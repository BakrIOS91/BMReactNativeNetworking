/** A cookie parsed from a `Set-Cookie` response header. */
export class BMCookie {
  constructor(
    readonly name: string,
    readonly value: string,
    readonly options: {
      domain?: string;
      path?: string;
      httpOnly?: boolean;
      secure?: boolean;
    } = {},
  ) {}

  get domain(): string | undefined {
    return this.options.domain;
  }
  get path(): string | undefined {
    return this.options.path;
  }
  get httpOnly(): boolean {
    return this.options.httpOnly ?? false;
  }
  get secure(): boolean {
    return this.options.secure ?? false;
  }

  /** Parses a single `Set-Cookie` header value. Unknown attributes are ignored. */
  static fromSetCookieValue(cookieString: string): BMCookie {
    const [nameValue, ...attributes] = cookieString.split(';');
    const trimmed = nameValue.trim();
    const eq = trimmed.indexOf('=');
    const name = eq >= 0 ? trimmed.slice(0, eq).trim() : trimmed;
    const value = eq >= 0 ? trimmed.slice(eq + 1).trim() : '';

    const options: { domain?: string; path?: string; httpOnly?: boolean; secure?: boolean } = {};
    for (const attr of attributes) {
      const t = attr.trim();
      const lower = t.toLowerCase();
      if (lower === 'httponly') options.httpOnly = true;
      else if (lower === 'secure') options.secure = true;
      else if (lower.startsWith('domain=')) options.domain = t.slice(7);
      else if (lower.startsWith('path=')) options.path = t.slice(5);
    }
    return new BMCookie(name, value, options);
  }
}

/** Best-effort parsing of a (possibly combined) `Set-Cookie` header. */
export function parseSetCookieHeader(headerValue: string | null | undefined): BMCookie[] {
  if (!headerValue || headerValue.trim() === '') return [];
  const cookies: BMCookie[] = [];
  for (const part of splitSetCookie(headerValue)) {
    cookies.push(BMCookie.fromSetCookieValue(part));
  }
  return cookies;
}

function splitSetCookie(headerValue: string): string[] {
  const parts: string[] = [];
  const lower = headerValue.toLowerCase();
  let start = 0;
  let inExpires = false;

  for (let i = 0; i < headerValue.length; i++) {
    if (!inExpires && lower.startsWith('expires=', i)) inExpires = true;
    if (inExpires && headerValue[i] === ';') inExpires = false;
    if (headerValue[i] === ',') {
      if (inExpires) {
        // The single comma of the date ("Wed, 21 Oct ...") is not a separator.
        inExpires = false;
      } else {
        const part = headerValue.slice(start, i).trim();
        if (part) parts.push(part);
        start = i + 1;
      }
    }
  }
  const last = headerValue.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}
