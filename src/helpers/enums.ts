/** Enums and constants for the networking layer. */

export enum AppEnvironment {
  development = 'development',
  testing = 'testing',
  staging = 'staging',
  preProduction = 'preProduction',
  production = 'production',
}

export function appEnvironmentFromString(value: string): AppEnvironment {
  switch (value.toLowerCase()) {
    case 'development':
    case 'dev':
      return AppEnvironment.development;
    case 'testing':
    case 'test':
      return AppEnvironment.testing;
    case 'staging':
      return AppEnvironment.staging;
    case 'preproduction':
    case 'pre_production':
    case 'pre-production':
    case 'preprod':
      return AppEnvironment.preProduction;
    case 'production':
    case 'prod':
      return AppEnvironment.production;
    default:
      return AppEnvironment.development;
  }
}

export enum RequestType {
  rest = 'rest',
  soap = 'soap',
}

/** HTTP request methods as defined in RFC 7231. */
export enum HTTPMethod {
  get = 'GET',
  post = 'POST',
  put = 'PUT',
  delete = 'DELETE',
  patch = 'PATCH',
  head = 'HEAD',
  options = 'OPTIONS',
  trace = 'TRACE',
  connect = 'CONNECT',
}

/** Binary file part of a multipart upload. */
export class MultipartFormDataData {
  constructor(
    readonly data: Uint8Array,
    readonly fileName: string,
    readonly mimeType: string,
  ) {}
}

/** Text field of a multipart upload. */
export class MultipartFormDataText {
  constructor(readonly value: unknown) {}
}

export type MultipartFormData = MultipartFormDataData | MultipartFormDataText;

export enum RequestTaskType {
  plain = 'plain',
  parameters = 'parameters',
  encodedBody = 'encodedBody',
  uploadFile = 'uploadFile',
  uploadMultipart = 'uploadMultipart',
  download = 'download',
  downloadResumable = 'downloadResumable',
  parametersAndBody = 'parametersAndBody',
}

/** HTTP status code categories for response handling. */
export enum HTTPStatusCode {
  information = 'information',
  success = 'success',
  redirection = 'redirection',
  notFound = 'notFound',
  notAuthorize = 'notAuthorize',
  clientError = 'clientError',
  serverError = 'serverError',
  unknown = 'unknown',
}

export function httpStatusCodeFrom(code: number): HTTPStatusCode {
  if (code >= 100 && code < 200) return HTTPStatusCode.information;
  if (code >= 200 && code < 300) return HTTPStatusCode.success;
  if (code >= 300 && code < 400) return HTTPStatusCode.redirection;
  if (code === 401) return HTTPStatusCode.notAuthorize;
  if (code === 404) return HTTPStatusCode.notFound;
  if (code >= 400 && code < 500) return HTTPStatusCode.clientError;
  if (code >= 500 && code < 600) return HTTPStatusCode.serverError;
  return HTTPStatusCode.unknown;
}

/** Methods that cannot change server state. */
export function isReadOnlyMethod(method: HTTPMethod): boolean {
  return method === HTTPMethod.get || method === HTTPMethod.head || method === HTTPMethod.options;
}
