export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import dbConnect from "@/lib/db";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthFresh } from "@/lib/middleware/requireAuth";
import { toPublicAuthzFromClaims, stampLiveRoleOnProfile } from "@/lib/auth/claims";
import { authErrorToResponse } from "@/lib/response";
import { getProfileForUser } from "@/lib/models/Profile";
import {
  listMembershipsForUser,
  resolveAuthzForUser,
} from "@/lib/membership";
import {
  LAST_PLATFORM_ADMIN_MESSAGE,
  USER_HAS_DEPENDENT_DATA_SELF_MESSAGE,
  assertUserHasNoRestrictDependents,
  detachUserReferencesForDelete,
  serializeMembershipWithTemplate,
} from "@/lib/memberAdmin";
import { ForbiddenError } from "@/lib/auth/http-error";
import { appendClearedAuthCookies } from "@/lib/auth/sessionCookies";
import {
  applyLazySubscriptionExpiryIfNeeded,
  getStorefrontOrgId,
} from "@/lib/org";

function clearSessionCookies(response: NextResponse, req: NextRequest): void {
  appendClearedAuthCookies(response, req);
}

// GET user profile
export async function GET(req: NextRequest) {
  try {
    // Waiting room: pending + suspended may refresh org status via /me.
    // Staff/tailor Fresh APIs still fail-closed on suspended (default Fresh).
    // Soft account suspend: /me still loads so the FE can show the unlock dialog.
    // Fresh: reject stale av after role/template changes so clients cannot
    // keep a live UI session while staff APIs return "Session outdated".
    const decoded = await requireAuthFresh(req, {
      allowSuspendedOrg: true,
      allowAccountSuspended: true,
    });
    // Session user only — ignore ?userId=.
    void req.nextUrl.searchParams.get("userId");

    await dbConnect();
    const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
    if (!user) {
      return NextResponse.json(
        { message: "User profile not found" },
        { status: 404 }
      );
    }
    const profile = await getProfileForUser(decoded.sub);

    // Prefer live Membership over possibly-stale JWT claims, but keep the
    // current access JWT org sticky when that seat is still active (avoids
    // storefront-first demotion mid-admin session).
    const authz = await resolveAuthzForUser(user, {
      preferOrgId: decoded.orgId,
    });
    stampLiveRoleOnProfile(profile, authz.role);
    const membershipRows = await listMembershipsForUser(user.id);
    const memberships = await Promise.all(
      membershipRows.map(async (row) => {
        const serialized = await serializeMembershipWithTemplate({
          ...row,
          userId: user.id,
        });
        return {
          orgId: serialized.orgId,
          rolePreset: serialized.rolePreset,
          roleTemplateId: serialized.roleTemplateId,
          status: serialized.status,
          permissions: serialized.permissions,
          permissionsOverride: serialized.permissionsOverride,
          companyWideView: serialized.companyWideView,
          invitedBy: serialized.invitedBy,
          createdAt: serialized.createdAt,
          updatedAt: serialized.updatedAt,
        };
      })
    );

    let organization: {
      id: string;
      name: string;
      status: string;
      billingSoftHold?: boolean;
      billingGraceEndsAt?: string | null;
      subscriptionPlan: string | null;
      subscriptionStatus: string | null;
      subscriptionEndsAt: Date | null;
      enterpriseHqEnabled?: boolean;
      profileCompleteness?: number;
      hasLogo?: boolean;
      logoUrl?: string | null;
      slug?: string;
      legalName?: string | null;
      tradingName?: string | null;
      companyDisplayName?: string | null;
    } | null = null;
    if (authz.orgId) {
      const [org, profile] = await Promise.all([
        prisma.organization.findUnique({
          where: { id: authz.orgId },
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            isDefault: true,
            subscriptionPlan: true,
            subscriptionStatus: true,
            subscriptionEndsAt: true,
          },
        }),
        prisma.companyProfile.findUnique({
          where: { orgId: authz.orgId },
          select: {
            legalName: true,
            tradingName: true,
            logoUrl: true,
            supportEmail: true,
            addressLine1: true,
            city: true,
            country: true,
            bankAccountLast4: true,
            bankAccountCiphertext: true,
            bankRoutingOrIban: true,
          },
        }),
      ]);
      if (org) {
        // Waiting-room /me must still apply lazy expire so AdminLayout /
        // company-pending sync when Fresh already suspended the tenant.
        const { isSoftBillingHoldRow } = await import("@/lib/billingSoftHold");
  const after = await applyLazySubscriptionExpiryIfNeeded(
          {
            id: org.id,
            status: org.status,
            isDefault: org.isDefault,
            subscriptionEndsAt: org.subscriptionEndsAt,
            subscriptionStatus: org.subscriptionStatus,
            subscriptionPlan: org.subscriptionPlan,
          },
          "me:subscriptionEndsAt passed"
        );
        // Soft-hold only for registered companies with DB still `active`.
        // Use pre-lazy org.status — hard-suspended must never soft-hold.
        // Storefront / isDefault never soft-holds (shop control plane).
        const softHoldEffective =
          org.isDefault || after.didExpire
            ? false
            : isSoftBillingHoldRow({
                status: org.status,
                subscriptionStatus: after.subscriptionStatus,
                subscriptionEndsAt: after.subscriptionEndsAt,
                subscriptionPlan:
                  after.subscriptionPlan ?? org.subscriptionPlan,
              });
        const {
          computeProfileCompleteness,
          computeCompanyDisplayName,
        } = await import("@/lib/companyProfile");
        const { billingGraceEndsAt } = await import("@/lib/billingGrace");
        const graceEndsAtIso =
          softHoldEffective && after.subscriptionEndsAt
            ? billingGraceEndsAt(after.subscriptionEndsAt).toISOString()
            : null;
        const completeness = computeProfileCompleteness({
          legalName: profile?.legalName ?? null,
          tradingName: profile?.tradingName ?? null,
          logoUrl: profile?.logoUrl ?? null,
          supportEmail: profile?.supportEmail ?? null,
          addressLine1: profile?.addressLine1 ?? null,
          city: profile?.city ?? null,
          country: profile?.country ?? null,
          hasBankAccount: Boolean(
            profile?.bankAccountLast4 || profile?.bankAccountCiphertext
          ),
          hasBankRoutingOrIban: Boolean(profile?.bankRoutingOrIban?.trim()),
        });
        const planForHq = after.subscriptionPlan ?? org.subscriptionPlan;
        const { orgHasEnterpriseHq } = await import("@/lib/enterpriseHq");
        const { resolveIsPlatformSoftwareOwner } = await import(
          "@/lib/resolvePlatformSoftwareOwner"
        );
        const storefrontOrgId = await getStorefrontOrgId();
        const ownerHost = await resolveIsPlatformSoftwareOwner({
          orgId: authz.orgId,
          preset: authz.preset,
          membershipRole: authz.membershipRole,
          storefrontOrgId,
        });
        const enterpriseHqEnabled =
          ownerHost ||
          (!softHoldEffective &&
            orgHasEnterpriseHq({
              isDefault: org.isDefault,
              status: after.status,
              subscriptionPlan: planForHq,
              subscriptionStatus: after.subscriptionStatus,
              subscriptionEndsAt: after.subscriptionEndsAt,
            }));
        organization = {
          id: org.id,
          name: org.name,
          status: after.status,
          billingSoftHold: softHoldEffective,
          billingGraceEndsAt: graceEndsAtIso,
          // Prefer post-lazy plan (Demo demotion keeps plan = demo).
          subscriptionPlan: planForHq,
          subscriptionStatus: after.subscriptionStatus,
          subscriptionEndsAt: after.subscriptionEndsAt,
          enterpriseHqEnabled,
          profileCompleteness: completeness,
          hasLogo: Boolean(profile?.logoUrl),
          logoUrl: org.isDefault ? null : profile?.logoUrl?.trim() || null,
          slug: org.slug,
          legalName: profile?.legalName ?? null,
          tradingName: profile?.tradingName ?? null,
          companyDisplayName: computeCompanyDisplayName({
            legalName: profile?.legalName,
            tradingName: profile?.tradingName,
            organizationName: org.name,
          }),
        };
      }
    }

    let parkScope: {
      parkLocked: boolean;
      assignedLocationIds: string[];
      effectiveLocationId: string | null;
      hqSelectedLocationId: string | null;
      franchiseParkManager: boolean;
    } | null = null;
    if (authz.orgId) {
      try {
        const { resolveEffectiveParkScope } = await import(
          "@/lib/parkAdminScope"
        );
        const scope = await resolveEffectiveParkScope({
          orgId: authz.orgId,
          sub: user.id,
          companyWideView: authz.companyWideView,
          preset: authz.preset,
          membershipRole: authz.membershipRole,
          storefrontOrgId: await getStorefrontOrgId(),
        });
        parkScope = {
          parkLocked: scope.parkLocked,
          assignedLocationIds: scope.assignedLocationIds,
          effectiveLocationId: scope.locationId,
          hqSelectedLocationId: scope.hqSelectedLocationId,
          franchiseParkManager: scope.franchiseParkManager === true,
        };
      } catch {
        // Fail-closed: never imply company-wide parks on resolve errors.
        parkScope = {
          parkLocked: true,
          assignedLocationIds: [],
          effectiveLocationId: null,
          hqSelectedLocationId: null,
          franchiseParkManager: false,
        };
      }
    }

    return NextResponse.json({
      profile,
      userId: user.id,
      ...toPublicAuthzFromClaims(authz),
      storefrontOrgId: await getStorefrontOrgId(),
      organization,
      companyLogoUrl: organization?.logoUrl ?? null,
      organizationSlug: organization?.slug ?? null,
      orgStatus: organization?.status ?? null,
      billingSoftHold: organization?.billingSoftHold === true,
      billingGraceEndsAt: organization?.billingGraceEndsAt ?? null,
      enterpriseHqEnabled: organization?.enterpriseHqEnabled === true,
      accountSuspended: user.accountSuspended === true,
      parkLocked: parkScope?.parkLocked === true,
      assignedLocationIds: parkScope?.assignedLocationIds ?? [],
      effectiveLocationId: parkScope?.effectiveLocationId ?? null,
      hqSelectedLocationId: parkScope?.hqSelectedLocationId ?? null,
      franchiseParkManager: parkScope?.franchiseParkManager === true,
      memberships,
    });
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    return NextResponse.json({ message: "Invalid token" }, { status: 401 });
  }
}

