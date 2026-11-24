/**
 * Guest online-account self-service (Feature 08 Phase 4 / Feature 21 slice).
 * AuthZ: only GuestProfiles with userId === actor.sub. Never trust body.orgId.
 */
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  MembershipBillingError,
  MembershipErrorCodes,
} from "@/lib/memberships/errors";
import {
  cancelMembership,
  renewMembership,
  upgradeMembership,
  reactivateMembership,
  updatePaymentMethod,
} from "@/lib/memberships/billingEngine";
import { verifyBenefits } from "@/lib/memberships/entitlementEngine";
import { ensureMembershipScanCodes } from "@/lib/memberships/entitlementEngine";
import { generateMembershipWalletPass } from "@/lib/memberships/walletPass";
import {
  listActiveCancelAlternatives,
  acceptCancelAlternative,
} from "@/lib/memberships/cancelAlternatives";
import { sendGuestMembershipCancelEmail } from "@/lib/memberships/mail";
import {
  loadEffectiveMembershipSettingsRow,
  MEMBERSHIP_GRACE_DAYS_WHEN_UNSET,
} from "@/lib/memberships/settings";
import {
  getAgreementForMembership,
  DEFAULT_AGREEMENT_TEXT,
  AGREEMENT_HONESTY_NOTE,
} from "@/lib/memberships/agreements";
import {
  assertOwnGuestMembership,
  linkGuestProfileToUser,
  requireLinkedGuestProfiles,
  type GuestSelfServeActor,
} from "@/lib/memberships/guestAuth";
import { assertMembershipsEnabled } from "@/lib/memberships/assert";
import { sellablePlanWhere } from "@/lib/memberships/planCatalogRules";

export type { GuestSelfServeActor };
export {
  assertOwnGuestMembership,
  linkGuestProfileToUser,
  requireLinkedGuestProfiles,
};

