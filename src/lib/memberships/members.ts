/**
 * GuestMembership list + detail (Feature 08 Phase 2).
 */
import type { GuestMembershipStatus, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId, requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  assertMembershipsStaff,
  locationScopeFilter,
  requireActorVenueInScope,
  assertLocationInMembershipScope,
  assertGuestMembershipVisibleToActor,
  type MembershipsActor,
} from "@/lib/memberships/common";
import { verifyBenefits } from "@/lib/memberships/entitlementEngine";
import type { GuestMembershipDto, GuestMembershipListItem } from "@/lib/memberships/types";

const STATUSES = new Set<string>([
  "active",
  "past_due",
  "paused",
  "cancelled",
  "expired",
  "pending",
]);

export function toGuestMembershipDto(row: {
  id: string;
  orgId: string;
  locationId: string;
  homeLocationId: string;
  guestProfileId: string;
  planId: string;
  status: GuestMembershipStatus;
  startsAt: Date | null;
  endsAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  customMembershipId: string;
  barcodeOrCode: string | null;
  photoUrl: string | null;
  source: GuestMembershipDto["source"];
  cancelAtPeriodEnd: boolean;
  cancelledAt: Date | null;
  creditBalanceMinor: number;
  visitStatus: GuestMembershipDto["visitStatus"];
  stripeSubscriptionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): GuestMembershipDto {
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    homeLocationId: row.homeLocationId,
    guestProfileId: row.guestProfileId,
    planId: row.planId,
    status: row.status,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    currentPeriodStart: row.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    customMembershipId: row.customMembershipId,
    barcodeOrCode: row.barcodeOrCode,
    photoUrl: row.photoUrl,
    source: row.source,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    creditBalanceMinor: row.creditBalanceMinor,
    visitStatus: row.visitStatus,
    hasStripeSubscription: Boolean(row.stripeSubscriptionId?.trim()),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** @deprecated Prefer toGuestMembershipDto */
const toDto = toGuestMembershipDto;

export async function listGuestMemberships(
  actor: MembershipsActor,
  opts?: {
    q?: string;
    status?: string;
    planId?: string;
    locationId?: string;
    take?: number;
    /** Opaque pagination cursor = last seen GuestMembership id */
    cursor?: string;
  }
): Promise<{
  members: GuestMembershipListItem[];
  nextCursor: string | null;
  note: string;
}> {
  const orgId = await assertMembershipsStaff(actor);
  const scope = await locationScopeFilter(actor);
  const take = Math.min(Math.max(opts?.take ?? 50, 1), 100);

  const where: Prisma.GuestMembershipWhereInput = { orgId };

  if (opts?.status && STATUSES.has(opts.status)) {
    where.status = opts.status as GuestMembershipStatus;
  }
  if (opts?.planId && isValidId(opts.planId)) {
    where.planId = opts.planId;
  }
  if (opts?.locationId && isValidId(opts.locationId)) {
    await requireActorVenueInScope(actor, opts.locationId, {
      allowArchived: true,
    });
    where.OR = [
      { locationId: opts.locationId },
      { homeLocationId: opts.locationId },
      {
        plan: {
          venueEligibility: {
            some: { locationId: opts.locationId, eligible: true },
          },
        },
      },
    ];
  } else if (scope.parkLocked) {
    const ids =
      scope.locationIds?.length
        ? scope.locationIds
        : scope.locationId
          ? [scope.locationId]
          : [];
    if (!ids.length) {
      where.id = "__none__";
    } else {
      // Include visiting members whose plan is eligible at an assigned park.
      where.OR = [
        { locationId: { in: ids } },
        { homeLocationId: { in: ids } },
        {
          plan: {
            venueEligibility: {
              some: { locationId: { in: ids }, eligible: true },
            },
          },
        },
      ];
    }
  } else if (scope.locationId) {
    const id = scope.locationId;
    where.OR = [
      { locationId: id },
      { homeLocationId: id },
      {
        plan: {
          venueEligibility: {
            some: { locationId: id, eligible: true },
          },
        },
      },
    ];
  }

  const q = opts?.q?.trim();
  if (q) {
    where.AND = [
      {
        OR: [
          { customMembershipId: { contains: q, mode: "insensitive" } },
          { barcodeOrCode: { contains: q, mode: "insensitive" } },
          {
            guestProfile: {
              OR: [
                { firstName: { contains: q, mode: "insensitive" } },
                { lastName: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
                { phone: { contains: q, mode: "insensitive" } },
              ],
            },
          },
        ],
      },
    ];
  }

  const cursorId =
    opts?.cursor && isValidId(opts.cursor) ? opts.cursor : undefined;

  const rows = await prisma.guestMembership.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    include: {
      guestProfile: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          userId: true,
        },
      },
      plan: {
        select: {
          id: true,
          name: true,
          billing: true,
          price: true,
          currency: true,
          categoryId: true,
          category: { select: { name: true } },
        },
      },
      homeLocation: { select: { id: true, name: true } },
    },
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  return {
    members: page.map((row) => ({
      ...toDto(row),
      guest: {
        id: row.guestProfile.id,
        firstName: row.guestProfile.firstName,
        lastName: row.guestProfile.lastName,
        displayName:
          `${row.guestProfile.firstName} ${row.guestProfile.lastName}`.trim(),
        email: row.guestProfile.email,
        phone: row.guestProfile.phone,
        userId: row.guestProfile.userId,
      },
      plan: {
        id: row.plan.id,
        name: row.plan.name,
        billing: row.plan.billing,
        price: String(row.plan.price),
        currency: row.plan.currency,
        categoryId: row.plan.categoryId,
        categoryName: row.plan.category?.name ?? null,
      },
      homeLocation: row.homeLocation
        ? { id: row.homeLocation.id, name: row.homeLocation.name }
        : null,
    })),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    note: "Desk sells, POS, and online memberships all appear here.",
  };
}

export type GuestMembershipDetailDto = GuestMembershipDto & {
  cancelReason: string | null;
  agreementSignedAt: string | null;
  dunningFailCount: number;
  dunningNextAt: string | null;
  pauseStartsAt: string | null;
  pauseEndsAt: string | null;
  remainingEntries: number | null;
  homeLocation: { id: string; name: string } | null;
  plan: {
    id: string;
    name: string;
    billing: string;
    price: string;
    currency: string;
    upgradeGroupKey: string | null;
    pauseAllowed: boolean;
    familyAllowed: boolean;
    membershipType: string;
    imageUrl: string | null;
    instructions: string | null;
    termsAndConditions: string | null;
    cancellationTerms: string | null;
    reportingCategory: string | null;
    categoryId: string | null;
    categoryName: string | null;
    hideFromOnlineSales: boolean;
    archivedAt: string | null;
  };
  guest: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    hasStripeCustomer: boolean;
  };
  paymentAttempts: Array<{
    id: string;
    amount: string;
    currency: string;
    status: string;
    attemptNumber: number;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: string;
  }>;
  familyLinks: Array<{
    id: string;
    guestProfileId: string;
    role: string;
    firstName: string;
    lastName: string;
  }>;
};

