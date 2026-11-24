/**
 * Org-scoped account blacklist (email / phone).
 * Public signup & login use the storefront org; admin APIs use actor.orgId.
 */

import prisma from "@/lib/prisma";
import { ForbiddenError } from "@/lib/auth/http-error";
import { asIdString, isValidId } from "@/lib/ids";
import type { AuditCreateStamp, AuditUpdateStamp } from "@/lib/audit/recordAudit";
import type {
  UserBlacklist as UserBlacklistRow,
  UserBlacklistSource,
  UserBlacklistType,
} from "@prisma/client";

export type { UserBlacklistSource, UserBlacklistType };

export const USER_BLACKLIST_TYPES = ["email", "phone"] as const;
export const USER_BLACKLIST_SOURCES = ["manual", "hard_delete"] as const;

export const BLACKLISTED_ACCOUNT_MESSAGE =
  "This email or phone number is blocked from creating or accessing an account";

export function normalizeBlacklistEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Keep digits only so +234… and 0234… match the same entry. */
export function normalizeBlacklistPhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function isValidBlacklistEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeBlacklistEmail(email));
}

export function isValidBlacklistPhone(phone: string): boolean {
  const digits = normalizeBlacklistPhone(phone);
  return digits.length >= 7 && digits.length <= 15;
}

function resolveOrgId(orgId: string): string {
  const id = asIdString(orgId) ?? String(orgId).trim();
  if (!id) throw new Error("Invalid orgId");
  return id;
}

export async function findBlacklistHit(
  orgId: string,
  identifiers: { email?: string | null; phone?: string | null }
): Promise<{ type: UserBlacklistType; value: string } | null> {
  const clauses: { type: UserBlacklistType; value: string }[] = [];
  if (identifiers.email) {
    const email = normalizeBlacklistEmail(identifiers.email);
    if (email) clauses.push({ type: "email", value: email });
  }
  if (identifiers.phone) {
    const phone = normalizeBlacklistPhone(identifiers.phone);
    if (phone) clauses.push({ type: "phone", value: phone });
  }
  if (clauses.length === 0) return null;

  const hit = await prisma.userBlacklist.findFirst({
    where: {
      orgId: resolveOrgId(orgId),
      OR: clauses.map((c) => ({ type: c.type, value: c.value })),
    },
    select: { type: true, value: true },
  });

  return hit ? { type: hit.type, value: hit.value } : null;
}

export async function assertNotBlacklisted(
  orgId: string,
  identifiers: { email?: string | null; phone?: string | null }
): Promise<void> {
  const hit = await findBlacklistHit(orgId, identifiers);
  if (hit) {
    throw new ForbiddenError(BLACKLISTED_ACCOUNT_MESSAGE);
  }
}

