import { AppEnvironment } from '../helpers/enums';

const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/g, '');

/**
 * A base URL configuration. Create one subclass per distinct API origin
 * (main API, auth API, CDN, ...).
 */
export abstract class Target {
  get appEnvironment(): AppEnvironment {
    return AppEnvironment.development;
  }
  abstract get kAppHost(): string;
  abstract get kAppScheme(): string;
  get kMainAPIPath(): string | undefined {
    return undefined;
  }
  get kAppApiPath(): string | undefined {
    return undefined;
  }
  get kAppPort(): number | undefined {
    return undefined;
  }

  get sanitizedHost(): string {
    return trimSlashes(this.kAppHost);
  }

  /** `scheme://host[:port]/main/api/` with a trailing slash. */
  get kBaseURL(): string {
    const segments = [this.kMainAPIPath, this.kAppApiPath]
      .filter((s): s is string => !!s)
      .map(trimSlashes)
      .filter((s) => s.length > 0);
    const path = segments.length > 0 ? `/${segments.join('/')}/` : '/';
    const port = this.kAppPort !== undefined ? `:${this.kAppPort}` : '';
    return `${this.kAppScheme}://${this.sanitizedHost}${port}${path}`;
  }
}
