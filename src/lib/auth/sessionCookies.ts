/**
 * Set-Cookie strings for the access/refresh session pair.
 * When company subdomains are on and the request is under the tenant root, the
 * cookies are scoped to `Domain={root}` so one sign-in covers {slug}.{root}.
 * Every set/clear also drops the host-only variant so a stale copy never shadows it.
 */
import { isWithinTenantRoot, tenantRootHostname } from "@/lib/tenantDomain";

export const AUTH_COOKIE_NAMES = ["access-token", "refresh-token"] as const;
export type AuthCookieName = (typeof AUTH_COOKIE_NAMES)[number];

export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

type HostSource = { headers: { get(name: string): string | null } } | string | null | undefined;

function hostOf(source: HostSource): string | null {
  if (!source) return null;
  if (typeof source === "string") return source;
  return source.headers.get("x-forwarded-host") ?? source.headers.get("host");
}

function sharedDomain(source: HostSource): string | null {
  const host = hostOf(source);
  return isWithinTenantRoot(host) ? tenantRootHostname() : null;
}

function flags(maxAge: number, domain: string | null): string {
  const prod = process.env.NODE_ENV === "production";
  return [
    "HttpOnly",
    "Path=/",
    `Max-Age=${maxAge}`,
    domain ? `Domain=${domain}` : "",
    prod ? "Secure" : "",
    prod ? "SameSite=Lax" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/** Cookie strings that set one session cookie (plus a host-only clear when shared). */
export function authCookieSetHeaders(
  source: HostSource,
  name: AuthCookieName,
  value: string
): string[] {
  const domain = sharedDomain(source);
  const out = [`${name}=${value}; ${flags(AUTH_COOKIE_MAX_AGE, domain)}`];
  if (domain) out.unshift(`${name}=; ${flags(0, null)}`);
  return out;
}

/** Cookie strings that clear the named session cookies (host-only and shared). */
export function authCookieClearHeaders(
  source: HostSource,
  names: readonly AuthCookieName[] = AUTH_COOKIE_NAMES
): string[] {
  const domain = sharedDomain(source);
  const out: string[] = [];
  for (const name of names) {
    out.push(`${name}=; ${flags(0, null)}`);
    if (domain) out.push(`${name}=; ${flags(0, domain)}`);
  }
  return out;
}

type HeaderTarget = { headers: { append(name: string, value: string): void } };

export function appendAuthSessionCookies(
  res: HeaderTarget,
  source: HostSource,
  tokens: { accessToken: string; refreshToken: string }
): void {
  for (const c of authCookieSetHeaders(source, "access-token", tokens.accessToken)) {
    res.headers.append("Set-Cookie", c);
  }
  for (const c of authCookieSetHeaders(source, "refresh-token", tokens.refreshToken)) {
    res.headers.append("Set-Cookie", c);
  }
}

export function appendClearedAuthCookies(
  res: HeaderTarget,
  source: HostSource,
  names: readonly AuthCookieName[] = AUTH_COOKIE_NAMES
): void {
  for (const c of authCookieClearHeaders(source, names)) {
    res.headers.append("Set-Cookie", c);
  }
}
