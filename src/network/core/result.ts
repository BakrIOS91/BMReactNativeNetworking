/** Either a success value or a failure error. */
export type Result<S, E> = Success<S, E> | Failure<S, E>;

export class Success<S, E = never> {
  readonly isSuccess = true as const;
  readonly isFailure = false as const;
  readonly error: undefined = undefined;
  constructor(readonly value: S) {}

  when<R>(handlers: { success: (value: S) => R; failure: (error: E) => R }): R {
    return handlers.success(this.value);
  }
  map<R>(transform: (value: S) => R): Result<R, E> {
    return new Success<R, E>(transform(this.value));
  }
  mapError<F>(_transform: (error: E) => F): Result<S, F> {
    return new Success<S, F>(this.value);
  }
}

export class Failure<S, E> {
  readonly isSuccess = false as const;
  readonly isFailure = true as const;
  readonly value: undefined = undefined;
  constructor(readonly error: E) {}

  when<R>(handlers: { success: (value: S) => R; failure: (error: E) => R }): R {
    return handlers.failure(this.error);
  }
  map<R>(_transform: (value: S) => R): Result<R, E> {
    return new Failure<R, E>(this.error);
  }
  mapError<F>(transform: (error: E) => F): Result<S, F> {
    return new Failure<S, F>(transform(this.error));
  }
}
