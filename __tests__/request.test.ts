import {
  APIError, APIErrorType, AesKeyFormat, AppEnvironment, HTTPMethod, ModelTargetType, MultipartFormDataData, MultipartFormDataText,
  NetworkConfig, NetworkMonitor, RequestTask, RequestType, SuccessTargetType, Target, TargetRequest, createRequest, utf8Decode,
} from '../src/core';
import { TestTarget, resetAll } from './helpers';

beforeEach(resetAll);

class Req extends SuccessTargetType {
  constructor(private task: RequestTask = RequestTask.plain(), private method = HTTPMethod.post, private path = 'items') { super(); }
  get baseURL() { return new TestTarget().kBaseURL; }
  get requestPath() { return this.path; }
  get requestMethod() { return this.method; }
  get requestTask() { return this.task; }
}

describe('createRequest', () => {
  test('plain and download keep the URL and merge default, custom and auth headers in that order', async () => {
    class H extends Req {
      get headers() { return { Accept: 'application/json', X: '1' }; }
      get authHeaders() { return { X: '2', Authorization: 'Bearer t' }; }
    }
    const r = await createRequest(new H());
    expect(r.url).toBe('https://api.example.com/api/v1/items');
    expect(r.headers).toEqual({ 'Content-Type': 'application/json', Accept: 'application/json', X: '2', Authorization: 'Bearer t' });
    expect((await createRequest(new Req(RequestTask.download('u')))).body).toBeUndefined();
  });

  test('query parameters: arrays, null, undefined and numbers', async () => {
    const r = await createRequest(new Req(RequestTask.parameters({ a: 1, b: [1, 2], c: null, d: undefined, e: 'x y' }), HTTPMethod.get));
    expect(r.url).toBe('https://api.example.com/api/v1/items?a=1&b=1&b=2&c&d&e=x%20y');
  });

  test('JSON bodies set the content type; null bodies send nothing', async () => {
    const r = await createRequest(new Req(RequestTask.encodedBody({ a: [1] })));
    expect([r.body, r.headers['Content-Type']]).toEqual(['{"a":[1]}', 'application/json']);
    expect((await createRequest(new Req(RequestTask.encodedBody(null)))).body).toBeUndefined();
    expect((await createRequest(new Req(RequestTask.encodedBody(undefined)))).body).toBeUndefined();
  });

  test('parametersAndBody combines both and tolerates each being absent', async () => {
    const r = await createRequest(new Req(RequestTask.parametersAndBody({ q: 1 }, { b: 2 })));
    expect([r.url, r.body]).toEqual(['https://api.example.com/api/v1/items?q=1', '{"b":2}']);
    const none = await createRequest(new Req(RequestTask.parametersAndBody(undefined as any, null)));
    expect([none.url, none.body]).toEqual(['https://api.example.com/api/v1/items', undefined]);
    expect((await createRequest(new Req(RequestTask.encodedBody(0)))).body).toBe('0');
  });

  test('a parameters task without parameters, and a plain parametersTask type, leave the URL alone', async () => {
    const t = RequestTask.parameters(undefined as any);
    expect((await createRequest(new Req(t))).url).toBe('https://api.example.com/api/v1/items');
  });

  test('encryption replaces the body; JSON.stringify failures become dataConversionFailed', async () => {
    NetworkConfig.configure({ payloadEncryptor: { encrypt: () => ({ enc: true }) } });
    expect((await createRequest(new Req(RequestTask.encodedBody({ a: 1 })))).body).toBe('{"enc":true}');
    NetworkConfig.configure({ payloadEncryptor: { encrypt: () => { throw new APIError(APIErrorType.encryptionFailed); } } });
    await expect(createRequest(new Req(RequestTask.encodedBody({})))).rejects.toMatchObject({ type: APIErrorType.encryptionFailed });
    NetworkConfig.configure({ payloadEncryptor: { encrypt: () => { throw new Error('x'); } } });
    await expect(createRequest(new Req(RequestTask.encodedBody({})))).rejects.toMatchObject({ type: APIErrorType.dataConversionFailed });
  });

  test('query encryption only applies to GET with the switch on', async () => {
    NetworkConfig.configure({ payloadEncryptor: { encrypt: () => ({ data: 'd', iv: 'i', key: 'k' }) }, encryptQueryParameters: true });
    const get = await createRequest(new Req(RequestTask.parameters({ a: 1 }), HTTPMethod.get));
    expect(get.url).toBe('https://api.example.com/api/v1/items?data=d&iv=i&key=k');
    const post = await createRequest(new Req(RequestTask.parameters({ a: 1 }), HTTPMethod.post));
    expect(post.url).toBe('https://api.example.com/api/v1/items?a=1');
    NetworkConfig.configure({ encryptQueryParameters: false });
    expect((await createRequest(new Req(RequestTask.parameters({ a: 1 }), HTTPMethod.get))).url).toContain('a=1');
  });

  test('uploadFile reads bytes through the file system adapter', async () => {
    const readBytes = jest.fn(async () => new Uint8Array([4, 5]));
    NetworkConfig.configure({ fileSystem: { readBytes, writeTemp: jest.fn() } });
    const r = await createRequest(new Req(RequestTask.uploadFile('/f')));
    expect(Array.from(r.body as Uint8Array)).toEqual([4, 5]);
    expect(readBytes).toHaveBeenCalledWith('/f');
    const none = await createRequest(new Req(RequestTask.uploadFile('')));
    expect(none.body).toBeUndefined();
    NetworkConfig.configure({ fileSystem: { readBytes: async () => { throw new Error('missing'); }, writeTemp: jest.fn() } });
    await expect(createRequest(new Req(RequestTask.uploadFile('/nope')))).rejects.toMatchObject({ type: APIErrorType.invalidURL });
  });

  test('multipart builds a boundary body, sanitises names and skips unknown parts', async () => {
    const r = await createRequest(new Req(RequestTask.uploadMultipart({
      'ti"tle': new MultipartFormDataText(5),
      file: new MultipartFormDataData(new Uint8Array([65, 66]), 'a\r\n.txt', 'text/plain'),
      weird: 'ignored' as any,
    })));
    const boundary = /boundary=(.+)$/.exec(r.headers['Content-Type'])![1];
    const text = utf8Decode(r.body as Uint8Array);
    expect(text).toContain(`--${boundary}\r\nContent-Disposition: form-data; name="ti_tle"\r\n\r\n5\r\n`);
    expect(text).toContain('filename="a__.txt"\r\nContent-Type: text/plain\r\n\r\nAB\r\n');
    expect(text.endsWith(`--${boundary}--\r\n`)).toBe(true);
    expect(text).not.toContain('weird');
    const empty = await createRequest(new Req(RequestTask.uploadMultipart(undefined as any)));
    expect(empty.body).toBeUndefined();
  });

  test('resumable downloads add a Range header only with an offset', async () => {
    expect((await createRequest(new Req(RequestTask.downloadResumable({ offset: 100 }), HTTPMethod.get))).headers.Range).toBe('bytes=100-');
    expect((await createRequest(new Req(RequestTask.downloadResumable(), HTTPMethod.get))).headers.Range).toBeUndefined();
  });

  test('SOAP is rejected and unresolvable URLs are invalidURL', async () => {
    class Soap extends Req { get requestType() { return RequestType.soap; } }
    await expect(createRequest(new Soap())).rejects.toMatchObject({ type: APIErrorType.notSupportedSOAPOperation });
    class Bad extends Req { get baseURL() { return 'not a url'; } get requestPath() { return '/x'; } }
    await expect(createRequest(new Bad())).rejects.toMatchObject({ type: APIErrorType.invalidURL });
  });
});