export async function listOwnMemberships(actor: GuestSelfServeActor) {
  // Auto-map park GuestProfiles whose email matches this customer account.
  try {
    const { syncGuestProfilesForUser } = await import(
      "@/lib/memberships/guestInvite"
    );
    await syncGuestProfilesForUser(actor.sub);
  } catch {
    /* soft — list still uses whatever is already linked */
  }

  const { guestProfileIds } = await requireLinkedGuestProfiles(actor);
  const rows = await prisma.guestMembership.findMany({
    where: { guestProfileId: { in: guestProfileIds } },
    include: {
      plan: {
        select: {
          id: true,
          name: true,
          description: true,
          imageUrl: true,
          membershipType: true,
          billing: true,
          currency: true,
          price: true,
          intervalUnit: true,
          intervalCount: true,
        },
      },
      homeLocation: { select: { id: true, name: true } },
      guestProfile: {
        select: { id: true, firstName: true, lastName: true, orgId: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // Hide rows for orgs where Memberships is Demo/Starter/storefront/unpaid —
  // detail/mutations already assert; list must not tease locked manage paths.
  const orgOk = new Map<string, boolean>();
  for (const orgId of new Set(rows.map((r) => r.orgId))) {
    try {
      await assertMembershipsEnabled(orgId);
      orgOk.set(orgId, true);
    } catch {
      orgOk.set(orgId, false);
    }
  }
  const entitled = rows.filter((r) => orgOk.get(r.orgId) === true);

  return Promise.all(
    entitled.map(async (m) => {
      let remainingEntries: number | null = null;
      let visitStatus = m.visitStatus;
      let discountPercent = 0;
      try {
        const v = await verifyBenefits(m.id, m.homeLocationId, {
          orgId: m.orgId,
          lean: true,
        });
        remainingEntries = v.remainingEntries;
        visitStatus = v.visitStatus;
        discountPercent = v.discountPercent;
      } catch {
        /* entitlements soft-fail for list */
      }
      return {
        id: m.id,
        orgId: m.orgId,
        status: m.status,
        customMembershipId: m.customMembershipId,
        cancelAtPeriodEnd: m.cancelAtPeriodEnd,
        currentPeriodEnd: m.currentPeriodEnd?.toISOString() ?? null,
        homeLocation: m.homeLocation,
        plan: m.plan,
        guestProfileId: m.guestProfileId,
        remainingEntries,
        visitStatus,
        discountPercent,
        dunningFailCount: m.dunningFailCount,
      };
    })
  );
}

export async function getOwnMembershipDetail(
  actor: GuestSelfServeActor,
  guestMembershipId: string,
  actingLocationId?: string | null
) {
  const member = await assertOwnGuestMembership(actor, guestMembershipId);
  let locationId = member.homeLocationId;
  if (actingLocationId && isValidId(actingLocationId)) {
    const venue = await prisma.venueLocation.findFirst({
      where: { id: actingLocationId, orgId: member.orgId },
      select: { id: true },
    });
    if (!venue) {
      throw new ForbiddenError("Venue not found for this membership");
    }
    locationId = venue.id;
  }
  const verify = await verifyBenefits(member.id, locationId, {
    orgId: member.orgId,
    lean: true,
  });
  const locSettings = await loadEffectiveMembershipSettingsRow(
    member.orgId,
    locationId
  );

  const alternatives =
    locSettings?.cancelAlternativesEnabled !== false
      ? await listActiveCancelAlternatives(member.orgId, locationId)
      : [];

  const home = await prisma.venueLocation.findFirst({
    where: { id: member.homeLocationId },
    select: { id: true, name: true },
  });

  const agreement = await getAgreementForMembership(member.orgId, member.id);

  const [paymentAttempts, activity] = await Promise.all([
    prisma.membershipPaymentAttempt.findMany({
      where: { orgId: member.orgId, guestMembershipId: member.id },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        attemptNumber: true,
        errorCode: true,
        errorMessage: true,
        createdAt: true,
      },
    }),
    prisma.membershipUsageEvent.findMany({
      where: { orgId: member.orgId, guestMembershipId: member.id },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        id: true,
        kind: true,
        qty: true,
        remainingAfter: true,
        source: true,
        createdAt: true,
        location: { select: { id: true, name: true } },
      },
    }),
  ]);

  // Upgrade candidates in same upgradeGroupKey (price >= current) — guest-safe.
  // Only for active memberships that are not already scheduled to end.
  const upgradePlans =
    member.plan.upgradeGroupKey &&
    member.status === "active" &&
    !member.cancelAtPeriodEnd
      ? (
          await prisma.membershipPlan.findMany({
            where: {
              orgId: member.orgId,
              upgradeGroupKey: member.plan.upgradeGroupKey,
              id: { not: member.planId },
              price: { gte: member.plan.price },
              ...sellablePlanWhere(),
            },
            select: {
              id: true,
              name: true,
              price: true,
              currency: true,
              billing: true,
              imageUrl: true,
              membershipType: true,
              description: true,
            },
            orderBy: { price: "asc" },
            take: 20,
          })
        ).map((p) => ({
          id: p.id,
          name: p.name,
          price: Number(p.price),
          currency: p.currency,
          billing: p.billing,
          imageUrl: p.imageUrl,
          membershipType: p.membershipType,
          description: p.description,
        }))
      : [];

  return {
    membership: {
      id: member.id,
      orgId: member.orgId,
      status: member.status,
      customMembershipId: member.customMembershipId,
      barcodeOrCode: member.barcodeOrCode,
      homeLocationId: member.homeLocationId,
      locationId: member.locationId,
      cancelAtPeriodEnd: member.cancelAtPeriodEnd,
      cancelReason: member.cancelReason,
      currentPeriodStart: member.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: member.currentPeriodEnd?.toISOString() ?? null,
      startsAt: member.startsAt?.toISOString() ?? null,
      endsAt: member.endsAt?.toISOString() ?? null,
      agreementSignedAt: member.agreementSignedAt?.toISOString() ?? null,
      /** True when a live guest Stripe Subscription is bound (auto-invoices). */
      hasLiveStripeSubscription: Boolean(member.stripeSubscriptionId),
      plan: {
        id: member.plan.id,
        name: member.plan.name,
        description: member.plan.description,
        detailedDescription: member.plan.detailedDescription,
        imageUrl: member.plan.imageUrl,
        membershipType: member.plan.membershipType,
        billing: member.plan.billing,
        currency: member.plan.currency,
        price: Number(member.plan.price),
        upgradeGroupKey: member.plan.upgradeGroupKey,
        entitlements: member.plan.entitlements,
        pauseAllowed: member.plan.pauseAllowed,
        familyAllowed: member.plan.familyAllowed,
        instructions: member.plan.instructions,
        termsAndConditions: member.plan.termsAndConditions,
        cancellationTerms: member.plan.cancellationTerms,
        customRedemptionDescription: member.plan.customRedemptionDescription,
      },
      guestProfile: member.guestProfile,
      homeLocation: home
        ? { id: home.id, name: home.name }
        : { id: member.homeLocationId, name: null },
    },
    verify,
    agreement: agreement
      ? {
          id: agreement.id,
          status: agreement.status,
          storageRef: agreement.storageRef ?? DEFAULT_AGREEMENT_TEXT,
          honestyNote: agreement.honestyNote,
          signedAt: agreement.signedAt,
        }
      : needsAgreementFallback(member)
        ? {
            id: null,
            status: "pending",
            storageRef: DEFAULT_AGREEMENT_TEXT,
            honestyNote: AGREEMENT_HONESTY_NOTE,
            signedAt: null,
          }
        : null,
    clickToCancelEnabled: locSettings?.clickToCancelEnabled !== false,
    cancelAlternativesEnabled: locSettings?.cancelAlternativesEnabled !== false,
    alternatives,
    settingsGraceDays: locSettings?.graceDays ?? MEMBERSHIP_GRACE_DAYS_WHEN_UNSET,
    upgradePlans,
    paymentAttempts: paymentAttempts.map((a) => ({
      id: a.id,
      amount: Number(a.amount),
      currency: a.currency,
      status: a.status,
      attemptNumber: a.attemptNumber,
      errorCode: a.errorCode,
      errorMessage: a.errorMessage,
      createdAt: a.createdAt.toISOString(),
    })),
    activity: activity.map((e) => ({
      id: e.id,
      kind: e.kind,
      qty: e.qty,
      remainingAfter: e.remainingAfter,
      source: e.source,
      locationName: e.location?.name ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

function needsAgreementFallback(member: {
  status: string;
  agreementSignedAt: Date | null;
}): boolean {
  return member.status === "pending" && !member.agreementSignedAt;
}

export async function selfServeCancel(input: {
  actor: GuestSelfServeActor;
  guestMembershipId: string;
  when: "immediate" | "end_of_period";
  reason?: string;
  confirm: boolean;
  declineAlternatives?: boolean;
  alternativeId?: string | null;
  idempotencyKey: string;
}) {
  if (!input.confirm) {
    throw new MembershipBillingError(
      MembershipErrorCodes.SELF_SERVE_DENIED,
      "Confirmation is required to cancel"
    );
  }
  const member = await assertOwnGuestMembership(
    input.actor,
    input.guestMembershipId
  );

  const locSettings = await loadEffectiveMembershipSettingsRow(
    member.orgId,
    member.homeLocationId
  );

  if (locSettings?.clickToCancelEnabled === false) {
    throw new MembershipBillingError(
      MembershipErrorCodes.CLICK_TO_CANCEL_DISABLED,
      "Online cancel is disabled for this park — contact the venue"
    );
  }

  if (
    locSettings?.cancelAlternativesEnabled !== false &&
    !input.declineAlternatives &&
    !input.alternativeId
  ) {
    const alts = await listActiveCancelAlternatives(
      member.orgId,
      member.homeLocationId
    );
    if (alts.length > 0) {
      return {
        requiresAlternatives: true as const,
        alternatives: alts,
        membershipId: member.id,
      };
    }
  }

  if (input.alternativeId) {
    const applied = await acceptCancelAlternative({
      orgId: member.orgId,
      guestMembershipId: member.id,
      alternativeId: input.alternativeId,
      actorUserId: input.actor.sub,
      idempotencyKey: input.idempotencyKey,
    });
    return { requiresAlternatives: false as const, alternativeApplied: applied };
  }

  if (member.cancelAtPeriodEnd && input.when === "end_of_period") {
    throw new MembershipBillingError(
      MembershipErrorCodes.CANCEL_ALREADY_SCHEDULED,
      "End-of-period cancel is already scheduled"
    );
  }

  const result = await cancelMembership({
    orgId: member.orgId,
    membershipId: member.id,
    actorUserId: input.actor.sub,
    when: input.when,
    reason: input.reason?.slice(0, 500) || "Guest self-serve cancel",
  });

  if (member.guestProfile.email) {
    void sendGuestMembershipCancelEmail({
      to: member.guestProfile.email,
      guestName: member.guestProfile.firstName,
      planName: member.plan.name,
      when: input.when,
      accessEndsAt:
        input.when === "end_of_period"
          ? member.currentPeriodEnd
          : new Date(),
      cancellationTerms: member.plan.cancellationTerms,
    }).catch((err) =>
      console.warn("[memberships] cancel confirm email failed", err)
    );
  }

  logStaffActivityEntry(
    { sub: input.actor.sub, orgId: member.orgId },
    {
      action: "memberships.self_serve.cancel",
      entityType: "GuestMembership",
      entityId: member.id,
      description: `Guest click-to-cancel (${input.when})`,
      metadata: { when: input.when, reason: input.reason ?? null },
    }
  );

  return {
    requiresAlternatives: false as const,
    membership: result.membership,
    note: result.note,
  };
}

export async function selfServeRenew(input: {
  actor: GuestSelfServeActor;
  guestMembershipId: string;
  idempotencyKey: string;
}) {
  const member = await assertOwnGuestMembership(
    input.actor,
    input.guestMembershipId
  );
  return renewMembership({
    orgId: member.orgId,
    membershipId: member.id,
    actorUserId: input.actor.sub,
    paymentMethod: "stripe",
    idempotencyKey: input.idempotencyKey,
  });
}

export async function selfServeUpgrade(input: {
  actor: GuestSelfServeActor;
  guestMembershipId: string;
  newPlanId: string;
  idempotencyKey: string;
}) {
  const member = await assertOwnGuestMembership(
    input.actor,
    input.guestMembershipId
  );
  return upgradeMembership({
    orgId: member.orgId,
    membershipId: member.id,
    newPlanId: input.newPlanId,
    actorUserId: input.actor.sub,
    paymentMethod: "stripe",
    idempotencyKey: input.idempotencyKey,
    sellChannel: "online",
  });
}

export async function selfServeReactivate(input: {
  actor: GuestSelfServeActor;
  guestMembershipId: string;
  idempotencyKey: string;
}) {
  const member = await assertOwnGuestMembership(
    input.actor,
    input.guestMembershipId
  );
  return reactivateMembership({
    orgId: member.orgId,
    membershipId: member.id,
    actorUserId: input.actor.sub,
    paymentMethod: "stripe",
    idempotencyKey: input.idempotencyKey,
  });
}

export async function selfServeUpdateCard(input: {
  actor: GuestSelfServeActor;
  guestMembershipId: string;
}) {
  const member = await assertOwnGuestMembership(
    input.actor,
    input.guestMembershipId
  );
  return updatePaymentMethod({
    orgId: member.orgId,
    membershipId: member.id,
    actorUserId: input.actor.sub,
  });
}

export async function selfServeCard(
  actor: GuestSelfServeActor,
  guestMembershipId: string
) {
  const member = await assertOwnGuestMembership(actor, guestMembershipId);
  const ensured = await ensureMembershipScanCodes(member);
  const company = await prisma.companyProfile.findFirst({
    where: { orgId: member.orgId },
    select: { tradingName: true, legalName: true, logoUrl: true },
  });
  const home = await prisma.venueLocation.findFirst({
    where: { id: member.homeLocationId },
    select: { name: true },
  });
  const card = {
    guestMembershipId: ensured.id,
    customMembershipId: ensured.customMembershipId,
    barcodeOrCode: ensured.barcodeOrCode,
    qrPayload: ensured.qrPayload,
    memberName:
      `${member.guestProfile.firstName} ${member.guestProfile.lastName}`.trim(),
    photoUrl: member.photoUrl,
    planName: member.plan.name,
    status: member.status,
    homeLocationName: home?.name ?? null,
    orgBrand: {
      companyName: company?.tradingName || company?.legalName || null,
      logoUrl: company?.logoUrl ?? null,
    },
  };
  const wallet = await generateMembershipWalletPass({
    orgId: member.orgId,
    guestMembershipId: member.id,
    downloadBasePath: `/api/me/memberships/${member.id}/wallet`,
  });
  return { card, wallet };
}
