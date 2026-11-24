/**
 * Guest park Memberships billing & lifecycle SSOT (Feature 08 Phase 2).
 * See docs/memberships-complete-spec.md Phase 2.
 *
 * Refunds: Phase 2 does not auto-refund Stripe charges on cancel ? cancel
 * stops future billing; creditBalanceMinor holds staff-applied credits only.
 * Do not invent silent ledger reversals.
 */
import { Prisma } from "@prisma/client";
import type {
  GuestMembership,
  MembershipPlan,
  MembershipSellChannel,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireId, isValidId } from "@/lib/ids";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import { assertMembershipsEnabled } from "@/lib/memberships/assert";
import {
  MembershipBillingError,
  MembershipErrorCodes,
} from "@/lib/memberships/errors";
import {
  loadEffectiveMembershipSettingsRow,
  MEMBERSHIP_GRACE_DAYS_WHEN_UNSET,
} from "@/lib/memberships/settings";
import { assertMembershipTransition } from "@/lib/memberships/statusMachine";
import { addMembershipCycle } from "@/lib/memberships/cycles";
import {
  assertPlanSellable,
  membershipPeriodBounds,
  membershipSetsEndsAt,
} from "@/lib/memberships/planCatalogRules";
import {
  computeProration,
  majorToMinor,
  minorToMajor,
} from "@/lib/memberships/proration";
import {
  enqueueSource,
  flushAccountingQueueSoon,
} from "@/lib/accounting/enqueueHooks";
import {
  cancelGuestStripeSubscription,
  changeGuestStripeSubscriptionPrice,
  createGuestOneTimeInvoiceItem,
  createGuestSetupIntent,
  createGuestStripeSubscription,
  ensureGuestStripeCustomer,
  isStripeConfigured,
  pauseGuestStripeSubscription,
  resumeGuestStripeSubscription,
} from "@/lib/memberships/stripeGuest";
import type { MembershipPlanEntitlements } from "@/lib/memberships/types";
import {
  membershipRequiresAgreement,
  createDraftAgreement,
} from "@/lib/memberships/agreements";
import { resolvePostPaymentMembershipStatus } from "@/lib/memberships/activationGates";
import { markMembershipPastDue } from "@/lib/memberships/dunning";

function snapshotPlanEntitlements(plan: MembershipPlan): MembershipPlanEntitlements {
  const raw = plan.entitlements;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const e = raw as MembershipPlanEntitlements;
  return {
    entriesPerPeriod: e.entriesPerPeriod ?? null,
    discountPercent: e.discountPercent ?? null,
    guestCount: e.guestCount ?? null,
    perkFlags: Array.isArray(e.perkFlags)
      ? e.perkFlags.filter((x): x is string => typeof x === "string")
      : [],
    freeProductRefs: Array.isArray(e.freeProductRefs)
      ? e.freeProductRefs.filter((x): x is string => typeof x === "string")
      : [],
  };
}

/**
 * Heal side-effects after an idempotent sell replay: family links,
 * payment ledger (membership may have committed before payment write),
 * and agreement draft (membership may have committed before draft create).
 */
async function healSellIdempotentReplay(input: {
  orgId: string;
  membership: GuestMembership;
  familyIds: string[];
  actorUserId: string;
  sellIdempotencyKey: string;
  paymentMethod: SellPaymentMethod;
  collectedAmount?: number;
}): Promise<GuestMembership> {
  const {
    orgId,
    familyIds,
    actorUserId,
    sellIdempotencyKey,
    paymentMethod,
    collectedAmount,
  } = input;
  let membership = input.membership;
  if (familyIds.length > 0) {
    await prisma.membershipFamilyLink.createMany({
      data: familyIds.map((fid) => ({
        orgId,
        guestMembershipId: membership.id,
        guestProfileId: fid,
        role: "dependent" as const,
      })),
      skipDuplicates: true,
    });
  }

  const payKey = `${sellIdempotencyKey}:pay`;
  const payRow = await prisma.membershipPaymentAttempt.findFirst({
    where: { orgId, idempotencyKey: payKey },
  });
  if (!payRow) {
    const plan = await prisma.membershipPlan.findFirst({
      where: { id: membership.planId, orgId },
      select: { price: true, currency: true },
    });
    if (plan) {
      if (paymentMethod === "collected") {
        const amount =
          collectedAmount != null && Number.isFinite(collectedAmount)
            ? Number(collectedAmount)
            : Number(plan.price);
        await createPaymentAttempt({
          orgId,
          guestMembershipId: membership.id,
          amountMajor: amount,
          currency: plan.currency,
          status: "succeeded",
          idempotencyKey: payKey,
        });
        const next = await resolvePostPaymentMembershipStatus(membership);
        if (next !== membership.status) {
          assertMembershipTransition(membership.status, next);
        }
        membership = await prisma.guestMembership.update({
          where: { id: membership.id },
          data: {
            status: next,
            dunningFailCount: 0,
            dunningNextAt: null,
          },
        });
      } else {
        const settled = await prisma.membershipPaymentAttempt.findFirst({
          where: {
            orgId,
            guestMembershipId: membership.id,
            status: "succeeded",
          },
          select: { id: true },
        });
        // Fail closed: never leave an "active" membership with no payment ledger.
        if (!settled && membership.status === "active") {
          assertMembershipTransition("active", "pending");
          membership = await prisma.guestMembership.update({
            where: { id: membership.id },
            data: { status: "pending" },
          });
        }
        await createPaymentAttempt({
          orgId,
          guestMembershipId: membership.id,
          amountMajor: Number(plan.price),
          currency: plan.currency,
          status: "pending",
          idempotencyKey: payKey,
          errorCode: MembershipErrorCodes.IDEMPOTENCY_CONFLICT,
          errorMessage:
            "Healed missing sell payment attempt on idempotent replay",
        });
      }
    }
  }

  if (!membership.agreementSignedAt) {
    const needsAgreement = await membershipRequiresAgreement({
      orgId,
      planId: membership.planId,
      locationId: membership.homeLocationId || membership.locationId,
    });
    if (needsAgreement) {
      await createDraftAgreement({
        orgId,
        guestMembershipId: membership.id,
        actorUserId,
        notifyGuest: false,
      });
    }
  }
  return membership;
}

/**
 * After plan switch, drop dependents that exceed the new guestCount cap
 * (or clear all links when the new plan disallows family).
 */
