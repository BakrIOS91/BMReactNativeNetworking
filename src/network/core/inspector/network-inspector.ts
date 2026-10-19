import type { NetworkLogEntry } from './network-log-entry';

export type InspectorBrightness = 'dark' | 'light';

export interface InspectorState {
  logs: NetworkLogEntry[];
  brightness: InspectorBrightness;
  visible: boolean;
}

/**
 * In-memory store of captured [NetworkLogEntry] items, fed by
 * `LoggingInterceptor` and rendered by `NetworkInspectorOverlay`. Compatible
 * with `useSyncExternalStore`.
 */
export class NetworkInspector {
  static readonly instance = new NetworkInspector();
  static readonly maxEntries = 200;

  private nextId = 0;
  private listeners = new Set<() => void>();
  private state: InspectorState = { logs: [], brightness: 'dark', visible: false };

  /** Immutable snapshot; a new object after every change. */
  getSnapshot = (): InspectorState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get logs(): NetworkLogEntry[] {
    return this.state.logs;
  }

  toggleBrightness(): void {
    this.update({ brightness: this.state.brightness === 'dark' ? 'light' : 'dark' });
  }

  /** Opens the inspector overlay (also what a shake does). */
  open(): void {
    this.update({ visible: true });
  }

  close(): void {
    this.update({ visible: false });
  }

  logRequest(args: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: Uint8Array;
  }): NetworkLogEntry {
    const entry: NetworkLogEntry = {
      id: `${this.nextId++}`,
      method: args.method,
      url: args.url,
      requestHeaders: { ...(args.headers ?? {}) },
      requestBody: args.body,
      startTime: new Date(),
    };
    this.update({ logs: [entry, ...this.state.logs].slice(0, NetworkInspector.maxEntries) });
    return entry;
  }

  logResponse(args: {
    entry?: NetworkLogEntry;
    statusCode: number;
    headers?: Record<string, string>;
    body?: Uint8Array;
    duration?: number;
  }): void {
    if (!args.entry) return;
    this.replace({
      ...args.entry,
      statusCode: args.statusCode,
      responseHeaders: args.headers,
      responseBody: args.body,
      duration: args.duration,
    });
  }

  logError(args: { entry?: NetworkLogEntry; error: unknown; duration?: number }): void {
    if (!args.entry) return;
    this.replace({ ...args.entry, error: args.error, duration: args.duration });
  }

  clear(): void {
    this.update({ logs: [] });
  }

  private replace(next: NetworkLogEntry): void {
    this.update({ logs: this.state.logs.map((e) => (e.id === next.id ? next : e)) });
  }

  private update(patch: Partial<InspectorState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
}
