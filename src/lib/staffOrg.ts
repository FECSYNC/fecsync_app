/**
 * Staff tenancy (Step 5.3 / Phase 2): catalog/order admin ops use Membership JWT
 * orgId (Account → Organization). Storefront public reads stay on DEFAULT_ORG_ID
 * via `@/lib/org` storefront helpers. Never take orgId from the client body or ?orgId=.
 *
 * Layer 1 TENANT: actor.orgId on every staff-scoped org resource.
 * Layer 2 VISIBILITY: when companyWideView === false AND the model has an
 * ownership field (createdById / sellerId / userId), AND owner = actor.sub.
 * platform_admin is always company-wide (resolveCompanyWideView).
 *
 * Exceptions (intentional):
 * - Org-wide settings (tax/AI/shipping/homepage/ads): org filter only — no CWV
 *   own-scope (one row per org; finance must open tax with CWV false).
 * - Cart / wallet / customization staff lists: models have no orgId — gated to
 *   **storefront org staff only** via assertStorefrontStaffOrg (not all companies).
 * - Admin tailors / tailoring-jobs: org-only (no inventing createdBy filters).
 * - Analytics tailoring-job totals: org-ops metrics (same as admin jobs).
 * - Role templates: org-wide (shared team roles; no CWV own-scope on createdById).
 * - Tailor studio `/api/tailor/*`: profile ownership, not staff CWV.
 *
 * Shipments follow order CWV: when companyWideView=false, only shipments whose
 * order.userId === actor.sub (same visibility as staff order list/detail).
 *
 * Suspended Organization → requireAuthFresh fails closed (Phase 1).
 */

import { NextRequest } from "next/server";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  hasPermission,
  resolveCompanyWideView,
  P,
  type Permission,
} from "@/lib/auth/permissions";
import { asIdString } from "@/lib/ids";
import {
  requireAnyPermissionFresh,
  requirePermissionFresh,
} from "@/lib/middleware/requireAuth";
import type { NormalizedAccessToken } from "@/lib/auth/claims";
import {
  orgIdsEqual,
  storefrontOrgFilter,
  getStorefrontOrgId,
} from "@/lib/org";

export const CROSS_TENANT_MESSAGE = "Cross-tenant access denied";
export const MEMBERSHIP_ORG_REQUIRED = "Organization membership required";
export const STOREFRONT_STAFF_ONLY_MESSAGE =
  "This staff list is limited to the FECSYNC storefront organization";

type ActorWithOrg = {
  orgId?: string | null;
  sub?: string;
  companyWideView?: boolean | null;
  preset?: string | null;
  membershipRole?: string | null;
};

/** Staff JWT Membership.orgId — 403 if missing (no silent storefront fallback). */
export function requireActorOrgId(actor: ActorWithOrg): string {
  const id = asIdString(actor.orgId);
  if (!id) {
    throw new ForbiddenError(MEMBERSHIP_ORG_REQUIRED);
  }
  return id;
}

/**
 * Org-blind models (Cart / Wallet / Customization) have no orgId column.
 * Under multi-company, only storefront (DEFAULT_ORG_ID / isDefault) staff may
 * use global list/detail — registered company staff get 403 instead of all tenants' rows.
 */
export async function assertStorefrontStaffOrg(
  actor: ActorWithOrg,
  message: string = STOREFRONT_STAFF_ONLY_MESSAGE
): Promise<string> {
  const storefrontOrgId = await getStorefrontOrgId();
  const actorOrgId = requireActorOrgId(actor);
  assertActorOrgMatch(actorOrgId, storefrontOrgId, message);
  return storefrontOrgId;
}

export function actorOrgFilter(actor: ActorWithOrg): { orgId: string } {
  return { orgId: requireActorOrgId(actor) };
}

export function withActorOrg<T extends Record<string, unknown>>(
  actor: ActorWithOrg,
  filter: T
): T & { orgId: string } {
  return { ...filter, orgId: requireActorOrgId(actor) };
}

/** Stamp server-side orgId from the actor. Never trust body.orgId. */
export function stampActorOrgId<T extends Record<string, unknown>>(
  actor: ActorWithOrg,
  fields: T
): T & { orgId: string } {
  const next = { ...fields };
  delete (next as { orgId?: unknown }).orgId;
  return { ...next, orgId: requireActorOrgId(actor) };
}

/** 403 when a document belongs to another org (even platform_admin of org A vs org B). */
export function assertActorOrgMatch(
  actorOrgId: string,
  docOrgId: unknown,
  message: string = CROSS_TENANT_MESSAGE
): void {
  if (!orgIdsEqual(actorOrgId, docOrgId)) {
    throw new ForbiddenError(message);
  }
}

/** Admin UI lists: `?scope=staff` → actor.orgId; else storefront (public). */
export function isStaffCatalogScope(req: NextRequest): boolean {
  return new URL(req.url).searchParams.get("scope") === "staff";
}

export function actorHasCompanyWideView(actor: ActorWithOrg): boolean {
  return resolveCompanyWideView({
    companyWideView: actor.companyWideView,
    preset: actor.preset,
    membershipRole: actor.membershipRole,
  });
}

