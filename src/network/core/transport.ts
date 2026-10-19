import { HTTPMethod } from '../../helpers/enums';

/** A fully built request, ready for a transport. */
export interface BMRequest {
  method: HTTPMethod;
  url: string;
  headers: Record<string, string>;
  /** JSON/text payload or raw bytes (uploads, multipart). */
  body?: string | Uint8Array;
}

/** A response whose body is read on demand so it can be bounded by a timeout. */
export interface TransportResponse {
  status: number;
  statusText?: string;
  /** Header names are lower-cased. */
  headers: Record<string, string>;
  /** Final URL after redirects. */
  url: string;
  readBody(): Promise<Uint8Array>;
}

export interface TransportOptions {
  /** Aborting must tear down the connection and reject `send`. */
  signal?: AbortSignal;
}

/** Sends one request. The default implementation uses `fetch`. */
export interface HttpTransport {
  send(request: BMRequest, options?: TransportOptions): Promise<TransportResponse>;
}

/** `fetch`-based transport. Works with React Native, Expo and Node 18+. */
export class FetchTransport implements HttpTransport {
  async send(request: BMRequest, options: TransportOptions = {}): Promise<TransportResponse> {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body as any,
      signal: options.signal,
    });

    const headers: Record<string, string> = {};
    response.headers.forEach((value: string, key: string) => {
      headers[key.toLowerCase()] = value;
    });

    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      url: response.url || request.url,
      readBody: async () => new Uint8Array(await response.arrayBuffer()),
    };
  }
}
