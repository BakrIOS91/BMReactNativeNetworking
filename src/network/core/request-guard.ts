import { APIError, APIErrorType } from '../../helpers/api-error';
import type { CancelToken } from './cancel-token';
import { NetworkMonitor } from './network-monitor';
import type { Unsubscribe } from '../../utils/emitter';

export interface RequestGuardOptions {
  /** Whether the request can change server state. */
  isMutating: boolean;
  cancelToken?: CancelToken;
  /** Called once when the request is aborted; tears down the connection. */
  onAbort: () => void;
  /** Source of connectivity changes (true = online). Replaced in tests. */
  subscribeConnectivity?: (listener: (online: boolean) => void) => Unsubscribe;
}

/**
 * Watches one in-flight request and aborts it when the caller cancels or the
 * device goes offline, instead of waiting for the timeout.
 *
 * A dropped request that changes state (any non-GET method) fails with
 * `connectionLostDuringRequest` because the server may already have processed
 * it; such requests are never retried automatically. Dropped reads fail with
 * `noNetwork`.
 */
export class RequestGuard {
  private unsubscribe?: Unsubscribe;
  private aborted = false;

  constructor(private readonly options: RequestGuardOptions) {}

  /** True once the request was cancelled or dropped; auth retries check this. */
  get isAborted(): boolean {
    return this.aborted;
  }

  /** Runs [action], failing early with an [APIError] if aborted. */
  run<T>(action: () => Promise<T>): Promise<T> {
    const { cancelToken, isMutating, onAbort } = this.options;
    if (cancelToken?.isCancelled) return Promise.reject(new APIError(APIErrorType.cancelled));

    return new Promise<T>((resolve, reject) => {
      const abort = (error: APIError) => {
        if (this.aborted) return;
        this.aborted = true;
        onAbort();
        reject(error);
      };

      cancelToken?.whenCancelled.then(() => abort(new APIError(APIErrorType.cancelled)));

      const subscribe = this.options.subscribeConnectivity ?? ((l) => NetworkMonitor.subscribe(l));
      try {
        this.unsubscribe = subscribe((online) => {
          if (online) return;
          abort(
            new APIError(isMutating ? APIErrorType.connectionLostDuringRequest : APIErrorType.noNetwork),
          );
        });
      } catch {
        // A broken connectivity module must never fail the request.
      }

      action().then(resolve, reject);
    });
  }

  /** Stops listening. Always call when the request is finished. */
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}
