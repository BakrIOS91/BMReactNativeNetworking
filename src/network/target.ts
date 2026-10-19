import { AppEnvironment, appEnvironmentFromString } from '../helpers/enums';

const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/g, '');

/**
 * A base URL configuration. Create one subclass per distinct API origin
 * (main API, auth API, CDN, ...).
 */
export abstract class Target {
  private static _defaultEnvironment: AppEnvironment = AppEnvironment.development;

  /** Environment used by every target that is not given one explicitly. */
  static get defaultEnvironment(): AppEnvironment {
    return Target._defaultEnvironment;
  }

  /**
   * Set the app-wide default environment once at startup, e.g. from a `.env`
   * value: `Target.configureEnvironment(process.env.APP_ENV)`. Accepts an
   * `AppEnvironment` or a string such as `'prod'` / `'staging'`.
   */
  static configureEnvironment(env: AppEnvironment | string | undefined | null): void {
    if (env === undefined || env === null || env === '') return;
    Target._defaultEnvironment = typeof env === 'string' ? appEnvironmentFromString(env) : env;
  }

  /** @param environment optional override; falls back to {@link Target.defaultEnvironment}. */
  constructor(private readonly environment?: AppEnvironment) {}

  get appEnvironment(): AppEnvironment {
    return this.environment ?? Target._defaultEnvironment;
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
