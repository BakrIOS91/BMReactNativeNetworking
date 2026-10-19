export type Unsubscribe = () => void;

/** Minimal multi-listener event source used for streams and stores. */
export class Emitter<T> {
  private listeners = new Set<(value: T) => void>();

  subscribe(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(value: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(value);
      } catch {
        // A throwing listener must not break the others.
      }
    }
  }

  get hasListeners(): boolean {
    return this.listeners.size > 0;
  }

  clear(): void {
    this.listeners.clear();
  }
}
