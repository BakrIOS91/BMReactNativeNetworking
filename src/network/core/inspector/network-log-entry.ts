/** A single captured request/response pair shown by the network inspector. */
export interface NetworkLogEntry {
  id: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody?: Uint8Array;
  startTime: Date;
  statusCode?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: Uint8Array;
  error?: unknown;
  /** Milliseconds. */
  duration?: number;
}

export const isPending = (e: NetworkLogEntry): boolean => e.statusCode === undefined && e.error === undefined;

export const isErrorEntry = (e: NetworkLogEntry): boolean =>
  e.error !== undefined || (e.statusCode !== undefined && e.statusCode >= 400);
