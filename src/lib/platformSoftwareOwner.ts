/**
 * Platform software owner — storefront (DEFAULT_ORG) Membership `platform_admin`.
 *
 * Client-safe (no Node/DB). Do not put server resolve in a sibling
 * `*.server.ts` next to this file — Turbopack can merge that into the
 * client graph. Server resolve lives in `resolvePlatformSoftwareOwner.ts`.
 */
export type PlatformOwnerActor = {
  preset?: string | null;
  membershipRole?: string | null;
  orgId?: string | null;
  storefrontOrgId?: string | null;
};

function isPlatformAdminPreset(
  actor: PlatformOwnerActor | null | undefined
): boolean {
  if (!actor) return false;
  return (
    actor.preset === "platform_admin" ||
    actor.membershipRole === "platform_admin"
  );
}

/**
 * Sync session check. Requires storefrontOrgId (login + /me stamp it for staff).
 */
export function isPlatformSoftwareOwner(
  actor: PlatformOwnerActor | null | undefined
): boolean {
  if (!isPlatformAdminPreset(actor)) return false;
  const orgId =
    typeof actor!.orgId === "string" && actor!.orgId.trim()
      ? actor!.orgId.trim()
      : "";
  const storefront =
    typeof actor!.storefrontOrgId === "string" &&
    actor!.storefrontOrgId.trim()
      ? actor!.storefrontOrgId.trim()
      : "";
  if (!orgId || !storefront) return false;
  return orgId === storefront;
}

export const PLATFORM_OWNER_HOST_MESSAGE =
  "Platform software owner — every admin surface unlocked on the storefront host for QA (money APIs stay fail-closed for DEFAULT_ORG).";
