/**
 * SSL/TLS pinning settings.
 *
 * React Native's `fetch` cannot be pinned from JavaScript. Pinning is applied
 * through the optional `react-native-ssl-public-key-pinning` package (see
 * `SSLPinningHelper`), which pins by SPKI public key hash.
 */
export interface SSLPinningConfiguration {
  isEnabled?: boolean;
  /**
   * When pinning cannot be applied (module missing, init failure) proceed
   * without it instead of failing the request. Default: false.
   */
  allowFallback?: boolean;
  /** Hosts to pin. */
  pinnedHosts?: string[];
  /** Base64 SHA-256 SPKI hashes, with or without the `sha256/` prefix. */
  pinnedPublicKeyHashes?: string[];
  /** Also pin subdomains of every pinned host. Default: false. */
  includeSubdomains?: boolean;
}