describe('TargetRequest', () => {
  test('defaults', () => {
    class Bare extends TargetRequest {
      get baseURL() { return 'https://a/'; }
      get requestPath() { return 'p'; }
      get requestMethod() { return HTTPMethod.get; }
    }
    const b = new Bare();
    expect([b.requestType, b.isAuthorized, b.headers, b.authHeaders, b.sslPinningConfiguration, b.useUniqueFilename, b.encryptsPayload, b.sendTimeout, b.receiveTimeout])
      .toEqual([RequestType.rest, false, {}, {}, undefined, false, true, undefined, undefined]);
    expect(b.requestTask.type).toBe('plain');
  });

  test('requestTaskDescription covers every task type', () => {
    const d = (t: RequestTask) => new Req(t).requestTaskDescription;
    expect(d(RequestTask.plain())).toBe('Plain request');
    expect(d(RequestTask.parameters({ a: 1 }))).toBe('Parameters: {"a":1}');
    expect(d(RequestTask.encodedBody({ b: 2 }))).toBe('Body: {"b":2}');
    expect(d(RequestTask.uploadFile('/f'))).toBe('Upload file: /f');
    expect(d(RequestTask.uploadMultipart({ k: new MultipartFormDataText(1) }))).toBe('Multipart fields: ["k"]');
    expect(d(RequestTask.uploadMultipart(undefined as any))).toBe('Multipart fields: []');
    expect(d(RequestTask.download('u'))).toBe('Download from: u');
    expect(d(RequestTask.downloadResumable({ offset: 3 }))).toBe('Resumable download with offset: 3');
    expect(d(RequestTask.parametersAndBody({ a: 1 }, { b: 2 }))).toBe('Parameters: {"a":1}, Body: {"b":2}');
  });

  test('isConnectedToInternet reads the monitor', async () => {
    NetworkMonitor.offlineRecheckDelay = 1;
    NetworkMonitor.setProvider({ isOnline: async () => false, subscribe: () => () => {} });
    expect(await TargetRequest.isConnectedToInternet()).toBe(false);
  });
});

describe('ModelTargetType', () => {
  class Bare extends ModelTargetType<number> {
    get baseURL() { return 'https://a/'; }
    get requestPath() { return 'p'; }
    get requestMethod() { return HTTPMethod.get; }
  }
  test('decoder, override and the missing-decoder error', () => {
    expect(() => new Bare().fromJson({})).toThrow(/fromJson MUST be overridden/);
    class WithDecoder extends Bare { constructor() { super((j) => j.n); } }
    expect(new WithDecoder().fromDynamicJson({ n: 4 })).toBe(4);
    class List extends Bare { fromDynamicJson(j: unknown) { return (j as number[]).length; } }
    expect(new List().fromDynamicJson([1, 2, 3])).toBe(3);
  });
});

describe('Target', () => {
  test('default environment, host sanitising and path trimming', () => {
    class T extends Target {
      get kAppHost() { return 'h.io/'; }
      get kAppScheme() { return 'https'; }
      get kMainAPIPath() { return '/a/'; }
      get kAppApiPath() { return '///'; }
    }
    const t = new T();
    expect(t.appEnvironment).toBe(AppEnvironment.development);
    expect(t.kBaseURL).toBe('https://h.io/a/');
    class Root extends Target { get kAppHost() { return 'h.io'; } get kAppScheme() { return 'http'; } get kMainAPIPath() { return ''; } }
    expect(new Root().kBaseURL).toBe('http://h.io/');
  });

  test('payload field names stay configurable', () => {
    expect(AesKeyFormat.hexString).toBe('hexString');
  });
});
