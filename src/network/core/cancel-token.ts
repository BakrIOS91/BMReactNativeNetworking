/**
 * Cancels one or more in-flight requests.
 *
 * ```ts
 * const token = new CancelToken();
 * const result = await request.performResult({ cancelToken: token });
 * // later, e.g. when the screen unmounts:
 * token.cancel();
 * ```
 * A cancelled request fails with `APIErrorType.cancelled`. One token may be
 * shared by several requests; it cannot be reused after [cancel].
 */
export class CancelToken {
  private _cancelled = false;
  private _reason?: string;
  private _resolve!: () => void;
  readonly whenCancelled: Promise<void>;

  constructor() {
    this.whenCancelled = new Promise<void>((resolve) => {
      this._resolve = resolve;
    });
  }

  get isCancelled(): boolean {
    return this._cancelled;
  }

  get reason(): string | undefined {
    return this._reason;
  }

  /** Cancels every request using this token. Safe to call more than once. */
  cancel(reason?: string): void {
    if (this._cancelled) return;
    this._cancelled = true;
    this._reason = reason;
    this._resolve();
  }
}
