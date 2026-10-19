import type { PayloadEncryptor } from './encryption/payload-encryptor';
import type { FileSystemAdapter } from '../../platform/file-system';
import type { HttpTransport } from './transport';

export interface NetworkConfigOptions {
  payloadEncryptor?: PayloadEncryptor;
  isPayloadEncryptionEnabled?: boolean;
  encryptQueryParameters?: boolean;
  /** Milliseconds. `null` disables the timeout. */
  sendTimeout?: number | null;
  /** Milliseconds. `null` disables the timeout. */
  receiveTimeout?: number | null;
  transport?: HttpTransport;
  fileSystem?: FileSystemAdapter;
}

/**
 * Global, app-wide networking settings. Configure once at startup; every
 * request reads them when it is built.
 *
 * ```ts
 * NetworkConfig.configure({
 *   payloadEncryptor: new HybridPayloadEncryptor({ publicKeyPem: Env.ENCRYPT_PUBLIC_KEY }),
 *   isPayloadEncryptionEnabled: !__DEV__,
 *   receiveTimeout: 45_000,
 * });
 * ```
 */
export class NetworkConfig {
  /** Encrypts request bodies. Undefined disables encryption. */
  static payloadEncryptor?: PayloadEncryptor;

  /** Master switch so encryption can be turned off per environment. */
  static isPayloadEncryptionEnabled = true;

  /**
   * Also encrypt the query string of GET requests: the parameters are replaced
   * by the encrypted envelope fields. Only enable when the backend decrypts them.
   */
  static encryptQueryParameters = false;

  /**
   * Maximum time (ms) from sending the request until the response headers
   * arrive. React Native exposes no separate connect timeout, so this also
   * bounds connection setup.
   */
  static sendTimeout: number | null = 30_000;

  /** Maximum time (ms) to read the response body. */
  static receiveTimeout: number | null = 30_000;

  /** Replaces the default `fetch` transport (custom stack, tests). */
  static transport?: HttpTransport;

  /** Replaces the default file system adapter used by uploads and downloads. */
  static fileSystem?: FileSystemAdapter;

  static configure(options: NetworkConfigOptions): void {
    if (options.payloadEncryptor !== undefined) NetworkConfig.payloadEncryptor = options.payloadEncryptor;
    if (options.isPayloadEncryptionEnabled !== undefined)
      NetworkConfig.isPayloadEncryptionEnabled = options.isPayloadEncryptionEnabled;
    if (options.encryptQueryParameters !== undefined)
      NetworkConfig.encryptQueryParameters = options.encryptQueryParameters;
    if (options.sendTimeout !== undefined) NetworkConfig.sendTimeout = options.sendTimeout;
    if (options.receiveTimeout !== undefined) NetworkConfig.receiveTimeout = options.receiveTimeout;
    if (options.transport !== undefined) NetworkConfig.transport = options.transport;
    if (options.fileSystem !== undefined) NetworkConfig.fileSystem = options.fileSystem;
  }

  /** Restores the defaults (mainly for tests). */
  static reset(): void {
    NetworkConfig.payloadEncryptor = undefined;
    NetworkConfig.isPayloadEncryptionEnabled = true;
    NetworkConfig.encryptQueryParameters = false;
    NetworkConfig.sendTimeout = 30_000;
    NetworkConfig.receiveTimeout = 30_000;
    NetworkConfig.transport = undefined;
    NetworkConfig.fileSystem = undefined;
  }

  /** Whether a request body should be encrypted. */
  static get shouldEncrypt(): boolean {
    return NetworkConfig.isPayloadEncryptionEnabled && NetworkConfig.payloadEncryptor !== undefined;
  }
}
