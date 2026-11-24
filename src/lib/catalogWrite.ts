/**
 * Shared catalog mutation helpers (products / fabrics / categories).
 * Tenant root is Organization.orgId (Step 5.1), stamped server-side.
 * seller/shop are unused leftover keys, never a privilege. Never body.orgId.
 */

import { Prisma } from "@prisma/client";
import {
  authErrorToResponse,
  badRequest,
  serverError,
} from "@/lib/response";
import { AUDIT_WRITE_KEYS } from "@/lib/audit/recordAudit";
import { isValidId } from "@/lib/ids";
import type { AuditCreateStamp, AuditUpdateStamp } from "@/lib/audit/recordAudit";

/** seller/shop unused leftovers. orgId + audit actors — never from the client. */
const TENANT_KEYS = ["seller", "shop", "orgId", ...AUDIT_WRITE_KEYS] as const;

/** True for JSON objects only — not arrays/null. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 404 unknown/invalid id (cuid, uuid, or legacy 24-char hex). */
export function isCatalogObjectId(id: string | undefined): boolean {
  return typeof id === "string" && isValidId(id);
}

/** Prisma where clause matching primary id or legacy Mongo hex. */
export function catalogIdWhere(id: string): { OR: [{ id: string }, { legacyId: string }] } {
  return { OR: [{ id }, { legacyId: id }] };
}

/** Org-scoped lookup by route id (cuid / legacy hex). */
export function whereOrgAndCatalogId(orgId: string, id: string) {
  return { orgId, ...catalogIdWhere(id) };
}

export function omitCatalogTenantKeys<T extends Record<string, unknown>>(
  body: T
): Omit<
  T,
  "seller" | "shop" | "orgId" | (typeof AUDIT_WRITE_KEYS)[number]
> {
  const next = { ...body } as Record<string, unknown>;
  for (const key of TENANT_KEYS) {
    delete next[key];
  }
  return next as Omit<
    T,
    "seller" | "shop" | "orgId" | (typeof AUDIT_WRITE_KEYS)[number]
  >;
}

/** Map audit stamp fields to Prisma column names. */
export function auditCreateToPrisma(audit: AuditCreateStamp) {
  return {
    createdById: audit.createdBy,
    createdByName: audit.createdByName,
    updatedById: audit.updatedBy,
    updatedByName: audit.updatedByName,
  };
}

export function auditUpdateToPrisma(audit: AuditUpdateStamp) {
  return {
    updatedById: audit.updatedBy,
    updatedByName: audit.updatedByName,
  };
}

/** Validation/duplicate → 400; auth → 401/403; else 500. */
export function catalogWriteErrorResponse(error: unknown, entity: string) {
  const authRes = authErrorToResponse(error);
  if (authRes) return authRes;
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return badRequest(`${entity} already exists`);
  }
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
  if (name === "ValidationError" || name === "CastError") {
    return badRequest(`Invalid ${entity} data: ` + (error as Error).message);
  }
  return serverError(
    error instanceof Error ? error.message : `Failed to save ${entity}`
  );
}
