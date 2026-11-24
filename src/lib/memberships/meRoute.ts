/**
 * Shared auth + error mapping for /api/me/memberships/* (guest self-serve).
 * Ownership is enforced in selfServe/guestAuth via GuestProfile.userId.
 */
import type { NextRequest, NextResponse } from "next/server";
import {
  badRequest,
  serverError,
  authErrorToResponse,
  authAudit,
  routeErrorResponse,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import type { Permission } from "@/lib/auth/permissions";
import type { NormalizedAccessToken } from "@/lib/auth/claims";
import { membershipBillingErrorResponse } from "@/lib/memberships/http";
import type { GuestSelfServeActor } from "@/lib/memberships/guestAuth";

export type MeMembershipAuth =
  | { ok: true; actor: NormalizedAccessToken }
  | { ok: false; response: NextResponse };

export async function authorizeMeMemberships(
  request: NextRequest,
  permission: Permission,
  route: string
): Promise<MeMembershipAuth> {
  try {
    const actor = await requirePermissionFresh(request, permission);
    return { ok: true, actor };
  } catch (err) {
    return {
      ok: false,
      response:
        authErrorToResponse(err, authAudit(request, route, { permission })) ??
        serverError("Failed to authorize"),
    };
  }
}

export function toGuestActor(actor: NormalizedAccessToken): GuestSelfServeActor {
  return {
    sub: String(actor.sub),
    orgId: actor.orgId,
    email: (actor as { email?: string | null }).email ?? null,
  };
}

/**
 * Parse JSON body; reject client-selected tenant fields. `allowOrgId` is only
 * for the link flow, where orgId is a lookup key verified against the
 * GuestProfile row + matching account email (never an authority grant).
 */
export async function readMeBody(
  request: NextRequest,
  opts?: { allowOrgId?: boolean }
): Promise<
  { ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }
> {
  let raw: unknown = {};
  try {
    const text = await request.text();
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    return { ok: false, response: badRequest("Invalid JSON body") };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, response: badRequest("Invalid JSON body") };
  }
  const body = raw as Record<string, unknown>;
  if ("organizationId" in body || (!opts?.allowOrgId && "orgId" in body)) {
    return { ok: false, response: badRequest("Unsupported selector in body") };
  }
  return { ok: true, body };
}

export function rejectQueryOrg(request: NextRequest): NextResponse | null {
  const sp = request.nextUrl.searchParams;
  if (sp.has("orgId") || sp.has("organizationId")) {
    return badRequest("Unsupported selector in query");
  }
  return null;
}

/**
 * @deprecated Prefer requireIdempotencyKey for money mutations.
 * Never invent Date.now() keys (double-submit would double-charge).
 */
export function idempotencyKeyFrom(
  body: Record<string, unknown>,
  _fallbackPrefix: string
): string {
  const raw =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  return raw.slice(0, 120);
}

/**
 * Money mutations must send a stable client idempotencyKey — never invent
 * Date.now() keys (double-submit would double-charge).
 */
export function requireIdempotencyKey(
  body: Record<string, unknown>
):
  | { ok: true; key: string }
  | { ok: false; response: NextResponse } {
  const raw =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!raw || raw.length > 120) {
    return {
      ok: false,
      response: badRequest("idempotencyKey is required (max 120 chars)"),
    };
  }
  return { ok: true, key: raw.slice(0, 120) };
}

export function meMembershipCatch(
  err: unknown,
  request: NextRequest,
  route: string,
  actor: NormalizedAccessToken,
  permission: Permission,
  fallback = "Membership request failed"
): NextResponse {
  const billed = membershipBillingErrorResponse(err);
  if (billed) return billed;
  if (err instanceof Error && err.name === "Error") {
    return badRequest(err.message);
  }
  return routeErrorResponse(
    err,
    fallback,
    authAudit(request, route, {
      actorSub: actor.sub,
      orgId: actor.orgId ?? null,
      permission,
    })
  );
}
