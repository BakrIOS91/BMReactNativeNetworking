import { HTTPStatusCode, httpStatusCodeFrom } from '../../../helpers/enums';
import type { NetworkInterceptor } from '../interceptor';
import type { BMRequest, TransportResponse } from '../transport';

export interface AuthInterceptorOptions {
  isAuthorized: boolean;
  /** Refreshes the token and returns the rebuilt request (fresh `authHeaders`). */
  refreshRequest: () => Promise<BMRequest>;
  retry: (request: BMRequest) => Promise<TransportResponse>;
  /** Return false to skip refresh-and-retry (cancelled or dropped request). */
  shouldRetry?: () => boolean;
}

/** Handles 401 Unauthorized responses by refreshing the token and replaying once. */
export class AuthInterceptor implements NetworkInterceptor {
  private isRetrying = false;

  constructor(private readonly options: AuthInterceptorOptions) {}

  async onResponse(_request: BMRequest, response: TransportResponse): Promise<TransportResponse> {
    const { isAuthorized, refreshRequest, retry, shouldRetry = () => true } = this.options;

    if (
      httpStatusCodeFrom(response.status) === HTTPStatusCode.notAuthorize &&
      isAuthorized &&
      !this.isRetrying &&
      shouldRetry()
    ) {
      this.isRetrying = true;
      try {
        return await retry(await refreshRequest());
      } catch {
        return response;
      }
    }
    return response;
  }
}
