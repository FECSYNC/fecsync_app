import type { NextRequest } from "next/server";
import type { ActivityEntityType, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { asIdString, isValidId } from "@/lib/ids";
import {
  AUTH_FORBIDDEN_MESSAGES,
  AUTH_UNAUTHENTICATED_MESSAGES,
  isAuthHttpError,
} from "@/lib/auth/http-error";

export type { ActivityEntityType };

export type DenialAuditContext = {
  route: string;
  permission?: string;
  actorSub?: string | null;
  orgId?: string | null;
  reason?: string;
  metadata?: Record<string, unknown>;
};

export function clientIpFromRequest(request: NextRequest): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || undefined;
}

function denialStatus(error: unknown): 401 | 403 {
  if (isAuthHttpError(error)) return error.status;
  const message = error instanceof Error ? error.message : String(error);
  if (AUTH_UNAUTHENTICATED_MESSAGES.has(message)) return 401;
  return 403;
}

function denialMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function resolveOrgId(
  orgId: unknown,
  metadata?: Record<string, unknown>
): string | null {
  const fromArg = asIdString(orgId);
  if (fromArg) return fromArg;
  if (metadata && metadata.orgId != null) {
    return asIdString(metadata.orgId);
  }
  return null;
}

function orgIdFromError(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  if (!("orgId" in error)) return null;
  return asIdString((error as { orgId?: unknown }).orgId);
}

/**
 * Generic ActivityLog write.
 * Phase 1 SSOT: stamp `orgId` column when known; always mirror into metadata.orgId.
 */
export async function logActivityEntryAsync(input: {
  actorSub?: string | null;
  orgId?: string | null;
  action: string;
  entityType?: ActivityEntityType;
  entityId?: string | null;
  description: string;
  request?: NextRequest;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const userIdRaw = input.actorSub ? String(input.actorSub) : null;
    const userId = userIdRaw && isValidId(userIdRaw) ? userIdRaw : null;
    const entityId =
      input.entityId != null
        ? asIdString(input.entityId) ??
          (String(input.entityId).trim() || null)
        : null;
    const orgId = resolveOrgId(input.orgId, input.metadata);
    const metadata: Record<string, unknown> = {
      ...(input.metadata ?? {}),
      orgId: orgId ?? (input.metadata?.orgId ?? null),
    };

    await prisma.activityLog.create({
      data: {
        userId: userId || undefined,
        orgId: orgId || undefined,
        action: input.action,
        entityType: input.entityType ?? "System",
        entityId: entityId || undefined,
        description: input.description.slice(0, 500),
        ipAddress: input.request
          ? clientIpFromRequest(input.request)
          : undefined,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    console.error("[audit] ActivityLog write failed:", err);
  }
}

/** Non-blocking ActivityLog write (route handlers that must not await I/O). */
export function logActivityEntry(
  input: Parameters<typeof logActivityEntryAsync>[0]
): void {
  void logActivityEntryAsync(input);
}

/**
 * Staff mutation audit helper — always stamps actor.orgId when present.
 * Prefer this over bare logActivityEntry on staff routes.
 */
export function logStaffActivityEntry(
  actor: { sub?: string | null; orgId?: string | null },
  input: Omit<Parameters<typeof logActivityEntry>[0], "actorSub" | "orgId">
): void {
  logActivityEntry({
    ...input,
    actorSub: actor.sub,
    orgId: actor.orgId ?? null,
  });
}

/** Log 401/403 auth failures on sensitive routes (Step 7.3). */
export function logPermissionDenial(
  request: NextRequest,
  error: unknown,
  ctx: DenialAuditContext
): void {
  const status = denialStatus(error);
  const message = ctx.reason ?? denialMessage(error);
  const action = status === 401 ? "Auth Required" : "Permission Denied";

  const orgId = resolveOrgId(ctx.orgId, ctx.metadata) ?? orgIdFromError(error);

  logActivityEntry({
    actorSub: ctx.actorSub,
    orgId,
    action,
    entityType: "System",
    description: `${ctx.route}: ${message}`.slice(0, 500),
    request,
    metadata: {
      route: ctx.route,
      permission: ctx.permission,
      orgId: orgId ?? null,
      httpStatus: status,
      reason: message,
      ...ctx.metadata,
    },
  });
}

/** Membership admin denial — same store, distinct action for analytics filters. */
export function logMembershipDenial(
  request: NextRequest,
  error: unknown,
  ctx: DenialAuditContext & { targetUserId?: string | null }
): void {
  logPermissionDenial(request, error, {
    ...ctx,
    metadata: {
      ...ctx.metadata,
      domain: "membership",
      targetUserId: ctx.targetUserId ?? null,
    },
  });
}

export function isAuthFailureMessage(message: string): boolean {
  return (
    AUTH_UNAUTHENTICATED_MESSAGES.has(message) ||
    AUTH_FORBIDDEN_MESSAGES.has(message)
  );
}