export async function upsertBlacklistEntry(input: {
  orgId: string;
  type: UserBlacklistType;
  value: string;
  reason?: string | null;
  source?: UserBlacklistSource;
  createdBy?: string | null;
  audit?: AuditCreateStamp | AuditUpdateStamp | null;
}): Promise<{
  _id: string;
  orgId: string;
  type: UserBlacklistType;
  value: string;
  reason: string | null;
  source: UserBlacklistSource;
  createdBy: string | null;
  createdByName: string | null;
  updatedBy: string | null;
  updatedByName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  created: boolean;
}> {
  const orgId = resolveOrgId(input.orgId);
  const normalized =
    input.type === "email"
      ? normalizeBlacklistEmail(input.value)
      : normalizeBlacklistPhone(input.value);

  if (input.type === "email" && !isValidBlacklistEmail(normalized)) {
    throw new Error("Invalid email");
  }
  if (input.type === "phone" && !isValidBlacklistPhone(normalized)) {
    throw new Error("Invalid phone number");
  }

  const existing = await prisma.userBlacklist.findUnique({
    where: {
      orgId_type_value: {
        orgId,
        type: input.type,
        value: normalized,
      },
    },
  });

  if (existing) {
    const data: {
      reason?: string | null;
      updatedById?: string | null;
      updatedByName?: string | null;
      createdById?: string | null;
      createdByName?: string | null;
    } = {};

    if (input.reason != null && input.reason.trim()) {
      data.reason = input.reason.trim().slice(0, 500);
    }
    if (input.audit) {
      data.updatedById = String(input.audit.updatedBy);
      data.updatedByName = input.audit.updatedByName;
      if ("createdBy" in input.audit && !existing.createdById) {
        data.createdById = String(input.audit.createdBy);
        data.createdByName = input.audit.createdByName;
      }
    } else if (input.createdBy && !existing.createdById) {
      const actorId = String(input.createdBy);
      if (isValidId(actorId)) data.createdById = actorId;
    }

    const updated =
      Object.keys(data).length > 0
        ? await prisma.userBlacklist.update({
            where: { id: existing.id },
            data,
          })
        : existing;

    return serializeBlacklistEntry(updated, false);
  }

  const createAudit =
    input.audit && "createdBy" in input.audit ? input.audit : null;

  const createdById = createAudit?.createdBy
    ? String(createAudit.createdBy)
    : input.createdBy && isValidId(String(input.createdBy))
      ? String(input.createdBy)
      : null;

  const created = await prisma.userBlacklist.create({
    data: {
      orgId,
      type: input.type,
      value: normalized,
      reason: input.reason?.trim()?.slice(0, 500) || null,
      source: input.source || "manual",
      createdById,
      createdByName: createAudit?.createdByName ?? "",
      updatedById: createAudit?.updatedBy
        ? String(createAudit.updatedBy)
        : input.audit?.updatedBy
          ? String(input.audit.updatedBy)
          : null,
      updatedByName:
        createAudit?.updatedByName ?? input.audit?.updatedByName ?? "",
    },
  });

  return serializeBlacklistEntry(created, true);
}

/** Add email + phone entries for a purged user (idempotent). */
export async function blacklistIdentifiersFromDeletedUser(input: {
  orgId: string;
  email?: string | null;
  phone?: string | null;
  actorSub: string;
  reason?: string;
  audit?: AuditCreateStamp | null;
}): Promise<{ emails: number; phones: number }> {
  let emails = 0;
  let phones = 0;
  const reason =
    input.reason?.trim() ||
    "Automatically blacklisted after permanent account deletion";

  if (input.email && isValidBlacklistEmail(input.email)) {
    const row = await upsertBlacklistEntry({
      orgId: input.orgId,
      type: "email",
      value: input.email,
      reason,
      source: "hard_delete",
      createdBy: input.actorSub,
      audit: input.audit,
    });
    if (row.created) emails += 1;
  }
  if (input.phone && isValidBlacklistPhone(input.phone)) {
    const row = await upsertBlacklistEntry({
      orgId: input.orgId,
      type: "phone",
      value: input.phone,
      reason,
      source: "hard_delete",
      createdBy: input.actorSub,
      audit: input.audit,
    });
    if (row.created) phones += 1;
  }
  return { emails, phones };
}

export function serializeBlacklistEntry(
  row: Record<string, unknown> | UserBlacklistRow,
  created = false
) {
  const r = row as Record<string, unknown>;
  const id = r.id ?? r._id;
  const createdBy = r.createdById ?? r.createdBy;
  const updatedBy = r.updatedById ?? r.updatedBy;
  return {
    _id: String(id),
    orgId: String(r.orgId),
    type: r.type as UserBlacklistType,
    value: String(r.value),
    reason: (r.reason as string | null | undefined) ?? null,
    source: (r.source as UserBlacklistSource) || "manual",
    createdBy: createdBy ? String(createdBy) : null,
    createdByName:
      typeof r.createdByName === "string" && r.createdByName.trim()
        ? r.createdByName.trim()
        : null,
    updatedBy: updatedBy ? String(updatedBy) : null,
    updatedByName:
      typeof r.updatedByName === "string" && r.updatedByName.trim()
        ? r.updatedByName.trim()
        : null,
    createdAt: r.createdAt
      ? new Date(r.createdAt as Date).toISOString()
      : null,
    updatedAt: r.updatedAt
      ? new Date(r.updatedAt as Date).toISOString()
      : null,
    created,
  };
}
