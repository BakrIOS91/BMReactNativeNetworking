import { APIError, APIErrorType } from '../helpers/api-error';
import { HTTPStatusCode } from '../helpers/enums';

/** Implemented by the host app to provide token-refresh logic. */
export interface TokenRefreshHandler {
  /** Resolves true when a new token is stored and ready for `authHeaders`. */
  refreshToken(): Promise<boolean>;
}

const unauthorized = () => new APIError(APIErrorType.httpError, { statusCode: HTTPStatusCode.notAuthorize, httpStatus: 401 });

/**
 * Global registry for the [TokenRefreshHandler]. If several requests receive
 * a 401 at once, only ONE refresh runs; all concurrent callers share its result.
 */
export class TokenRefreshRegistry {
  private static handler?: TokenRefreshHandler;
  private static inFlight?: Promise<void>;

  static register(handler: TokenRefreshHandler): void {
    TokenRefreshRegistry.handler = handler;
  }

  static clear(): void {
    TokenRefreshRegistry.handler = undefined;
    TokenRefreshRegistry.inFlight = undefined;
  }

  static refreshToken(): Promise<void> {
    const handler = TokenRefreshRegistry.handler;
    if (!handler) return Promise.reject(unauthorized());
    if (TokenRefreshRegistry.inFlight) return TokenRefreshRegistry.inFlight;

    const run = (async () => {
      const success = await handler.refreshToken();
      if (success !== true) throw unauthorized();
    })();
    const tracked = run.finally(() => {
      if (TokenRefreshRegistry.inFlight === tracked) TokenRefreshRegistry.inFlight = undefined;
    });
    TokenRefreshRegistry.inFlight = tracked;
    return tracked;
  }
}
