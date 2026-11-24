/**
 * Server-only resolve for platform software owner (loads storefront org from DB).
 * Keep this filename away from `platformSoftwareOwner.ts` — do not use a
 * sibling `platformSoftwareOwner.server.ts` (Turbopack client merge).
 */
import { getStorefrontOrgId } from "@/lib/org";
import {
  isPlatformSoftwareOwner,
  type PlatformOwnerActor,
} from "@/lib/platformSoftwareOwner";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";

export type { PlatformOwnerActor };

/** Tenant-facing copy — do not name FECSYNC owner emails or user ids. */
export const PLATFORM_OWNER_HIDDEN_FROM_TENANT_MESSAGE =
  "That account is not available in this company workspace";

/** Generic fail-closed copy for non-owners targeting a software owner. */
export const PLATFORM_OWNER_PROTECTED_MESSAGE =
  "That account is not available";

/** UI / audit redaction for non-owners. */
export const PLATFORM_OWNER_REDACTED_LABEL = "---";

function isPlatformAdminPreset(
  actor: PlatformOwnerActor | null | undefined
): boolean {
  if (!actor) return false;
  return (
    actor.preset === "platform_admin" ||
    actor.membershipRole === "platform_admin"
  );
}

/** Resolves storefront org when JWT omits storefrontOrgId. */
export async function resolveIsPlatformSoftwareOwner(
  actor: PlatformOwnerActor | null | undefined
): Promise<boolean> {
  if (!isPlatformAdminPreset(actor)) return false;
  if (isPlatformSoftwareOwner(actor)) return true;
  const orgId =
    typeof actor!.orgId === "string" && actor!.orgId.trim()
      ? actor!.orgId.trim()
      : "";
  if (!orgId) return false;
  const storefront = await getStorefrontOrgId();
  return Boolean(storefront) && orgId === storefront;
}

/**
 * User ids with a storefront (DEFAULT_ORG) Membership rolePreset platform_admin.
 * Non-owners must never list, invite, edit, delete, reset password, or see
 * activity for these — only another software owner may.
 */
export async function listStorefrontPlatformAdminUserIds(): Promise<
  Set<string>
> {
  const storefront = await getStorefrontOrgId();
  if (!storefront || !isValidId(storefront)) return new Set();
  const rows = await prisma.membership.findMany({
    where: {
      orgId: storefront,
      rolePreset: "platform_admin",
    },
    select: { userId: true },
  });
  return new Set(rows.map((r) => r.userId).filter(Boolean));
}

export async function isStorefrontPlatformAdminUserId(
  userId: string
): Promise<boolean> {
  if (!isValidId(userId)) return false;
  const storefront = await getStorefrontOrgId();
  if (!storefront || !isValidId(storefront)) return false;
  const row = await prisma.membership.findFirst({
    where: {
      userId,
      orgId: storefront,
      rolePreset: "platform_admin",
    },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * Registered-company actors cannot manage FECSYNC storefront platform_admin users.
 * Prefer {@link assertCanManageStaffUserTarget} for new call sites.
 */
export async function assertTenantCannotTargetStorefrontPlatformAdmin(
  actorOrgId: string,
  targetUserId: string
): Promise<void> {
  const storefront = await getStorefrontOrgId();
  if (!storefront || actorOrgId === storefront) return;
  if (await isStorefrontPlatformAdminUserId(targetUserId)) {
    throw new ForbiddenError(PLATFORM_OWNER_HIDDEN_FROM_TENANT_MESSAGE);
  }
}

/**
 * Fail-closed: only a platform software owner may view/mutate/reset another
 * software owner. Everyone else gets a generic not-available error (no leak).
 */
export async function assertCanManageStaffUserTarget(
  actor: PlatformOwnerActor & { sub?: string | null; orgId?: string | null },
  targetUserId: string
): Promise<void> {
  if (!isValidId(targetUserId)) {
    throw new ForbiddenError(PLATFORM_OWNER_PROTECTED_MESSAGE);
  }
  const targetIsOwner = await isStorefrontPlatformAdminUserId(targetUserId);
  if (!targetIsOwner) return;
  const viewerIsOwner = await resolveIsPlatformSoftwareOwner(actor);
  if (!viewerIsOwner) {
    throw new ForbiddenError(PLATFORM_OWNER_PROTECTED_MESSAGE);
  }
}

/**
 * Membership / user list filter: drop software-owner rows unless the viewer
 * is also a software owner.
 */
export async function filterHiddenPlatformOwnerUserIds(
  actor: PlatformOwnerActor | null | undefined,
  userIds: Iterable<string>
): Promise<Set<string>> {
  const viewerIsOwner = await resolveIsPlatformSoftwareOwner(actor);
  if (viewerIsOwner) return new Set();
  const owners = await listStorefrontPlatformAdminUserIds();
  const hide = new Set<string>();
  for (const id of userIds) {
    if (owners.has(id)) hide.add(id);
  }
  return hide;
}

/** Redact audit actor display when the actor is a hidden software owner. */
export function redactPlatformOwnerAuditLabel(
  viewerIsOwner: boolean,
  actorUserId: string | null | undefined,
  label: string | null | undefined,
  ownerIds: Set<string>
): string | null {
  if (viewerIsOwner) {
    return typeof label === "string" && label.trim() ? label.trim() : null;
  }
  if (actorUserId && ownerIds.has(actorUserId)) {
    return PLATFORM_OWNER_REDACTED_LABEL;
  }
  return typeof label === "string" && label.trim() ? label.trim() : null;
}
