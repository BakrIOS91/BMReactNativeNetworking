import {
  APIError, APIErrorType, AppEnvironment, BMCookie, CancelToken, Emitter, Failure, HTTPMethod, HTTPStatusCode,
  MultipartFormDataData, MultipartFormDataText, NetworkConfig, RequestTask, RequestTaskType, Success, appEnvironmentFromString,
  base64Decode, base64Encode, cookieHeader, httpStatusCodeFrom, isReadOnlyMethod, parseSetCookieHeader, utf8Decode, utf8Encode,
  ReconnectPolicies, isPending, isErrorEntry,
} from '../src/core';
import { buildQueryString, lastPathSegment, resolveUrl, withQuery } from '../src/utils/url';

describe('enums', () => {
  test.each([
    ['development', AppEnvironment.development], ['dev', AppEnvironment.development],
    ['testing', AppEnvironment.testing], ['TEST', AppEnvironment.testing],
    ['staging', AppEnvironment.staging],
    ['preproduction', AppEnvironment.preProduction], ['pre_production', AppEnvironment.preProduction],
    ['pre-production', AppEnvironment.preProduction], ['preprod', AppEnvironment.preProduction],
    ['production', AppEnvironment.production], ['prod', AppEnvironment.production],
    ['unknown', AppEnvironment.development],
  ])('appEnvironmentFromString(%s)', (input, expected) => {
    expect(appEnvironmentFromString(input)).toBe(expected);
  });

  test.each([
    [101, HTTPStatusCode.information], [204, HTTPStatusCode.success], [302, HTTPStatusCode.redirection],
    [401, HTTPStatusCode.notAuthorize], [404, HTTPStatusCode.notFound], [409, HTTPStatusCode.clientError],
    [500, HTTPStatusCode.serverError], [700, HTTPStatusCode.unknown], [99, HTTPStatusCode.unknown],
  ])('httpStatusCodeFrom(%i)', (code, expected) => expect(httpStatusCodeFrom(code)).toBe(expected));

  test('isReadOnlyMethod', () => {
    expect([HTTPMethod.get, HTTPMethod.head, HTTPMethod.options].every(isReadOnlyMethod)).toBe(true);
    expect([HTTPMethod.post, HTTPMethod.put, HTTPMethod.patch, HTTPMethod.delete].some(isReadOnlyMethod)).toBe(false);
  });
});

describe('APIError', () => {
  const messages: Record<APIErrorType, RegExp> = {
    [APIErrorType.invalidURL]: /Invalid URL/, [APIErrorType.dataConversionFailed]: /convert data/,
    [APIErrorType.stringConversionFailed]: /convert string/, [APIErrorType.httpError]: /HTTP Error with status code: notFound/,
    [APIErrorType.invalidSoapMultipartRequest]: /SOAP multipart/, [APIErrorType.xmlEncodingFailed]: /XML/,
    [APIErrorType.notSupportedSOAPOperation]: /not supported/, [APIErrorType.noNetwork]: /No internet/,
    [APIErrorType.invalidResponse]: /Invalid response/, [APIErrorType.encryptionFailed]: /encrypt/,
    [APIErrorType.timeout]: /timed out/, [APIErrorType.cancelled]: /cancelled/,
    [APIErrorType.connectionLostDuringRequest]: /connection was lost/, [APIErrorType.sslPinningUnavailable]: /SSL pinning/,
  };
  test.each(Object.entries(messages))('message for %s', (type, re) => {
    const e = new APIError(type as APIErrorType, { statusCode: HTTPStatusCode.notFound });
    expect(e.message).toMatch(re);
    expect(`${e}`).toBe(e.message);
    expect(e.name).toBe('APIError');
  });

  test('error model formatting', () => {
    expect(new APIError(APIErrorType.timeout, { errorModel: 'raw' }).message).toContain('(Error Data: raw)');
    expect(new APIError(APIErrorType.timeout, { errorModel: { a: 1 } }).message).toContain('{"a":1}');
    const circular: any = {}; circular.self = circular;
    expect(new APIError(APIErrorType.timeout, { errorModel: circular }).message).toContain('[object Object]');
    expect(new APIError(APIErrorType.timeout).errorModelAs()).toBeUndefined();
    expect(new APIError(APIErrorType.httpError, { httpStatus: 418 }).httpStatus).toBe(418);
  });
});

