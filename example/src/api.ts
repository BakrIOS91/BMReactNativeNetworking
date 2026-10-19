import {
  APIErrorResponseRegistry,
  HTTPMethod,
  ModelTargetType,
  MultipartFormDataData,
  MultipartFormDataText,
  RequestTask,
  SuccessTargetType,
  Target,
  TokenRefreshRegistry,
  utf8Encode,
} from 'bm-react-native-networking';

/** Demo RSA public key for the payload-encryption scenario (its private key was discarded). */
export const DEMO_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzP+PsrWv5RQDqgdhlMMu
SauOb0QLG8/5v9u+xJ4JX2kprCM9kYxwtxcenrmZW00c0FVOouTAenaGbrPzOzXe
Lc4QsM1ZMILUjQUwThSWZVy/Cc1BRWfR8aCLvZWBIhnIY5lfnSCSOlI9Q3jUxpxv
v43yLrS/HTLNJgp/RN9siMiBBMbf1+SEMiRtn58y9ae1qWznIhbkdBe4w3YxpyP5
x2DVgtcRqUj6cJjfPet+X1l62diBpS0f0Hhv1XQfjQZGuJwIFcghyUv2tQa/xy5d
le+mV0vmPuHLvpLZdkC4yRXdSOgnDgUEX6jDfFyFA7Ru5ymF9nK6zJvE//u1uGOT
6wIDAQAB
-----END PUBLIC KEY-----`;

// ── Targets ──────────────────────────────────────────────────────────────────

export class DummyJsonTarget extends Target {
  get kAppScheme() { return 'https'; }
  get kAppHost() { return 'dummyjson.com'; }
}

export class HttpbinTarget extends Target {
  get kAppScheme() { return 'https'; }
  get kAppHost() { return 'httpbin.org'; }
}

// ── Models ───────────────────────────────────────────────────────────────────

export interface Post { id: number; userId: number; title: string; body: string }
export interface HttpbinEcho { url: string; json?: unknown; headers?: Record<string, string>; files?: Record<string, string>; form?: Record<string, string>; authenticated?: boolean; token?: string }
export interface ApiProblem { message: string }

// ── Session (stands in for secure storage) ───────────────────────────────────

export const session = { accessToken: '' };

TokenRefreshRegistry.register({
  async refreshToken() {
    // A real app would call its auth endpoint here.
    await new Promise((resolve) => setTimeout(resolve, 300));
    session.accessToken = 'fresh-token-' + Date.now();
    return true;
  },
});

APIErrorResponseRegistry.register({
  decode: (json): ApiProblem => ({ message: 'Server said: ' + JSON.stringify(json) }),
});

// ── DummyJSON ──────────────────────────────────────────────────────────

abstract class DummyModel<T> extends ModelTargetType<T> {
  get baseURL() { return new DummyJsonTarget().kBaseURL; }
}

export class ListPosts extends DummyModel<Post[]> {
  constructor(private userId?: number, private limit = 10) { super(); }
  get requestPath() { return this.userId ? `posts/user/${this.userId}` : 'posts'; }
  get requestMethod() { return HTTPMethod.get; }
  get requestTask() { return RequestTask.parameters({ limit: this.limit, select: ['title', 'body', 'userId'] }); }
  // The response is { posts: [...] }; override fromDynamicJson to unwrap a non-flat shape.
  fromDynamicJson(json: unknown) { return (json as { posts: Post[] }).posts; }
}

export class GetPost extends DummyModel<Post> {
  constructor(private id: number) { super((json) => json as Post); }
  get requestPath() { return `posts/${this.id}`; }
  get requestMethod() { return HTTPMethod.get; }
}

export class CreatePost extends DummyModel<Post> {
  constructor(private title: string) { super((json) => json as Post); }
  get requestPath() { return 'posts/add'; }
  get requestMethod() { return HTTPMethod.post; }
  get encryptsPayload() { return false; } // this server cannot decrypt
  get requestTask() { return RequestTask.encodedBody({ title: this.title, body: 'created from BMReactNativeNetworking', userId: 1 }); }
}

export class DeletePost extends SuccessTargetType {
  constructor(private id: number) { super(); }
  get baseURL() { return new DummyJsonTarget().kBaseURL; }
  get requestPath() { return `posts/${this.id}`; }
  get requestMethod() { return HTTPMethod.delete; }
}

// ── httpbin ──────────────────────────────────────────────────────────────────

abstract class HttpbinModel extends ModelTargetType<HttpbinEcho> {
  constructor() { super((json) => json as HttpbinEcho); }
  get baseURL() { return new HttpbinTarget().kBaseURL; }
}

export class Delay extends HttpbinModel {
  constructor(private seconds: number, private sendTimeoutMs?: number) { super(); }
  get requestPath() { return `delay/${this.seconds}`; }
  get requestMethod() { return HTTPMethod.get; }
  get sendTimeout() { return this.sendTimeoutMs; }
}

export class Status extends SuccessTargetType {
  constructor(private code: number) { super(); }
  get baseURL() { return new HttpbinTarget().kBaseURL; }
  get requestPath() { return `status/${this.code}`; }
  get requestMethod() { return HTTPMethod.get; }
}

/** httpbin answers 401 until the Authorization header carries a non-empty bearer token. */
export class Bearer extends HttpbinModel {
  get requestPath() { return 'bearer'; }
  get requestMethod() { return HTTPMethod.get; }
  get isAuthorized() { return true; }
  get authHeaders() { return { Authorization: `Bearer ${session.accessToken}` }; }
}

export class SetCookie extends HttpbinModel {
  get requestPath() { return 'response-headers?Set-Cookie=session%3Dabc123%3B%20Path%3D%2F%3B%20HttpOnly'; }
  get requestMethod() { return HTTPMethod.get; }
}

export class PostJson extends HttpbinModel {
  constructor(private encrypted: boolean) { super(); }
  get requestPath() { return 'post'; }
  get requestMethod() { return HTTPMethod.post; }
  get encryptsPayload() { return this.encrypted; }
  get requestTask() { return RequestTask.encodedBody({ username: 'bakr', password: 'p@ssw0rd', note: 'héllo 世界' }); }
}

export class UploadMultipart extends HttpbinModel {
  get requestPath() { return 'post'; }
  get requestMethod() { return HTTPMethod.post; }
  get requestTask() {
    return RequestTask.uploadMultipart({
      title: new MultipartFormDataText('hello'),
      file: new MultipartFormDataData(utf8Encode('file contents from the example app'), 'hello.txt', 'text/plain'),
    });
  }
}

export class DownloadImage extends ModelTargetType<unknown> {
  get baseURL() { return new DummyJsonTarget().kBaseURL; }
  get requestPath() { return 'icon/bm-networking/96'; }
  get requestMethod() { return HTTPMethod.get; }
  get requestTask() { return RequestTask.download('https://dummyjson.com/icon/bm-networking/96'); }
  get useUniqueFilename() { return true; }
}

export const ECHO_SOCKET_URL = 'wss://ws.postman-echo.com/raw';