// DELETE user + profile — own rows only. Never body.user.
// Step 6.1: cannot orphan an org by deleting the last platform_admin
// (Serializable recheck, same integrity model as members hard-delete).
// Graph detach + Restrict preflight match hardDeleteOrgMemberUser so self-delete
// cannot leave dangling invitedBy/activityLog FKs or fail mid-purge.
export async function DELETE(req: NextRequest) {
  try {
    const decoded = await requireAuthFresh(req, { allowSuspendedOrg: true });
    void req.nextUrl.searchParams.get("userId");
    const userId = decoded.sub;

    await dbConnect();
    await assertUserHasNoRestrictDependents(
      userId,
      USER_HAS_DEPENDENT_DATA_SELF_MESSAGE
    );

    const { deleteTailorDomainForUser } = await import("@/lib/tailors");

    await prisma.$transaction(
      async (tx) => {
        const adminMemberships = await tx.membership.findMany({
          where: {
            userId,
            rolePreset: "platform_admin",
            status: "active",
          },
          select: { id: true, orgId: true },
        });

        for (const row of adminMemberships) {
          const remaining = await tx.membership.count({
            where: {
              orgId: row.orgId,
              rolePreset: "platform_admin",
              status: "active",
              id: { not: row.id },
            },
          });
          if (remaining < 1) {
            throw new ForbiddenError(LAST_PLATFORM_ADMIN_MESSAGE);
          }
        }

        await detachUserReferencesForDelete(tx, userId);
        await deleteTailorDomainForUser(userId, tx);
        await tx.profile.deleteMany({ where: { userId } });
        // Wallet stays user-scoped (PAYMENT_POLICY); delete only own wallet.
        await tx.wallet.deleteMany({ where: { userId } });
        await tx.membership.deleteMany({ where: { userId } });
        await tx.user.delete({ where: { id: userId } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    const response = NextResponse.json({ message: "User deleted successfully" });
    clearSessionCookies(response, req);
    return response;
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    if (
      err instanceof Error &&
      (err.message.includes("Record to delete does not exist") ||
        err.message.includes("No record was found"))
    ) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }
    console.error("DELETE /api/auth/me failed:", err);
    return NextResponse.json(
      { message: "Failed to delete user" },
      { status: 500 }
    );
  }
}
