import forge from 'node-forge';
import {
  APIError, APIErrorType, AesKeyFormat, AuthInterceptor, BMRequest, CancelToken, FetchTransport, HTTPMethod, HybridPayloadEncryptor,
  LoggingInterceptor, Logger, NetworkClient, NetworkInspector, NetworkMonitor, RequestGuard, RsaPadding, SSLPinningHelper,
  accelerometerShakeSource, currentFileSystem, defaultFileSystem, NetworkConfig, utf8Encode, utf8Decode,
} from '../src/core';
import { jsonResponse, resetAll } from './helpers';

beforeEach(resetAll);

const OPTIONAL = ['@react-native-community/netinfo', 'expo-sensors', 'expo-file-system', 'expo-file-system/legacy'];
const missing = (...names: string[]) => names.forEach((n) => jest.doMock(n, () => { throw new Error('not installed'); }, { virtual: true }));
const mock = (name: string, factory: () => unknown) => jest.doMock(name, factory, { virtual: true });
beforeEach(() => { jest.resetModules(); missing(...OPTIONAL); });

const req = (over: Partial<BMRequest> = {}): BMRequest => ({ method: HTTPMethod.get, url: 'https://x/y', headers: {}, ...over });

describe('NetworkMonitor', () => {
  test('without a provider the device is assumed online', async () => {
    NetworkMonitor.reset();
    expect(await NetworkMonitor.isConnected()).toBe(true); // netinfo not installed
    NetworkMonitor.start(); // already resolved: no-op
    const off = NetworkMonitor.subscribe(() => {});
    off();
  });

  test('NetInfo provider: default export, null means unknown (online), changes propagate', async () => {
    NetworkMonitor.reset();
    let listener: (s: any) => void = () => {};
    jest.doMock('@react-native-community/netinfo', () => ({
      default: { fetch: async () => ({ isConnected: null }), addEventListener: (l: any) => { listener = l; return () => {}; } },
    }), { virtual: true });
    const seen: boolean[] = [];
    NetworkMonitor.subscribe((o) => seen.push(o));
    expect(await NetworkMonitor.isConnected()).toBe(true);
    listener({ isConnected: false }); listener({ isConnected: true }); listener({ isConnected: null });
    expect(seen).toEqual([false, true, true]);
    
  });

  test('NetInfo as a CommonJS module without default', async () => {
    NetworkMonitor.reset();
    mock('@react-native-community/netinfo', () => ({ fetch: async () => ({ isConnected: false }), addEventListener: () => () => {} }));
    NetworkMonitor.offlineRecheckDelay = 1;
    expect(await NetworkMonitor.isConnected()).toBe(false);
  });

  test('a module without fetch is ignored', async () => {
    NetworkMonitor.reset();
    mock('@react-native-community/netinfo', () => ({}));
    expect(await NetworkMonitor.isConnected()).toBe(true);
  });

  test('offline is re-checked once before giving up; a failing provider counts as online', async () => {
    NetworkMonitor.offlineRecheckDelay = 1;
    const answers = [false, true];
    NetworkMonitor.setProvider({ isOnline: async () => answers.shift()!, subscribe: () => () => {} });
    expect(await NetworkMonitor.isConnected()).toBe(true);
    NetworkMonitor.setProvider({ isOnline: async () => { throw new Error('x'); }, subscribe: () => () => {} });
    expect(await NetworkMonitor.isConnected()).toBe(true);
  });

  test('setProvider replaces and detaches the previous subscription; subscribe errors are swallowed', () => {
    const unsub = jest.fn();
    NetworkMonitor.setProvider({ isOnline: async () => true, subscribe: () => unsub });
    NetworkMonitor.setProvider({ isOnline: async () => true, subscribe: () => { throw new Error('no module'); } });
    expect(unsub).toHaveBeenCalledTimes(1);
    NetworkMonitor.setProvider(undefined);
    NetworkMonitor.reset();
    NetworkMonitor.reset();
  });
});

