import {
  APIError, APIErrorResponseRegistry, APIErrorType, CancelToken, HTTPStatusCode, NetworkConfig,
  NetworkMonitor, TokenRefreshRegistry, utf8Decode,
} from '../src/core';
import { CreateUser, GetUser, MockTransport, jsonResponse, resetAll } from './helpers';

beforeEach(resetAll);

const use = (t: MockTransport) => NetworkConfig.configure({ transport: t });

test('decodes a model and builds the URL with query parameters', async () => {
  const t = new MockTransport(() => jsonResponse(200, { id: 1, name: 'Ann' }, { 'set-cookie': 'sid=abc; Path=/; HttpOnly' }));
  use(t);
  const res = await new GetUser().performAsyncWithCookies();
  expect(res.data).toEqual({ id: 1, name: 'Ann' });
  expect(res.cookies[0]).toMatchObject({ name: 'sid', value: 'abc', httpOnly: true });
  expect(t.requests[0].url).toBe('https://api.example.com/api/v1/users/1?include=a&include=b&q=x%20y');
  expect(t.requests[0].method).toBe('GET');
});

test('performResult returns Success / Failure instead of throwing', async () => {
  use(new MockTransport(() => jsonResponse(500, { message: 'boom' })));
  const result = await new GetUser().performResult();
  expect(result.isFailure).toBe(true);
  expect((result.error as APIError).statusCode).toBe(HTTPStatusCode.serverError);
});

test('decodes the server error payload through the registered mapper', async () => {
  APIErrorResponseRegistry.register({ decode: (j: any) => ({ msg: j.message }) });
  use(new MockTransport(() => jsonResponse(422, { message: 'bad' })));
  const err = await new GetUser().performAsync().catch((e) => e as APIError) as APIError;
  expect(err.type).toBe(APIErrorType.httpError);
  expect(err.errorModelAs<{ msg: string }>()).toEqual({ msg: 'bad' });
});

test('invalid JSON becomes dataConversionFailed', async () => {
  use(new MockTransport(() => jsonResponse(200, 'not json')));
  await expect(new GetUser().performAsync()).rejects.toMatchObject({ type: APIErrorType.dataConversionFailed });
});

test('sends a JSON body for success targets', async () => {
  const t = new MockTransport(() => jsonResponse(201, ''));
  use(t);
  await new CreateUser().performAsync();
  expect(t.requests[0].body).toBe('{"name":"Ann"}');
  expect(t.requests[0].headers['Content-Type']).toBe('application/json');
});

test('401 refreshes the token once and replays with the new auth header', async () => {
  const req = new GetUser(true);
  let calls = 0;
  const t = new MockTransport((r) => (++calls === 1 ? jsonResponse(401, {}) : jsonResponse(200, { id: 1, name: 'Ann' })));
  use(t);
  TokenRefreshRegistry.register({ refreshToken: async () => { req.token = 'new'; return true; } });
  await expect(req.performAsync()).resolves.toEqual({ id: 1, name: 'Ann' });
  expect(t.requests.map((r) => r.headers.Authorization)).toEqual(['Bearer old', 'Bearer new']);
});

test('a failed refresh surfaces the 401', async () => {
  use(new MockTransport(() => jsonResponse(401, {})));
  TokenRefreshRegistry.register({ refreshToken: async () => false });
  await expect(new GetUser(true).performAsync()).rejects.toMatchObject({ statusCode: HTTPStatusCode.notAuthorize });
});

test('concurrent 401s share a single refresh', async () => {
  let refreshes = 0;
  TokenRefreshRegistry.register({ refreshToken: async () => { refreshes++; await new Promise((r) => setTimeout(r, 20)); return true; } });
  await Promise.all([TokenRefreshRegistry.refreshToken(), TokenRefreshRegistry.refreshToken(), TokenRefreshRegistry.refreshToken()]);
  expect(refreshes).toBe(1);
});

test('unauthorized requests never trigger a refresh', async () => {
  const refresh = jest.fn(async () => true);
  TokenRefreshRegistry.register({ refreshToken: refresh });
  use(new MockTransport(() => jsonResponse(401, {})));
  await expect(new GetUser(false).performAsync()).rejects.toBeInstanceOf(APIError);
  expect(refresh).not.toHaveBeenCalled();
});