describe('cookies', () => {
  test('attributes, getters and defaults', () => {
    const c = BMCookie.fromSetCookieValue('id=1; Domain=d.com; Path=/p; Secure; HttpOnly; SameSite=Lax');
    expect([c.name, c.value, c.domain, c.path, c.secure, c.httpOnly]).toEqual(['id', '1', 'd.com', '/p', true, true]);
    const bare = new BMCookie('a', 'b');
    expect([bare.domain, bare.path, bare.secure, bare.httpOnly]).toEqual([undefined, undefined, false, false]);
    expect(BMCookie.fromSetCookieValue('flag').value).toBe('');
  });
  test('header parsing', () => {
    expect(parseSetCookieHeader(undefined)).toEqual([]);
    expect(parseSetCookieHeader(null)).toEqual([]);
    expect(parseSetCookieHeader('   ')).toEqual([]);
    expect(parseSetCookieHeader('a=1,, b=2,').map((c) => c.name)).toEqual(['a', 'b']);
    expect(parseSetCookieHeader('a=1; Expires=0; Path=/, b=2').map((c) => c.name)).toEqual(['a', 'b']);
    expect(parseSetCookieHeader('a=1; expires=Wed, 21 Oct 2026 07:28:00 GMT, b=2').map((c) => c.name)).toEqual(['a', 'b']);
  });
  test('cookieHeader', () => {
    expect(cookieHeader({ cookies: [] })).toBeUndefined();
    expect(cookieHeader({ cookies: [new BMCookie('a', '1'), new BMCookie('b', '2')] })).toBe('a=1; b=2');
  });
});

describe('Result', () => {
  test('success and failure variants', () => {
    const ok = new Success<number, string>(1);
    const bad = new Failure<number, string>('e');
    expect([ok.isSuccess, ok.isFailure, ok.error, bad.isSuccess, bad.isFailure, bad.value]).toEqual([true, false, undefined, false, true, undefined]);
    expect(ok.map((n) => n + 1).value).toBe(2);
    expect(bad.map((n) => n + 1).error).toBe('e');
    expect(ok.mapError((e) => e + '!').value).toBe(1);
    expect(bad.mapError((e) => e + '!').error).toBe('e!');
    expect(ok.when({ success: (v) => v, failure: () => -1 })).toBe(1);
    expect(bad.when({ success: () => 'x', failure: (e) => e })).toBe('e');
  });
});

describe('CancelToken', () => {
  test('cancel is idempotent and exposes the first reason', async () => {
    const t = new CancelToken();
    expect(t.isCancelled).toBe(false);
    t.cancel('first');
    t.cancel('second');
    await t.whenCancelled;
    expect([t.isCancelled, t.reason]).toEqual([true, 'first']);
  });
});

describe('RequestTask', () => {
  test('every factory', () => {
    const fields = { a: new MultipartFormDataText(1) };
    expect(RequestTask.plain().type).toBe(RequestTaskType.plain);
    expect(RequestTask.parameters({ a: 1 }).parameters).toEqual({ a: 1 });
    expect(RequestTask.encodedBody({ b: 2 }).body).toEqual({ b: 2 });
    expect(RequestTask.uploadFile('/f').filePath).toBe('/f');
    expect(RequestTask.uploadMultipart(fields).fields).toBe(fields);
    expect(RequestTask.download('https://x').url).toBe('https://x');
    const resume = new Uint8Array([1]);
    expect(RequestTask.downloadResumable({ resumeData: resume, offset: 5 })).toMatchObject({ offset: 5, resumeData: resume });
    expect(RequestTask.downloadResumable().offset).toBeUndefined();
    const both = RequestTask.parametersAndBody({ a: 1 }, { b: 2 });
    expect([both.parameters, both.body]).toEqual([{ a: 1 }, { b: 2 }]);
    expect(new MultipartFormDataData(new Uint8Array(), 'f', 'm').fileName).toBe('f');
  });
});

