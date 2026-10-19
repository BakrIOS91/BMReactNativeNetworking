import { APIError, APIErrorType } from '../helpers/api-error';
import type { SSLPinningConfiguration } from '../network/core/ssl-pinning';

/**
 * Applies SSL pinning through `react-native-ssl-public-key-pinning`, which
 * installs the pins natively for all `fetch`/XHR traffic of the app.
 *
 * Pins are applied once per distinct configuration. The library keeps a single
 * global pin set, so configurations are merged per host.
 */
export class SSLPinningHelper {
  private static pins: Record<string, { includeSubdomains: boolean; publicKeyHashes: string[] }> = {};
  private static applied = new Set<string>();

  /** Overridable in tests. */
  static loadModule: () => any = () => {
    try {
      return require('react-native-ssl-public-key-pinning');
    } catch {
      return undefined;
    }
  };

  /** Ensures [config] is in effect; throws unless `allowFallback` is set. */
  static async ensureApplied(config: SSLPinningConfiguration): Promise<void> {
    if (config.isEnabled === false) return;

    const key = JSON.stringify([
      [...(config.pinnedHosts ?? [])].sort(),
      [...(config.pinnedPublicKeyHashes ?? [])].sort(),
      !!config.includeSubdomains,
    ]);
    if (SSLPinningHelper.applied.has(key)) return;

    try {
      const mod = SSLPinningHelper.loadModule();
      if (!mod?.initializeSslPinning) throw new Error('react-native-ssl-public-key-pinning is not installed');
      const hosts = config.pinnedHosts ?? [];
      const hashes = (config.pinnedPublicKeyHashes ?? []).map((h) => (h.startsWith('sha256/') ? h : `sha256/${h}`));
      if (hosts.length === 0 || hashes.length === 0) throw new Error('pinnedHosts and pinnedPublicKeyHashes are required');

      for (const host of hosts) {
        const existing = SSLPinningHelper.pins[host];
        SSLPinningHelper.pins[host] = {
          includeSubdomains: !!config.includeSubdomains || !!existing?.includeSubdomains,
          publicKeyHashes: [...new Set([...(existing?.publicKeyHashes ?? []), ...hashes])],
        };
      }
      await mod.initializeSslPinning(SSLPinningHelper.pins);
      SSLPinningHelper.applied.add(key);
    } catch {
      if (config.allowFallback) return;
      throw new APIError(APIErrorType.sslPinningUnavailable);
    }
  }

  /** Forgets applied pins (tests). */
  static reset(): void {
    SSLPinningHelper.pins = {};
    SSLPinningHelper.applied.clear();
  }
}
