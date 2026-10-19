import {
  APIErrorResponseRegistry,
  HTTPMethod,
  Logger,
  ModelTargetType,
  NetworkConfig,
  NetworkInspector,
  NetworkMonitor,
  SSLPinningHelper,
  SuccessTargetType,
  Target,
  TokenRefreshRegistry,
  utf8Encode,
  type BMRequest,
  type HttpTransport,
  type TransportResponse,
} from '../src/core';
import { RequestTask } from '../src/network/core/request-task';

export class TestTarget extends Target {
  get kAppHost() { return 'api.example.com'; }
  get kAppScheme() { return 'https'; }
  get kMainAPIPath() { return 'api'; }
  get kAppApiPath() { return 'v1'; }
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): TransportResponse {
  const bytes = utf8Encode(typeof body === 'string' ? body : JSON.stringify(body));
  return { status, headers, url: 'https://api.example.com/api/v1/x', readBody: async () => bytes };
}

/** A transport that replays queued responses and records the requests it saw. */
export class MockTransport implements HttpTransport {
  requests: BMRequest[] = [];
  constructor(public handler: (req: BMRequest, signal?: AbortSignal) => Promise<TransportResponse> | TransportResponse) {}
  async send(req: BMRequest, options?: { signal?: AbortSignal }) {
    this.requests.push(req);
    return this.handler(req, options?.signal);
  }
}

export interface User { id: number; name: string }

export class GetUser extends ModelTargetType<User> {
  token = 'old';
  constructor(private authorized = false) { super((j) => ({ id: j.id, name: j.name })); }
  get baseURL() { return new TestTarget().kBaseURL; }
  get requestPath() { return 'users/1'; }
  get requestMethod() { return HTTPMethod.get; }
  get isAuthorized() { return this.authorized; }
  get authHeaders(): Record<string, string> { return this.authorized ? { Authorization: `Bearer ${this.token}` } : {}; }
  get requestTask() { return RequestTask.parameters({ include: ['a', 'b'], q: 'x y' }); }
}

export class CreateUser extends SuccessTargetType {
  get baseURL() { return new TestTarget().kBaseURL; }
  get requestPath() { return 'users'; }
  get requestMethod() { return HTTPMethod.post; }
  get requestTask() { return RequestTask.encodedBody({ name: 'Ann' }); }
}

export function resetAll(): void {
  NetworkConfig.reset();
  TokenRefreshRegistry.clear();
  APIErrorResponseRegistry.clear();
  SSLPinningHelper.reset();
  NetworkMonitor.reset();
  NetworkMonitor.setProvider({ isOnline: async () => true, subscribe: () => () => {} });
  NetworkInspector.instance.clear();
  Logger.isEnabled = false;
}
