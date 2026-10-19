import type { HTTPStatusCode } from './enums';

/** API error categories for comprehensive error handling. */
export enum APIErrorType {
  /** The request URL could not be formed or resolved. */
  invalidURL = 'invalidURL',
  /** The response data could not be decoded into the expected model. */
  dataConversionFailed = 'dataConversionFailed',
  /** A string encoding or decoding step failed. */
  stringConversionFailed = 'stringConversionFailed',
  /** The server returned a non-2xx HTTP status code. */
  httpError = 'httpError',
  invalidSoapMultipartRequest = 'invalidSoapMultipartRequest',
  xmlEncodingFailed = 'xmlEncodingFailed',
  notSupportedSOAPOperation = 'notSupportedSOAPOperation',
  /** No internet connection was available when the request was attempted. */
  noNetwork = 'noNetwork',
  /** The server response could not be interpreted. */
  invalidResponse = 'invalidResponse',
  /** The request payload could not be encrypted. The request was not sent. */
  encryptionFailed = 'encryptionFailed',
  /** The request timed out before the server answered. */
  timeout = 'timeout',
  /** The request was cancelled with a `CancelToken`. */
  cancelled = 'cancelled',
  /**
   * The connection dropped while a request was in flight. For requests that
   * change state (non-GET) the server may already have processed it, so the
   * request is not retried automatically; check the outcome before retrying.
   */
  connectionLostDuringRequest = 'connectionLostDuringRequest',
  /** SSL pinning was required but could not be applied. The request was not sent. */
  sslPinningUnavailable = 'sslPinningUnavailable',
}

export interface APIErrorOptions {
  statusCode?: HTTPStatusCode;
  /** HTTP status number as received, when available. */
  httpStatus?: number;
  errorModel?: unknown;
}

/**
 * A network error with a category, optional HTTP status code, and an optional
 * decoded error payload from the server.
 */
export class APIError extends Error {
  readonly type: APIErrorType;
  /** The HTTP status code category returned by the server, if applicable. */
  readonly statusCode?: HTTPStatusCode;
  readonly httpStatus?: number;
  /** Decoded error payload attached by the registered `APIErrorResponseMapper`. */
  readonly errorModel?: unknown;

  constructor(type: APIErrorType, options: APIErrorOptions = {}) {
    super();
    Object.setPrototypeOf(this, APIError.prototype);
    this.name = 'APIError';
    this.type = type;
    this.statusCode = options.statusCode;
    this.httpStatus = options.httpStatus;
    this.errorModel = options.errorModel;
    this.message = this.describe();
  }

  /** Returns [errorModel] typed as [T], or `undefined` when there is none. */
  errorModelAs<T>(): T | undefined {
    return this.errorModel as T | undefined;
  }

  toString(): string {
    return this.message;
  }

  private describe(): string {
    const base = this.baseMessage();
    return this.errorModel != null ? `${base} (Error Data: ${safeStringify(this.errorModel)})` : base;
  }

  private baseMessage(): string {
    switch (this.type) {
      case APIErrorType.invalidURL:
        return 'Invalid URL formation.';
      case APIErrorType.dataConversionFailed:
        return 'Failed to convert data.';
      case APIErrorType.stringConversionFailed:
        return 'Failed to convert string.';
      case APIErrorType.httpError:
        return `HTTP Error with status code: ${this.statusCode}`;
      case APIErrorType.invalidSoapMultipartRequest:
        return 'Invalid SOAP multipart request.';
      case APIErrorType.xmlEncodingFailed:
        return 'XML encoding failed.';
      case APIErrorType.notSupportedSOAPOperation:
        return 'SOAP operation not supported.';
      case APIErrorType.noNetwork:
        return 'No internet connection.';
      case APIErrorType.invalidResponse:
        return 'Invalid response.';
      case APIErrorType.encryptionFailed:
        return 'Failed to encrypt the request payload.';
      case APIErrorType.timeout:
        return 'The request timed out.';
      case APIErrorType.cancelled:
        return 'The request was cancelled.';
      case APIErrorType.connectionLostDuringRequest:
        return 'The connection was lost while the request was in flight.';
      case APIErrorType.sslPinningUnavailable:
        return 'SSL pinning could not be applied.';
    }
  }
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}
