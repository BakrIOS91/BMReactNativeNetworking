import { HTTPMethod, RequestTaskType, RequestType } from '../helpers/enums';
import type { DownloadedFile } from '../helpers/downloaded-file';
import type { APIError } from '../helpers/api-error';
import { NetworkMonitor } from './core/network-monitor';
import { RequestTask } from './core/request-task';
import type { SSLPinningConfiguration } from './core/ssl-pinning';
import type { CancelToken } from './core/cancel-token';
import type { NetworkResponse } from './core/network-response';
import { Failure, Success, type Result } from './core/result';
import * as perform from './perform-async';

export interface PerformOptions {
  /** Cancels the request, e.g. when a screen unmounts. */
  cancelToken?: CancelToken;
}

/** Everything a request needs to know about itself. */
export abstract class TargetRequest {
  abstract get baseURL(): string;
  abstract get requestPath(): string;
  abstract get requestMethod(): HTTPMethod;

  get requestType(): RequestType {
    return RequestType.rest;
  }
  get requestTask(): RequestTask {
    return RequestTask.plain();
  }
  get isAuthorized(): boolean {
    return false;
  }
  get headers(): Record<string, string> {
    return {};
  }
  /** Evaluated on every build, so a retry after a refresh picks up the new token. */
  get authHeaders(): Record<string, string> {
    return {};
  }
  get sslPinningConfiguration(): SSLPinningConfiguration | undefined {
    return undefined;
  }
  get useUniqueFilename(): boolean {
    return false;
  }

  /** Set to false to send this endpoint's body in plain JSON even when encryption is enabled. */
  get encryptsPayload(): boolean {
    return true;
  }

  /** Per-endpoint timeout overrides in milliseconds. Undefined uses `NetworkConfig`. */
  get sendTimeout(): number | null | undefined {
    return undefined;
  }
  get receiveTimeout(): number | null | undefined {
    return undefined;
  }

  get defaultHeaders(): Record<string, string> {
    return { 'Content-Type': 'application/json', Accept: '*/*' };
  }

  get mergedHeaders(): Record<string, string> {
    return { ...this.defaultHeaders, ...this.headers, ...this.authHeaders };
  }

  static isConnectedToInternet(): Promise<boolean> {
    return NetworkMonitor.isConnected();
  }

  get requestTaskDescription(): string {
    const task = this.requestTask;
    switch (task.type) {
      case RequestTaskType.plain:
        return 'Plain request';
      case RequestTaskType.parameters:
        return `Parameters: ${JSON.stringify(task.parameters)}`;
      case RequestTaskType.encodedBody:
        return `Body: ${JSON.stringify(task.body)}`;
      case RequestTaskType.uploadFile:
        return `Upload file: ${task.filePath}`;
      case RequestTaskType.uploadMultipart:
        return `Multipart fields: ${JSON.stringify(Object.keys(task.fields ?? {}))}`;
      case RequestTaskType.download:
        return `Download from: ${task.url}`;
      case RequestTaskType.downloadResumable:
        return `Resumable download with offset: ${task.offset}`;
      case RequestTaskType.parametersAndBody:
        return `Parameters: ${JSON.stringify(task.parameters)}, Body: ${JSON.stringify(task.body)}`;
    }
  }
}

/** A request whose response body is ignored; only success or failure matters. */
export abstract class SuccessTargetType extends TargetRequest {
  async performAsync(options: PerformOptions = {}): Promise<void> {
    await this.performAsyncWithCookies(options);
  }

  performAsyncWithCookies(options: PerformOptions = {}): Promise<NetworkResponse<void>> {
    return perform.performSuccess(this, options.cancelToken);
  }

  performResult(options: PerformOptions = {}): Promise<Result<void, APIError>> {
    return toResult(() => this.performAsync(options));
  }

  performResultWithCookies(options: PerformOptions = {}): Promise<Result<NetworkResponse<void>, APIError>> {
    return toResult(() => this.performAsyncWithCookies(options));
  }
}

/** A request whose JSON response is decoded into a model [T]. */
export abstract class ModelTargetType<T> extends TargetRequest {
  constructor(private readonly decoder?: (json: any) => T) {
    super();
  }

  /** Decodes a JSON object. Override, or pass a `decoder` to the constructor. */
  fromJson(json: any): T {
    if (this.decoder) return this.decoder(json);
    throw new Error('fromJson MUST be overridden or a decoder MUST be provided in the constructor of ModelTargetType');
  }

  /**
   * Override instead of [fromJson] when the top-level JSON is not an object
   * (e.g. an array). Defaults to forwarding to [fromJson].
   */
  fromDynamicJson(json: unknown): T {
    return this.fromJson(json);
  }

  async performAsync(options: PerformOptions = {}): Promise<T> {
    return (await this.performAsyncWithCookies(options)).data;
  }

  performAsyncWithCookies(options: PerformOptions = {}): Promise<NetworkResponse<T>> {
    return perform.performModel(this, options.cancelToken);
  }

  performDownload(options: PerformOptions = {}): Promise<DownloadedFile> {
    return perform.performDownload(this, options.cancelToken);
  }

  performResult(options: PerformOptions = {}): Promise<Result<T, APIError>> {
    return toResult(() => this.performAsync(options));
  }

  performResultWithCookies(options: PerformOptions = {}): Promise<Result<NetworkResponse<T>, APIError>> {
    return toResult(() => this.performAsyncWithCookies(options));
  }

  performDownloadResult(options: PerformOptions = {}): Promise<Result<DownloadedFile, APIError>> {
    return toResult(() => this.performDownload(options));
  }
}

async function toResult<V>(action: () => Promise<V>): Promise<Result<V, APIError>> {
  try {
    return new Success<V, APIError>(await action());
  } catch (error) {
    // Everything thrown by the perform functions is already an APIError.
    return new Failure<V, APIError>(error as APIError);
  }
}
