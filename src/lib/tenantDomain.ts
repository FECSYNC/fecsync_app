/**
 * Company dashboard subdomains: {orgSlug}.{root} serves that company's /admin.
 * Client-safe. Off unless NEXT_PUBLIC_TENANT_ROOT_DOMAIN is set (e.g. "fecsync.com",
 * or "lvh.me:3000" for local testing), so localhost and preview hosts are untouched.
 */

/** Never company subdomains — infra / marketing hosts on the root domain. */
export const RESERVED_TENANT_SUBDOMAINS = [
  "www",
  "app",
  "api",
  "admin",
  "mail",
  "smtp",
  "ftp",
  "cdn",
  "static",
  "assets",
  "status",
  "docs",
  "help",
  "support",
  "blog",
  "dev",
  "staging",
  "preview",
] as const;

const RESERVED = new Set<string>(RESERVED_TENANT_SUBDOMAINS);
const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isReservedTenantSubdomain(slug: string): boolean {
  return RESERVED.has(slug.trim().toLowerCase());
}

type TenantRoot = { hostname: string; port: string };

function parseRoot(raw: string | undefined): TenantRoot | null {
  const value = raw?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!value) return null;
  const [hostname, port = ""] = value.split(":");
  if (!hostname || !hostname.includes(".")) return null;
  return { hostname: hostname.replace(/^\.+|\.+$/g, ""), port };
}

const ROOT = parseRoot(process.env.NEXT_PUBLIC_TENANT_ROOT_DOMAIN);

export function tenantSubdomainsEnabled(): boolean {
  return ROOT !== null;
}

/** Root hostname without port (cookie Domain value), or null when disabled. */
export function tenantRootHostname(): string | null {
  return ROOT?.hostname ?? null;
}

/** A slug that can be a DNS label and is not an infra host. */
export function isSubdomainSafeSlug(slug: string | null | undefined): slug is string {
  const value = slug?.trim().toLowerCase() ?? "";
  return DNS_LABEL_RE.test(value) && !isReservedTenantSubdomain(value);
}

function hostnameOf(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().split(":")[0] ?? "";
}

/** True for the bare root or www host (where the marketing site + sign-in live). */
export function isTenantRootHost(host: string | null | undefined): boolean {
  if (!ROOT) return false;
  const name = hostnameOf(host);
  return name === ROOT.hostname || name === `www.${ROOT.hostname}`;
}

/** True for the root host or any of its subdomains (cookie Domain may apply). */
export function isWithinTenantRoot(host: string | null | undefined): boolean {
  if (!ROOT) return false;
  const name = hostnameOf(host);
  return name === ROOT.hostname || name.endsWith(`.${ROOT.hostname}`);
}

/** Company slug for {slug}.{root}; null for the root/www host, other hosts, or reserved labels. */
export function tenantSlugFromHost(host: string | null | undefined): string | null {
  if (!ROOT) return null;
  const name = hostnameOf(host);
  const suffix = `.${ROOT.hostname}`;
  if (!name.endsWith(suffix)) return null;
  const label = name.slice(0, -suffix.length);
  if (label.includes(".")) return null;
  return isSubdomainSafeSlug(label) ? label : null;
}

function originFor(hostname: string, protocol: string, port: string): string {
  const scheme = protocol.replace(/:$/, "") || "https";
  return `${scheme}://${hostname}${port ? `:${port}` : ""}`;
}

/** https://{slug}.{root} — protocol/port default to the current request's. */
export function tenantDashboardOrigin(
  slug: string,
  opts?: { protocol?: string; port?: string }
): string | null {
  if (!ROOT || !isSubdomainSafeSlug(slug)) return null;
  return originFor(
    `${slug.toLowerCase()}.${ROOT.hostname}`,
    opts?.protocol ?? (ROOT.port ? "http" : "https"),
    opts?.port ?? ROOT.port
  );
}

/** Origin for guest-facing links built in the browser — the root host when on a company subdomain. */
export function browserPublicOrigin(): string {
  if (typeof window === "undefined") return "";
  const { protocol, port, host, origin } = window.location;
  if (!tenantSlugFromHost(host)) return origin;
  return tenantRootOrigin({ protocol, port }) ?? origin;
}

/**
 * A company's own staff sign-in link: {slug}.{root}/signin, or {fallbackOrigin}/signin/{slug}
 * when subdomains are off or the slug cannot be a DNS label. Unique because Organization.slug is.
 */
export function companyLoginUrl(
  slug: string,
  fallbackOrigin: string,
  opts?: { protocol?: string; port?: string }
): string {
  const sub = tenantDashboardOrigin(slug, opts);
  if (sub) return `${sub}/signin`;
  return `${fallbackOrigin.replace(/\/$/, "")}/signin/${encodeURIComponent(slug.toLowerCase())}`;
}

/**
 * Where staff land after signing out: their company's sign-in page, else the public home.
 * Pass a slug only for registered companies (never the platform storefront org).
 */
export function postLogoutPath(companySlug: string | null | undefined): string {
  if (typeof window !== "undefined" && tenantSlugFromHost(window.location.host)) return "/signin";
  const slug = companySlug?.trim().toLowerCase();
  return slug ? `/signin/${encodeURIComponent(slug)}` : "/home";
}

export function tenantRootOrigin(opts?: { protocol?: string; port?: string }): string | null {
  if (!ROOT) return null;
  return originFor(
    ROOT.hostname,
    opts?.protocol ?? (ROOT.port ? "http" : "https"),
    opts?.port ?? ROOT.port
  );
}
