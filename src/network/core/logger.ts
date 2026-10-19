import { utf8Decode } from '../../helpers/bytes';

declare const __DEV__: boolean | undefined;

/** Formatted console logging of requests and responses. */
export class Logger {
  static isEnabled: boolean = typeof __DEV__ !== 'undefined' ? !!__DEV__ : false;

  /** Replaced in tests. */
  static sink: (message: string) => void = (message) => console.log(message);

  static logRequest(args: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    parameters?: Record<string, unknown>;
    body?: string | Uint8Array;
  }): void {
    if (!Logger.isEnabled) return;
    const log = Logger.sink;

    log('############################## Request ##############################');
    log(`📤 Will send ${args.method} request for ${args.url}\n`);

    if (args.headers && Object.keys(args.headers).length > 0) {
      log('🏷 Headers:');
      for (const [key, value] of Object.entries(args.headers)) log(`${key} : ${value}`);
    }
    if (args.parameters && Object.keys(args.parameters).length > 0) {
      log(`\nParameters: ${prettyJson(args.parameters)}\n`);
    }
    log(args.body != null ? `\nBody: ${prettyBody(args.body)}\n` : '\nBody: Empty\n');
    log('############################## End Request ##############################\n');
  }

  static logResponse(args: {
    method: string;
    url: string;
    statusCode?: number;
    responseData?: Uint8Array;
    error?: unknown;
  }): void {
    if (!Logger.isEnabled) return;
    const log = Logger.sink;

    log('############################## Received Response ##############################');
    if (args.error != null) {
      log(`❌ ${args.statusCode ?? ''} ${args.method} request for ${args.url} returned Error: ${String(args.error)}`);
    }
    if (args.statusCode != null) {
      const emoji = args.statusCode >= 200 && args.statusCode < 300 ? '✅' : '⚠️';
      log(`${emoji} Did receive response ${args.statusCode} for request ${args.url}`);
      log(args.responseData && args.responseData.length > 0 ? `\nBody:\n${prettyBody(args.responseData)}` : '\nBody: Empty or Void...');
    }
    log('############################## End Response ##############################\n');
  }
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function prettyBody(body: string | Uint8Array): string {
  const text = typeof body === 'string' ? body : utf8Decode(body);
  try {
    return prettyJson(JSON.parse(text));
  } catch {
    return text;
  }
}
