import { Emitter, type Unsubscribe } from '../../helpers/emitter';

/** Minimal connectivity source. Implement it to use a library other than NetInfo. */
export interface ConnectivityProvider {
  /** Current status (true = online). */
  isOnline(): Promise<boolean>;
  /** Called on every change. */
  subscribe(listener: (online: boolean) => void): Unsubscribe;
}

/**
 * App-wide connectivity monitor. Uses `@react-native-community/netinfo` when
 * it is installed; otherwise the device is assumed online. Call
 * [NetworkMonitor.setProvider] to plug in another source.
 */
export class NetworkMonitor {
  /** Delay before re-checking when a check reports offline. */
  static offlineRecheckDelay = 500;

  private static provider?: ConnectivityProvider;
  private static resolved = false;
  private static readonly changes = new Emitter<boolean>();
  private static providerUnsubscribe?: Unsubscribe;

  static setProvider(provider: ConnectivityProvider | undefined): void {
    NetworkMonitor.providerUnsubscribe?.();
    NetworkMonitor.providerUnsubscribe = undefined;
    NetworkMonitor.provider = provider;
    NetworkMonitor.resolved = true;
    NetworkMonitor.attach();
  }

  /** Warms up the platform monitor. Called automatically on first use. */
  static start(): void {
    if (NetworkMonitor.resolved) return;
    NetworkMonitor.resolved = true;
    NetworkMonitor.provider = netInfoProvider();
    NetworkMonitor.attach();
  }

  /** Stops monitoring and forgets the provider. For tests. */
  static reset(): void {
    NetworkMonitor.providerUnsubscribe?.();
    NetworkMonitor.providerUnsubscribe = undefined;
    NetworkMonitor.provider = undefined;
    NetworkMonitor.resolved = false;
    NetworkMonitor.changes.clear();
  }

  static async isConnected(): Promise<boolean> {
    NetworkMonitor.start();
    if (await NetworkMonitor.check()) return true;
    await new Promise((resolve) => setTimeout(resolve, NetworkMonitor.offlineRecheckDelay));
    return NetworkMonitor.check();
  }

  /** Emits changes only, without the current status. */
  static subscribe(listener: (online: boolean) => void): Unsubscribe {
    NetworkMonitor.start();
    return NetworkMonitor.changes.subscribe(listener);
  }

  private static async check(): Promise<boolean> {
    const provider = NetworkMonitor.provider;
    if (!provider) return true;
    try {
      return await provider.isOnline();
    } catch {
      return true;
    }
  }

  private static attach(): void {
    const provider = NetworkMonitor.provider;
    if (!provider) return;
    try {
      NetworkMonitor.providerUnsubscribe = provider.subscribe((online) => NetworkMonitor.changes.emit(online));
    } catch {
      // Platform module unavailable; on-demand checks still work.
    }
  }
}

function netInfoProvider(): ConnectivityProvider | undefined {
  const mod = loadNetInfo();
  const NetInfo = mod?.default ?? mod;
  if (!NetInfo?.fetch) return undefined;
  // `isConnected: null` means unknown; only an explicit false is offline.
  const online = (state: { isConnected: boolean | null }) => state.isConnected !== false;
  return {
    isOnline: async () => online(await NetInfo.fetch()),
    subscribe: (listener) => NetInfo.addEventListener((state: { isConnected: boolean | null }) => listener(online(state))),
  };
}

/**
 * Metro only tolerates a missing package when a literal `require` sits inside
 * a `try` block, so optional peers are loaded this way (not via a helper).
 */
function loadNetInfo(): any {
  try {
    return require('@react-native-community/netinfo');
  } catch {
    return undefined;
  }
}
