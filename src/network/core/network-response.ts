import type { BMCookie } from '../../helpers/bm-cookie';

/** Decoded data plus response metadata. */
export interface NetworkResponse<T> {
  data: T;
  statusCode: number;
  /** Response headers with lower-cased names. */
  headers: Record<string, string>;
  rawSetCookieHeader?: string;
  cookies: BMCookie[];
}

/** `name=value; name2=value2`, ready for a `Cookie` request header. */
export function cookieHeader(response: Pick<NetworkResponse<unknown>, 'cookies'>): string | undefined {
  if (response.cookies.length === 0) return undefined;
  return response.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}