async function trimFamilyLinksToPlanCap(input: {
  orgId: string;
  guestMembershipId: string;
  plan: MembershipPlan;
}): Promise<void> {
  const { orgId, guestMembershipId, plan } = input;
  if (!plan.familyAllowed) {
    await prisma.membershipFamilyLink.deleteMany({
      where: { orgId, guestMembershipId },
    });
    return;
  }
  const snap = snapshotPlanEntitlements(plan);
  const cap =
    typeof snap.guestCount === "number" && Number.isFinite(snap.guestCount)
      ? Math.max(1, Math.floor(snap.guestCount))
      : null;
  if (cap == null) return;
  const maxDependents = Math.max(0, cap - 1);
  const links = await prisma.membershipFamilyLink.findMany({
    where: { orgId, guestMembershipId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (links.length <= maxDependents) return;
  const dropIds = links.slice(maxDependents).map((l) => l.id);
  await prisma.membershipFamilyLink.deleteMany({
    where: { id: { in: dropIds }, orgId },
  });
}

function auditMembership(
  actorUserId: string,
  orgId: string,
  input: Parameters<typeof logStaffActivityEntry>[1]
): void {
  logStaffActivityEntry({ sub: actorUserId, orgId }, input);
}

/** Fail-closed Demo / Starter / storefront / unpaid before any money mutation. */
async function assertBillingOrg(orgId: string): Promise<string> {
  const id = requireId(orgId, "orgId");
  await assertMembershipsEnabled(id);
  return id;
}

export type SellPaymentMethod =
  | "stripe"
  | "collected"
  | "pending"
  | "credit";

const ALLOWED_SELL_PAYMENT = new Set<SellPaymentMethod>([
  "stripe",
  "collected",
  "pending",
  "credit",
]);

function requireSellPaymentMethod(
  raw: string,
  allowed: readonly SellPaymentMethod[]
): SellPaymentMethod {
  const method = String(raw || "").trim() as SellPaymentMethod;
  if (!ALLOWED_SELL_PAYMENT.has(method) || !allowed.includes(method)) {
    throw new MembershipBillingError(
      MembershipErrorCodes.AMOUNT_REQUIRED,
      `paymentMethod must be one of: ${allowed.join("|")}`
    );
  }
  return method;
}

export type SellMembershipInput = {
  orgId: string;
  locationId: string;
  homeLocationId: string;
  guestProfileId: string;
  planId: string;
  familyMemberIds?: string[];
  paymentMethod: SellPaymentMethod;
  collectedAmount?: number;
  actorUserId: string;
  idempotencyKey: string;
  source: MembershipSellChannel;
  /** Allow sell when Stripe required but missing - force pending. */
  allowPendingWithoutStripe?: boolean;
};

export type MembershipLifecycleResult = {
  membership: GuestMembership;
  paymentAttemptId?: string;
  stripeConfigured: boolean;
  note?: string;
};

function planPriceMajor(plan: { price: Prisma.Decimal | number }): number {
  return Number(plan.price);
}

function generateCustomMembershipId(): string {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `GM-${Date.now().toString(36).toUpperCase()}-${rand}`;
}

async function loadSettingsGraceDays(
  orgId: string,
  locationId: string
): Promise<{ dunningEnabled: boolean; graceDays: number; allowPause: boolean }> {
  const row = await loadEffectiveMembershipSettingsRow(orgId, locationId);
  return {
    dunningEnabled: row?.dunningEnabled ?? true,
    graceDays: row?.graceDays ?? MEMBERSHIP_GRACE_DAYS_WHEN_UNSET,
    allowPause: row?.allowPause ?? true,
  };
}

async function requirePlanForSell(
  orgId: string,
  planId: string,
  source: MembershipSellChannel = "admin"
): Promise<MembershipPlan> {
  const plan = await prisma.membershipPlan.findFirst({
    where: { id: requireId(planId, "planId"), orgId },
  });
  if (!plan) {
    throw new MembershipBillingError(
      MembershipErrorCodes.PLAN_NOT_FOUND,
      "Membership plan not found"
    );
  }
  assertPlanSellable(plan, source);
  return plan;
}

async function requireGuest(orgId: string, guestProfileId: string) {
  const guest = await prisma.guestProfile.findFirst({
    where: { id: requireId(guestProfileId, "guestProfileId"), orgId },
  });
  if (!guest) {
    throw new MembershipBillingError(
      MembershipErrorCodes.GUEST_NOT_FOUND,
      "Guest profile not found"
    );
  }
  if (guest.bannedAt) {
    throw new MembershipBillingError(
      MembershipErrorCodes.GUEST_NOT_FOUND,
      "Guest is banned"
    );
  }
  return guest;
}

async function requireVenuePair(
  orgId: string,
  locationId: string,
  homeLocationId: string
) {
  const venues = await prisma.venueLocation.findMany({
    where: {
      orgId,
      id: { in: [locationId, homeLocationId] },
      status: { not: "archived" },
    },
    select: { id: true },
  });
  const ids = new Set(venues.map((v) => v.id));
  if (!ids.has(locationId) || !ids.has(homeLocationId)) {
    throw new MembershipBillingError(
      MembershipErrorCodes.VENUE_INVALID,
      "Sell or home venue is missing or archived"
    );
  }
}

function periodBounds(
  plan: MembershipPlan,
  from: Date
): { start: Date; end: Date | null } {
  return membershipPeriodBounds(plan, from);
}

async function createPaymentAttempt(input: {
  orgId: string;
  guestMembershipId: string;
  amountMajor: number;
  currency: string;
  status: "pending" | "succeeded" | "failed" | "skipped";
  attemptNumber?: number;
  idempotencyKey?: string;
  stripeInvoiceId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  /** Park stamp + Connect settlement snapshot (Step 3). */
  locationId?: string | null;
  connectedAccountId?: string | null;
  platformFeeMinor?: number | null;
  tx?: Prisma.TransactionClient;
}): Promise<string> {
  if (!Number.isFinite(input.amountMajor)) {
    throw new MembershipBillingError(
      MembershipErrorCodes.AMOUNT_REQUIRED,
      "Payment amount must be a finite number"
    );
  }
  const db = input.tx ?? prisma;
  if (input.idempotencyKey) {
    const existing = await db.membershipPaymentAttempt.findFirst({
      where: { orgId: input.orgId, idempotencyKey: input.idempotencyKey },
    });
    if (existing) return existing.id;
  }
  try {
    const row = await db.membershipPaymentAttempt.create({
      data: {
        orgId: input.orgId,
        guestMembershipId: input.guestMembershipId,
        amount: new Prisma.Decimal(input.amountMajor.toFixed(2)),
        currency: input.currency,
        status: input.status,
        attemptNumber: input.attemptNumber ?? 1,
        idempotencyKey: input.idempotencyKey ?? null,
        stripeInvoiceId: input.stripeInvoiceId ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        locationId: input.locationId?.trim() || null,
        connectedAccountId: input.connectedAccountId?.trim() || null,
        platformFeeMinor:
          input.platformFeeMinor != null && Number.isFinite(input.platformFeeMinor)
            ? Math.trunc(input.platformFeeMinor)
            : null,
      },
    });
    if (input.status === "succeeded") {
      await enqueueSource(db, {
        orgId: input.orgId,
        locationId: input.locationId?.trim() || null,
        sourceType: "membership_payment",
        sourceId: row.id,
        sourceEvent: "succeeded",
        eventAt: row.createdAt,
      });
      if (!input.tx) flushAccountingQueueSoon(input.orgId);
    }
    return row.id;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      input.idempotencyKey
    ) {
      const again = await db.membershipPaymentAttempt.findFirst({
        where: { orgId: input.orgId, idempotencyKey: input.idempotencyKey },
      });
      if (again) return again.id;
    }
    throw err;
  }
}

const TARGET_PLAN_META_PREFIX = "targetPlanId:";

function targetPlanMeta(planId: string): string {
  return `${TARGET_PLAN_META_PREFIX}${planId}`;
}

function parseTargetPlanMeta(
  errorMessage: string | null | undefined
): string | null {
  if (!errorMessage?.startsWith(TARGET_PLAN_META_PREFIX)) return null;
  const id = errorMessage.slice(TARGET_PLAN_META_PREFIX.length).trim();
  return id || null;
}

/**
 * Serialize membership money finalizers (renew/upgrade/downgrade) so concurrent
 * same-key retries cannot double-advance period or double-credit.
 */
async function withMembershipRowLock<T>(
  orgId: string,
  membershipId: string,
  fn: (
    tx: Prisma.TransactionClient,
    locked: GuestMembership & { plan: MembershipPlan }
  ) => Promise<T>
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        SELECT 1 FROM guest_memberships
        WHERE id = ${membershipId} AND "orgId" = ${orgId}
        FOR UPDATE`;
      const locked = await tx.guestMembership.findFirst({
        where: { id: membershipId, orgId },
        include: { plan: true },
      });
      if (!locked) {
        throw new MembershipBillingError(
          MembershipErrorCodes.MEMBER_NOT_FOUND,
          "Guest membership not found"
        );
      }
      return fn(tx, locked);
    },
    { maxWait: 10_000, timeout: 20_000 }
  );
}

/**
 * Sell a new guest membership (recurring or fixed).
 * Stripe path: creates Customer + Subscription when STRIPE_SECRET_KEY present.
 * Without Stripe: `collected` activates with amount-collected attempt;
 * `pending` / unpaid `stripe` request stays pending (never fake invoice success).
 */
export async function sellMembership(
  input: SellMembershipInput
): Promise<MembershipLifecycleResult> {
  const orgId = await assertBillingOrg(input.orgId);
  const locationId = requireId(input.locationId, "locationId");
  const homeLocationId = requireId(input.homeLocationId, "homeLocationId");
  const paymentMethod = requireSellPaymentMethod(input.paymentMethod, [
    "stripe",
    "collected",
    "pending",
    "credit",
  ]);
  const idempotencyKey = String(input.idempotencyKey || "").trim();
  if (!idempotencyKey || idempotencyKey.length > 120) {
    throw new MembershipBillingError(
      MembershipErrorCodes.IDEMPOTENCY_CONFLICT,
      "idempotencyKey is required (max 120 chars)"
    );
  }

  const existing = await prisma.guestMembership.findFirst({
    where: { orgId, sellIdempotencyKey: idempotencyKey },
  });
  if (existing) {
    // Heal family links if a prior attempt committed the membership but failed
    // before createMany (partial sell). skipDuplicates keeps replay safe.
    // Also heal agreement draft if sell required one but crashed before create.
    const replayFamilyIds = (input.familyMemberIds ?? []).filter(
      (id) => isValidId(id) && id !== existing.guestProfileId
    );
    const healed = await healSellIdempotentReplay({
      orgId,
      membership: existing,
      familyIds: replayFamilyIds,
      actorUserId: input.actorUserId,
      sellIdempotencyKey: idempotencyKey,
      paymentMethod,
      collectedAmount: input.collectedAmount,
    });
    return {
      membership: healed,
      stripeConfigured: isStripeConfigured(),
      note: "idempotent_replay",
    };
  }

  await requireVenuePair(orgId, locationId, homeLocationId);
  const plan = await requirePlanForSell(orgId, input.planId, input.source);
  const guest = await requireGuest(orgId, input.guestProfileId);
  const priceMajor = planPriceMajor(plan);

  // New memberships start with 0 credit ? paying by credit would always fail
  // after create and leave cancelled orphan rows. Apply credit on an existing
  // membership, then renew/upgrade with collected/stripe.
  if (paymentMethod === "credit") {
    throw new MembershipBillingError(
      MembershipErrorCodes.AMOUNT_REQUIRED,
      "Cannot sell a new membership with paymentMethod credit ? apply credit on an existing membership first, or use collected/pending/stripe"
    );
  }

  if (paymentMethod === "collected") {
    if (
      input.collectedAmount == null ||
      !Number.isFinite(input.collectedAmount) ||
      input.collectedAmount < 0
    ) {
      throw new MembershipBillingError(
        MembershipErrorCodes.AMOUNT_REQUIRED,
        "collectedAmount is required for collected payment"
      );
    }
  }

  const familyIds = (input.familyMemberIds ?? []).filter(
    (id) => isValidId(id) && id !== guest.id
  );
  if (familyIds.length > 0 && !plan.familyAllowed) {
    throw new MembershipBillingError(
      MembershipErrorCodes.FAMILY_NOT_ALLOWED,
      "Plan does not allow family members"
    );
  }
  const planEntSnapshot = snapshotPlanEntitlements(plan);
  const guestCountCap =
    typeof planEntSnapshot.guestCount === "number" &&
    Number.isFinite(planEntSnapshot.guestCount)
      ? Math.max(1, Math.floor(planEntSnapshot.guestCount))
      : null;
  if (guestCountCap != null && familyIds.length + 1 > guestCountCap) {
    throw new MembershipBillingError(
      MembershipErrorCodes.FAMILY_NOT_ALLOWED,
      `Family size exceeds plan guestCount (${guestCountCap} including primary)`
    );
  }
  if (familyIds.length > 0) {
    const found = await prisma.guestProfile.count({
      where: { orgId, id: { in: familyIds } },
    });
    if (found !== familyIds.length) {
      throw new MembershipBillingError(
        MembershipErrorCodes.GUEST_NOT_FOUND,
        "One or more family guests not found"
      );
    }
  }

  const now = new Date();
  const { start, end } = periodBounds(plan, now);
  const stripeOn = isStripeConfigured();
  let status: GuestMembership["status"] = "pending";
  let note: string | undefined;

  if (paymentMethod === "collected") {
    status = "active";
  } else if (paymentMethod === "pending") {
    status = "pending";
    note = "Awaiting payment collection";
  } else if (paymentMethod === "stripe") {
    if (!stripeOn) {
      if (input.allowPendingWithoutStripe) {
        status = "pending";
        note = "STRIPE_NOT_CONFIGURED - membership left pending";
      } else {
        throw new MembershipBillingError(
          MembershipErrorCodes.STRIPE_NOT_CONFIGURED,
          "STRIPE_SECRET_KEY is not configured - use paymentMethod collected or pending"
        );
      }
    } else {
      // Activate after Stripe sub create succeeds below; start pending.
      status = "pending";
    }
  }

  const needsAgreement = await membershipRequiresAgreement({
    orgId,
    planId: plan.id,
    // Same park key as activationGates / recover (home, then sell location).
    locationId: homeLocationId || locationId,
  });
  if (needsAgreement && status === "active") {
    status = "pending";
    note = "AGREEMENT_REQUIRED — pending until agreement is signed";
  }

  let membership: GuestMembership;
  let createAttempts = 0;
  for (;;) {
    createAttempts += 1;
    try {
      // Create membership + family links atomically so a failed family insert
      // cannot leave an orphan that idempotent replay would return forever.
      membership = await prisma.$transaction(async (tx) => {
        const row = await tx.guestMembership.create({
          data: {
            orgId,
            locationId,
            homeLocationId,
            guestProfileId: guest.id,
            planId: plan.id,
            status,
            startsAt: start,
            endsAt: membershipSetsEndsAt(plan) ? end : null,
            currentPeriodStart: start,
            currentPeriodEnd: end,
            customMembershipId: generateCustomMembershipId(),
            familyEntitlements: planEntSnapshot as Prisma.InputJsonValue,
            sellIdempotencyKey: idempotencyKey,
            source: input.source,
            createdFromSaleId:
              input.source === "pos" ? idempotencyKey.slice(0, 64) : null,
          },
        });
        if (familyIds.length > 0) {
          await tx.membershipFamilyLink.createMany({
            data: familyIds.map((fid) => ({
              orgId,
              guestMembershipId: row.id,
              guestProfileId: fid,
              role: "dependent" as const,
            })),
            skipDuplicates: true,
          });
        }
        return row;
      });
      break;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const again = await prisma.guestMembership.findFirst({
          where: { orgId, sellIdempotencyKey: idempotencyKey },
        });
        if (again) {
          const healed = await healSellIdempotentReplay({
            orgId,
            membership: again,
            familyIds,
            actorUserId: input.actorUserId,
            sellIdempotencyKey: idempotencyKey,
            paymentMethod,
            collectedAmount: input.collectedAmount,
          });
          return {
            membership: healed,
            stripeConfigured: stripeOn,
            note: "idempotent_replay",
          };
        }
        // Rare customMembershipId collision ? regenerate and retry.
        if (createAttempts < 4) continue;
        throw new MembershipBillingError(
          MembershipErrorCodes.CUSTOM_ID_CONFLICT,
          "Could not allocate a unique customMembershipId"
        );
      }
      throw err;
    }
  }

  let paymentAttemptId: string | undefined;
  let stripeSubscriptionId: string | null = null;
  let stripePriceId: string | null = null;

  if (paymentMethod === "collected") {
    paymentAttemptId = await createPaymentAttempt({
      orgId,
      guestMembershipId: membership.id,
      amountMajor: Number(input.collectedAmount),
      currency: plan.currency,
      status: "succeeded",
      idempotencyKey: `${idempotencyKey}:pay`,
    });
  } else if (paymentMethod === "pending") {
    paymentAttemptId = await createPaymentAttempt({
      orgId,
      guestMembershipId: membership.id,
      amountMajor: priceMajor,
      currency: plan.currency,
      status: "pending",
      idempotencyKey: `${idempotencyKey}:pay`,
    });
  } else if (paymentMethod === "stripe" && stripeOn) {
    try {
      const customerId = await ensureGuestStripeCustomer({
        guestProfileId: guest.id,
        email: guest.email,
        name: `${guest.firstName} ${guest.lastName}`.trim(),
        existingCustomerId: guest.stripeCustomerId,
        orgId,
      });
      if (!guest.stripeCustomerId) {
        await prisma.guestProfile.update({
          where: { id: guest.id },
          data: { stripeCustomerId: customerId },
        });
      }
      if (plan.billing === "recurring") {
        const count = plan.intervalCount ?? 1;
        const unit = plan.intervalUnit ?? "month";
        const sub = await createGuestStripeSubscription({
          customerId,
          orgId,
          guestMembershipId: membership.id,
          guestProfileId: guest.id,
          planId: plan.id,
          locationId: plan.locationId,
          currency: plan.currency,
          priceMajor,
          intervalCount: count,
          intervalUnit: unit,
          idempotencyKey,
        });
        stripeSubscriptionId = sub.subscriptionId;
        stripePriceId = sub.priceId;
        // incomplete until first payment - stay pending unless active-like
        const activeLike =
          sub.status === "active" ||
          sub.status === "trialing" ||
          sub.status === "paid";
        const nextStatus =
          activeLike && !needsAgreement ? "active" : "pending";
        membership = await prisma.guestMembership.update({
          where: { id: membership.id },
          data: {
            stripeSubscriptionId,
            stripePriceId,
            status: nextStatus,
          },
        });
        paymentAttemptId = await createPaymentAttempt({
          orgId,
          guestMembershipId: membership.id,
          amountMajor: priceMajor,
          currency: plan.currency,
          status: activeLike ? "succeeded" : "pending",
          idempotencyKey: `${idempotencyKey}:pay`,
          locationId: plan.locationId,
          connectedAccountId: sub.connectedAccountId,
          platformFeeMinor: sub.platformFeeMinor,
        });
        note = needsAgreement
          ? "AGREEMENT_REQUIRED — pending until agreement is signed"
          : activeLike
            ? undefined
            : "Stripe subscription created; awaiting first invoice payment";
      } else {
        // Fixed-term one-shot charge via invoice item
        const inv = await createGuestOneTimeInvoiceItem({
          customerId,
          currency: plan.currency,
          amountMajor: priceMajor,
          description: `Membership ${plan.name}`,
          orgId,
          guestMembershipId: membership.id,
          planId: plan.id,
          locationId: plan.locationId,
        });
        const toStatus = !inv.paid
          ? ("past_due" as const)
          : needsAgreement
            ? ("pending" as const)
            : ("active" as const);
        if (toStatus === "past_due") {
          paymentAttemptId = await createPaymentAttempt({
            orgId,
            guestMembershipId: membership.id,
            amountMajor: priceMajor,
            currency: plan.currency,
            status: "failed",
            stripeInvoiceId: inv.invoiceId || null,
            idempotencyKey: `${idempotencyKey}:pay`,
            errorCode: MembershipErrorCodes.PAYMENT_FAILED,
            errorMessage: "Stripe invoice not paid",
            locationId: inv.locationId ?? plan.locationId,
            connectedAccountId: inv.connectedAccountId,
            platformFeeMinor: inv.platformFeeMinor,
          });
          await markMembershipPastDue({
            guestMembershipId: membership.id,
            orgId,
            amountMajor: priceMajor,
            currency: plan.currency,
            stripeInvoiceId: inv.invoiceId || null,
            errorMessage: "Stripe invoice not paid",
            skipPaymentAttempt: true,
          });
          membership = await prisma.guestMembership.findFirstOrThrow({
            where: { id: membership.id },
          });
          note = "Fixed-term Stripe charge failed - status past_due";
        } else {
          assertMembershipTransition(membership.status, toStatus);
          membership = await prisma.guestMembership.update({
            where: { id: membership.id },
            data: { status: toStatus },
          });
          paymentAttemptId = await createPaymentAttempt({
            orgId,
            guestMembershipId: membership.id,
            amountMajor: priceMajor,
            currency: plan.currency,
            status: "succeeded",
            stripeInvoiceId: inv.invoiceId || null,
            idempotencyKey: `${idempotencyKey}:pay`,
            locationId: inv.locationId ?? plan.locationId,
            connectedAccountId: inv.connectedAccountId,
            platformFeeMinor: inv.platformFeeMinor,
          });
          if (needsAgreement) {
            note = "AGREEMENT_REQUIRED — pending until agreement is signed";
          }
        }
      }
    } catch (err) {
      if (err instanceof MembershipBillingError) throw err;
      await markMembershipPastDue({
        guestMembershipId: membership.id,
        orgId,
        amountMajor: priceMajor,
        currency: plan.currency,
        errorMessage: err instanceof Error ? err.message : "Stripe error",
        eventId: `${idempotencyKey}:sell_fail`,
      });
      // Fail closed to the client so the desk keeps the same idempotency key
      // (HTTP error → no key rotate). Membership is already past_due; same-key
      // retry returns the existing row via sellIdempotencyKey.
      throw new MembershipBillingError(
        MembershipErrorCodes.PAYMENT_FAILED,
        err instanceof Error
          ? `Stripe sell failed: ${err.message}`
          : "Stripe sell failed — membership marked past_due; retry with the same key"
      );
    }
  } else if (paymentMethod === "stripe" && !stripeOn) {
    paymentAttemptId = await createPaymentAttempt({
      orgId,
      guestMembershipId: membership.id,
      amountMajor: priceMajor,
      currency: plan.currency,
      status: "pending",
      idempotencyKey: `${idempotencyKey}:pay`,
      errorCode: MembershipErrorCodes.STRIPE_NOT_CONFIGURED,
      errorMessage: "Stripe not configured",
    });
  }

  if (needsAgreement) {
    await createDraftAgreement({
      orgId,
      guestMembershipId: membership.id,
      actorUserId: input.actorUserId,
      notifyGuest: true,
    });
  }

  auditMembership(input.actorUserId, orgId, {
    action: "guest_membership.sell",
    entityType: "GuestMembership",
    entityId: membership.id,
    description: `Sold membership ${membership.customMembershipId} (${membership.status})`,
    metadata: {
      planId: plan.id,
      paymentMethod,
      source: input.source,
      paymentAttemptId,
      agreementRequired: needsAgreement,
    },
  });

  // Soft: link existing customer or send invite-only dashboard access (never fails sell).
  let inviteNote: string | undefined;
  try {
    const { softInviteAfterSell } = await import("@/lib/memberships/guestInvite");
    const invite = await softInviteAfterSell({
      actorUserId: input.actorUserId,
      orgId,
      guestProfileId,
    });
    if (invite?.note) inviteNote = invite.note;
  } catch {
    /* sell already committed */
  }

  return {
    membership,
    paymentAttemptId,
    stripeConfigured: stripeOn,
    note: [note, inviteNote].filter(Boolean).join(" · ") || undefined,
  };
}

function isBenignStripeCancelError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /already been canceled|already cancelled|No such subscription|resource_missing|status is canceled/i.test(
    msg
  );
}

async function retargetLiveStripePlanPrice(input: {
  member: GuestMembership & { plan?: MembershipPlan };
  newPlan: MembershipPlan;
  orgId: string;
  idempotencyKey: string;
}): Promise<string | null> {
  const { member, newPlan, orgId, idempotencyKey } = input;
  if (
    !member.stripeSubscriptionId ||
    newPlan.billing !== "recurring" ||
    !isStripeConfigured()
  ) {
    return member.stripePriceId;
  }
  try {
    const changed = await changeGuestStripeSubscriptionPrice({
      subscriptionId: member.stripeSubscriptionId,
      orgId,
      guestMembershipId: member.id,
      planId: newPlan.id,
      currency: newPlan.currency,
      priceMajor: planPriceMajor(newPlan),
      intervalCount: newPlan.intervalCount ?? 1,
      intervalUnit: newPlan.intervalUnit ?? "month",
      idempotencyKey,
    });
    return changed.priceId;
  } catch (err) {
    console.warn("[memberships] stripe plan price retarget failed", err);
    throw new MembershipBillingError(
      MembershipErrorCodes.PAYMENT_FAILED,
      err instanceof Error
        ? `Stripe plan price update failed: ${err.message}`
        : "Stripe plan price update failed — membership plan not changed"
    );
  }
}

async function loadMember(
  orgId: string,
  membershipId: string
): Promise<GuestMembership & { plan: MembershipPlan }> {
  const row = await prisma.guestMembership.findFirst({
    where: { id: requireId(membershipId, "membershipId"), orgId },
    include: { plan: true },
  });
  if (!row) {
    throw new MembershipBillingError(
      MembershipErrorCodes.MEMBER_NOT_FOUND,
      "Guest membership not found"
    );
  }
  return row;
}

export async function renewMembership(input: {
  orgId: string;
  membershipId: string;
  actorUserId: string;
  paymentMethod: SellPaymentMethod;
  collectedAmount?: number;
  idempotencyKey: string;
}): Promise<MembershipLifecycleResult> {
  await assertBillingOrg(input.orgId);
  const member = await loadMember(input.orgId, input.membershipId);
  const paymentMethod = requireSellPaymentMethod(input.paymentMethod, [
    "collected",
    "pending",
    "stripe",
  ]);
  if (
    member.status !== "active" &&
    member.status !== "past_due" &&
    member.status !== "pending"
  ) {
    throw new MembershipBillingError(
      MembershipErrorCodes.INVALID_TRANSITION,
      "Renew requires active, past_due, or pending ? use reactivate for cancelled/expired/paused"
    );
  }
  if (member.plan.archivedAt) {
    throw new MembershipBillingError(
      MembershipErrorCodes.PLAN_ARCHIVED,
      "Cannot renew onto an archived plan"
    );
  }

  // Live Stripe Subscription already invoices each cycle — a desk/self-serve
  // Stripe one-shot renew would double-bill and desync periods. Collect
  // arrears via renew only when past_due (or use collected when no live sub).
  if (
    member.stripeSubscriptionId &&
    (member.status === "active" || member.status === "pending")
  ) {
    throw new MembershipBillingError(
      MembershipErrorCodes.PAYMENT_FAILED,
      "This membership has a live Stripe subscription — Stripe invoices automatically at period end. Use Renew only when past_due (to recover), or cancel the Stripe subscription before an off-cycle desk renew."
    );
  }

  const key = String(input.idempotencyKey || "").trim();
  const existingAttempt = key
    ? await prisma.membershipPaymentAttempt.findFirst({
        where: { orgId: input.orgId, idempotencyKey: `${key}:renew` },
      })
    : null;
  if (existingAttempt) {
    if (
      existingAttempt.status === "failed" ||
      existingAttempt.status === "pending"
    ) {
      // Drop stale attempt so the same client key can retry a real charge.
      await prisma.membershipPaymentAttempt.delete({
        where: { id: existingAttempt.id },
      });
    } else {
      // succeeded / skipped — finish period/status if crash left membership stale.
      let latest = await loadMember(input.orgId, input.membershipId);
      const nowHeal = new Date();
      const needsHeal =
        latest.status === "past_due" ||
        !latest.currentPeriodEnd ||
        latest.currentPeriodEnd.getTime() <= nowHeal.getTime();
      if (needsHeal && existingAttempt.status === "succeeded") {
        const from =
          latest.currentPeriodEnd && latest.currentPeriodEnd > nowHeal
            ? latest.currentPeriodEnd
            : nowHeal;
        const { start, end } = periodBounds(latest.plan, from);
        const status = await resolvePostPaymentMembershipStatus(latest);
        if (status !== latest.status) {
          assertMembershipTransition(latest.status, status);
        }
        latest = await prisma.guestMembership.update({
          where: { id: latest.id },
          data: {
            status,
            currentPeriodStart: start,
            currentPeriodEnd: end,
            endsAt: latest.plan.billing === "fixed" ? end : latest.endsAt,
            dunningFailCount: 0,
            dunningNextAt: null,
            ...(latest.status === "past_due"
              ? { cancelAtPeriodEnd: false, cancelReason: null }
              : {}),
          },
          include: { plan: true },
        });
      }
      return {
        membership: latest,
        paymentAttemptId: existingAttempt.id,
        stripeConfigured: isStripeConfigured(),
        note: "idempotent_replay",
      };
    }
  }

  const now = new Date();
  const from =
    member.currentPeriodEnd && member.currentPeriodEnd > now
      ? member.currentPeriodEnd
      : now;
  const { start, end } = periodBounds(member.plan, from);
  const priceMajor = planPriceMajor(member.plan);
  const stripeOn = isStripeConfigured();

  let paymentSucceeded = false;
  let paymentAttemptId: string | undefined;
  let note: string | undefined;

  if (paymentMethod === "collected") {
    if (
      input.collectedAmount == null ||
      !Number.isFinite(input.collectedAmount) ||
      input.collectedAmount < 0
    ) {
      throw new MembershipBillingError(
        MembershipErrorCodes.AMOUNT_REQUIRED,
        "collectedAmount required"
      );
    }
    paymentAttemptId = await createPaymentAttempt({
      orgId: input.orgId,
      guestMembershipId: member.id,
      amountMajor: Number(input.collectedAmount),
      currency: member.plan.currency,
      status: "succeeded",
      idempotencyKey: key ? `${key}:renew` : undefined,
    });
    paymentSucceeded = true;
  } else if (paymentMethod === "stripe" && stripeOn) {
    const guest = await requireGuest(input.orgId, member.guestProfileId);
    const customerId = await ensureGuestStripeCustomer({
      guestProfileId: guest.id,
      email: guest.email,
      name: `${guest.firstName} ${guest.lastName}`.trim(),
      existingCustomerId: guest.stripeCustomerId,
      orgId: input.orgId,
    });
    if (!guest.stripeCustomerId) {
      await prisma.guestProfile.update({
        where: { id: guest.id },
        data: { stripeCustomerId: customerId },
      });
    }
    const inv = await createGuestOneTimeInvoiceItem({
      customerId,
      currency: member.plan.currency,
      amountMajor: priceMajor,
      description: `Renew ${member.plan.name}`,
      orgId: input.orgId,
      guestMembershipId: member.id,
      planId: member.planId,
      locationId: member.plan.locationId,
      idempotencyKey: key || undefined,
    });
    paymentAttemptId = await createPaymentAttempt({
      orgId: input.orgId,
      guestMembershipId: member.id,
      amountMajor: priceMajor,
      currency: member.plan.currency,
      status: inv.paid ? "succeeded" : "failed",
      stripeInvoiceId: inv.invoiceId || null,
      idempotencyKey: key ? `${key}:renew` : undefined,
      errorCode: inv.paid ? null : MembershipErrorCodes.PAYMENT_FAILED,
      locationId: inv.locationId ?? member.plan.locationId,
      connectedAccountId: inv.connectedAccountId,
      platformFeeMinor: inv.platformFeeMinor,
    });
    if (!inv.paid) {
      await markMembershipPastDue({
        guestMembershipId: member.id,
        orgId: input.orgId,
        amountMajor: priceMajor,
        currency: member.plan.currency,
        stripeInvoiceId: inv.invoiceId || null,
        errorMessage: "Renew Stripe charge failed",
        skipPaymentAttempt: true,
      });
      throw new MembershipBillingError(
        MembershipErrorCodes.PAYMENT_FAILED,
        "Renew Stripe charge failed — membership marked past_due; retry with the same key"
      );
    }
    paymentSucceeded = true;
  } else if (paymentMethod === "stripe" && !stripeOn) {
    throw new MembershipBillingError(
      MembershipErrorCodes.STRIPE_NOT_CONFIGURED,
      "Stripe not configured - use collected"
    );
  } else if (paymentMethod === "pending") {
    paymentAttemptId = await createPaymentAttempt({
      orgId: input.orgId,
      guestMembershipId: member.id,
      amountMajor: priceMajor,
      currency: member.plan.currency,
      status: "pending",
      idempotencyKey: key ? `${key}:renew` : undefined,
    });
    note = "Renew marked pending";
  } else {
    throw new MembershipBillingError(
      MembershipErrorCodes.AMOUNT_REQUIRED,
      "paymentMethod must be collected|pending|stripe"
    );
  }

  if (!paymentSucceeded) {
    // Unpaid renew path (pending method) — leave status alone except note.
    const updated = await loadMember(input.orgId, input.membershipId);
    auditMembership(input.actorUserId, input.orgId, {
      action: "guest_membership.renew",
      entityType: "GuestMembership",
      entityId: member.id,
      description: `Renewed membership ${member.customMembershipId}`,
      metadata: { paymentAttemptId, status: updated.status },
    });
    return {
      membership: updated,
      paymentAttemptId,
      stripeConfigured: stripeOn,
      note,
    };
  }

  const status = await resolvePostPaymentMembershipStatus(member);
  if (status !== member.status) {
    assertMembershipTransition(member.status, status);
  }
  if (status === "pending") {
    note = "AGREEMENT_REQUIRED — pending until agreement is signed";
  }

  // Advance period on successful payment.
  // From active: preserve cancelAtPeriodEnd (Phase 2 C6 EOP cancel sticks).
  // From past_due: clear like recoverMembershipFromPastDue — renew is recovery.
  // Row lock prevents concurrent same-key retries from double-advancing.
  const updated = await withMembershipRowLock(
    input.orgId,
    member.id,
    async (tx, locked) => {
      if (
        locked.currentPeriodEnd &&
        locked.currentPeriodEnd.getTime() >= end.getTime() &&
        locked.status !== "past_due"
      ) {
        return locked;
      }
      return tx.guestMembership.update({
        where: { id: locked.id },
        data: {
          status,
          currentPeriodStart: start,
          currentPeriodEnd: end,
          endsAt: locked.plan.billing === "fixed" ? end : locked.endsAt,
          dunningFailCount: 0,
          dunningNextAt: null,
          ...(locked.status === "past_due"
            ? { cancelAtPeriodEnd: false, cancelReason: null }
            : {}),
        },
        include: { plan: true },
      });
    }
  );

  auditMembership(input.actorUserId, input.orgId, {
    action: "guest_membership.renew",
    entityType: "GuestMembership",
    entityId: member.id,
    description: `Renewed membership ${member.customMembershipId}`,
    metadata: { paymentAttemptId, status },
  });

  return { membership: updated, paymentAttemptId, stripeConfigured: stripeOn, note };
}

async function assertUpgradeGroup(
  from: MembershipPlan,
  to: MembershipPlan,
  allowOverride: boolean
) {
  if (allowOverride) return;
  if (!from.upgradeGroupKey || !to.upgradeGroupKey) {
    throw new MembershipBillingError(
      MembershipErrorCodes.UPGRADE_GROUP_MISMATCH,
      "Plans must share upgradeGroupKey (or use admin override)"
    );
  }
  if (from.upgradeGroupKey !== to.upgradeGroupKey) {
    throw new MembershipBillingError(
      MembershipErrorCodes.UPGRADE_GROUP_MISMATCH,
      "Plans are not in the same upgrade group"
    );
  }
}

export async function upgradeMembership(input: {
  orgId: string;
  membershipId: string;
  newPlanId: string;
  actorUserId: string;
  paymentMethod: SellPaymentMethod;
  collectedAmount?: number;
  idempotencyKey: string;
  /** memberships:admin may override upgradeGroupKey (API enforces). */
  allowGroupOverride?: boolean;
  /** Self-serve upgrades use online sellability rules. */
  sellChannel?: MembershipSellChannel;
}): Promise<MembershipLifecycleResult> {
  await assertBillingOrg(input.orgId);
  const member = await loadMember(input.orgId, input.membershipId);
  const paymentMethod = requireSellPaymentMethod(input.paymentMethod, [
    "collected",
    "stripe",
  ]);
  if (member.status !== "active") {
    throw new MembershipBillingError(
      MembershipErrorCodes.INVALID_TRANSITION,
      member.status === "past_due"
        ? "Upgrade requires an active membership — renew/recover past_due first"
        : "Upgrade requires active membership"
    );
  }
  const key = String(input.idempotencyKey || "").trim();
  if (key) {
    const existingAttempt = await prisma.membershipPaymentAttempt.findFirst({
      where: { orgId: input.orgId, idempotencyKey: `${key}:upgrade` },
    });
    if (existingAttempt) {
      if (
        existingAttempt.status === "failed" ||
        existingAttempt.status === "pending"
      ) {
        await prisma.membershipPaymentAttempt.delete({
          where: { id: existingAttempt.id },
        });
      } else {
        let latest = await loadMember(input.orgId, input.membershipId);
        const targetPlanId = String(input.newPlanId || "");
        const storedPlanId = parseTargetPlanMeta(existingAttempt.errorMessage);
        if (
          storedPlanId &&
          targetPlanId &&
          storedPlanId !== targetPlanId
        ) {
          throw new MembershipBillingError(
            MembershipErrorCodes.IDEMPOTENCY_CONFLICT,
            "idempotencyKey already used for a different target plan"
          );
        }
        const healPlanId = storedPlanId || targetPlanId;
        if (
          (existingAttempt.status === "succeeded" ||
            existingAttempt.status === "skipped") &&
          healPlanId
        ) {
          const targetPlan = await requirePlanForSell(input.orgId, healPlanId);
          // Always re-attempt Stripe price sync on heal (idempotent) so a
          // charged upgrade that failed retarget does not leave old recurring price.
          const nextStripePriceId = await retargetLiveStripePlanPrice({
            member: latest,
            newPlan: targetPlan,
            orgId: input.orgId,
            idempotencyKey: `${key}:upgrade`,
          });
          if (latest.planId !== healPlanId) {
            const nextStatus = await resolvePostPaymentMembershipStatus({
              ...latest,
              planId: targetPlan.id,
            });
            latest = await prisma.guestMembership.update({
              where: { id: latest.id },
              data: {
                planId: healPlanId,
                familyEntitlements: snapshotPlanEntitlements(
                  targetPlan
                ) as Prisma.InputJsonValue,
                status: nextStatus,
                ...(nextStripePriceId
                  ? { stripePriceId: nextStripePriceId }
                  : {}),
                cancelledAt: null,
              },
              include: { plan: true },
            });
            await trimFamilyLinksToPlanCap({
              orgId: input.orgId,
              guestMembershipId: latest.id,
              plan: targetPlan,
            });
          } else if (
            nextStripePriceId &&
            latest.stripePriceId !== nextStripePriceId
          ) {
            latest = await prisma.guestMembership.update({
              where: { id: latest.id },
              data: { stripePriceId: nextStripePriceId },
              include: { plan: true },
            });
          } else {
            await trimFamilyLinksToPlanCap({
              orgId: input.orgId,
              guestMembershipId: latest.id,
              plan: latest.plan,
            });
          }
        }
        return {
          membership: latest,
          paymentAttemptId: existingAttempt.id,
          stripeConfigured: isStripeConfigured(),
          note: "idempotent_replay",
        };
      }
    }
  }
  const newPlan = await requirePlanForSell(
    input.orgId,
    input.newPlanId,
    input.sellChannel ?? "admin"
  );
  if (newPlan.id === member.planId) {
    throw new MembershipBillingError(
      MembershipErrorCodes.PRORATION_FAILED,
      "Already on this plan ? choose a different plan to upgrade"
    );
  }
  if (newPlan.currency !== member.plan.currency) {
    throw new MembershipBillingError(
      MembershipErrorCodes.CURRENCY_MISMATCH,
      "Currency mismatch between plans"
    );
  }
  await assertUpgradeGroup(member.plan, newPlan, Boolean(input.allowGroupOverride));

  const oldPrice = planPriceMajor(member.plan);
  const newPrice = planPriceMajor(newPlan);
  if (newPrice <= oldPrice) {
    throw new MembershipBillingError(
      MembershipErrorCodes.PRORATION_FAILED,
      "New plan price must be higher for upgrade ? use downgrade"
    );
  }
  const periodStart = member.currentPeriodStart ?? member.startsAt ?? new Date();
  const periodEnd =
    member.currentPeriodEnd ??
    addMembershipCycle(
      periodStart,
      member.plan.intervalCount ?? 1,
      member.plan.intervalUnit ?? "month"
    );
  const proration = computeProration({
    oldPriceMajor: oldPrice,
    newPriceMajor: newPrice,
    periodStart,
    periodEnd,
  });
  const charge = Math.max(0, proration.amountDueMajor);
  const stripeOn = isStripeConfigured();

  let paymentAttemptId: string | undefined;
  let paid = false;
  let note: string | undefined;

  if (charge <= 0) {
    paid = true;
    paymentAttemptId = await createPaymentAttempt({
      orgId: input.orgId,
      guestMembershipId: member.id,
      amountMajor: 0,
      currency: newPlan.currency,
      status: "skipped",
      idempotencyKey: key ? `${key}:upgrade` : undefined,
      errorMessage: targetPlanMeta(newPlan.id),
    });
  } else if (paymentMethod === "collected") {
    if (
      input.collectedAmount == null ||
      !Number.isFinite(input.collectedAmount) ||
      input.collectedAmount < charge - 0.01
    ) {
      throw new MembershipBillingError(
        MembershipErrorCodes.AMOUNT_REQUIRED,
        `collectedAmount must cover proration ${charge}`
      );
    }
    paymentAttemptId = await createPaymentAttempt({
      orgId: input.orgId,
      guestMembershipId: member.id,
      // Ledger the prorated due (Phase 2 C4), not any over-collected amount.
      amountMajor: charge,
      currency: newPlan.currency,
      status: "succeeded",
      idempotencyKey: key ? `${key}:upgrade` : undefined,
      errorMessage: targetPlanMeta(newPlan.id),
    });
    paid = true;
  } else if (paymentMethod === "stripe" && stripeOn) {
    const guest = await requireGuest(input.orgId, member.guestProfileId);
    const customerId = await ensureGuestStripeCustomer({
      guestProfileId: guest.id,
      email: guest.email,
      name: `${guest.firstName} ${guest.lastName}`.trim(),
      existingCustomerId: guest.stripeCustomerId,
      orgId: input.orgId,
    });
    const inv = await createGuestOneTimeInvoiceItem({
      customerId,
      currency: newPlan.currency,
      amountMajor: charge,
      description: `Upgrade proration to ${newPlan.name}`,
      orgId: input.orgId,
      guestMembershipId: member.id,
      planId: newPlan.id,
      locationId: newPlan.locationId,
      idempotencyKey: key || undefined,
    });
    paymentAttemptId = await createPaymentAttempt({
      orgId: input.orgId,
      guestMembershipId: member.id,
      amountMajor: charge,
      currency: newPlan.currency,
      status: inv.paid ? "succeeded" : "failed",
      stripeInvoiceId: inv.invoiceId || null,
      idempotencyKey: key ? `${key}:upgrade` : undefined,
      errorMessage: inv.paid ? targetPlanMeta(newPlan.id) : null,
      locationId: inv.locationId ?? newPlan.locationId,
      connectedAccountId: inv.connectedAccountId,
      platformFeeMinor: inv.platformFeeMinor,
    });
    paid = inv.paid;
    if (!paid) {
      throw new MembershipBillingError(
        MembershipErrorCodes.PAYMENT_FAILED,
        "Upgrade payment failed — plan unchanged; retry with the same idempotency key"
      );
    }
  } else if (paymentMethod === "stripe" && !stripeOn) {
    throw new MembershipBillingError(
      MembershipErrorCodes.STRIPE_NOT_CONFIGURED,
      "Stripe not configured"
    );
  } else {
    throw new MembershipBillingError(
      MembershipErrorCodes.AMOUNT_REQUIRED,
      "Use collected or stripe for upgrade charge"
    );
  }

  const nextStatus = await resolvePostPaymentMembershipStatus({
    ...member,
    planId: newPlan.id,
  });
  if (nextStatus === "pending") {
    note =
      note ?? "AGREEMENT_REQUIRED — pending until agreement is signed";
  }
  if (nextStatus !== member.status) {
    assertMembershipTransition(member.status, nextStatus);
  }

  // Keep Stripe recurring price aligned with the new plan (in-app proration
  // already charged — do not let Stripe also prorate).
  const nextStripePriceId = await retargetLiveStripePlanPrice({
    member,
    newPlan,
    orgId: input.orgId,
    idempotencyKey: key || `upgrade:${member.id}:${newPlan.id}`,
  });

  const updated = await withMembershipRowLock(
    input.orgId,
    member.id,
    async (tx, locked) => {
      if (locked.planId === newPlan.id) {
        return locked;
      }
      return tx.guestMembership.update({
        where: { id: locked.id },
        data: {
          planId: newPlan.id,
          familyEntitlements: snapshotPlanEntitlements(
            newPlan
          ) as Prisma.InputJsonValue,
          status: nextStatus,
          ...(nextStripePriceId ? { stripePriceId: nextStripePriceId } : {}),
          // Preserve staff/guest end-of-period cancel (same as renew).
          // Do not treat upgrade as past_due recovery.
          cancelledAt: null,
        },
        include: { plan: true },
      });
    }
  );

  await trimFamilyLinksToPlanCap({
    orgId: input.orgId,
    guestMembershipId: member.id,
    plan: newPlan,
  });

  auditMembership(input.actorUserId, input.orgId, {
    action: "guest_membership.upgrade",
    entityType: "GuestMembership",
    entityId: member.id,
    description: `Upgraded membership to plan ${newPlan.name}`,
    metadata: { charge, proration, paymentAttemptId, paid, status: nextStatus },
  });

  return { membership: updated, paymentAttemptId, stripeConfigured: stripeOn, note };
}

/**
 * Downgrade policy (default): immediate plan switch + credit remaining
 * fraction x (old - new) to creditBalanceMinor. Not a Stripe refund.
 * Period-end-only downgrade can be added via settings later.
 */
export async function downgradeMembership(input: {
  orgId: string;
  membershipId: string;
  newPlanId: string;
  actorUserId: string;
  idempotencyKey: string;
  allowGroupOverride?: boolean;
}): Promise<MembershipLifecycleResult> {
  await assertBillingOrg(input.orgId);
  const member = await loadMember(input.orgId, input.membershipId);
  if (member.status !== "active") {
    throw new MembershipBillingError(
      MembershipErrorCodes.INVALID_TRANSITION,
      "Downgrade requires active membership"
    );
  }
  const key = String(input.idempotencyKey || "").trim();
  if (key) {
    const existingAttempt = await prisma.membershipPaymentAttempt.findFirst({
      where: { orgId: input.orgId, idempotencyKey: `${key}:downgrade` },
    });
    if (existingAttempt) {
      let latest = await loadMember(input.orgId, input.membershipId);
      const targetPlanId = String(input.newPlanId || "");
      const storedPlanId = parseTargetPlanMeta(existingAttempt.errorMessage);
      if (
        storedPlanId &&
        targetPlanId &&
        storedPlanId !== targetPlanId
      ) {
        throw new MembershipBillingError(
          MembershipErrorCodes.IDEMPOTENCY_CONFLICT,
          "idempotencyKey already used for a different target plan"
        );
      }
      const healPlanId = storedPlanId || targetPlanId;
      if (
        existingAttempt.status === "succeeded" &&
        healPlanId &&
        latest.planId !== healPlanId
      ) {
        const targetPlan = await requirePlanForSell(input.orgId, healPlanId);
        await retargetLiveStripePlanPrice({
          member: latest,
          newPlan: targetPlan,
          orgId: input.orgId,
          idempotencyKey: `${key}:downgrade`,
        });
        // Payment attempt amount is negative credit major for downgrade.
        // Apply credit only when healing an incomplete plan switch (not on
        // replays that already switched plan).
        const creditMajor = Math.abs(Number(existingAttempt.amount));
        const creditMinor = majorToMinor(
          Number.isFinite(creditMajor) ? creditMajor : 0
        );
        latest = await prisma.guestMembership.update({
          where: { id: latest.id },
          data: {
            planId: healPlanId,
            familyEntitlements: snapshotPlanEntitlements(
              targetPlan
            ) as Prisma.InputJsonValue,
            ...(creditMinor > 0
              ? { creditBalanceMinor: { increment: creditMinor } }
              : {}),
          },
          include: { plan: true },
        });
        await trimFamilyLinksToPlanCap({
          orgId: input.orgId,
          guestMembershipId: latest.id,
          plan: targetPlan,
        });
      } else if (healPlanId && latest.planId === healPlanId) {
        const targetPlan = await requirePlanForSell(input.orgId, healPlanId);
        await retargetLiveStripePlanPrice({
          member: latest,
          newPlan: targetPlan,
          orgId: input.orgId,
          idempotencyKey: `${key}:downgrade`,
        });
        await trimFamilyLinksToPlanCap({
          orgId: input.orgId,
          guestMembershipId: latest.id,
          plan: latest.plan,
        });
      }
      return {
        membership: latest,
        paymentAttemptId: existingAttempt.id,
        stripeConfigured: isStripeConfigured(),
        note: "idempotent_replay",
      };
    }
  }
  const newPlan = await requirePlanForSell(input.orgId, input.newPlanId);
  if (newPlan.id === member.planId) {
    throw new MembershipBillingError(
      MembershipErrorCodes.PRORATION_FAILED,
      "Already on this plan ? choose a different plan to downgrade"
    );
  }
  if (newPlan.currency !== member.plan.currency) {
    throw new MembershipBillingError(
      MembershipErrorCodes.CURRENCY_MISMATCH,
      "Currency mismatch"
    );
  }
  await assertUpgradeGroup(member.plan, newPlan, Boolean(input.allowGroupOverride));

  const oldPrice = planPriceMajor(member.plan);
  const newPrice = planPriceMajor(newPlan);
  if (newPrice >= oldPrice) {
    throw new MembershipBillingError(
      MembershipErrorCodes.PRORATION_FAILED,
      "New plan price must be lower for downgrade ? use upgrade"
    );
  }
  const periodStart = member.currentPeriodStart ?? member.startsAt ?? new Date();
  const periodEnd =
    member.currentPeriodEnd ??
    addMembershipCycle(
      periodStart,
      member.plan.intervalCount ?? 1,
      member.plan.intervalUnit ?? "month"
    );
  const proration = computeProration({
    oldPriceMajor: oldPrice,
    newPriceMajor: newPrice,
    periodStart,
    periodEnd,
  });
  const creditMajor = Math.abs(Math.min(0, proration.amountDueMajor));
  const creditMinor = majorToMinor(creditMajor);

  // Retarget Stripe before ledger/DB so a failed retarget never creates a
  // succeeded attempt that heals without credit.
  const nextStripePriceId = await retargetLiveStripePlanPrice({
    member,
    newPlan,
    orgId: input.orgId,
    idempotencyKey: key || `downgrade:${member.id}:${newPlan.id}`,
  });

  const paymentAttemptId = await createPaymentAttempt({
    orgId: input.orgId,
    guestMembershipId: member.id,
    amountMajor: -creditMajor,
    currency: newPlan.currency,
    status: "succeeded",
    idempotencyKey: key ? `${key}:downgrade` : undefined,
    errorMessage: targetPlanMeta(newPlan.id),
  });

  const updated = await withMembershipRowLock(
    input.orgId,
    member.id,
    async (tx, locked) => {
      if (locked.planId === newPlan.id) {
        return locked;
      }
      return tx.guestMembership.update({
        where: { id: locked.id },
        data: {
          planId: newPlan.id,
          familyEntitlements: snapshotPlanEntitlements(
            newPlan
          ) as Prisma.InputJsonValue,
          creditBalanceMinor: { increment: creditMinor },
          ...(nextStripePriceId ? { stripePriceId: nextStripePriceId } : {}),
          cancelledAt: null,
        },
        include: { plan: true },
      });
    }
  );

  await trimFamilyLinksToPlanCap({
    orgId: input.orgId,
    guestMembershipId: member.id,
    plan: newPlan,
  });

  auditMembership(input.actorUserId, input.orgId, {
    action: "guest_membership.downgrade",
    entityType: "GuestMembership",
    entityId: member.id,
    description: `Downgraded membership to plan ${newPlan.name}`,
    metadata: { creditMajor, creditMinor, paymentAttemptId },
  });

  return {
    membership: updated,
    paymentAttemptId,
    stripeConfigured: isStripeConfigured(),
    note: creditMajor > 0 ? `Credited ${creditMajor}` : undefined,
  };
}

export async function pauseMembership(input: {
  orgId: string;
  membershipId: string;
  actorUserId: string;
  reason?: string;
}): Promise<MembershipLifecycleResult> {
  await assertBillingOrg(input.orgId);
  const member = await loadMember(input.orgId, input.membershipId);
  const settings = await loadSettingsGraceDays(input.orgId, member.locationId);
  if (!settings.allowPause || !member.plan.pauseAllowed) {
    throw new MembershipBillingError(
      MembershipErrorCodes.PAUSE_NOT_ALLOWED,
      "Pause is disabled for this plan/settings"
    );
  }
  assertMembershipTransition(member.status, "paused");
  if (member.status === "past_due") {
    throw new MembershipBillingError(
      MembershipErrorCodes.INVALID_TRANSITION,
      "Cannot pause a past_due membership — collect payment or cancel first"
    );
  }

  if (member.stripeSubscriptionId && isStripeConfigured()) {
    try {
      await pauseGuestStripeSubscription(member.stripeSubscriptionId);
    } catch (err) {
      console.warn("[memberships] stripe pause failed", err);
      throw new MembershipBillingError(
        MembershipErrorCodes.PAYMENT_FAILED,
        err instanceof Error
          ? `Stripe pause failed: ${err.message}`
          : "Stripe pause failed — membership not paused in app"
      );
    }
  }

  const updated = await prisma.guestMembership.update({
    where: { id: member.id },
    data: {
      status: "paused",
      pauseStartsAt: new Date(),
      pauseEndsAt: null,
      // Freeze dunning schedule while paused (status is no longer past_due).
      dunningNextAt: null,
    },
  });

  auditMembership(input.actorUserId, input.orgId, {
    action: "guest_membership.pause",
    entityType: "GuestMembership",
    entityId: member.id,
    description: `Paused membership ${member.customMembershipId}`,
    metadata: { reason: input.reason ?? null },
  });

  return {
    membership: updated,
    stripeConfigured: isStripeConfigured(),
    note: "Pause is beta - benefits suspended while paused",
  };
}

export async function resumeMembership(input: {
  orgId: string;
  membershipId: string;
  actorUserId: string;
}): Promise<MembershipLifecycleResult> {
  await assertBillingOrg(input.orgId);
  const member = await loadMember(input.orgId, input.membershipId);
  assertMembershipTransition(member.status, "active");
  if (member.status !== "paused") {
    throw new MembershipBillingError(
      MembershipErrorCodes.INVALID_TRANSITION,
      "Only paused memberships can be resumed"
    );
  }

  if (member.stripeSubscriptionId && isStripeConfigured()) {
    try {
      await resumeGuestStripeSubscription(member.stripeSubscriptionId);
    } catch (err) {
      console.warn("[memberships] stripe resume failed", err);
      throw new MembershipBillingError(
        MembershipErrorCodes.PAYMENT_FAILED,
        err instanceof Error
          ? `Stripe resume failed: ${err.message}`
          : "Stripe resume failed — membership not resumed in app"
      );
    }
  }

  const nextStatus = await resolvePostPaymentMembershipStatus(member);
  assertMembershipTransition(member.status, nextStatus);

  const updated = await prisma.guestMembership.update({
    where: { id: member.id },
    data: {
      status: nextStatus,
      pauseEndsAt: new Date(),
    },
  });

  auditMembership(input.actorUserId, input.orgId, {
    action: "guest_membership.resume",
    entityType: "GuestMembership",
    entityId: member.id,
    description: `Resumed membership ${member.customMembershipId}`,
    metadata: { status: nextStatus },
  });

  return {
    membership: updated,
    stripeConfigured: isStripeConfigured(),
    note:
      nextStatus === "pending"
        ? "AGREEMENT_REQUIRED — pending until agreement is signed"
        : undefined,
  };
}

export async function cancelMembership(input: {
  orgId: string;
  membershipId: string;
  actorUserId: string;
  when: "immediate" | "end_of_period";
  reason?: string;
}): Promise<MembershipLifecycleResult> {
  await assertBillingOrg(input.orgId);
  const member = await loadMember(input.orgId, input.membershipId);
  if (member.status === "cancelled" || member.status === "expired") {
    throw new MembershipBillingError(
      MembershipErrorCodes.INVALID_TRANSITION,
      "Membership already cancelled/expired"
    );
  }

  if (member.stripeSubscriptionId && isStripeConfigured()) {
    try {
      await cancelGuestStripeSubscription({
        subscriptionId: member.stripeSubscriptionId,
        when: input.when,
      });
    } catch (err) {
      if (isBenignStripeCancelError(err)) {
        // Stripe already cancelled / missing — finish app-side cancel.
        console.warn(
          "[memberships] stripe cancel already terminal; continuing DB cancel",
          err
        );
      } else {
        console.warn("[memberships] stripe cancel failed", err);
        throw new MembershipBillingError(
          MembershipErrorCodes.PAYMENT_FAILED,
          err instanceof Error
            ? `Stripe cancel failed: ${err.message}`
            : "Stripe cancel failed — membership not cancelled in app"
        );
      }
    }
  }

  const now = new Date();
  let updated: GuestMembership;
  /** Clear dead Stripe sub binding once membership is terminal-cancelled. */
  const clearStripeBind = {
    stripeSubscriptionId: null as string | null,
    stripePriceId: null as string | null,
  };
  if (input.when === "end_of_period") {
    // Spec: remain active-like until period end, then cron/webhook finalize.
    if (
      member.status !== "active" &&
      member.status !== "past_due" &&
      member.status !== "paused"
    ) {
      throw new MembershipBillingError(
        MembershipErrorCodes.INVALID_TRANSITION,
        "End-of-period cancel requires active, past_due, or paused ? use immediate cancel for pending"
      );
    }
    const periodEnd = member.currentPeriodEnd;
    if (!periodEnd || periodEnd.getTime() <= now.getTime()) {
      // Missing or already-over period end — finalize immediately (cron cannot
      // match null currentPeriodEnd).
      assertMembershipTransition(member.status, "cancelled");
      updated = await prisma.guestMembership.update({
        where: { id: member.id },
        data: {
          status: "cancelled",
          cancelAtPeriodEnd: false,
          cancelledAt: now,
          cancelReason: input.reason?.slice(0, 500) ?? null,
          dunningNextAt: null,
          ...clearStripeBind,
        },
      });
    } else {
      updated = await prisma.guestMembership.update({
        where: { id: member.id },
        data: {
          cancelAtPeriodEnd: true,
          cancelReason: input.reason?.slice(0, 500) ?? null,
        },
      });
    }
  } else {
    assertMembershipTransition(member.status, "cancelled");
    updated = await prisma.guestMembership.update({
      where: { id: member.id },
      data: {
        status: "cancelled",
        cancelAtPeriodEnd: false,
        cancelledAt: now,
        cancelReason: input.reason?.slice(0, 500) ?? null,
        dunningNextAt: null,
        ...clearStripeBind,
      },
    });
  }

  auditMembership(input.actorUserId, input.orgId, {
    action: "guest_membership.cancel",
    entityType: "GuestMembership",
    entityId: member.id,
    description: `Cancelled membership (${input.when})`,
    metadata: { when: input.when, reason: input.reason ?? null },
  });

  return { membership: updated, stripeConfigured: isStripeConfigured() };
}

/**
 * Reactivate from cancelled / expired / paused.
 * May require new payment when coming from cancelled/expired.
 */
export async function reactivateMembership(input: {
  orgId: string;
  membershipId: string;
  actorUserId: string;
  paymentMethod?: SellPaymentMethod;
  collectedAmount?: number;
  idempotencyKey: string;
}): Promise<MembershipLifecycleResult> {
  await assertBillingOrg(input.orgId);
  const member = await loadMember(input.orgId, input.membershipId);
  if (
    member.status !== "cancelled" &&
    member.status !== "expired" &&
    member.status !== "paused"
  ) {
    throw new MembershipBillingError(
      MembershipErrorCodes.INVALID_TRANSITION,
      "Reactivate only from cancelled, expired, or paused"
    );
  }

  if (member.status === "paused") {
    return resumeMembership({
      orgId: input.orgId,
      membershipId: input.membershipId,
      actorUserId: input.actorUserId,
    });
  }

  if (member.plan.archivedAt) {
    throw new MembershipBillingError(
      MembershipErrorCodes.PLAN_ARCHIVED,
      "Plan is archived - sell a new membership on an active plan"
    );
  }

  // Drop dead cancelled Stripe binding before creating a new sub so webhook
  // metadata bind cannot hit bind_conflict against the old subscription id.
  if (member.stripeSubscriptionId) {
    await prisma.guestMembership.update({
      where: { id: member.id },
      data: { stripeSubscriptionId: null, stripePriceId: null },
    });
    member.stripeSubscriptionId = null;
    member.stripePriceId = null;
  }

  const method = requireSellPaymentMethod(
    input.paymentMethod ?? "collected",
    ["collected", "stripe"]
  );
  const now = new Date();
  const { start, end } = periodBounds(member.plan, now);
  const priceMajor = planPriceMajor(member.plan);
  const key = String(input.idempotencyKey || "").trim();
  if (!key) {
    throw new MembershipBillingError(
      MembershipErrorCodes.IDEMPOTENCY_CONFLICT,
      "idempotencyKey is required"
    );
  }

  const existingAttempt = await prisma.membershipPaymentAttempt.findFirst({
    where: { orgId: input.orgId, idempotencyKey: `${key}:reactivate` },
  });
  if (existingAttempt) {
    if (
      existingAttempt.status === "failed" ||
      existingAttempt.status === "pending"
    ) {
      await prisma.membershipPaymentAttempt.delete({
        where: { id: existingAttempt.id },
      });
    } else {
      // succeeded — heal membership if still cancelled/expired; re-bind Stripe
      // sub via same idempotency key when DB crashed after sub create.
      let latest = await loadMember(input.orgId, input.membershipId);
      let healStripeSubId: string | null = latest.stripeSubscriptionId;
      let healStripePriceId: string | null = latest.stripePriceId;
      if (
        latest.plan.billing === "recurring" &&
        isStripeConfigured() &&
        !latest.stripeSubscriptionId
      ) {
        try {
          const guest = await requireGuest(input.orgId, latest.guestProfileId);
          const customerId = await ensureGuestStripeCustomer({
            guestProfileId: guest.id,
            email: guest.email,
            name: `${guest.firstName} ${guest.lastName}`.trim(),
            existingCustomerId: guest.stripeCustomerId,
            orgId: input.orgId,
          });
          const sub = await createGuestStripeSubscription({
            customerId,
            orgId: input.orgId,
            guestMembershipId: latest.id,
            guestProfileId: guest.id,
            planId: latest.planId,
            locationId: latest.plan.locationId,
            currency: latest.plan.currency,
            priceMajor: planPriceMajor(latest.plan),
            intervalCount: latest.plan.intervalCount ?? 1,
            intervalUnit: latest.plan.intervalUnit ?? "month",
            idempotencyKey: key,
          });
          healStripeSubId = sub.subscriptionId;
          healStripePriceId = sub.priceId;
        } catch (err) {
          console.warn("[memberships] reactivate heal stripe rebind failed", err);
        }
      }
      if (latest.status === "cancelled" || latest.status === "expired") {
        const nextStatus = await resolvePostPaymentMembershipStatus(latest);
        assertMembershipTransition(latest.status, nextStatus);
        latest = await prisma.guestMembership.update({
          where: { id: latest.id },
          data: {
            status: nextStatus,
            startsAt: start,
            currentPeriodStart: start,
            currentPeriodEnd: end,
            endsAt: latest.plan.billing === "fixed" ? end : null,
            cancelAtPeriodEnd: false,
            cancelledAt: null,
            cancelReason: null,
            dunningFailCount: 0,
            dunningNextAt: null,
            ...(healStripeSubId
              ? {
                  stripeSubscriptionId: healStripeSubId,
                  stripePriceId: healStripePriceId,
                }
              : {}),
          },
          include: { plan: true },
        });
      } else if (
        healStripeSubId &&
        healStripeSubId !== latest.stripeSubscriptionId
      ) {
        latest = await prisma.guestMembership.update({
          where: { id: latest.id },
          data: {
            stripeSubscriptionId: healStripeSubId,
            stripePriceId: healStripePriceId,
          },
          include: { plan: true },
        });
      }
      return {
        membership: latest,
        paymentAttemptId: existingAttempt.id,
        stripeConfigured: isStripeConfigured(),
        note: "idempotent_replay",
      };
    }
  }

  let paymentAttemptId: string | undefined;
  let stripeSubscriptionId: string | null = null;
  let stripePriceId: string | null = null;

  if (method === "collected") {
    if (
      input.collectedAmount == null ||
      !Number.isFinite(input.collectedAmount) ||
      input.collectedAmount < 0
    ) {
      throw new MembershipBillingError(
        MembershipErrorCodes.AMOUNT_REQUIRED,
        "collectedAmount required to reactivate"
      );
    }
    paymentAttemptId = await createPaymentAttempt({
      orgId: input.orgId,
      guestMembershipId: member.id,
      amountMajor: Number(input.collectedAmount),
      currency: member.plan.currency,
      status: "succeeded",
      idempotencyKey: `${key}:reactivate`,
    });
  } else if (method === "stripe") {
    if (!isStripeConfigured()) {
      throw new MembershipBillingError(
        MembershipErrorCodes.STRIPE_NOT_CONFIGURED,
        "Stripe not configured"
      );
    }
    const guest = await requireGuest(input.orgId, member.guestProfileId);
    const customerId = await ensureGuestStripeCustomer({
      guestProfileId: guest.id,
      email: guest.email,
      name: `${guest.firstName} ${guest.lastName}`.trim(),
      existingCustomerId: guest.stripeCustomerId,
      orgId: input.orgId,
    });
    if (!guest.stripeCustomerId) {
      await prisma.guestProfile.update({
        where: { id: guest.id },
        data: { stripeCustomerId: customerId },
      });
    }
    if (member.plan.billing === "recurring") {
      // Cancelled subs are dead — recreate like sell (not a one-shot invoice).
      const count = member.plan.intervalCount ?? 1;
      const unit = member.plan.intervalUnit ?? "month";
      const sub = await createGuestStripeSubscription({
        customerId,
        orgId: input.orgId,
        guestMembershipId: member.id,
        guestProfileId: guest.id,
        planId: member.planId,
        locationId: member.plan.locationId,
        currency: member.plan.currency,
        priceMajor,
        intervalCount: count,
        intervalUnit: unit,
        idempotencyKey: key,
      });
      stripeSubscriptionId = sub.subscriptionId;
      stripePriceId = sub.priceId;
      const activeLike =
        sub.status === "active" ||
        sub.status === "trialing" ||
        sub.status === "paid";
      paymentAttemptId = await createPaymentAttempt({
        orgId: input.orgId,
        guestMembershipId: member.id,
        amountMajor: priceMajor,
        currency: member.plan.currency,
        status: activeLike ? "succeeded" : "pending",
        idempotencyKey: `${key}:reactivate`,
        locationId: member.plan.locationId,
        connectedAccountId: sub.connectedAccountId,
        platformFeeMinor: sub.platformFeeMinor,
      });
      if (!activeLike) {
        try {
          await cancelGuestStripeSubscription({
            subscriptionId: sub.subscriptionId,
            when: "immediate",
          });
        } catch (cancelErr) {
          console.warn(
            "[memberships] orphan reactivate sub cancel failed",
            cancelErr
          );
        }
        throw new MembershipBillingError(
          MembershipErrorCodes.PAYMENT_FAILED,
          "Reactivate subscription created but first payment incomplete"
        );
      }
    } else {
      const inv = await createGuestOneTimeInvoiceItem({
        customerId,
        currency: member.plan.currency,
        amountMajor: priceMajor,
        description: `Reactivate ${member.plan.name}`,
        orgId: input.orgId,
        guestMembershipId: member.id,
        planId: member.planId,
        locationId: member.plan.locationId,
        idempotencyKey: key,
      });
      paymentAttemptId = await createPaymentAttempt({
        orgId: input.orgId,
        guestMembershipId: member.id,
        amountMajor: priceMajor,
        currency: member.plan.currency,
        status: inv.paid ? "succeeded" : "failed",
        stripeInvoiceId: inv.invoiceId || null,
        idempotencyKey: `${key}:reactivate`,
        locationId: inv.locationId ?? member.plan.locationId,
        connectedAccountId: inv.connectedAccountId,
        platformFeeMinor: inv.platformFeeMinor,
      });
      if (!inv.paid) {
        throw new MembershipBillingError(
          MembershipErrorCodes.PAYMENT_FAILED,
          "Reactivate payment failed"
        );
      }
    }
  } else {
    throw new MembershipBillingError(
      MembershipErrorCodes.AMOUNT_REQUIRED,
      "paymentMethod collected or stripe required"
    );
  }

  assertMembershipTransition(member.status, "active");
  const nextStatus = await resolvePostPaymentMembershipStatus(member);
  // cancelled/expired → pending allowed; cancelled/expired → active allowed.
  if (nextStatus !== "active") {
    assertMembershipTransition(member.status, nextStatus);
  }
  const updated = await prisma.guestMembership.update({
    where: { id: member.id },
    data: {
      status: nextStatus,
      startsAt: start,
      currentPeriodStart: start,
      currentPeriodEnd: end,
      endsAt: member.plan.billing === "fixed" ? end : null,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      cancelReason: null,
      dunningFailCount: 0,
      dunningNextAt: null,
      // Replace dead cancelled Stripe sub binding when we recreated one.
      ...(stripeSubscriptionId
        ? { stripeSubscriptionId, stripePriceId }
        : method === "collected" && member.plan.billing === "recurring"
          ? { stripeSubscriptionId: null, stripePriceId: null }
          : {}),
    },
  });

  auditMembership(input.actorUserId, input.orgId, {
    action: "guest_membership.reactivate",
    entityType: "GuestMembership",
    entityId: member.id,
    description: `Reactivated membership ${member.customMembershipId}`,
    metadata: { paymentAttemptId, status: nextStatus },
  });

  return {
    membership: updated,
    paymentAttemptId,
    stripeConfigured: isStripeConfigured(),
    note:
      nextStatus === "pending"
        ? "AGREEMENT_REQUIRED — pending until agreement is signed"
        : undefined,
  };
}

export async function updatePaymentMethod(input: {
  orgId: string;
  membershipId: string;
  actorUserId: string;
}): Promise<{
  clientSecret: string | null;
  setupIntentId: string;
  stripeCustomerId: string;
}> {
  await assertBillingOrg(input.orgId);
  if (!isStripeConfigured()) {
    throw new MembershipBillingError(
      MembershipErrorCodes.STRIPE_NOT_CONFIGURED,
      "Stripe not configured"
    );
  }
  const member = await loadMember(input.orgId, input.membershipId);
  const guest = await requireGuest(input.orgId, member.guestProfileId);
  const customerId = await ensureGuestStripeCustomer({
    guestProfileId: guest.id,
    email: guest.email,
    name: `${guest.firstName} ${guest.lastName}`.trim(),
    existingCustomerId: guest.stripeCustomerId,
    orgId: input.orgId,
  });
  if (!guest.stripeCustomerId) {
    await prisma.guestProfile.update({
      where: { id: guest.id },
      data: { stripeCustomerId: customerId },
    });
  }
  const si = await createGuestSetupIntent({
    customerId,
    orgId: input.orgId,
    guestMembershipId: member.id,
  });

  auditMembership(input.actorUserId, input.orgId, {
    action: "guest_membership.payment_method",
    entityType: "GuestMembership",
    entityId: member.id,
    description: "Created SetupIntent for guest payment method",
    metadata: { setupIntentId: si.setupIntentId },
  });

  return {
    clientSecret: si.clientSecret,
    setupIntentId: si.setupIntentId,
    stripeCustomerId: customerId,
  };
}

export async function applyCredit(input: {
  orgId: string;
  membershipId: string;
  actorUserId: string;
  /** Major currency units; positive adds credit */
  amountMajor: number;
  reason?: string;
  /** Stable key — required for cancel-alternative / webhook replays */
  idempotencyKey?: string;
}): Promise<MembershipLifecycleResult> {
  await assertBillingOrg(input.orgId);
  if (!Number.isFinite(input.amountMajor) || input.amountMajor === 0) {
    throw new MembershipBillingError(
      MembershipErrorCodes.AMOUNT_REQUIRED,
      "amountMajor must be a non-zero number"
    );
  }
  // Bound per-call credit to limit fat-finger / abuse (billing role still required).
  const MAX_CREDIT_MAJOR = 100_000;
  if (Math.abs(input.amountMajor) > MAX_CREDIT_MAJOR) {
    throw new MembershipBillingError(
      MembershipErrorCodes.AMOUNT_REQUIRED,
      `amountMajor abs must be <= ${MAX_CREDIT_MAJOR}`
    );
  }
  const member = await loadMember(input.orgId, input.membershipId);
  const idem = input.idempotencyKey?.trim().slice(0, 120) || "";
  if (!idem) {
    throw new MembershipBillingError(
      MembershipErrorCodes.IDEMPOTENCY_CONFLICT,
      "idempotencyKey is required for credit adjustments"
    );
  }
  const prior = await prisma.membershipPaymentAttempt.findFirst({
    where: { orgId: input.orgId, idempotencyKey: idem },
  });
  if (prior) {
    const latest = await loadMember(input.orgId, input.membershipId);
    return {
      membership: latest,
      paymentAttemptId: prior.id,
      stripeConfigured: isStripeConfigured(),
      note: "idempotent_replay",
    };
  }
  const delta = majorToMinor(input.amountMajor);

  let updated: GuestMembership;
  let paymentAttemptId: string;
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Re-check idempotency inside the transaction to close TOCTOU races.
      const prior = await tx.membershipPaymentAttempt.findFirst({
        where: { orgId: input.orgId, idempotencyKey: idem },
      });
      if (prior) {
        const latest = await tx.guestMembership.findFirstOrThrow({
          where: { id: member.id, orgId: input.orgId },
        });
        return {
          membership: latest,
          paymentAttemptId: prior.id,
          replay: true as const,
        };
      }
      const locked = await tx.guestMembership.findFirstOrThrow({
        where: { id: member.id, orgId: input.orgId },
      });
      const next = locked.creditBalanceMinor + delta;
      if (next < 0) {
        throw new MembershipBillingError(
          MembershipErrorCodes.AMOUNT_REQUIRED,
          "Credit balance cannot go negative"
        );
      }
      const row = await tx.guestMembership.update({
        where: { id: locked.id },
        data: { creditBalanceMinor: next },
      });
      const attempt = await tx.membershipPaymentAttempt.create({
        data: {
          orgId: input.orgId,
          guestMembershipId: locked.id,
          amount: new Prisma.Decimal((-input.amountMajor).toFixed(2)),
          currency: member.plan.currency,
          status: "succeeded",
          attemptNumber: 1,
          idempotencyKey: idem,
          locationId: locked.locationId,
        },
      });
      await enqueueSource(tx, {
        orgId: input.orgId,
        locationId: locked.locationId,
        sourceType: "membership_payment",
        sourceId: attempt.id,
        sourceEvent: "succeeded",
        eventAt: attempt.createdAt,
      });
      return {
        membership: row,
        paymentAttemptId: attempt.id,
        replay: false as const,
      };
    });
    updated = result.membership;
    paymentAttemptId = result.paymentAttemptId;
    if (!result.replay) flushAccountingQueueSoon(input.orgId);
    if (result.replay) {
      return {
        membership: updated,
        paymentAttemptId,
        stripeConfigured: isStripeConfigured(),
        note: "idempotent_replay",
      };
    }
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const prior = await prisma.membershipPaymentAttempt.findFirst({
        where: { orgId: input.orgId, idempotencyKey: idem },
      });
      const latest = await loadMember(input.orgId, input.membershipId);
      return {
        membership: latest,
        paymentAttemptId: prior?.id,
        stripeConfigured: isStripeConfigured(),
        note: "idempotent_replay",
      };
    }
    throw err;
  }

  auditMembership(input.actorUserId, input.orgId, {
    action: "guest_membership.apply_credit",
    entityType: "GuestMembership",
    entityId: member.id,
    description: `Applied credit ${input.amountMajor} (${input.reason ?? "manual"})`,
    metadata: {
      amountMajor: input.amountMajor,
      creditBalanceMinor: updated.creditBalanceMinor,
      reason: input.reason ?? null,
    },
  });
  return {
    membership: updated,
    paymentAttemptId,
    stripeConfigured: isStripeConfigured(),
  };
}

export { membershipBenefitsActive } from "@/lib/memberships/statusMachine";
export { minorToMajor, majorToMinor, computeProration };

