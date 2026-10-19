import { RequestTaskType, type MultipartFormData } from '../../helpers/enums';

/** Describes what a request carries: parameters, a JSON body, a file or a download. */
export class RequestTask {
  private constructor(
    readonly type: RequestTaskType,
    readonly parameters?: Record<string, unknown>,
    readonly body?: unknown,
    readonly filePath?: string,
    readonly fields?: Record<string, MultipartFormData>,
    readonly url?: string,
    readonly resumeData?: Uint8Array,
    readonly offset?: number,
  ) {}

  static plain(): RequestTask {
    return new RequestTask(RequestTaskType.plain);
  }

  static parameters(params: Record<string, unknown>): RequestTask {
    return new RequestTask(RequestTaskType.parameters, params);
  }

  static encodedBody(body: unknown): RequestTask {
    return new RequestTask(RequestTaskType.encodedBody, undefined, body);
  }

  static uploadFile(filePath: string): RequestTask {
    return new RequestTask(RequestTaskType.uploadFile, undefined, undefined, filePath);
  }

  static uploadMultipart(fields: Record<string, MultipartFormData>): RequestTask {
    return new RequestTask(RequestTaskType.uploadMultipart, undefined, undefined, undefined, fields);
  }

  static download(url: string): RequestTask {
    return new RequestTask(RequestTaskType.download, undefined, undefined, undefined, undefined, url);
  }

  static downloadResumable(options: { resumeData?: Uint8Array; offset?: number } = {}): RequestTask {
    return new RequestTask(
      RequestTaskType.downloadResumable,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      options.resumeData,
      options.offset,
    );
  }

  static parametersAndBody(params: Record<string, unknown>, body: unknown): RequestTask {
    return new RequestTask(RequestTaskType.parametersAndBody, params, body);
  }
}
