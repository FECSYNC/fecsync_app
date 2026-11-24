import { NextRequest, NextResponse } from "next/server";
import { verifyAccessTokenEdge, EdgeTokenError } from "@/lib/auth/edge-jwt";
import {
  classifyPageRoute,
  defaultPathForActor,
  isSafeReturnTo,
  isStaffActor,
  isTailorActor,
} from "@/lib/auth/routePolicy";
import type { NormalizedAccessToken } from "@/lib/auth/claims";
import {
  COMPANY_EMBED_HEADER,
  isCompanySitePath,
} from "@/lib/publicCategory/sitePaths";
import {
  companyFrameOriginsBySlug,
  frameAncestorsPolicy,
} from "@/lib/publicCategory/frameOrigins";
import { decodeJwt } from "jose";
import {
  appendAuthSessionCookies,
  appendClearedAuthCookies,
} from "@/lib/auth/sessionCookies";
import {
  isTenantRootHost,
  tenantDashboardOrigin,
  tenantRootOrigin,
  tenantSlugFromHost,
} from "@/lib/tenantDomain";
import { dashboardSlugForOrg } from "@/lib/companyBranding";

/** Paths a company subdomain serves itself; every other page goes to the root host. */
const TENANT_HOST_PATH = /^\/(?:admin|403)(?:\/|$)/;

/** Static files and generated icons — never redirected between hosts. */
function isAssetPath(pathname: string): boolean {
  if (pathname.startsWith("/_next/")) return true;
  if (/^\/(?:icon|apple-icon|manifest\.webmanifest)(?:\/|$)/.test(pathname)) return true;
  const last = pathname.split("/").pop() ?? "";
  return last.includes(".");
}

function browserHost(req: NextRequest): string {
  return req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
}

/** Public scheme + port as the browser sees them (behind a TLS-terminating proxy). */
function requestOriginParts(req: NextRequest) {
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = browserHost(req);
  const port = host.includes(":") ? (host.split(":").pop() ?? "") : "";
  return { protocol: forwardedProto || req.nextUrl.protocol, port };
}

/**
 * Cross-host redirect. Client-router (RSC) fetches cannot follow a redirect to
 * another origin, so they get an empty non-Flight reply instead — the router
 * then hard-navigates to the same URL and this proxy answers with the real 307.
 * Next strips the `rsc` header before the proxy runs, so detect script fetches
 * via Sec-Fetch-Mode (only document loads send "navigate").
 */
function redirectToOrigin(req: NextRequest, origin: string, path?: string) {
  const target = new URL(path ?? `${req.nextUrl.pathname}${req.nextUrl.search}`, origin);
  const { protocol } = requestOriginParts(req);
  const current = `${protocol.replace(/:$/, "")}://${browserHost(req).toLowerCase()}`;
  const fetchMode = req.headers.get("sec-fetch-mode");
  if (fetchMode && fetchMode !== "navigate" && target.origin !== current) {
    return new NextResponse(null, { status: 204 });
  }
  return NextResponse.redirect(target);
}

/** orgId from the access JWT without verifying expiry — host routing only, never authz. */
function peekAccessOrgId(req: NextRequest): string | null {
  const raw = req.cookies.get("access-token")?.value;
  if (!raw) return null;
  try {
    const orgId = decodeJwt(raw).orgId;
    return typeof orgId === "string" && orgId.trim() ? orgId.trim() : null;
  } catch {
    return null;
  }
}

const SIGNIN_PATH = /^\/signin(?:\/|$)/;
const COMPANY_SIGNIN_PATH = /^\/signin\/([^/]+)\/?$/;

/**
 * Company subdomain ({slug}.{root}) hosts /admin and that company's own /signin.
 * `/` opens the dashboard; marketing, storefront, and booking pages live on the root host.
 */
function tenantHostResponse(req: NextRequest, hostSlug: string): NextResponse | null {
  const pathname = req.nextUrl.pathname;
  if (pathname === "/") return redirectTo(req, "/admin");
  // The host decides the company; a /signin/{other} path cannot switch it.
  if (SIGNIN_PATH.test(pathname)) {
    return NextResponse.rewrite(new URL(`/signin/${hostSlug}${req.nextUrl.search}`, req.url));
  }
  if (TENANT_HOST_PATH.test(pathname) || isAssetPath(pathname)) return null;
  const root = tenantRootOrigin(requestOriginParts(req));
  return root ? redirectToOrigin(req, root) : null;
}

/**
 * Keep each company's admin on its own subdomain: root-host /admin hops to
 * {slug}.{root}; a mismatched subdomain hops to the session's company (or the
 * root host for the platform storefront org / slugs that cannot be DNS labels).
 */