export async function getGuestMembershipDetail(
  actor: MembershipsActor,
  membershipId: string
): Promise<GuestMembershipDetailDto> {
  const orgId = await assertMembershipsStaff(actor);
  const id = requireId(membershipId, "membershipId");
  const row = await prisma.guestMembership.findFirst({
    where: { id, orgId },
    include: {
      plan: {
        include: {
          category: { select: { id: true, name: true } },
        },
      },
      guestProfile: true,
      homeLocation: { select: { id: true, name: true } },
      paymentAttempts: {
        orderBy: { createdAt: "desc" },
        take: 25,
      },
      familyLinks: {
        include: {
          guestProfile: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      },
    },
  });
  if (!row) throw new ForbiddenError("Guest membership not found");
  await assertGuestMembershipVisibleToActor(actor, {
    orgId: row.orgId,
    planId: row.planId,
    locationId: row.locationId,
    homeLocationId: row.homeLocationId,
  });

  const base = toDto(row);
  let remainingEntries: number | null = null;
  let visitStatus: "CURRENT" | "VISITING" | "INELIGIBLE" | null =
    (row.visitStatus as "CURRENT" | "VISITING" | "INELIGIBLE" | null) ?? null;
  try {
    const v = await verifyBenefits(row.id, row.homeLocationId, {
      orgId: row.orgId,
      lean: true,
    });
    remainingEntries = v.remainingEntries;
    visitStatus = v.visitStatus;
  } catch {
    /* soft-fail entitlements on detail */
  }
  const home = row.homeLocation;

  return {
    ...base,
    cancelReason: row.cancelReason,
    agreementSignedAt: row.agreementSignedAt?.toISOString() ?? null,
    dunningFailCount: row.dunningFailCount,
    dunningNextAt: row.dunningNextAt?.toISOString() ?? null,
    pauseStartsAt: row.pauseStartsAt?.toISOString() ?? null,
    pauseEndsAt: row.pauseEndsAt?.toISOString() ?? null,
    remainingEntries,
    visitStatus,
    homeLocation: home,
    plan: {
      id: row.plan.id,
      name: row.plan.name,
      billing: row.plan.billing,
      price: String(row.plan.price),
      currency: row.plan.currency,
      upgradeGroupKey: row.plan.upgradeGroupKey,
      pauseAllowed: row.plan.pauseAllowed,
      familyAllowed: row.plan.familyAllowed,
      membershipType: row.plan.membershipType,
      imageUrl: row.plan.imageUrl,
      instructions: row.plan.instructions,
      termsAndConditions: row.plan.termsAndConditions,
      cancellationTerms: row.plan.cancellationTerms,
      reportingCategory: row.plan.reportingCategory,
      categoryId: row.plan.categoryId,
      categoryName: row.plan.category?.name ?? null,
      hideFromOnlineSales: row.plan.hideFromOnlineSales,
      archivedAt: row.plan.archivedAt?.toISOString() ?? null,
    },
    guest: {
      id: row.guestProfile.id,
      firstName: row.guestProfile.firstName,
      lastName: row.guestProfile.lastName,
      email: row.guestProfile.email,
      phone: row.guestProfile.phone,
      hasStripeCustomer: Boolean(row.guestProfile.stripeCustomerId?.trim()),
    },
    paymentAttempts: row.paymentAttempts.map((a) => ({
      id: a.id,
      amount: String(a.amount),
      currency: a.currency,
      status: a.status,
      attemptNumber: a.attemptNumber,
      errorCode: a.errorCode,
      errorMessage: a.errorMessage,
      createdAt: a.createdAt.toISOString(),
    })),
    familyLinks: row.familyLinks.map((f) => ({
      id: f.id,
      guestProfileId: f.guestProfileId,
      role: f.role,
      firstName: f.guestProfile.firstName,
      lastName: f.guestProfile.lastName,
    })),
  };
}

/**
 * Park-lock / HQ preference gate for money mutations.
 * Same venue rules as GET detail — never rely on UI alone.
 */
export async function assertGuestMembershipMutableByActor(
  actor: MembershipsActor,
  membershipId: string
): Promise<{ id: string; orgId: string; locationId: string }> {
  const orgId = await assertMembershipsStaff(actor);
  const id = requireId(membershipId, "membershipId");
  const row = await prisma.guestMembership.findFirst({
    where: { id, orgId },
    select: {
      id: true,
      orgId: true,
      locationId: true,
      homeLocationId: true,
    },
  });
  if (!row) throw new ForbiddenError("Guest membership not found");
  await assertLocationInMembershipScope(actor, row.locationId);
  await assertLocationInMembershipScope(actor, row.homeLocationId);
  return { id: row.id, orgId: row.orgId, locationId: row.locationId };
}

/** Strip Stripe subscription/price ids from engine rows before API return. */
export function publicGuestMembershipPayload(row: {
  id: string;
  orgId: string;
  locationId: string;
  homeLocationId: string;
  guestProfileId: string;
  planId: string;
  status: GuestMembershipStatus;
  startsAt: Date | null;
  endsAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  customMembershipId: string;
  barcodeOrCode: string | null;
  photoUrl: string | null;
  source: GuestMembershipDto["source"];
  cancelAtPeriodEnd: boolean;
  cancelledAt: Date | null;
  creditBalanceMinor: number;
  visitStatus: GuestMembershipDto["visitStatus"];
  stripeSubscriptionId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}): GuestMembershipDto {
  return toDto({
    ...row,
    stripeSubscriptionId: row.stripeSubscriptionId ?? null,
  });
}
