/** Encodes a query map; arrays repeat the key and `null` yields a bare key. */
export function buildQueryString(params: Record<string, string | string[] | null>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    const k = encodeURIComponent(key);
    if (value === null) parts.push(k);
    else if (Array.isArray(value)) value.forEach((v) => parts.push(`${k}=${encodeURIComponent(v)}`));
    else parts.push(`${k}=${encodeURIComponent(value)}`);
  }
  return parts.join('&');
}

/** Appends [query] to [url], replacing any existing query string. */
export function withQuery(url: string, query: string): string {
  const [base] = url.split('?');
  return query ? `${base}?${query}` : base;
}

/** Resolves [path] against [baseURL] with RFC 3986 semantics for the common cases. */
export function resolveUrl(baseURL: string, path: string): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(path)) return path;
  if (path.startsWith('/')) {
    const origin = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]+/.exec(baseURL);
    if (!origin) throw new Error(`Invalid base URL: ${baseURL}`);
    return origin[0] + path;
  }
  const base = baseURL.split(/[?#]/)[0];
  return base.endsWith('/') ? base + path : `${base.slice(0, base.lastIndexOf('/') + 1)}${path}`;
}

export function lastPathSegment(url: string): string {
  const path = url.split(/[?#]/)[0];
  return path.slice(path.lastIndexOf('/') + 1);
}
