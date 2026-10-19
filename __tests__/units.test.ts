import forge from 'node-forge';
import {
  APIError, APIErrorType, AppEnvironment, BMCookie, Failure, HTTPStatusCode, HybridPayloadEncryptor,
  NetworkInspector, ReconnectPolicies, RsaPadding, Success, Target, appEnvironmentFromString,
  base64Decode, base64Encode, httpStatusCodeFrom, parseSetCookieHeader, utf8Decode, utf8Encode,
} from '../src/core';
import { resolveUrl } from '../src/utils/url';
import { TestTarget, resetAll } from './helpers';

beforeEach(resetAll);

test('Target composes the base URL', () => {
  expect(new TestTarget().kBaseURL).toBe('https://api.example.com/api/v1/');
  class Bare extends Target { get kAppHost() { return '/host.io/'; } get kAppScheme() { return 'http'; } get kAppPort() { return 8080; } }
  expect(new Bare().kBaseURL).toBe('http://host.io:8080/');
});

test('URL resolution follows Uri.resolve semantics', () => {
  const base = 'https://a.com/api/v1/';
  expect(resolveUrl(base, 'users')).toBe('https://a.com/api/v1/users');
  expect(resolveUrl(base, '/users')).toBe('https://a.com/users');
  expect(resolveUrl(base, 'https://b.com/x')).toBe('https://b.com/x');
});

test('status categories and environments', () => {
  expect(httpStatusCodeFrom(200)).toBe(HTTPStatusCode.success);
  expect(httpStatusCodeFrom(401)).toBe(HTTPStatusCode.notAuthorize);
  expect(httpStatusCodeFrom(404)).toBe(HTTPStatusCode.notFound);
  expect(httpStatusCodeFrom(418)).toBe(HTTPStatusCode.clientError);
  expect(httpStatusCodeFrom(503)).toBe(HTTPStatusCode.serverError);
  expect(appEnvironmentFromString('PROD')).toBe(AppEnvironment.production);
  expect(appEnvironmentFromString('???')).toBe(AppEnvironment.development);
});

test('APIError messages and typed error model', () => {
  const e = new APIError(APIErrorType.httpError, { statusCode: HTTPStatusCode.notFound, errorModel: { m: 1 } });
  expect(e).toBeInstanceOf(APIError);
  expect(e).toBeInstanceOf(Error);
  expect(e.toString()).toContain('notFound');
  expect(e.errorModelAs<{ m: number }>()?.m).toBe(1);
});

test('Result helpers', () => {
  const ok = new Success<number, string>(2);
  const bad = new Failure<number, string>('no');
  expect(ok.map((n) => n * 2).value).toBe(4);
  expect(bad.mapError((e) => e.toUpperCase()).error).toBe('NO');
  expect(ok.when({ success: (v) => `s${v}`, failure: (e) => e })).toBe('s2');
  expect(bad.when({ success: () => 'x', failure: (e) => e })).toBe('no');
});

test('cookies parse including Expires commas', () => {
  const cookies = parseSetCookieHeader('a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Secure, b=2; Path=/x');
  expect(cookies.map((c) => c.name)).toEqual(['a', 'b']);
  expect(cookies[0].secure).toBe(true);
  expect(BMCookie.fromSetCookieValue('z=9; Domain=d.com').domain).toBe('d.com');
});

test('byte helpers round-trip', () => {
  const s = 'héllo 😀 世界';
  expect(utf8Decode(utf8Encode(s))).toBe(s);
  const b = new Uint8Array([0, 1, 2, 250, 255]);
  expect(Array.from(base64Decode(base64Encode(b)))).toEqual(Array.from(b));
  expect(base64Encode(utf8Encode('Man'))).toBe('TWFu');
});

test('reconnect policy backs off, caps and jitters', () => {
  const p = ReconnectPolicies.exponential({ initial: 1000, max: 5000, factor: 2, jitter: 0, random: () => 0.5 });
  expect([1, 2, 3, 4, 5].map((n) => p.delayFor(n))).toEqual([1000, 2000, 4000, 5000, 5000]);
  expect(ReconnectPolicies.fixed(250).delayFor(9)).toBe(250);
});

describe('HybridPayloadEncryptor', () => {
  const { privateKey, publicKey } = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
  const pem = forge.pki.publicKeyToPem(publicKey);
  const randomBytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 255);

  function decrypt(envelope: any, scheme: any, hexKey: boolean) {
    const wrapped = privateKey.decrypt(forge.util.decode64(envelope.key), scheme);
    const key = hexKey ? forge.util.hexToBytes(wrapped) : wrapped;
    const d = forge.cipher.createDecipher('AES-CBC', key);
    d.start({ iv: forge.util.decode64(envelope.iv) });
    d.update(forge.util.createBuffer(forge.util.decode64(envelope.data)));
    d.finish();
    return JSON.parse(forge.util.decodeUtf8(d.output.getBytes()));
  }

  test.each([
    [RsaPadding.pkcs1v15, 'RSAES-PKCS1-V1_5'],
    [RsaPadding.oaepSha1, 'RSA-OAEP'],
  ])('round-trips with %s', (rsaPadding, scheme) => {
    const enc = new HybridPayloadEncryptor({ publicKeyPem: pem, rsaPadding, randomBytes });
    const body = { name: 'Ann', tags: ['é', '世'] };
    expect(decrypt(enc.encrypt(body), scheme, true)).toEqual(body);
  });

  test('raw key bytes and custom field names', () => {
    const enc = new HybridPayloadEncryptor({
      publicKeyPem: pem.replace(/\n/g, '\\n'), aesKeyFormat: 'rawBytes' as any, dataField: 'd', ivField: 'i', keyField: 'k', randomBytes,
    });
    const out: any = enc.encrypt({ a: 1 });
    expect(Object.keys(out).sort()).toEqual(['d', 'i', 'k']);
    expect(decrypt({ data: out.d, iv: out.i, key: out.k }, 'RSAES-PKCS1-V1_5', false)).toEqual({ a: 1 });
  });

  test('a bad key fails with encryptionFailed', () => {
    expect(() => new HybridPayloadEncryptor({ publicKeyPem: 'nope' })).toThrow(APIError);
  });
});

test('inspector keeps newest first, caps entries and updates by id', () => {
  const i = NetworkInspector.instance;
  const seen = jest.fn();
  const off = i.subscribe(seen);
  const first = i.logRequest({ method: 'GET', url: 'https://x/1' });
  i.logRequest({ method: 'GET', url: 'https://x/2' });
  i.logResponse({ entry: first, statusCode: 500, duration: 5 });
  expect(i.logs.map((l) => l.url)).toEqual(['https://x/2', 'https://x/1']);
  expect(i.logs[1].statusCode).toBe(500);
  expect(seen).toHaveBeenCalledTimes(3);
  for (let n = 0; n < 250; n++) i.logRequest({ method: 'GET', url: `https://x/${n}` });
  expect(i.logs).toHaveLength(NetworkInspector.maxEntries);
  off();
});
