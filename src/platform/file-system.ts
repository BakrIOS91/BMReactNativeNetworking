import { base64Encode } from '../helpers/bytes';
import { APIError, APIErrorType } from '../helpers/api-error';
import { NetworkConfig } from '../network/core/network-config';

/** File access needed by uploads and downloads. */
export interface FileSystemAdapter {
  /** Reads the file at [path] (a path or `file://` URI). */
  readBytes(path: string): Promise<Uint8Array>;
  /** Writes [bytes] to the temporary directory and returns the file URI. */
  writeTemp(fileName: string, bytes: Uint8Array): Promise<string>;
}

/**
 * Default adapter: reads through `fetch` (supports `file://` URIs on React
 * Native) and writes with `expo-file-system` when it is installed. Bare apps
 * without Expo should pass their own adapter to `NetworkConfig.configure`.
 */
export const defaultFileSystem: FileSystemAdapter = {
  async readBytes(path) {
    const response = await fetch(path.includes('://') ? path : `file://${path}`);
    return new Uint8Array(await response.arrayBuffer());
  },

  async writeTemp(fileName, bytes) {
    const fs = loadExpoFileSystem();
    const dir: string | undefined = fs?.cacheDirectory;
    if (!fs?.writeAsStringAsync || !dir) {
      throw new APIError(APIErrorType.invalidURL);
    }
    const uri = `${dir}${fileName}`;
    await fs.writeAsStringAsync(uri, base64Encode(bytes), { encoding: 'base64' });
    return uri;
  },
};

export function currentFileSystem(): FileSystemAdapter {
  return NetworkConfig.fileSystem ?? defaultFileSystem;
}

/** `expo-file-system/legacy` (SDK 54+) first, then the classic entry point. */
function loadExpoFileSystem(): any {
  try {
    return require('expo-file-system/legacy');
  } catch {
    // Older SDKs expose the classic API from the package root.
  }
  try {
    return require('expo-file-system');
  } catch {
    return undefined;
  }
}
