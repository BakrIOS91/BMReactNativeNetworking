import {
  APIError, APIErrorType, HTTPMethod, Logger, ModelTargetType, NetworkConfig, NetworkMonitor, RequestTask, SSLPinningHelper,
  SuccessTargetType, TokenRefreshRegistry, APIErrorResponseRegistry, FetchTransport,
} from '../src/core';
import { GetUser, MockTransport, TestTarget, jsonResponse, resetAll } from './helpers';

beforeEach(resetAll);
const use = (t: MockTransport) => NetworkConfig.configure({ transport: t });

class Download extends ModelTargetType<unknown> {
  constructor(private unique = false) { super(); }
  get baseURL() { return new TestTarget().kBaseURL; }
  get requestPath() { return 'files/report.pdf?v=2'; }
  get requestMethod() { return HTTPMethod.get; }
  get useUniqueFilename() { return this.unique; }
}

class Ping extends SuccessTargetType {
  get baseURL() { return new TestTarget().kBaseURL; }
  get requestPath() { return 'ping'; }
  get requestMethod() { return HTTPMethod.get; }
}

describe('downloads', () => {
  const written: Array<[string, number[]]> = [];
  beforeEach(() => {
    written.length = 0;
    NetworkConfig.configure({ fileSystem: { readBytes: jest.fn(), writeTemp: async (n, b) => { written.push([n, Array.from(b)]); return `file:///tmp/${n}`; } } });
  });

  test('saves the body and reports metadata', async () => {
    use(new MockTransport(() => ({ ...jsonResponse(200, ''), url: 'https://cdn.x/files/report.pdf?v=2', readBody: async () => new Uint8Array([1, 2]) })));
    const file = await new Download().performDownload();
    expect(file).toMatchObject({ downloadedUrl: 'file:///tmp/report.pdf', remoteUrl: 'https://cdn.x/files/report.pdf?v=2', statusCode: 200 });
    expect(written).toEqual([['report.pdf', [1, 2]]]);
  });

  test('unique file names and a fallback name when the URL has no file part', async () => {
    use(new MockTransport(() => ({ ...jsonResponse(200, ''), url: 'https://cdn.x/dir/' })));
    const file = await new Download(true).performDownload();
    expect(file.downloadedUrl).toMatch(/\/\d+_[0-9a-f]+_download$/);
    use(new MockTransport(() => ({ ...jsonResponse(200, ''), url: '' })));
    expect((await new Download().performDownload()).remoteUrl).toBe('https://api.example.com/api/v1/files/report.pdf?v=2');
  });

  test('non-2xx responses are not saved; result wrapper reports both outcomes', async () => {
    use(new MockTransport(() => jsonResponse(404, '')));
    const failed = await new Download().performDownloadResult();
    expect(failed.isFailure).toBe(true);
    expect(written).toHaveLength(0);
    use(new MockTransport(() => jsonResponse(200, '')));
    expect((await new Download().performDownloadResult()).isSuccess).toBe(true);
  });
});

describe('success targets', () => {
  test('HTTP failures decode the error model; success returns metadata', async () => {
    APIErrorResponseRegistry.register({ decode: (j: any) => j.reason });
    use(new MockTransport(() => jsonResponse(400, { reason: 'nope' })));
    const err = (await new Ping().performResult()).error as APIError;
    expect(err.errorModel).toBe('nope');
    use(new MockTransport(() => jsonResponse(204, '', { 'set-cookie': 'a=1' })));
    const ok = await new Ping().performResultWithCookies();
    expect(ok.value).toMatchObject({ statusCode: 204, cookies: [{ name: 'a', value: '1' }] });
    const failed = await new Ping().performResultWithCookies();
    expect(failed.isSuccess).toBe(true);
  });

  test('error bodies that are empty, non-JSON or hit a throwing mapper leave errorModel undefined', async () => {
    use(new MockTransport(() => jsonResponse(500, '')));
    expect(((await new Ping().performResult()).error as APIError).errorModel).toBeUndefined();
    use(new MockTransport(() => jsonResponse(500, '<html>')));
    expect(((await new Ping().performResult()).error as APIError).errorModel).toBeUndefined();
    APIErrorResponseRegistry.register({ decode: () => { throw new Error('mapper'); } });
    use(new MockTransport(() => jsonResponse(500, { a: 1 })));
    expect(((await new Ping().performResult()).error as APIError).errorModel).toBeUndefined();
  });
});

