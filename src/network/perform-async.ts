/**
 * Request execution for the networking layer.
 *
 * When a 401 Unauthorized response is received on an `isAuthorized` request,
 * the layer refreshes the token via `TokenRefreshRegistry`. If the refresh
 * succeeds the original request is rebuilt (fresh token from `authHeaders`)
 * and re-sent exactly once. If it fails the 401 propagates normally.
 */
import { APIError, APIErrorType } from '../helpers/api-error';
import { parseSetCookieHeader } from '../helpers/bm-cookie';
import type { DownloadedFile } from '../helpers/downloaded-file';
import { HTTPStatusCode, httpStatusCodeFrom, isReadOnlyMethod } from '../helpers/enums';
import { currentFileSystem } from '../platform/file-system';
import { SSLPinningHelper } from '../helpers/ssl-pinning-helper';
import { lastPathSegment } from '../helpers/url';
import { utf8Decode } from '../helpers/bytes';
import type { CancelToken } from './core/cancel-token';
import { AuthInterceptor } from './core/interceptors/auth-interceptor';
import { LoggingInterceptor } from './core/interceptors/logging-interceptor';
import { NetworkClient } from './core/interceptor';
import { NetworkConfig } from './core/network-config';
import { NetworkMonitor } from './core/network-monitor';
import type { NetworkResponse } from './core/network-response';
import { RequestGuard } from './core/request-guard';
import { FetchTransport, type BMRequest, type TransportResponse } from './core/transport';
import { APIErrorResponseRegistry } from './error-handler';
import { createRequest } from './request';
import { TokenRefreshRegistry } from './token-refresh-handler';
import type { ModelTargetType, SuccessTargetType, TargetRequest } from './target-request';

declare const __DEV__: boolean | undefined;

const defaultTransport = new FetchTransport();

interface Execution {
  client: NetworkClient;
  abortSignal: AbortSignal;
  send(request: BMRequest): Promise<TransportResponse>;
  readBody(response: TransportResponse): Promise<Uint8Array>;
}

/** Runs [body] with timeouts, cancellation and connection-loss detection; maps every failure to an [APIError]. */
async function execute<R>(
  target: TargetRequest,
  cancelToken: CancelToken | undefined,
  body: (exec: Execution, request: BMRequest) => Promise<R>,
): Promise<R> {
  if (cancelToken?.isCancelled) throw new APIError(APIErrorType.cancelled);

  // Checked before anything is built or sent, so an offline request is never queued.
  if (!(await NetworkMonitor.isConnected())) throw new APIError(APIErrorType.noNetwork);

  const pinning = target.sslPinningConfiguration;
  if (pinning) await SSLPinningHelper.ensureApplied(pinning);

  const controller = new AbortController();
  const transport = NetworkConfig.transport ?? defaultTransport;
  let guard!: RequestGuard;
  let client!: NetworkClient;

  const sendLimit = target.sendTimeout === undefined ? NetworkConfig.sendTimeout : target.sendTimeout;
  const receiveLimit = target.receiveTimeout === undefined ? NetworkConfig.receiveTimeout : target.receiveTimeout;

  client = new NetworkClient(transport, [
    new AuthInterceptor({
      isAuthorized: target.isAuthorized,
      refreshRequest: async () => {
        await TokenRefreshRegistry.refreshToken();
        return createRequest(target);
      },
      retry: (req) => client.send(req, { signal: controller.signal }),
      // A request that was cancelled or dropped is never replayed.
      shouldRetry: () => !guard.isAborted,
    }),
    new LoggingInterceptor(),
  ]);

  guard = new RequestGuard({
    isMutating: !isReadOnlyMethod(target.requestMethod),
    cancelToken,
    onAbort: () => controller.abort(),
  });

  const exec: Execution = {
    client,
    abortSignal: controller.signal,
    send: (request) =>
      withTimeout(client.send(request, { signal: controller.signal }), sendLimit, () => controller.abort()),
    readBody: (response) => withTimeout(response.readBody(), receiveLimit, () => controller.abort()),
  };

  try {
    return await guard.run(async () => body(exec, await createRequest(target)));
  } catch (error) {
    if (error instanceof APIError) throw error;
    if (error instanceof TimeoutError) throw new APIError(APIErrorType.timeout);
    throw new APIError(APIErrorType.invalidResponse);
  } finally {
    guard.dispose();
  }
}

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number | null | undefined, onTimeout: () => void): Promise<T> {
  if (ms === null || ms === undefined) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new TimeoutError());
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function httpError(response: TransportResponse, errorModel?: unknown): APIError {
  return new APIError(APIErrorType.httpError, {
    statusCode: httpStatusCodeFrom(response.status),
    httpStatus: response.status,
    errorModel,
  });
}

function tryDecodeError(data: Uint8Array): unknown {
  try {
    if (data.length === 0) return undefined;
    return APIErrorResponseRegistry.decode(JSON.parse(utf8Decode(data)));
  } catch {
    return undefined;
  }
}

function responseMeta(response: TransportResponse) {
  const rawSetCookieHeader = response.headers['set-cookie'];
  return {
    statusCode: response.status,
    headers: response.headers,
    rawSetCookieHeader,
    cookies: parseSetCookieHeader(rawSetCookieHeader),
  };
}

export function performModel<T>(target: ModelTargetType<T>, cancelToken?: CancelToken): Promise<NetworkResponse<T>> {
  return execute(target, cancelToken, async (exec, request) => {
    const response = await exec.send(request);
    const data = await exec.readBody(response);

    if (httpStatusCodeFrom(response.status) !== HTTPStatusCode.success) {
      throw httpError(response, tryDecodeError(data));
    }
    try {
      const decoded = target.fromDynamicJson(JSON.parse(utf8Decode(data)));
      return { data: decoded, ...responseMeta(response) };
    } catch (error) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[BMNetworking] decode failed', error);
      throw new APIError(APIErrorType.dataConversionFailed);
    }
  });
}

export function performSuccess(target: SuccessTargetType, cancelToken?: CancelToken): Promise<NetworkResponse<void>> {
  return execute(target, cancelToken, async (exec, request) => {
    const response = await exec.send(request);
    if (httpStatusCodeFrom(response.status) === HTTPStatusCode.success) {
      return { data: undefined, ...responseMeta(response) };
    }
    throw httpError(response, tryDecodeError(await exec.readBody(response)));
  });
}

export function performDownload(target: ModelTargetType<any>, cancelToken?: CancelToken): Promise<DownloadedFile> {
  return execute(target, cancelToken, async (exec, request) => {
    const response = await exec.send(request);
    if (httpStatusCodeFrom(response.status) !== HTTPStatusCode.success) throw httpError(response);

    const remoteUrl = response.url || request.url;
    let fileName = lastPathSegment(remoteUrl) || 'download';
    if (target.useUniqueFilename) {
      fileName = `${Date.now()}_${Math.random().toString(16).slice(2, 10)}_${fileName}`;
    }

    const bytes = await exec.readBody(response);
    const downloadedUrl = await currentFileSystem().writeTemp(fileName, bytes);
    return { downloadedUrl, remoteUrl, statusCode: response.status, headers: response.headers };
  });
}
