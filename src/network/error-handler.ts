/** Implemented by the host app to decode server error payloads into its own models. */
export interface APIErrorResponseMapper {
  decode(json: unknown): unknown;
}

/** Global registry for the [APIErrorResponseMapper]. */
export class APIErrorResponseRegistry {
  private static mapper?: APIErrorResponseMapper;

  static register(mapper: APIErrorResponseMapper): void {
    APIErrorResponseRegistry.mapper = mapper;
  }

  static clear(): void {
    APIErrorResponseRegistry.mapper = undefined;
  }

  static decode(json: unknown): unknown {
    return APIErrorResponseRegistry.mapper?.decode(json);
  }
}