async function adminHostPlacement(
  req: NextRequest,
  orgId: string | null | undefined,
  hostSlug: string | null
): Promise<NextResponse | null> {
  if (!hostSlug && !isTenantRootHost(browserHost(req))) return null;
  let orgSlug = await dashboardSlugForOrg(orgId);
  if (hostSlug && orgSlug !== hostSlug) {
    orgSlug = await dashboardSlugForOrg(orgId, { fresh: true });
  }
  if (orgSlug === hostSlug) return null;
  const parts = requestOriginParts(req);
  const target = orgSlug ? tenantDashboardOrigin(orgSlug, parts) : tenantRootOrigin(parts);
  if (!target) return null;
  const res = redirectToOrigin(req, target);
  // Sessions issued before subdomains were on are host-only on the root host;
  // re-issue them for the shared domain so the hop does not force a re-login.
  const accessToken = req.cookies.get("access-token")?.value;
  const refreshToken = req.cookies.get("refresh-token")?.value;
  if (!hostSlug && accessToken && refreshToken) {
    appendAuthSessionCookies(res, req, { accessToken, refreshToken });
  }
  return res;
}

/** Paths the auth gate below was written for (the original matcher list). */
const AUTH_GATED_PATH =
  /^\/(?:$|(?:admin|tailor|profile|user\/profile|cart|checkout|settings|dashboard)(?:\/|$))/;

/**
 * Company category site: frame-ancestors from the company's saved origins
 * (next.config leaves X-Frame-Options off these paths only), and a trusted
 * embed flag for server components. Fails closed to 'self'.
 */
async function companySiteResponse(req: NextRequest) {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.delete(COMPANY_EMBED_HEADER);
  if (req.nextUrl.searchParams.get("embed") === "1") {
    requestHeaders.set(COMPANY_EMBED_HEADER, "1");
  }
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  let origins: string[] = [];
  try {
    const first = req.nextUrl.pathname.split("/").filter(Boolean)[0] ?? "";
    origins = await companyFrameOriginsBySlug(decodeURIComponent(first));
  } catch {
    origins = [];
  }
  res.headers.set("Content-Security-Policy", frameAncestorsPolicy(origins));
  return res;
}

function redirectTo(req: NextRequest, pathname: string, search?: URLSearchParams) {
  const url = new URL(pathname, req.url);
  if (search) {
    search.forEach((value, key) => url.searchParams.set(key, value));
  }
  return NextResponse.redirect(url);
}

function returnToValue(req: NextRequest): string {
  const path = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  return isSafeReturnTo(path) ? path : "/";
}

/** On a company subdomain this is that company's own sign-in page. */
function redirectToSignIn(req: NextRequest) {
  const search = new URLSearchParams();
  search.set("returnTo", returnToValue(req));
  return redirectTo(req, "/signin", search);
}

/** Root-host /signin/{slug} → {slug}.{root}/signin, so each company has one sign-in address. */
function companySignInPlacement(req: NextRequest): NextResponse | null {
  const match = COMPANY_SIGNIN_PATH.exec(req.nextUrl.pathname);
  if (!match || !isTenantRootHost(browserHost(req))) return null;
  let slug = match[1];
  try {
    slug = decodeURIComponent(slug).toLowerCase();
  } catch {
    return null;
  }
  const origin = tenantDashboardOrigin(slug, requestOriginParts(req));
  return origin ? redirectToOrigin(req, origin, `/signin${req.nextUrl.search}`) : null;
}

/** Drop both auth cookies (logout / tampered token). */
function clearAuthCookies(response: NextResponse, req: NextRequest) {
  appendClearedAuthCookies(response, req);
  return response;
}

/** Access JWT expired — keep refresh so the client can silent-refresh. */
function clearAccessCookieOnly(response: NextResponse, req: NextRequest) {
  appendClearedAuthCookies(response, req, ["access-token"]);
  return response;
}

function hasRefreshCookie(req: NextRequest) {
  return Boolean(req.cookies.get("refresh-token")?.value?.trim());
}

type EdgeSession =
  | { status: "ok"; token: NormalizedAccessToken }
  | { status: "missing" }
  | { status: "invalid"; expired: boolean };

/**
 * Expired/missing access with a refresh cookie is recoverable — let the page
 * load so auth-bootstrap / api() can POST /api/auth/refresh.
 * Tampered (non-expired invalid) access is not recoverable.
 */
function canSilentResume(req: NextRequest, session: EdgeSession) {
  if (!hasRefreshCookie(req)) return false;
  if (session.status === "missing") return true;
  return session.status === "invalid" && session.expired;
}

/** Client on an admin page → /403 (Admin Access Required). */
function redirectClientFromAdmin(req: NextRequest) {
  const search = new URLSearchParams();
  search.set("from", req.nextUrl.pathname);
  search.set("reason", "This area is for administrators.");
  return redirectTo(req, "/403", search);
}

async function readAccessToken(req: NextRequest): Promise<EdgeSession> {
  const raw = req.cookies.get("access-token")?.value;
  if (!raw) {
    return { status: "missing" };
  }

  try {
    const token = await verifyAccessTokenEdge(raw);
    return { status: "ok", token };
  } catch (error) {
    const expired = error instanceof EdgeTokenError && error.expired;
    return { status: "invalid", expired };
  }
}

