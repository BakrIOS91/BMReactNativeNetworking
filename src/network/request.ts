import { APIError, APIErrorType } from '../helpers/api-error';
import {
  HTTPMethod,
  MultipartFormDataData,
  MultipartFormDataText,
  RequestTaskType,
  RequestType,
} from '../helpers/enums';
import { currentFileSystem } from '../platform/file-system';
import { buildQueryString, resolveUrl, withQuery } from '../helpers/url';
import { concatBytes, utf8Encode } from '../helpers/bytes';
import { NetworkConfig } from './core/network-config';
import type { BMRequest } from './core/transport';
import type { TargetRequest } from './target-request';

/** Builds the wire request described by [target]. Rejects with an [APIError]. */
export async function createRequest(target: TargetRequest): Promise<BMRequest> {
  try {
    const url = resolveUrl(target.baseURL, target.requestPath);
    const request: BMRequest = { method: target.requestMethod, url, headers: { ...target.mergedHeaders } };

    if (target.requestType === RequestType.soap) {
      throw new APIError(APIErrorType.notSupportedSOAPOperation);
    }
    return await configureREST(target, request);
  } catch (error) {
    if (error instanceof APIError) throw error;
    throw new APIError(APIErrorType.invalidURL);
  }
}

async function configureREST(target: TargetRequest, request: BMRequest): Promise<BMRequest> {
  const task = target.requestTask;

  switch (task.type) {
    case RequestTaskType.plain:
    case RequestTaskType.download:
      return request;

    case RequestTaskType.parameters:
      return task.parameters ? withParameters(target, request, task.parameters) : request;

    case RequestTaskType.encodedBody:
      return task.body !== undefined && task.body !== null ? withJsonBody(target, request, task.body) : request;

    case RequestTaskType.parametersAndBody: {
      let next = task.parameters ? withParameters(target, request, task.parameters) : request;
      if (task.body !== undefined && task.body !== null) next = withJsonBody(target, next, task.body);
      return next;
    }

    case RequestTaskType.uploadFile: {
      if (!task.filePath) return request;
      let bytes: Uint8Array;
      try {
        bytes = await currentFileSystem().readBytes(task.filePath);
      } catch {
        throw new APIError(APIErrorType.invalidURL);
      }
      return { ...request, body: bytes };
    }

    case RequestTaskType.uploadMultipart:
      return task.fields ? withMultipart(request, task.fields) : request;

    case RequestTaskType.downloadResumable:
      return task.offset !== undefined
        ? { ...request, headers: { ...request.headers, Range: `bytes=${task.offset}-` } }
        : request;
  }
}

function withJsonBody(target: TargetRequest, request: BMRequest, body: unknown): BMRequest {
  try {
    const encrypted = shouldEncrypt(target) ? NetworkConfig.payloadEncryptor!.encrypt(body) : body;
    return {
      ...request,
      body: JSON.stringify(encrypted),
      headers: { ...request.headers, 'Content-Type': 'application/json' },
    };
  } catch (error) {
    if (error instanceof APIError) throw error;
    throw new APIError(APIErrorType.dataConversionFailed);
  }
}

function withParameters(target: TargetRequest, request: BMRequest, params: Record<string, unknown>): BMRequest {
  let effective = params;
  if (
    request.method === HTTPMethod.get &&
    shouldEncrypt(target) &&
    NetworkConfig.encryptQueryParameters
  ) {
    effective = NetworkConfig.payloadEncryptor!.encrypt(params) as Record<string, unknown>;
  }
  const normalized: Record<string, string | string[] | null> = {};
  for (const [key, value] of Object.entries(effective)) {
    if (value === null || value === undefined) normalized[key] = null;
    else if (Array.isArray(value)) normalized[key] = value.map((v) => String(v));
    else normalized[key] = String(value);
  }
  return { ...request, url: withQuery(request.url, buildQueryString(normalized)) };
}

function shouldEncrypt(target: TargetRequest): boolean {
  return target.encryptsPayload && NetworkConfig.shouldEncrypt;
}

function withMultipart(request: BMRequest, fields: Record<string, unknown>): BMRequest {
  const boundary = `----BMNetworking${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  const parts: Uint8Array[] = [];
  const text = (s: string) => parts.push(utf8Encode(s));
  const quote = (s: string) => s.replace(/[\r\n"]/g, '_');

  for (const [name, field] of Object.entries(fields)) {
    if (field instanceof MultipartFormDataData) {
      text(
        `--${boundary}\r\nContent-Disposition: form-data; name="${quote(name)}"; filename="${quote(field.fileName)}"\r\n` +
          `Content-Type: ${field.mimeType}\r\n\r\n`,
      );
      parts.push(field.data);
      text('\r\n');
    } else if (field instanceof MultipartFormDataText) {
      text(`--${boundary}\r\nContent-Disposition: form-data; name="${quote(name)}"\r\n\r\n${String(field.value)}\r\n`);
    }
  }
  text(`--${boundary}--\r\n`);

  return {
    ...request,
    body: concatBytes(parts),
    headers: { ...request.headers, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
  };
}