describe('NetworkConfig', () => {
  afterEach(() => NetworkConfig.reset());
  test('configure sets only provided values and reset restores defaults', () => {
    const encryptor = { encrypt: (b: unknown) => b };
    const transport = { send: jest.fn() };
    const fileSystem = { readBytes: jest.fn(), writeTemp: jest.fn() };
    NetworkConfig.configure({});
    expect(NetworkConfig.shouldEncrypt).toBe(false);
    NetworkConfig.configure({
      payloadEncryptor: encryptor, isPayloadEncryptionEnabled: false, encryptQueryParameters: true,
      sendTimeout: null, receiveTimeout: 5, transport, fileSystem,
    });
    expect([NetworkConfig.isPayloadEncryptionEnabled, NetworkConfig.encryptQueryParameters, NetworkConfig.sendTimeout, NetworkConfig.receiveTimeout])
      .toEqual([false, true, null, 5]);
    expect(NetworkConfig.shouldEncrypt).toBe(false);
    NetworkConfig.configure({ isPayloadEncryptionEnabled: true });
    expect(NetworkConfig.shouldEncrypt).toBe(true);
    NetworkConfig.reset();
    expect([NetworkConfig.payloadEncryptor, NetworkConfig.transport, NetworkConfig.fileSystem, NetworkConfig.sendTimeout]).toEqual([undefined, undefined, undefined, 30_000]);
  });
});

describe('utils', () => {
  test('bytes: all utf8 widths, malformed input and base64 padding', () => {
    const s = 'a é 世 😀';
    expect(utf8Decode(utf8Encode(s))).toBe(s);
    expect(Array.from(utf8Encode('\ud800'))).toEqual([0xed, 0xa0, 0x80]);
    expect(utf8Decode(Uint8Array.from([0xff]))).toBe('\ufffd');
    expect(utf8Decode(Uint8Array.from([0xe4, 0xb8]))).toContain('\ufffd');
    expect(utf8Decode(Uint8Array.from([0xc3]))).toBe('\ufffd');
    expect(() => utf8Decode(Uint8Array.from([0xf7, 0xbf, 0xbf, 0xbf, 0x89, 0x50]))).not.toThrow();
    expect(utf8Decode(Uint8Array.from([0xf7, 0xbf, 0xbf, 0xbf]))).toBe('\ufffd');
    expect(utf8Decode(Uint8Array.from([0xf0, 0x9f]))).toContain('\ufffd');
    for (const n of [0, 1, 2, 3, 4]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => i * 60 + 1);
      expect(Array.from(base64Decode(base64Encode(bytes)))).toEqual(Array.from(bytes));
    }
    expect(base64Encode(utf8Encode('Ma'))).toBe('TWE=');
    expect(base64Encode(utf8Encode('M'))).toBe('TQ==');
    expect(Array.from(base64Decode('TQ'))).toEqual([77]);
  });

  test('emitter isolates throwing listeners', () => {
    const e = new Emitter<number>();
    const seen: number[] = [];
    e.subscribe(() => { throw new Error('x'); });
    const off = e.subscribe((n) => seen.push(n));
    expect(e.hasListeners).toBe(true);
    e.emit(1);
    off();
    e.emit(2);
    expect(seen).toEqual([1]);
    e.clear();
    expect(e.hasListeners).toBe(false);
  });

  test('url helpers', () => {
    expect(buildQueryString({ a: '1 2', b: ['x', 'y'], c: null })).toBe('a=1%202&b=x&b=y&c');
    expect(withQuery('https://a/b?old=1', 'n=2')).toBe('https://a/b?n=2');
    expect(withQuery('https://a/b?old=1', '')).toBe('https://a/b');
    expect(resolveUrl('https://a.com/x/y', 'z')).toBe('https://a.com/x/z');
    expect(resolveUrl('https://a.com/x/', 'z')).toBe('https://a.com/x/z');
    expect(resolveUrl('https://a.com/x/?q=1', '/z')).toBe('https://a.com/z');
    expect(() => resolveUrl('nonsense', '/z')).toThrow();
    expect(lastPathSegment('https://a.com/f/report.pdf?x=1#h')).toBe('report.pdf');
  });

  test('reconnect policy defaults', () => {
    const d = ReconnectPolicies.exponential();
    for (let i = 0; i < 20; i++) {
      const ms = d.delayFor(3);
      expect(ms).toBeGreaterThanOrEqual(2800);
      expect(ms).toBeLessThanOrEqual(5200);
    }
  });

  test('log entry helpers', () => {
    const base = { id: '1', method: 'GET', url: 'u', requestHeaders: {}, startTime: new Date() };
    expect(isPending(base)).toBe(true);
    expect(isPending({ ...base, statusCode: 200 })).toBe(false);
    expect(isPending({ ...base, error: new Error('x') })).toBe(false);
    expect(isErrorEntry(base)).toBe(false);
    expect(isErrorEntry({ ...base, statusCode: 200 })).toBe(false);
    expect(isErrorEntry({ ...base, statusCode: 500 })).toBe(true);
    expect(isErrorEntry({ ...base, error: 'x' })).toBe(true);
  });
});