export async function proxy(req: NextRequest) {
  // A password in a URL lands in history, logs, and referrers — drop it before anything renders.
  const secretKeys = [...new Set(req.nextUrl.searchParams.keys())].filter((key) =>
    /password/i.test(key)
  );
  if (secretKeys.length > 0) {
    const clean = new URL(req.url);
    for (const key of secretKeys) clean.searchParams.delete(key);
    return NextResponse.redirect(clean, 303);
  }
  const pathname = req.nextUrl.pathname;
  const hostSlug = tenantSlugFromHost(browserHost(req));
  if (hostSlug) {
    const hop = tenantHostResponse(req, hostSlug);
    if (hop) return hop;
  } else {
    const placement = companySignInPlacement(req);
    if (placement) return placement;
  }
  if (isCompanySitePath(pathname)) return companySiteResponse(req);
  if (!AUTH_GATED_PATH.test(pathname)) return NextResponse.next();
  const gate = classifyPageRoute(pathname);
  const session = await readAccessToken(req);

  if (gate === "root") {
    if (session.status === "ok") {
      if (
        isStaffActor(
          session.token.role,
          session.token.preset,
          session.token.permissions
        )
      ) {
        return redirectTo(req, defaultPathForActor(true));
      }
      if (
        isTailorActor(
          session.token.role,
          session.token.preset,
          session.token.permissions,
          session.token.membershipRole
        )
      ) {
        return redirectTo(req, "/tailor/home");
      }
      // Clients: serve landing at `/` (no browser redirect hop).
      return NextResponse.rewrite(new URL("/home", req.url));
    }
    // Guests / stale cookies: rewrite to landing — URL stays `/`, paints faster.
    const storefront = NextResponse.rewrite(new URL("/home", req.url));
    if (session.status === "invalid") {
      // Only wipe the refresh session when the access token is tampered.
      // Expired access + valid refresh must survive so silent refresh works.
      if (session.expired && hasRefreshCookie(req)) {
        clearAccessCookieOnly(storefront, req);
      } else {
        clearAuthCookies(storefront, req);
      }
    }
    return storefront;
  }

  if (gate === "public") {
    return NextResponse.next();
  }

  if (session.status !== "ok") {
    // Access JWT is short-lived; refresh is 7d. After idle/sleep the access
    // cookie is often expired while refresh is still valid — do not bounce
    // to sign-in (that was forcing a full re-login on refresh).
    if (canSilentResume(req, session)) {
      // Expired access still names its company — keep the dashboard on the
      // right host while the client refreshes. No access cookie: host unknown.
      const peekedOrgId = gate === "staff" ? peekAccessOrgId(req) : null;
      if (peekedOrgId) {
        const placement = await adminHostPlacement(req, peekedOrgId, hostSlug);
        if (placement) return placement;
      }
      return NextResponse.next();
    }
    return redirectToSignIn(req);
  }

  const staff = isStaffActor(
    session.token.role,
    session.token.preset,
    session.token.permissions
  );

  if (gate === "staff") {
    if (!staff) {
      return redirectClientFromAdmin(req);
    }
    const placement = await adminHostPlacement(req, session.token.orgId, hostSlug);
    return placement ?? NextResponse.next();
  }

  if (gate === "tailor") {
    const tailorOk = isTailorActor(
      session.token.role,
      session.token.preset,
      session.token.permissions,
      session.token.membershipRole
    );
    if (!tailorOk) {
      const search = new URLSearchParams();
      search.set("from", req.nextUrl.pathname);
      search.set("reason", "This area is for tailor providers.");
      return redirectTo(req, "/403", search);
    }
    return NextResponse.next();
  }

  if (gate === "client") {
    if (staff) {
      return redirectTo(req, defaultPathForActor(true));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

// Matcher must be a literal here — Next.js cannot parse imported arrays.
// Do not add /payment, /success, /cancel, /api, /customize, or /shop — those
// stay public (Stripe/Paystack return URLs, storefront, APIs).
// The first entry reaches /{orgSlug}/{categorySlug}/… company pages; any other
// two-segment path it catches returns NextResponse.next() before the auth gate.
// The second reaches single-segment pages so company subdomains can send them
// to the root host; on the root host they also return before the auth gate.
export const config = {
  matcher: [
    "/((?!_next/|api/|admin/|tailor/)[^/]+/.+)",
    "/((?!_next|api)[^/.]+)",
    "/",
    "/admin",
    "/admin/:path*",
    "/tailor",
    "/tailor/:path*",
    "/profile",
    "/profile/:path*",
    "/user/profile",
    "/user/profile/:path*",
    "/cart",
    "/cart/:path*",
    "/checkout",
    "/checkout/:path*",
    "/settings",
    "/settings/:path*",
    "/dashboard",
    "/dashboard/:path*",
  ],
};