describe('RequestGuard', () => {
  test('ignores online events, survives a throwing connectivity source, and disposes', async () => {
    let notify: (o: boolean) => void = () => {};
    const unsub = jest.fn();
    const guard = new RequestGuard({ isMutating: false, onAbort: jest.fn(), subscribeConnectivity: (l) => { notify = l; return unsub; } });
    const result = guard.run(async () => { notify(true); return 7; });
    await expect(result).resolves.toBe(7);
    guard.dispose();
    guard.dispose();
    expect(unsub).toHaveBeenCalledTimes(1);

    const broken = new RequestGuard({ isMutating: false, onAbort: jest.fn(), subscribeConnectivity: () => { throw new Error('x'); } });
    await expect(broken.run(async () => 1)).resolves.toBe(1);
  });

  test('defaults to NetworkMonitor, fails fast when pre-cancelled and aborts only once', async () => {
    const token = new CancelToken();
    token.cancel();
    const g1 = new RequestGuard({ isMutating: false, cancelToken: token, onAbort: jest.fn() });
    await expect(g1.run(async () => 1)).rejects.toMatchObject({ type: APIErrorType.cancelled });

    let notify: (o: boolean) => void = () => {};
    NetworkMonitor.setProvider({ isOnline: async () => true, subscribe: (l) => { notify = l; return () => {}; } });
    const onAbort = jest.fn();
    const t2 = new CancelToken();
    const g2 = new RequestGuard({ isMutating: true, cancelToken: t2, onAbort });
    const pending = g2.run(() => new Promise<number>(() => {}));
    notify(false); notify(false); t2.cancel();
    await expect(pending).rejects.toMatchObject({ type: APIErrorType.connectionLostDuringRequest });
    await new Promise((r) => setTimeout(r, 0));
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(g2.isAborted).toBe(true);
    g2.dispose();
  });

  test('action rejections propagate', async () => {
    const g = new RequestGuard({ isMutating: false, onAbort: jest.fn(), subscribeConnectivity: () => () => {} });
    await expect(g.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});

describe('FetchTransport', () => {
  afterEach(() => { delete (globalThis as any).fetch; });
  test('maps the fetch response, lower-casing headers', async () => {
    const calls: any[] = [];
    (globalThis as any).fetch = async (url: string, init: any) => {
      calls.push([url, init]);
      return { status: 201, statusText: 'Created', url: '', headers: new Map([['Content-Type', 'a/b']]), arrayBuffer: async () => new Uint8Array([1, 2]).buffer };
    };
    const signal = new AbortController().signal;
    const res = await new FetchTransport().send(req({ method: HTTPMethod.post, body: 'b', headers: { h: '1' } }), { signal });
    expect(calls[0]).toEqual(['https://x/y', { method: 'POST', headers: { h: '1' }, body: 'b', signal }]);
    expect([res.status, res.headers, res.url]).toEqual([201, { 'content-type': 'a/b' }, 'https://x/y']);
    expect(Array.from(await res.readBody())).toEqual([1, 2]);
  });
  test('uses the final URL and works without options', async () => {
    (globalThis as any).fetch = async () => ({ status: 200, url: 'https://final/', headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) });
    expect((await new FetchTransport().send(req())).url).toBe('https://final/');
  });
});

describe('NetworkClient', () => {
  const ok = jsonResponse(200, {});
  test('works without interceptors', async () => {
    expect(await new NetworkClient({ send: async () => ok }).send(req())).toBe(ok);
  });

  test('runs hooks in order and tolerates partial interceptors', async () => {
    const order: string[] = [];
    const client = new NetworkClient({ send: async (r) => { order.push('send:' + r.url); return ok; } }, [
      { onRequest: (r) => { order.push('a.req'); return { ...r, url: r.url + '1' }; }, onResponse: (_r, res) => { order.push('a.res'); return res; } },
      {},
      { onRequest: (r) => { order.push('b.req'); return r; }, onResponse: (_r, res) => { order.push('b.res'); return res; } },
    ]);
    await client.send(req());
    expect(order).toEqual(['a.req', 'b.req', 'send:https://x/y1', 'b.res', 'a.res']);
  });

  test('onError can recover, otherwise the error is rethrown', async () => {
    const fail = { send: async () => { throw new Error('net'); } };
    const recovered = await new NetworkClient(fail, [{}, { onError: () => undefined }, { onError: () => ok }]).send(req());
    expect(recovered).toBe(ok);
    await expect(new NetworkClient(fail, [{ onError: () => undefined }]).send(req())).rejects.toThrow('net');
    await expect(new NetworkClient(fail, [{}]).send(req())).rejects.toThrow('net');
  });
});

describe('AuthInterceptor', () => {
  const unauthorized = jsonResponse(401, {});
  test('retries once, ignores non-401, and honours shouldRetry', async () => {
    const retried = jsonResponse(200, { r: 1 });
    const retry = jest.fn(async () => retried);
    const refreshRequest = jest.fn(async () => req());
    const auth = new AuthInterceptor({ isAuthorized: true, refreshRequest, retry });
    expect(await auth.onResponse(req(), ok())).toBeDefined();
    expect(await auth.onResponse(req(), unauthorized)).toBe(retried);
    expect(await auth.onResponse(req(), unauthorized)).toBe(unauthorized); // already retried once
    const never = new AuthInterceptor({ isAuthorized: true, refreshRequest, retry, shouldRetry: () => false });
    expect(await never.onResponse(req(), unauthorized)).toBe(unauthorized);
    const failing = new AuthInterceptor({ isAuthorized: true, refreshRequest: async () => { throw new Error('x'); }, retry });
    expect(await failing.onResponse(req(), unauthorized)).toBe(unauthorized);
    function ok() { return jsonResponse(200, {}); }
  });
});

const defaultSink = Logger.sink;

describe('Logger', () => {
  let lines: string[];
  beforeEach(() => { lines = []; Logger.sink = (m) => lines.push(m); Logger.isEnabled = true; });
  afterEach(() => { Logger.sink = (m) => console.log(m); });

  test('request formatting for each body kind', () => {
    Logger.logRequest({ method: 'POST', url: 'u', headers: { a: 'b' }, parameters: { p: 1 }, body: '{"x":1}' });
    Logger.logRequest({ method: 'POST', url: 'u', body: utf8Encode('plain text') });
    Logger.logRequest({ method: 'GET', url: 'u', headers: {}, parameters: {} });
    const text = lines.join('\n');
    expect(text).toContain('🏷 Headers:');
    expect(text).toContain('a : b');
    expect(text).toContain('Parameters: {\n  "p": 1\n}');
    expect(text).toContain('"x": 1');
    expect(text).toContain('Body: plain text');
    expect(text).toContain('Body: Empty');
  });

  test('response formatting', () => {
    Logger.logResponse({ method: 'GET', url: 'u', statusCode: 200, responseData: utf8Encode('{"ok":true}') });
    Logger.logResponse({ method: 'GET', url: 'u', statusCode: 500, responseData: new Uint8Array() });
    Logger.logResponse({ method: 'GET', url: 'u', statusCode: 500 });
    Logger.logResponse({ method: 'GET', url: 'u', error: 'bad' });
    Logger.logResponse({ method: 'GET', url: 'u', statusCode: 400, error: 'bad' });
    const text = lines.join('\n');
    expect(text).toContain('✅ Did receive response 200');
    expect(text).toContain('⚠️ Did receive response 500');
    expect(text).toContain('"ok": true');
    expect(text).toContain('Body: Empty or Void...');
    expect(text).toContain('❌  GET request for u returned Error: bad');
    expect(text).toContain('❌ 400 GET');
  });

  test('is silent when disabled and unserialisable parameters fall back to String()', () => {
    Logger.isEnabled = false;
    Logger.logRequest({ method: 'GET', url: 'u' });
    Logger.logResponse({ method: 'GET', url: 'u' });
    expect(lines).toEqual([]);
    Logger.isEnabled = true;
    const circular: any = {}; circular.c = circular;
    Logger.logRequest({ method: 'GET', url: 'u', parameters: circular });
    expect(lines.join('')).toContain('[object Object]');
  });

  test('default sink writes to console.log; default enablement follows __DEV__', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    Logger.sink = defaultSink;
    Logger.logResponse({ method: 'GET', url: 'u', statusCode: 200 });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect(Logger.isEnabled).toBe(true);
    const fresh = () => {
      let enabled!: boolean;
      jest.isolateModules(() => { enabled = require('../src/network/core/logger').Logger.isEnabled; });
      return enabled;
    };
    expect(fresh()).toBe(false);
    (globalThis as any).__DEV__ = true;
    expect(fresh()).toBe(true);
    delete (globalThis as any).__DEV__;
    expect(fresh()).toBe(false);
    (globalThis as any).__DEV__ = false;
  });
});

describe('LoggingInterceptor', () => {
  beforeEach(() => { Logger.sink = () => {}; });
  afterEach(() => { Logger.sink = (m) => console.log(m); });

  test('captures request, response and error when enabled', async () => {
    Logger.isEnabled = true;
    const li = new LoggingInterceptor();
    li.onRequest(req({ body: '{"a":1}' }));
    const res = await li.onResponse(req(), jsonResponse(200, { ok: 1 }));
    expect(utf8Decode(await res.readBody())).toBe('{"ok":1}');
    expect(NetworkInspector.instance.logs[0]).toMatchObject({ statusCode: 200 });
    expect(NetworkInspector.instance.logs[0].requestBody).toBeDefined();

    const li2 = new LoggingInterceptor();
    li2.onRequest(req({ body: new Uint8Array([1]) }));
    expect(li2.onError(req(), new Error('x'))).toBeUndefined();
    expect(NetworkInspector.instance.logs[0].error).toBeInstanceOf(Error);
  });

  test('is a pass-through when disabled', async () => {
    Logger.isEnabled = false;
    const li = new LoggingInterceptor();
    const r = req();
    expect(li.onRequest(r)).toBe(r);
    const res = jsonResponse(200, {});
    expect(await li.onResponse(r, res)).toBe(res);
    expect(li.onError(r, new Error('x'))).toBeUndefined();
    expect(NetworkInspector.instance.logs).toHaveLength(0);
  });
});

describe('NetworkInspector', () => {
  test('state transitions and ignored updates for missing entries', () => {
    const i = NetworkInspector.instance;
    const snap = i.getSnapshot();
    i.logResponse({ statusCode: 200 });
    i.logError({ error: 'x' });
    expect(i.getSnapshot()).toBe(snap);
    expect(i.getSnapshot().brightness).toBe('dark');
    i.toggleBrightness();
    expect(i.getSnapshot().brightness).toBe('light');
    i.toggleBrightness();
    expect(i.getSnapshot().brightness).toBe('dark');
    i.open();
    expect(i.getSnapshot().visible).toBe(true);
    i.close();
    expect(i.getSnapshot().visible).toBe(false);
    const e = i.logRequest({ method: 'GET', url: 'u' });
    i.logError({ entry: e, error: 'bad', duration: 3 });
    expect(i.logs[0]).toMatchObject({ error: 'bad', duration: 3 });
  });
});

describe('accelerometerShakeSource', () => {
    test('is a no-op without expo-sensors', () => {
    const off = accelerometerShakeSource()(() => {});
    expect(off()).toBeUndefined();
  });

  test('fires on a strong shake, respects the cooldown, and unsubscribes', () => {
    let handler: (v: { x: number; y: number; z: number }) => void = () => {};
    const remove = jest.fn();
    const setUpdateInterval = jest.fn();
    jest.doMock('expo-sensors', () => ({ Accelerometer: { setUpdateInterval, addListener: (h: any) => { handler = h; return { remove }; } } }), { virtual: true });
    const onShake = jest.fn();
    const off = accelerometerShakeSource({ threshold: 2, cooldownMs: 10_000 })(onShake);
    handler({ x: 0, y: 0, z: 1 });
    handler({ x: 2, y: 2, z: 2 });
    handler({ x: 2, y: 2, z: 2 });
    expect(onShake).toHaveBeenCalledTimes(1);
    expect(setUpdateInterval).toHaveBeenCalledWith(100);
    off();
    expect(remove).toHaveBeenCalled();
  });

  test('copes with an Accelerometer lacking setUpdateInterval and a subscription lacking remove', () => {
    mock('expo-sensors', () => ({ Accelerometer: { addListener: () => undefined } }));
    const off = accelerometerShakeSource()(() => {});
    expect(off()).toBeUndefined();
  });
});

describe('file system', () => {
  afterEach(() => { delete (globalThis as any).fetch; });

  test('readBytes prefixes bare paths with file://', async () => {
    const urls: string[] = [];
    (globalThis as any).fetch = async (u: string) => { urls.push(u); return { arrayBuffer: async () => new Uint8Array([9]).buffer }; };
    expect(Array.from(await defaultFileSystem.readBytes('/tmp/a'))).toEqual([9]);
    await defaultFileSystem.readBytes('content://doc/1');
    expect(urls).toEqual(['file:///tmp/a', 'content://doc/1']);
  });

  test('writeTemp uses expo-file-system (legacy first)', async () => {
    const write = jest.fn(async () => {});
    mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///cache/', writeAsStringAsync: write }));
    expect(await defaultFileSystem.writeTemp('f.bin', Uint8Array.from([1, 2, 3]))).toBe('file:///cache/f.bin');
    expect(write).toHaveBeenCalledWith('file:///cache/f.bin', 'AQID', { encoding: 'base64' });
  });

  test('writeTemp fails with invalidURL when no usable module exists', async () => {
    await expect(defaultFileSystem.writeTemp('f', new Uint8Array())).rejects.toMatchObject({ type: APIErrorType.invalidURL });
    mock('expo-file-system/legacy', () => ({ cacheDirectory: null, writeAsStringAsync: async () => {} }));
    await expect(defaultFileSystem.writeTemp('f', new Uint8Array())).rejects.toBeInstanceOf(APIError);
    mock('expo-file-system/legacy', () => ({ cacheDirectory: '/c/' }));
    await expect(defaultFileSystem.writeTemp('f', new Uint8Array())).rejects.toBeInstanceOf(APIError);
  });

  test('currentFileSystem prefers the configured adapter', () => {
    expect(currentFileSystem()).toBe(defaultFileSystem);
    const custom = { readBytes: jest.fn(), writeTemp: jest.fn() };
    NetworkConfig.configure({ fileSystem: custom });
    expect(currentFileSystem()).toBe(custom);
  });
});

describe('SSLPinningHelper', () => {
  const init = jest.fn(async () => {});
  beforeEach(() => { init.mockClear(); SSLPinningHelper.loadModule = () => ({ initializeSslPinning: init }); });
  afterAll(() => { SSLPinningHelper.loadModule = () => undefined; });

  test('merges pins per host, prefixes hashes and applies each configuration once', async () => {
    await SSLPinningHelper.ensureApplied({ pinnedHosts: ['a.com'], pinnedPublicKeyHashes: ['H1', 'sha256/H2'] });
    await SSLPinningHelper.ensureApplied({ pinnedHosts: ['a.com'], pinnedPublicKeyHashes: ['H1', 'sha256/H2'] });
    expect(init).toHaveBeenCalledTimes(1);
    await SSLPinningHelper.ensureApplied({ pinnedHosts: ['a.com', 'b.com'], pinnedPublicKeyHashes: ['H3'], includeSubdomains: true });
    expect(init).toHaveBeenLastCalledWith({
      'a.com': { includeSubdomains: true, publicKeyHashes: ['sha256/H1', 'sha256/H2', 'sha256/H3'] },
      'b.com': { includeSubdomains: true, publicKeyHashes: ['sha256/H3'] },
    });
    await SSLPinningHelper.ensureApplied({ pinnedHosts: ['a.com'], pinnedPublicKeyHashes: ['H4'] });
    expect((init.mock.calls.at(-1) as any)[0]['a.com'].includeSubdomains).toBe(true);
  });

  test('disabled configurations are skipped', async () => {
    await SSLPinningHelper.ensureApplied({ isEnabled: false });
    expect(init).not.toHaveBeenCalled();
  });

  test.each([
    ['module missing', () => undefined, { pinnedHosts: ['a'], pinnedPublicKeyHashes: ['h'] }],
    ['no hosts', () => ({ initializeSslPinning: init }), { pinnedPublicKeyHashes: ['h'] }],
    ['no hashes', () => ({ initializeSslPinning: init }), { pinnedHosts: ['a'] }],
    ['init throws', () => ({ initializeSslPinning: async () => { throw new Error('x'); } }), { pinnedHosts: ['a'], pinnedPublicKeyHashes: ['h'] }],
  ])('%s fails closed unless allowFallback', async (_n, load, cfg) => {
    SSLPinningHelper.loadModule = load as any;
    await expect(SSLPinningHelper.ensureApplied(cfg)).rejects.toMatchObject({ type: APIErrorType.sslPinningUnavailable });
    await expect(SSLPinningHelper.ensureApplied({ ...cfg, allowFallback: true })).resolves.toBeUndefined();
  });

  test('the default loader resolves the optional module', () => {
    jest.isolateModules(() => {
      const { SSLPinningHelper: Fresh } = require('../src/ssl/ssl-pinning-helper');
      expect(Fresh.loadModule()).toBeUndefined();
    });
  });
});

describe('HybridPayloadEncryptor', () => {
  const { privateKey, publicKey } = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
  const pem = forge.pki.publicKeyToPem(publicKey);
  const randomBytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 11 + 5) & 255);

  test('OAEP-SHA256 with a 256-bit key', () => {
    const enc = new HybridPayloadEncryptor({ publicKeyPem: pem, rsaPadding: RsaPadding.oaepSha256, aesKeyBits: 256, aesKeyFormat: AesKeyFormat.rawBytes, randomBytes });
    const out: any = enc.encrypt({ z: 1 });
    const key = privateKey.decrypt(forge.util.decode64(out.key), 'RSA-OAEP', { md: forge.md.sha256.create() });
    expect(key).toHaveLength(32);
  });

  test('PKCS#1 RSA PUBLIC KEY PEM is accepted', () => {
    const pkcs1 = forge.pki.publicKeyToRSAPublicKeyPem(publicKey);
    expect(() => new HybridPayloadEncryptor({ publicKeyPem: pkcs1, randomBytes })).not.toThrow();
  });

  test('encryption failures become encryptionFailed; APIErrors pass through', () => {
    const bad = new HybridPayloadEncryptor({ publicKeyPem: pem, randomBytes: () => { throw new Error('rng'); } });
    expect(() => bad.encrypt({})).toThrow(expect.objectContaining({ type: APIErrorType.encryptionFailed }));
    const passthrough = new HybridPayloadEncryptor({ publicKeyPem: pem, randomBytes: () => { throw new APIError(APIErrorType.timeout); } });
    expect(() => passthrough.encrypt({})).toThrow(expect.objectContaining({ type: APIErrorType.timeout }));
  });

  test('the default random source uses crypto.getRandomValues, and reports when it is missing', () => {
    const enc = new HybridPayloadEncryptor({ publicKeyPem: pem });
    const original = (globalThis as any).crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    expect(() => enc.encrypt({})).toThrow(expect.objectContaining({ type: APIErrorType.encryptionFailed }));
    Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues: (a: Uint8Array) => a.fill(7) }, configurable: true });
    expect(() => enc.encrypt({})).not.toThrow();
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
    expect(() => enc.encrypt({})).toThrow(APIError);
    Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
  });
});
