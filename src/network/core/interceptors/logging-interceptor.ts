import { Logger } from '../logger';
import type { NetworkInterceptor } from '../interceptor';
import type { BMRequest, TransportResponse } from '../transport';
import { NetworkInspector } from '../inspector/network-inspector';
import type { NetworkLogEntry } from '../inspector/network-log-entry';
import { utf8Encode } from '../../../helpers/bytes';

/**
 * Logs requests and responses to the console (via [Logger]) and to the in-app
 * [NetworkInspector] used by `NetworkInspectorOverlay`.
 */
export class LoggingInterceptor implements NetworkInterceptor {
  private entry?: NetworkLogEntry;
  private startedAt = 0;

  onRequest(request: BMRequest): BMRequest {
    if (!Logger.isEnabled) return request;

    Logger.logRequest({ method: request.method, url: request.url, headers: request.headers, body: request.body });

    this.startedAt = Date.now();
    this.entry = NetworkInspector.instance.logRequest({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: typeof request.body === 'string' ? utf8Encode(request.body) : request.body,
    });
    return request;
  }

  async onResponse(request: BMRequest, response: TransportResponse): Promise<TransportResponse> {
    if (!Logger.isEnabled) return response;

    const bytes = await response.readBody();
    Logger.logResponse({ method: request.method, url: request.url, statusCode: response.status, responseData: bytes });
    NetworkInspector.instance.logResponse({
      entry: this.entry,
      statusCode: response.status,
      headers: response.headers,
      body: bytes,
      duration: Date.now() - this.startedAt,
    });

    // The body has been consumed; hand later readers the cached bytes.
    return { ...response, readBody: async () => bytes };
  }

  onError(request: BMRequest, error: unknown): undefined {
    if (!Logger.isEnabled) return undefined;
    Logger.logResponse({ method: request.method, url: request.url, error });
    NetworkInspector.instance.logError({ entry: this.entry, error, duration: Date.now() - this.startedAt });
    return undefined;
  }
}