/**
 * Merge org filter with own-scope fields when companyWideView is false.
 * `own` is ignored for platform_admin / company-wide members.
 */
export function withStaffDataScope<T extends Record<string, unknown>>(
  actor: ActorWithOrg & { sub: string },
  base: T,
  own: Record<string, unknown>
): T & Record<string, unknown> {
  if (actorHasCompanyWideView(actor)) {
    return { ...base };
  }
  return { ...base, ...own };
}

/** Own-scope filter fragment for models stamped with createdById (fabric/category). */
export function staffOwnCreatedByFilter(actor: { sub: string }): {
  createdById: string;
} {
  return { createdById: actor.sub };
}

/**
 * Detail/mutate IDOR guard for ownership-capable catalog rows.
 * CWV true → any row in actor.orgId. CWV false → createdById must equal sub
 * (null/missing createdById is not visible — same as list filter).
 */
export function assertStaffCreatedByOwnScope(
  actor: ActorWithOrg & { sub: string },
  createdById: unknown
): void {
  if (actorHasCompanyWideView(actor)) return;
  const owner = asIdString(createdById);
  if (!owner || owner !== actor.sub) {
    throw new ForbiddenError("Forbidden");
  }
}

/** Own-scope filter for Product (seller and/or createdBy — both are stamped on create). */
export function staffOwnProductFilter(actor: { sub: string }): {
  OR: Array<{ sellerId: string } | { createdById: string }>;
} {
  return {
    OR: [{ sellerId: actor.sub }, { createdById: actor.sub }],
  };
}

/**
 * Detail/mutate IDOR for products: CWV false allows sellerId or createdById = sub.
 */
export function assertStaffProductOwnScope(
  actor: ActorWithOrg & { sub: string },
  product: { sellerId?: string | null; createdById?: string | null } | null | undefined
): void {
  if (actorHasCompanyWideView(actor)) return;
  const seller = asIdString(product?.sellerId);
  const created = asIdString(product?.createdById);
  if (seller === actor.sub || created === actor.sub) return;
  throw new ForbiddenError("Forbidden");
}

/**
 * Resolve catalog org for dual-purpose GET list/detail.
 * `scope=staff` always reloads Membership (Fresh) so revoke/demotion/org
 * change cannot keep serving stale JWT grants until access TTL.
 * Otherwise always DEFAULT_ORG_ID / default org (never JWT org for public shop).
 */
export async function resolveCatalogOrgFilter(
  req: NextRequest,
  staffPermission: Permission
): Promise<{ orgId: string }> {
  if (!isStaffCatalogScope(req)) {
    return storefrontOrgFilter();
  }

  const actor = await requirePermissionFresh(req, staffPermission);
  return actorOrgFilter(actor);
}

/**
 * Staff catalog detail access: Fresh actor + orgId (public path returns org only).
 */
export async function resolveCatalogAccess(
  req: NextRequest,
  staffPermission: Permission
): Promise<
  | { scope: "staff"; orgId: string; actor: NormalizedAccessToken }
  | { scope: "public"; orgId: string; actor: null }
> {
  if (!isStaffCatalogScope(req)) {
    const { orgId } = await storefrontOrgFilter();
    return { scope: "public", orgId, actor: null };
  }
  const actor = await requirePermissionFresh(req, staffPermission);
  return {
    scope: "staff",
    orgId: requireActorOrgId(actor),
    actor,
  };
}

/**
 * Staff catalog list filter: org + optional own-scope (e.g. seller=sub / createdById).
 * Public storefront path unchanged (no own-scope).
 * Staff path always uses Fresh membership checks.
 */
export async function resolveStaffCatalogListFilter(
  req: NextRequest,
  staffPermission: Permission,
  ownScope?: (actor: { sub: string }) => Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!isStaffCatalogScope(req)) {
    return storefrontOrgFilter();
  }

  const actor = await requirePermissionFresh(req, staffPermission);
  const base = actorOrgFilter(actor);
  if (!ownScope || actorHasCompanyWideView(actor)) {
    return base;
  }
  return { ...base, ...ownScope(actor) };
}

/**
 * ProductCategory staff list for Catalog managers OR Ticketing staff who need
 * org categories for admission-product filters / optional assignment.
 * Own-scope (createdBy) applies only when the actor holds categories:read —
 * ticketing:read alone always sees the full org category set (classification
 * is org-wide, not author-scoped).
 */
export async function resolveStaffCategoryListFilter(
  req: NextRequest,
  ownScope?: (actor: { sub: string }) => Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!isStaffCatalogScope(req)) {
    return storefrontOrgFilter();
  }

  const actor = await requireAnyPermissionFresh(req, [P.CategoriesRead]);
  const base = actorOrgFilter(actor);
  const applyOwnScope =
    Boolean(ownScope) &&
    hasPermission(actor.permissions, P.CategoriesRead) &&
    !actorHasCompanyWideView(actor);
  if (!applyOwnScope || !ownScope) {
    return base;
  }
  return { ...base, ...ownScope(actor) };
}
