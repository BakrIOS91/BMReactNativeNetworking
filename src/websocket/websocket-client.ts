import { NetworkMonitor } from '../network/core/network-monitor';
import { TokenRefreshRegistry } from '../network/token-refresh-handler';
import { Emitter } from '../utils/emitter';
import { ReconnectPolicies, type ReconnectPolicy } from './reconnect-policy';

/** Connection lifecycle of a [BMWebSocketClient]. */
export type SocketConnectionState =
  /** First connection attempt in progress. */
  | 'connecting'
  /** Connected; messages are flowing. */
  | 'open'
  /** The connection dropped unexpectedly; waiting to retry. */
  | 'reconnecting'
  /** Closed on purpose (or never started). The client will not reconnect. */
  | 'closed';

/** The subset of the WebSocket API the client uses. */
export interface BMSocket {
  onopen: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  onclose: ((event: { code?: number }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** Opens a socket. Replaced in tests. */
export type WebSocketConnector = (url: string, headers: Record<string, string>) => BMSocket;

/** React Native's WebSocket accepts handshake headers as a third argument. */
const defaultConnector: WebSocketConnector = (url, headers) =>
  new (WebSocket as unknown as new (url: string, protocols?: string[] | null, options?: object) => BMSocket)(
    url,
    null,
    { headers },
  );

export interface BMWebSocketClientOptions {
  url: string;
  /** Stream names added to the URL as repeated `stream` query parameters. */
  streams?: string[];
  /** Supplies the access token for the `Authorization: Bearer` header. */
  accessToken?: () => Promise<string | null | undefined>;
  /** Extra handshake headers. */
  headers?: Record<string, string>;
  reconnectPolicy?: ReconnectPolicy;
  /** Refresh the token (through `TokenRefreshRegistry`) before every reconnect. Default true. */
  refreshTokenOnReconnect?: boolean;
  /** Return false to stop reconnecting, e.g. `() => session.isLoggedIn`. */
  shouldReconnect?: () => boolean;
  /** Retry immediately when the network comes back. Default true. */
  reconnectOnConnectivityRegained?: boolean;
  connector?: WebSocketConnector;
}

/**
 * A WebSocket that reconnects, authenticates and exposes its messages and
 * connection state as subscribable streams.
 *
 * ```ts
 * const prices = new BMWebSocketClient({
 *   url: 'wss://api.example.com/api/v2/ranger/private/',
 *   streams: ['global.currencies_prices'],
 *   accessToken: async () => session.accessToken,
 * });
 * BMWebSocketRegistry.register('prices', prices);
 * prices.messages.subscribe((m) => ...);
 * await prices.connect();
 * ```
 *
 * Several `streams` share one connection (`?stream=a&stream=b`). Close codes
 * 1000 and 1001 are normal closes and never reconnect; anything else (or a
 * socket error) reconnects per `reconnectPolicy` until [close] is called or
 * `shouldReconnect` returns false.
 */
export class BMWebSocketClient {
  /** Raw messages (usually strings). */
  readonly messages = new Emitter<unknown>();
  /** Messages decoded from JSON; non-JSON frames are skipped. */
  readonly jsonMessages = new Emitter<unknown>();
  /** Connection state changes. Emits only on change. */
  readonly states = new Emitter<SocketConnectionState>();

  private readonly options: BMWebSocketClientOptions;
  private readonly reconnectPolicy: ReconnectPolicy;
  private readonly connector: WebSocketConnector;

  private _state: SocketConnectionState = 'closed';
  private socket?: BMSocket;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private connectivityUnsubscribe?: () => void;
  private attempt = 0;
  private wantOpen = false;
  private connecting = false;

  constructor(options: BMWebSocketClientOptions) {
    this.options = options;
    this.reconnectPolicy = options.reconnectPolicy ?? ReconnectPolicies.exponential();
    this.connector = options.connector ?? defaultConnector;
    this.messages.subscribe((message) => {
      if (typeof message !== 'string') return;
      try {
        this.jsonMessages.emit(JSON.parse(message));
      } catch {
        // Non-JSON frame.
      }
    });
  }

  get state(): SocketConnectionState {
    return this._state;
  }

  /** The URL that is opened, including the `stream` parameters. */
  get url(): string {
    const { url, streams = [] } = this.options;
    if (streams.length === 0) return url;
    const query = streams.map((s) => `stream=${encodeURIComponent(s)}`).join('&');
    return url + (url.includes('?') ? '&' : '?') + query;
  }

  /** Opens the connection. Does nothing if already connecting or open. */
  async connect(): Promise<void> {
    if (this.wantOpen) return;
    this.wantOpen = true;
    this.attempt = 0;
    this.listenConnectivity();
    this.setState('connecting');
    await this.open();
  }

  /** Sends a text frame (JSON-encodes non-string values). Ignored unless open. */
  send(message: unknown): void {
    if (!this.socket || this._state !== 'open') return;
    this.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  /** Closes on purpose and stops reconnecting. Use on logout. */
  close(): void {
    this.wantOpen = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.connectivityUnsubscribe?.();
    this.connectivityUnsubscribe = undefined;
    this.teardown(1000);
    this.setState('closed');
  }

  /** Closes and drops every listener. The client cannot be used afterwards. */
  dispose(): void {
    this.close();
    this.messages.clear();
    this.jsonMessages.clear();
    this.states.clear();
  }

  private open(): Promise<void> {
    if (this.connecting) return Promise.resolve();
    this.connecting = true;

    return (async () => {
      try {
        if (this.attempt > 0 && (this.options.refreshTokenOnReconnect ?? true)) {
          try {
            await TokenRefreshRegistry.refreshToken();
          } catch {
            // No handler registered or refresh failed: use the stored token.
          }
        }
        if (!this.wantOpen) return;

        const token = await this.options.accessToken?.();
        if (!this.wantOpen) return;
        const handshake = {
          ...(this.options.headers ?? {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        };

        await new Promise<void>((resolve) => {
          const socket = this.connector(this.url, handshake);
          this.socket = socket;
          let settled = false;
          const settle = () => {
            settled = true;
            resolve();
          };

          socket.onopen = () => {
            if (this.socket !== socket || !this.wantOpen) return settle();
            this.attempt = 0;
            this.setState('open');
            settle();
          };
          socket.onmessage = (event) => {
            if (this.socket === socket) this.messages.emit(event.data);
          };
          socket.onerror = () => {
            if (!settled) settle();
            this.onClosed(socket, undefined);
          };
          socket.onclose = (event) => {
            if (!settled) settle();
            this.onClosed(socket, event?.code);
          };
        });
      } catch {
        this.scheduleReconnect();
      } finally {
        this.connecting = false;
      }
    })();
  }

  private onClosed(socket: BMSocket, code: number | undefined): void {
    if (this.socket !== socket) return;
    this.socket = undefined;
    // 1000 normal closure, 1001 going away: the server ended it cleanly.
    if (code === 1000 || code === 1001) {
      if (this.wantOpen) {
        this.wantOpen = false;
        this.setState('closed');
      }
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.wantOpen) return;
    if (this.options.shouldReconnect && !this.options.shouldReconnect()) {
      this.wantOpen = false;
      this.setState('closed');
      return;
    }
    this.setState('reconnecting');
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.attempt++;
    this.retryTimer = setTimeout(() => void this.open(), this.reconnectPolicy.delayFor(this.attempt));
  }

  private listenConnectivity(): void {
    if (!(this.options.reconnectOnConnectivityRegained ?? true) || this.connectivityUnsubscribe) return;
    try {
      this.connectivityUnsubscribe = NetworkMonitor.subscribe((online) => {
        if (online && this.wantOpen && this._state === 'reconnecting') {
          if (this.retryTimer) clearTimeout(this.retryTimer);
          void this.open();
        }
      });
    } catch {
      // Connectivity module unavailable; the backoff timer still reconnects.
    }
  }

  private teardown(code?: number): void {
    const socket = this.socket;
    this.socket = undefined;
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
    try {
      socket.close(code);
    } catch {
      // Already closed.
    }
  }

  private setState(next: SocketConnectionState): void {
    if (this._state === next) return;
    this._state = next;
    this.states.emit(next);
  }
}

/** Keeps named sockets so they can all be closed from anywhere, e.g. on every logout path. */
export class BMWebSocketRegistry {
  private static clients = new Map<string, BMWebSocketClient>();

  /** Registers [client] under [name], closing any previous client with the same name. */
  static register(name: string, client: BMWebSocketClient): void {
    const previous = BMWebSocketRegistry.clients.get(name);
    if (previous && previous !== client) previous.close();
    BMWebSocketRegistry.clients.set(name, client);
  }

  static get(name: string): BMWebSocketClient | undefined {
    return BMWebSocketRegistry.clients.get(name);
  }

  /** Closes (without reconnecting) and forgets one socket. */
  static close(name: string): void {
    BMWebSocketRegistry.clients.get(name)?.close();
    BMWebSocketRegistry.clients.delete(name);
  }

  /** Closes every registered socket. Call on logout. */
  static closeAll(): void {
    const all = [...BMWebSocketRegistry.clients.values()];
    BMWebSocketRegistry.clients.clear();
    all.forEach((c) => c.close());
  }
}
