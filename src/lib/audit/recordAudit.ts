/**
 * Server-side create/update audit stamps.
 * Never trust client body for createdBy / updatedBy / *Name fields.
 */

import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";

export const AUDIT_WRITE_KEYS = [
  "createdBy",
  "createdByName",
  "updatedBy",
  "updatedByName",
] as const;

export type AuditCreateStamp = {
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  updatedByName: string;
};

export type AuditUpdateStamp = {
  updatedBy: string;
  updatedByName: string;
};

/**
 * Legacy mongoose schema paths — empty under Prisma.
 * Callers that still use mongoose should define audit fields locally.
 */
export const auditActorFields = {} as const;

export function stripAuditWriteFields<T extends Record<string, unknown>>(
  fields: T
): Omit<T, (typeof AUDIT_WRITE_KEYS)[number]> {
  const next = { ...fields };
  for (const key of AUDIT_WRITE_KEYS) {
    delete (next as Record<string, unknown>)[key];
  }
  return next as Omit<T, (typeof AUDIT_WRITE_KEYS)[number]>;
}

export function displayNameFromUser(user: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  email?: string | null;
} | null): string {
  if (!user) return "Unknown";
  const full = [user.firstName, user.lastName]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean)
    .join(" ");
  if (full) return full.slice(0, 200);
  if (typeof user.username === "string" && user.username.trim()) {
    return user.username.trim().slice(0, 200);
  }
  if (typeof user.email === "string" && user.email.trim()) {
    return user.email.trim().slice(0, 200);
  }
  return "Unknown";
}

export async function resolveActorDisplayName(userId: string): Promise<string> {
  const id = String(userId).trim();
  if (!isValidId(id)) return "Unknown";
  // FECSYNC software owners never leave a readable name on tenant/staff audit
  // columns — all stampCreate/stampUpdate callers stay in sync (Products,
  // Orders, Users, etc.). Activity APIs still filter by userId for owners.
  try {
    const { isStorefrontPlatformAdminUserId, PLATFORM_OWNER_REDACTED_LABEL } =
      await import("@/lib/resolvePlatformSoftwareOwner");
    if (await isStorefrontPlatformAdminUserId(id)) {
      return PLATFORM_OWNER_REDACTED_LABEL;
    }
  } catch {
    /* fail open to normal name if resolve import fails */
  }
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ id }, { legacyId: id }],
    },
    select: {
      firstName: true,
      lastName: true,
      username: true,
      email: true,
    },
  });
  return displayNameFromUser(user);
}

export async function stampCreate(actorSub: string): Promise<AuditCreateStamp> {
  const name = await resolveActorDisplayName(actorSub);
  const id = String(actorSub);
  return {
    createdBy: id,
    createdByName: name,
    updatedBy: id,
    updatedByName: name,
  };
}

export async function stampUpdate(actorSub: string): Promise<AuditUpdateStamp> {
  const name = await resolveActorDisplayName(actorSub);
  return {
    updatedBy: String(actorSub),
    updatedByName: name,
  };
}

/**
 * No-op under Prisma (audit columns live in schema.prisma).
 * Kept so legacy mongoose model files still compile during migration.
 */
export function ensureAuditPathsOnModel(_model?: unknown): void {
  void _model;
}
