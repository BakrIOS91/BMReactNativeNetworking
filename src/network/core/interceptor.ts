import type { BMRequest, HttpTransport, TransportOptions, TransportResponse } from './transport';

/** Hooks into a request/response exchange. All hooks are optional. */
export interface NetworkInterceptor {
  onRequest?(request: BMRequest): BMRequest | Promise<BMRequest>;
  onResponse?(request: BMRequest, response: TransportResponse): TransportResponse | Promise<TransportResponse>;
  /** Return a response to recover from [error], or nothing to let it propagate. */
  onError?(request: BMRequest, error: unknown): TransportResponse | undefined | void | Promise<TransportResponse | undefined | void>;
}

/** A transport wrapper that runs interceptors around every send. */
export class NetworkClient {
  constructor(
    private readonly transport: HttpTransport,
    readonly interceptors: NetworkInterceptor[] = [],
  ) {}

  async send(request: BMRequest, options?: TransportOptions): Promise<TransportResponse> {
    let current = request;
    for (const interceptor of this.interceptors) {
      if (interceptor.onRequest) current = await interceptor.onRequest(current);
    }

    try {
      let response = await this.transport.send(current, options);
      for (const interceptor of [...this.interceptors].reverse()) {
        if (interceptor.onResponse) response = await interceptor.onResponse(current, response);
      }
      return response;
    } catch (error) {
      for (const interceptor of [...this.interceptors].reverse()) {
        const recovered = interceptor.onError ? await interceptor.onError(current, error) : undefined;
        if (recovered) return recovered;
      }
      throw error;
    }
  }
}
