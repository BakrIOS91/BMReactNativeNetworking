import forge from 'node-forge';
import { APIError, APIErrorType } from '../../../helpers/api-error';

/** Turns a request body into the encrypted envelope that is sent instead of it. */
export interface PayloadEncryptor {
  /** Returns a JSON-encodable object that replaces [body] on the wire. */
  encrypt(body: unknown): unknown;
}

/** How the AES key is wrapped with the RSA public key. */
export enum RsaPadding {
  /** RSAES-PKCS1-v1_5 (JSEncrypt, OpenSSL `RSA_PKCS1_PADDING`, PHP default). */
  pkcs1v15 = 'pkcs1v15',
  /** RSAES-OAEP with SHA-1. */
  oaepSha1 = 'oaepSha1',
  /** RSAES-OAEP with SHA-256. */
  oaepSha256 = 'oaepSha256',
}

/** What is encrypted with the RSA key. */
export enum AesKeyFormat {
  /** Lowercase hex of the key (32 chars for AES-128) as UTF-8 bytes, as CryptoJS/JSEncrypt clients send. */
  hexString = 'hexString',
  /** The raw key bytes. */
  rawBytes = 'rawBytes',
}

export interface HybridPayloadEncryptorOptions {
  /** X.509 `BEGIN PUBLIC KEY` or PKCS#1 `BEGIN RSA PUBLIC KEY` PEM. Literal `\n` sequences are accepted. */
  publicKeyPem: string;
  rsaPadding?: RsaPadding;
  aesKeyFormat?: AesKeyFormat;
  aesKeyBits?: 128 | 192 | 256;
  dataField?: string;
  ivField?: string;
  keyField?: string;
  /**
   * Cryptographically secure random bytes. Defaults to
   * `globalThis.crypto.getRandomValues`; on React Native install
   * `react-native-get-random-values` (or `expo-crypto`) or pass your own.
   */
  randomBytes?: (length: number) => Uint8Array;
}

/**
 * Hybrid encryption: a fresh AES-CBC key and IV are generated for every
 * request, the body is encrypted with them, and the AES key is wrapped with
 * the server RSA public key.
 *
 * The envelope is `{ data: base64(cipher), iv: base64(iv), key: base64(rsa(aesKey)) }`;
 * the field names can be changed with `dataField`, `ivField` and `keyField`.
 */
export class HybridPayloadEncryptor implements PayloadEncryptor {
  private readonly publicKey: forge.pki.rsa.PublicKey;
  private readonly rsaPadding: RsaPadding;
  private readonly aesKeyFormat: AesKeyFormat;
  private readonly aesKeyBits: number;
  private readonly dataField: string;
  private readonly ivField: string;
  private readonly keyField: string;
  private readonly randomBytes: (length: number) => Uint8Array;

  constructor(options: HybridPayloadEncryptorOptions) {
    this.rsaPadding = options.rsaPadding ?? RsaPadding.pkcs1v15;
    this.aesKeyFormat = options.aesKeyFormat ?? AesKeyFormat.hexString;
    this.aesKeyBits = options.aesKeyBits ?? 128;
    this.dataField = options.dataField ?? 'data';
    this.ivField = options.ivField ?? 'iv';
    this.keyField = options.keyField ?? 'key';
    this.randomBytes = options.randomBytes ?? secureRandomBytes;
    this.publicKey = HybridPayloadEncryptor.parseRsaPublicKey(options.publicKeyPem);
  }

  encrypt(body: unknown): unknown {
    try {
      const aesKey = bytesToBinary(this.randomBytes(this.aesKeyBits / 8));
      const iv = bytesToBinary(this.randomBytes(16));

      const cipher = forge.cipher.createCipher('AES-CBC', aesKey);
      cipher.start({ iv });
      cipher.update(forge.util.createBuffer(forge.util.encodeUtf8(JSON.stringify(body))));
      cipher.finish();

      const keyPlain = this.aesKeyFormat === AesKeyFormat.hexString ? forge.util.bytesToHex(aesKey) : aesKey;
      const [scheme, schemeOptions] = this.rsaScheme();
      const wrappedKey = this.publicKey.encrypt(keyPlain, scheme, schemeOptions);

      return {
        [this.dataField]: forge.util.encode64(cipher.output.getBytes()),
        [this.ivField]: forge.util.encode64(iv),
        [this.keyField]: forge.util.encode64(wrappedKey),
      };
    } catch (error) {
      if (error instanceof APIError) throw error;
      throw new APIError(APIErrorType.encryptionFailed);
    }
  }

  private rsaScheme(): [forge.pki.rsa.EncryptionScheme, { md: forge.md.MessageDigest } | undefined] {
    switch (this.rsaPadding) {
      case RsaPadding.pkcs1v15:
        return ['RSAES-PKCS1-V1_5', undefined];
      case RsaPadding.oaepSha1:
        return ['RSA-OAEP', undefined];
      case RsaPadding.oaepSha256:
        return ['RSA-OAEP', { md: forge.md.sha256.create() }];
    }
  }

  /** Parses an RSA public key from an X.509 or PKCS#1 PEM string. */
  static parseRsaPublicKey(pem: string): forge.pki.rsa.PublicKey {
    try {
      return forge.pki.publicKeyFromPem(pem.replace(/\\n/g, '\n').trim());
    } catch {
      throw new APIError(APIErrorType.encryptionFailed);
    }
  }
}

function bytesToBinary(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function secureRandomBytes(length: number): Uint8Array {
  const crypto = (globalThis as { crypto?: { getRandomValues?: <T extends Uint8Array>(a: T) => T } }).crypto;
  if (!crypto?.getRandomValues) {
    throw new Error(
      'No secure random source. Import "react-native-get-random-values" (or pass randomBytes) before encrypting.',
    );
  }
  return crypto.getRandomValues(new Uint8Array(length));
}