test('offline requests fail fast without sending', async () => {
  NetworkMonitor.offlineRecheckDelay = 1;
  NetworkMonitor.setProvider({ isOnline: async () => false, subscribe: () => () => {} });
  const t = new MockTransport(() => jsonResponse(200, {}));
  use(t);
  await expect(new GetUser().performAsync()).rejects.toMatchObject({ type: APIErrorType.noNetwork });
  expect(t.requests).toHaveLength(0);
});

test('times out waiting for headers', async () => {
  NetworkConfig.configure({ sendTimeout: 20 });
  use(new MockTransport((_r, signal) => new Promise((_res, rej) => signal?.addEventListener('abort', () => rej(new Error('aborted'))))));
  await expect(new GetUser().performAsync()).rejects.toMatchObject({ type: APIErrorType.timeout });
});

test('per-endpoint timeout override wins', async () => {
  NetworkConfig.configure({ sendTimeout: 5000 });
  use(new MockTransport(() => new Promise(() => {})));
  const req = new GetUser();
  Object.defineProperty(req, 'sendTimeout', { get: () => 10 });
  await expect(req.performAsync()).rejects.toMatchObject({ type: APIErrorType.timeout });
});

test('a cancel token aborts the in-flight request', async () => {
  const token = new CancelToken();
  use(new MockTransport((_r, signal) => new Promise((_res, rej) => signal?.addEventListener('abort', () => rej(new Error('aborted'))))));
  const pending = new GetUser().performAsync({ cancelToken: token });
  setTimeout(() => token.cancel(), 10);
  await expect(pending).rejects.toMatchObject({ type: APIErrorType.cancelled });
});

test('an already-cancelled token never sends', async () => {
  const token = new CancelToken();
  token.cancel();
  const t = new MockTransport(() => jsonResponse(200, {}));
  use(t);
  await expect(new GetUser().performAsync({ cancelToken: token })).rejects.toMatchObject({ type: APIErrorType.cancelled });
  expect(t.requests).toHaveLength(0);
});

test('losing connectivity mid-request: GET is noNetwork, POST is connectionLostDuringRequest', async () => {
  let notify: (online: boolean) => void = () => {};
  NetworkMonitor.setProvider({ isOnline: async () => true, subscribe: (l) => { notify = l; return () => {}; } });
  use(new MockTransport((_r, signal) => new Promise((_res, rej) => signal?.addEventListener('abort', () => rej(new Error('aborted'))))));

  const get = new GetUser().performAsync();
  await new Promise((r) => setTimeout(r, 10));
  notify(false);
  await expect(get).rejects.toMatchObject({ type: APIErrorType.noNetwork });

  const post = new CreateUser().performAsync();
  await new Promise((r) => setTimeout(r, 10));
  notify(false);
  await expect(post).rejects.toMatchObject({ type: APIErrorType.connectionLostDuringRequest });
});

test('payload encryption can be switched off per endpoint', async () => {
  const encrypt = jest.fn((b) => ({ data: 'x', iv: 'y', key: 'z', original: b }));
  NetworkConfig.configure({ payloadEncryptor: { encrypt } });
  const t = new MockTransport(() => jsonResponse(201, ''));
  use(t);
  await new CreateUser().performAsync();
  expect(JSON.parse(t.requests[0].body as string)).toMatchObject({ data: 'x' });

  const plain = new CreateUser();
  Object.defineProperty(plain, 'encryptsPayload', { get: () => false });
  await plain.performAsync();
  expect(t.requests[1].body).toBe('{"name":"Ann"}');
});

test('multipart bodies carry the boundary header and file bytes', async () => {
  const { MultipartFormDataData, MultipartFormDataText, RequestTask, HTTPMethod } = await import('../src/core');
  const t = new MockTransport(() => jsonResponse(200, ''));
  use(t);
  class Upload extends CreateUser {
    get requestTask() { return RequestTask.uploadMultipart({ title: new MultipartFormDataText('hi'), file: new MultipartFormDataData(new Uint8Array([1, 2, 3]), 'a.bin', 'application/octet-stream') }); }
    get requestMethod() { return HTTPMethod.post; }
  }
  await new Upload().performAsync();
  const sent = t.requests[0];
  expect(sent.headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=/);
  const text = utf8Decode(sent.body as Uint8Array);
  expect(text).toContain('name="title"\r\n\r\nhi');
  expect(text).toContain('filename="a.bin"');
});