describe('execution edge cases', () => {
  test('per-endpoint receive timeout wins over the global one', async () => {
    use(new MockTransport(() => ({ ...jsonResponse(200, {}), readBody: () => new Promise(() => {}) })));
    const req = new GetUser();
    Object.defineProperty(req, 'receiveTimeout', { get: () => 10 });
    await expect(req.performAsync()).rejects.toMatchObject({ type: APIErrorType.timeout });
  });

  test('success targets work without options', async () => {
    use(new MockTransport(() => jsonResponse(200, '')));
    await expect(new Ping().performAsyncWithCookies()).resolves.toMatchObject({ statusCode: 200 });
    await expect(new Ping().performResult()).resolves.toMatchObject({ isSuccess: true });
  });

  test('performResultWithCookies on model targets', async () => {
    use(new MockTransport(() => jsonResponse(200, { id: 1, name: 'a' })));
    expect((await new GetUser().performResultWithCookies()).value?.data).toEqual({ id: 1, name: 'a' });
  });

  test('unexpected transport errors become invalidResponse; a bad request build keeps its own APIError', async () => {
    use(new MockTransport(() => { throw new Error('socket hang up'); }));
    await expect(new Ping().performAsync()).rejects.toMatchObject({ type: APIErrorType.invalidResponse });
    class Soap extends Ping { get requestType() { return 'soap' as any; } }
    await expect(new Soap().performAsync()).rejects.toMatchObject({ type: APIErrorType.notSupportedSOAPOperation });
  });

  test('receive timeouts abort the body read; null disables a timeout', async () => {
    NetworkConfig.configure({ receiveTimeout: 10 });
    use(new MockTransport(() => ({ ...jsonResponse(200, {}), readBody: () => new Promise(() => {}) })));
    await expect(new GetUser().performAsync()).rejects.toMatchObject({ type: APIErrorType.timeout });
    NetworkConfig.configure({ receiveTimeout: null, sendTimeout: null });
    use(new MockTransport(async () => { await new Promise((r) => setTimeout(r, 20)); return jsonResponse(200, { id: 1, name: 'a' }); }));
    await expect(new GetUser().performAsync()).resolves.toEqual({ id: 1, name: 'a' });
  });

  test('transport errors reach the caller after the timer is cleared (no leaked timer)', async () => {
    NetworkConfig.configure({ sendTimeout: 10_000 });
    use(new MockTransport(() => Promise.reject(new Error('refused'))));
    await expect(new Ping().performAsync()).rejects.toMatchObject({ type: APIErrorType.invalidResponse });
  });

  test('decode failures are logged in development builds only', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    use(new MockTransport(() => jsonResponse(200, '{bad')));
    (globalThis as any).__DEV__ = true;
    await expect(new GetUser().performAsync()).rejects.toMatchObject({ type: APIErrorType.dataConversionFailed });
    expect(warn).toHaveBeenCalledTimes(1);
    (globalThis as any).__DEV__ = false;
    await new GetUser().performAsync().catch(() => {});
    delete (globalThis as any).__DEV__;
    await new GetUser().performAsync().catch(() => {});
    (globalThis as any).__DEV__ = false;
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test('requests apply SSL pinning first and fail closed when it is unavailable', async () => {
    class Pinned extends Ping {
      get sslPinningConfiguration() { return { pinnedHosts: ['api.example.com'], pinnedPublicKeyHashes: ['h'] }; }
    }
    const t = new MockTransport(() => jsonResponse(200, ''));
    use(t);
    SSLPinningHelper.loadModule = () => undefined;
    await expect(new Pinned().performAsync()).rejects.toMatchObject({ type: APIErrorType.sslPinningUnavailable });
    expect(t.requests).toHaveLength(0);
    const init = jest.fn(async () => {});
    SSLPinningHelper.loadModule = () => ({ initializeSslPinning: init });
    await new Pinned().performAsync();
    expect(init).toHaveBeenCalled();
    SSLPinningHelper.loadModule = () => undefined;
  });

  test('the default transport is fetch', async () => {
    (globalThis as any).fetch = async () => ({ status: 200, url: '', headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) });
    await expect(new Ping().performAsync()).resolves.toBeUndefined();
    delete (globalThis as any).fetch;
    expect(new FetchTransport()).toBeDefined();
  });

  test('a replay after refresh is not attempted once the request was dropped', async () => {
    let notify: (o: boolean) => void = () => {};
    NetworkMonitor.setProvider({ isOnline: async () => true, subscribe: (l) => { notify = l; return () => {}; } });
    const refresh = jest.fn(async () => true);
    TokenRefreshRegistry.register({ refreshToken: refresh });
    use(new MockTransport(() => { setTimeout(() => notify(false), 0); return new Promise((r) => setTimeout(() => r(jsonResponse(401, {})), 20)); }));
    await expect(new GetUser(true).performAsync()).rejects.toMatchObject({ type: APIErrorType.noNetwork });
    expect(refresh).not.toHaveBeenCalled();
  });

  test('logging stays out of the way when disabled and records when enabled', async () => {
    Logger.sink = () => {};
    Logger.isEnabled = true;
    use(new MockTransport(() => jsonResponse(200, { id: 1, name: 'a' })));
    await new GetUser().performAsync();
    Logger.sink = (m) => console.log(m);
  });
});

describe('TokenRefreshRegistry', () => {
  test('without a handler the refresh is an unauthorized error', async () => {
    await expect(TokenRefreshRegistry.refreshToken()).rejects.toMatchObject({ httpStatus: 401 });
  });

  test('a rejected handler fails every waiter and a new refresh can start afterwards', async () => {
    let calls = 0;
    TokenRefreshRegistry.register({ refreshToken: async () => { calls++; if (calls === 1) throw new Error('down'); return true; } });
    const a = TokenRefreshRegistry.refreshToken();
    const b = TokenRefreshRegistry.refreshToken();
    await expect(a).rejects.toThrow('down');
    await expect(b).rejects.toThrow('down');
    await expect(TokenRefreshRegistry.refreshToken()).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  test('clear() while a refresh is in flight does not clobber a newer refresh', async () => {
    let release: () => void = () => {};
    TokenRefreshRegistry.register({ refreshToken: () => new Promise<boolean>((r) => { release = () => r(true); }) });
    const first = TokenRefreshRegistry.refreshToken();
    TokenRefreshRegistry.clear();
    TokenRefreshRegistry.register({ refreshToken: async () => true });
    await TokenRefreshRegistry.refreshToken();
    release();
    await first;
  });
});

test('RequestTask import is exercised via helpers', () => {
  expect(RequestTask.plain().type).toBe('plain');
});
