import { NextRequest } from "next/server";
import {
  ok,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requireAnyPermissionFresh } from "@/lib/middleware/requireAuth";
import { P, hasAnyPermission } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { assertOrganizationActive } from "@/lib/org";
import {
  assertRegisteredCompanyBillingOrg,
} from "@/lib/companyBilling";
import { getPlanUsageSnapshot } from "@/lib/planLimits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Actors who may see membership-adjacent seat occupant user ids. */
const SEAT_OCCUPANT_ID_PERMS = [
  P.SettingsManage,
  P.BillingRead,
  P.UsersInvite,
  P.UsersManageRoles,
  P.TailorsManage,
] as const;

/**
 * GET /api/admin/billing/usage
 * Plan meters for company tenants (settings/analytics/invite/catalog write/tailors).
 * tailorSeatOccupantUserIds is withheld from catalog-write-only actors.
 */
export async function GET(req: NextRequest) {
  let actor;
  try {
    // Dashboard + create/invite UI mirrors (still actor.orgId only).
    actor = await requireAnyPermissionFresh(
      req,
      [
        P.SettingsManage,
        P.BillingRead,
        P.BillingManage,
        P.VenuesRead,
        P.AnalyticsRead,
        P.UsersInvite,
        P.UsersManageRoles,
        P.ProductsWrite,
        P.FabricsWrite,
        P.CategoriesWrite,
        P.BookingPackagesManage,
        P.BookingPackagesRead,
        P.TailorsManage,
      ],
      { allowOnDemo: true }
    );
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/admin/billing/usage", {
          permission: P.AnalyticsRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const orgId = requireActorOrgId(actor);
    const { resolveIsPlatformSoftwareOwner } = await import(
      "@/lib/resolvePlatformSoftwareOwner"
    );
    const ownerHost = await resolveIsPlatformSoftwareOwner(actor);
    // Platform Super admin hosts park meters on the storefront org; company
    // billing assert stays for registered-company tenants only.
    if (!ownerHost) {
      await assertRegisteredCompanyBillingOrg(orgId);
    }
    await assertOrganizationActive(orgId);
    const { resolveEffectiveParkScope } = await import("@/lib/parkAdminScope");
    const parkScope = await resolveEffectiveParkScope(actor);
    const usage = await getPlanUsageSnapshot(orgId);
    const maySeeSeatOccupants = hasAnyPermission(
      actor.permissions,
      SEAT_OCCUPANT_ID_PERMS
    );
    // Park-locked: do not leak company-wide venue counts / seat occupant ids.
    let meters = usage.meters;
    if (parkScope.parkLocked && Array.isArray(meters)) {
      meters = meters.map((m: { resource?: string; used?: number; limit?: number | null; remaining?: number | null; unlimited?: boolean }) => {
        if (m?.resource !== "venues") return m;
        const used = parkScope.assignedLocationIds.length;
        const limit = m.limit ?? null;
        const unlimited = Boolean(m.unlimited);
        return {
          ...m,
          used,
          remaining: unlimited || limit == null ? null : Math.max(0, limit - used),
        };
      });
    }
    return ok({
      usage: {
        ...usage,
        meters,
        tailorSeatOccupantUserIds:
          maySeeSeatOccupants && !parkScope.parkLocked
            ? usage.tailorSeatOccupantUserIds
            : [],
      },
    });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "GET /api/admin/billing/usage", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
      })
    );
    if (authRes) return authRes;
    console.error("billing usage error:", err);
    return serverError("Failed to load plan usage");
  }
}
