import * as Crypto from 'expo-crypto';
import { HybridPayloadEncryptor, Logger, NetworkConfig } from 'bm-react-native-networking';
import { DEMO_PUBLIC_KEY } from './api';

/** One-time networking setup, imported first by App. */
export function configureNetworking(): void {
  Logger.isEnabled = true;
  NetworkConfig.configure({
    payloadEncryptor: new HybridPayloadEncryptor({
      publicKeyPem: DEMO_PUBLIC_KEY,
      randomBytes: (n) => Crypto.getRandomBytes(n),
    }),
    isPayloadEncryptionEnabled: false, // toggled from the UI
    sendTimeout: 15_000,
    receiveTimeout: 15_000,
  });
}
