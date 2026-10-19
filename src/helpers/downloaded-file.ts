/** A file downloaded to the device's temporary directory. */
export interface DownloadedFile {
  /** Local URI of the saved file. */
  downloadedUrl?: string;
  /** The remote URL the file was downloaded from. */
  remoteUrl?: string;
  statusCode: number;
  headers: Record<string, string>;
}
