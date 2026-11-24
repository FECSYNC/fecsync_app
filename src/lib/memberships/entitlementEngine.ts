/**
 * Memberships entitlement engine SSOT (Feature 08 Phase 3).
 *
 * Check-In / POS / admin redeem MUST call these helpers — never fork
 * remaining-visit math. Usage is ledgered on MembershipUsageEvent.
 */
import type {
  GuestMembership,
  MembershipPlan,
  MembershipUsageEvent,
  MembershipUsageKind,
  MembershipUsageSource,
  MembershipVisitStatus,
  Prisma,
} from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId, requireId } from "@/lib/ids";
import {
  MembershipBillingError,
  MembershipErrorCodes,
} from "@/lib/memberships/errors";
import { membershipBenefitsActive } from "@/lib/memberships/statusMachine";
import type { MembershipPlanEntitlements } from "@/lib/memberships/types";
import { loadEffectiveMembershipSettingsRow } from "@/lib/memberships/settings";
import {
  applyLocalPerks,
  computeVisitStatus,
  normalizePerkFlags,
} from "@/lib/memberships/multiVenueStatus";
import {
  addDaysFrom,
  isPlanInRedemptionWindow,
} from "@/lib/memberships/planCatalogRules";

export type EntitlementBlockReason =
  | "paused"
  | "past_due"
  | "cancelled"
  | "expired"
  | "pending"
  | "ineligible_venue"
  | "exhausted"
  | "agreement_missing"
  | "photo_missing"
  | "banned"
  | "outside_redemption_window"
  | null;

export type VerifyBenefitsResult = {
  guestMembershipId: string;
  orgId: string;
  locationId: string;
  visitStatus: MembershipVisitStatus;
  eligible: boolean;
  status: GuestMembership["status"];
  cancelAtPeriodEnd: boolean;
  /**
   * Hard block: status / venue / agreement / photo / ban.
   * Visit exhaustion is separate (`visitsExhausted`) so discounts/perks
   * remain usable when entries are spent.
   */
  blocked: boolean;
  blockReason: EntitlementBlockReason;
  visitsExhausted: boolean;
  /** Soft warning when past_due redeem is allowed by settings. */
  warnings: string[];
  entriesPerPeriod: number | null;
  entriesUsed: number;
  remainingEntries: number | null;
  discountPercent: number;
  perks: string[];
  freeProductRefs: string[];
  familyAllowed: boolean;
  familyMembers: Array<{
    guestProfileId: string;
    role: string;
    firstName: string;
    lastName: string;
    photoUrl: string | null;
  }>;
  member: {
    customMembershipId: string;
    barcodeOrCode: string | null;
    qrPayload: string | null;
    photoUrl: string | null;
    guestProfileId: string;
    firstName: string;
    lastName: string;
    guestPhotoUrl: string | null;
    homeLocationId: string;
  };
  periodStart: string | null;
  periodEnd: string | null;
};

export type ConsumeBenefitInput = {
  orgId: string;
  guestMembershipId: string;
  locationId: string;
  /** Guests consuming this redeem (partial family redeem). Empty = primary only. */
  guestProfileIds?: string[];
  kind?: Extract<
    MembershipUsageKind,
    "visit" | "redeem" | "perk_consumed" | "free_product"
  >;
  /** Required when kind is perk_consumed — must be in effective perks. */
  perkFlag?: string;
  qty?: number;
  actorUserId?: string | null;
  source?: MembershipUsageSource;
  idempotencyKey?: string;
  meta?: Record<string, unknown>;
};

export type ConsumeBenefitResult = {
  events: MembershipUsageEvent[];
  remainingEntries: number | null;
  visitStatus: MembershipVisitStatus;
  verify: VerifyBenefitsResult;
};

function parseEntitlements(raw: unknown): MembershipPlanEntitlements {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as MembershipPlanEntitlements;
}

function settingsAllowPastDueRedeem(other: unknown): boolean {
  if (!other || typeof other !== "object" || Array.isArray(other)) return false;
  return (other as Record<string, unknown>).allowPastDueRedeem === true;
}

function periodBounds(member: GuestMembership): {
  start: Date | null;
  end: Date | null;
} {
  return {
    start: member.currentPeriodStart ?? member.startsAt ?? null,
    end: member.currentPeriodEnd ?? member.endsAt ?? null,
  };
}

function isUsageUndone(meta: unknown): boolean {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
  return Boolean((meta as Record<string, unknown>).undoneAt);
}

/**
 * Hard redeem/verify blocks shared by verifyBenefits + locked consume (TOCTOU).
 * Visit exhaustion is NOT a hard block — discounts/perks may still apply.
 */
function evaluateHardBlocks(input: {
  member: GuestMembership & {
    plan: Pick<
      MembershipPlan,
      | "agreementRequired"
      | "redemptionStartsAt"
      | "redemptionEndsAt"
      | "customRedemptionDescription"
    >;
    guestProfile: { bannedAt: Date | null; photoUrl: string | null };
  };
  eligible: boolean;
  settings: {
    requirePhotoOnRedeem: boolean;
    requireAgreementBeforeActive: boolean;
    allowPastDueRedeem: boolean;
  };
  now?: Date;
}): {
  blocked: boolean;
  blockReason: EntitlementBlockReason;
  warnings: string[];
} {
  const now = input.now ?? new Date();
  const { member, settings } = input;
  const warnings: string[] = [];
  let blocked = false;
  let blockReason: EntitlementBlockReason = null;

  const endedAt = member.endsAt;
  const periodEndedAt = member.currentPeriodEnd;
  const periodEnded =
    periodEndedAt != null && periodEndedAt.getTime() < now.getTime();
  const pastDueAllowed =
    member.status === "past_due" && settings.allowPastDueRedeem;

  if (endedAt && endedAt.getTime() < now.getTime() && member.status !== "cancelled") {
    blocked = true;
    blockReason = "expired";
  } else if (member.guestProfile.bannedAt) {
    blocked = true;
    blockReason = "banned";
  } else if (!input.eligible) {
    blocked = true;
    blockReason = "ineligible_venue";
  } else if (member.status === "paused") {
    blocked = true;
    blockReason = "paused";
  } else if (member.status === "cancelled") {
    blocked = true;
    blockReason = "cancelled";
  } else if (member.status === "expired") {
    blocked = true;
    blockReason = "expired";
  } else if (member.status === "pending") {
    blocked = true;
    blockReason = "pending";
  } else if (member.status === "past_due") {
    if (settings.allowPastDueRedeem) {
      warnings.push("Membership is past_due — redeem allowed by settings");
    } else {
      blocked = true;
      blockReason = "past_due";
    }
  } else if (!membershipBenefitsActive(member.status)) {
    blocked = true;
    blockReason = "pending";
  }

  // Spec: cancelAtPeriodEnd remains redeemable until period end — not after.
  // past_due + allowPastDueRedeem may still redeem during dunning grace after window.
  if (!blocked && periodEnded && !pastDueAllowed) {
    blocked = true;
    blockReason = "expired";
    warnings.push("Billing period ended — renew or wait for subscription sync");
  } else if (!blocked && periodEnded && pastDueAllowed) {
    warnings.push(
      "Billing period ended while past_due — redeem allowed by settings"
    );
  }

  if (!blocked && !isPlanInRedemptionWindow(member.plan, now)) {
    blocked = true;
    blockReason = "outside_redemption_window";
    if (member.plan.customRedemptionDescription?.trim()) {
      warnings.push(member.plan.customRedemptionDescription.trim());
    } else {
      warnings.push("Outside plan redemption date window");
    }
  }

  const agreementNeeded =
    settings.requireAgreementBeforeActive || member.plan.agreementRequired;
  if (!blocked && agreementNeeded && !member.agreementSignedAt) {
    blocked = true;
    blockReason = "agreement_missing";
  }

  const photoUrl = member.photoUrl || member.guestProfile.photoUrl;
  if (!blocked && settings.requirePhotoOnRedeem && !photoUrl) {
    blocked = true;
    blockReason = "photo_missing";
  }

  return { blocked, blockReason, warnings };
}

function throwIfBlocked(blockReason: EntitlementBlockReason, status: string): never {
  if (blockReason === "ineligible_venue") {
    throw new MembershipBillingError(
      MembershipErrorCodes.INELIGIBLE_VENUE,
      "Membership is not eligible at this venue"
    );
  }
  if (blockReason === "agreement_missing") {
    throw new MembershipBillingError(
      MembershipErrorCodes.AGREEMENT_REQUIRED,
      "Agreement must be signed before redeem"
    );
  }
  if (blockReason === "photo_missing") {
    throw new MembershipBillingError(
      MembershipErrorCodes.PHOTO_REQUIRED,
      "Member photo required before redeem"
    );
  }
  if (blockReason === "outside_redemption_window") {
    throw new MembershipBillingError(
      MembershipErrorCodes.OUTSIDE_REDEMPTION_WINDOW,
      "Membership is outside its redemption date window"
    );
  }
  throw new MembershipBillingError(
    MembershipErrorCodes.MEMBERSHIP_NOT_ACTIVE,
    `Membership cannot redeem (${blockReason ?? status})`
  );
}

/**
 * Shared visit/redeem consumption in the current period across all parks.
 * Undo events reverse prior consume via meta.undoneAt on the original row.
 */
export async function countConsumedEntries(input: {
  orgId: string;
  guestMembershipId: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  tx?: Prisma.TransactionClient;
}): Promise<number> {
  const db = input.tx ?? prisma;
  // Aggregate in SQL — avoid pulling every usage row into the app (remote DB RTT).
  const rows = await db.$queryRaw<Array<{ used: number | bigint }>>`
    SELECT COALESCE(SUM(qty), 0)::int AS used
    FROM membership_usage_events
    WHERE "orgId" = ${input.orgId}
      AND "guestMembershipId" = ${input.guestMembershipId}
      AND kind IN ('visit', 'redeem')
      AND (meta->>'undoneAt') IS NULL
      ${
        input.periodStart
          ? PrismaNS.sql`AND "createdAt" >= ${input.periodStart}`
          : PrismaNS.empty
      }
      ${
        input.periodEnd
          ? PrismaNS.sql`AND "createdAt" < ${input.periodEnd}`
          : PrismaNS.empty
      }
  `;
  const used = Number(rows[0]?.used ?? 0);
  return Number.isFinite(used) ? Math.max(0, used) : 0;
}

async function loadSettingsBundle(
  orgId: string,
  locationId: string,
  tx?: Prisma.TransactionClient
): Promise<{
  requirePhotoOnRedeem: boolean;
  requireAgreementBeforeActive: boolean;
  allowPastDueRedeem: boolean;
}> {
  const row = await loadEffectiveMembershipSettingsRow(orgId, locationId, tx);
  return {
    requirePhotoOnRedeem: row?.requirePhotoOnRedeem ?? false,
    requireAgreementBeforeActive: row?.requireAgreementBeforeActive ?? false,
    allowPastDueRedeem: settingsAllowPastDueRedeem(row?.other),
  };
}

type MemberBundle = GuestMembership & {
  plan: MembershipPlan;
  guestProfile: {
    id: string;
    firstName: string;
    lastName: string;
    photoUrl: string | null;
    bannedAt: Date | null;
  };
  familyLinks: Array<{
    id: string;
    guestProfileId: string;
    role: string;
    guestProfile: {
      id: string;
      firstName: string;
      lastName: string;
      photoUrl: string | null;
    };
  }>;
};

async function loadMemberBundle(
  orgId: string,
  guestMembershipId: string,
  tx?: Prisma.TransactionClient
): Promise<MemberBundle> {
  const db = tx ?? prisma;
  const id = requireId(guestMembershipId, "guestMembershipId");
  const row = await db.guestMembership.findFirst({
    where: { id, orgId },
    include: {
      plan: true,
      guestProfile: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          photoUrl: true,
          bannedAt: true,
        },
      },
      familyLinks: {
        include: {
          guestProfile: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              photoUrl: true,
            },
          },
        },
      },
    },
  });
  if (!row) {
    throw new MembershipBillingError(
      MembershipErrorCodes.MEMBER_NOT_FOUND,
      "Guest membership not found"
    );
  }
  return row;
}

function buildQrPayload(member: {
  id: string;
  customMembershipId: string;
  orgId: string;
}): string {
  return JSON.stringify({
    type: "membership",
    orgId: member.orgId,
    guestMembershipId: member.id,
    customMembershipId: member.customMembershipId,
  });
}

/** Ensure scan codes exist for print / digital card (idempotent). */
export async function ensureMembershipScanCodes(
  member: GuestMembership,
  tx?: Prisma.TransactionClient
): Promise<GuestMembership> {
  if (member.barcodeOrCode && member.qrPayload) return member;
  const db = tx ?? prisma;
  const barcodeOrCode = member.barcodeOrCode || member.customMembershipId;
  const qrPayload = member.qrPayload || buildQrPayload(member);
  return db.guestMembership.update({
    where: { id: member.id },
    data: { barcodeOrCode, qrPayload },
  });
}

/**
 * verifyBenefits(guestMembershipId, locationId) — structured remaining + blocks.
 */
export async function verifyBenefits(
  guestMembershipId: string,
  locationId: string,
  opts?: {
    orgId?: string;
    tx?: Prisma.TransactionClient;
    /** Skip scan-code / visitStatus writes — safe inside hot redeem transactions. */
    lean?: boolean;
    /** Reuse a locked member bundle (avoids a second include query). */
    member?: MemberBundle;
  }
): Promise<VerifyBenefitsResult> {
  const locId = requireId(locationId, "locationId");
  const orgId = opts?.orgId;
  if (!orgId) {
    throw new MembershipBillingError(
      MembershipErrorCodes.MEMBER_NOT_FOUND,
      "orgId is required for membership verify"
    );
  }

  const member =
    opts?.member ??
    (await loadMemberBundle(orgId, guestMembershipId, opts?.tx));
  if (!opts?.lean) {
    await ensureMembershipScanCodes(member, opts?.tx);
  }

  const venue = await (opts?.tx ?? prisma).venueLocation.findFirst({
    where: { id: locId, orgId },
    select: { id: true, status: true },
  });
  if (!venue || venue.status === "archived") {
    throw new MembershipBillingError(
      MembershipErrorCodes.VENUE_INVALID,
      "Venue not found or archived"
    );
  }

  const eligibility = await (opts?.tx ?? prisma).membershipVenueEligibility.findFirst({
    where: { orgId, planId: member.planId, locationId: locId },
  });

  const multi = computeVisitStatus({
    homeLocationId: member.homeLocationId,
    actingLocationId: locId,
    eligibility: eligibility
      ? {
          eligible: eligibility.eligible,
          localPerksAdd: eligibility.localPerksAdd,
          localPerksRemove: eligibility.localPerksRemove,
        }
      : null,
  });

  // Persist last computed visit label (snapshot for desks / reports).
  if (!opts?.lean && member.visitStatus !== multi.visitStatus) {
    await (opts?.tx ?? prisma).guestMembership.update({
      where: { id: member.id },
      data: { visitStatus: multi.visitStatus },
    });
  }

  const entitlements = parseEntitlements(member.plan.entitlements);
  const familyEnt =
    member.familyEntitlements &&
    typeof member.familyEntitlements === "object" &&
    !Array.isArray(member.familyEntitlements)
      ? (member.familyEntitlements as MembershipPlanEntitlements)
      : null;
  const entriesPerPeriod =
    familyEnt?.entriesPerPeriod !== undefined
      ? familyEnt.entriesPerPeriod ?? null
      : entitlements.entriesPerPeriod ?? null;
  const discountPercent = Number(entitlements.discountPercent ?? 0) || 0;
  const planPerks = normalizePerkFlags(entitlements.perkFlags);
  const perks = applyLocalPerks({
    planPerks,
    localPerksAdd: eligibility?.localPerksAdd,
    localPerksRemove: eligibility?.localPerksRemove,
  });
  const freeProductRefs = Array.isArray(entitlements.freeProductRefs)
    ? entitlements.freeProductRefs
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 50)
    : [];

  const { start, end } = periodBounds(member);
  // Capped plans must have a period window — never count all-time history.
  if (
    entriesPerPeriod != null &&
    entriesPerPeriod >= 0 &&
    (!start || !end)
  ) {
    throw new MembershipBillingError(
      MembershipErrorCodes.MEMBERSHIP_NOT_ACTIVE,
      "Membership period bounds are missing — cannot compute remaining entitlements"
    );
  }
  const entriesUsed = await countConsumedEntries({
    orgId,
    guestMembershipId: member.id,
    periodStart: start,
    periodEnd: end,
    tx: opts?.tx,
  });
  const remainingEntries =
    entriesPerPeriod == null
      ? null
      : Math.max(0, entriesPerPeriod - entriesUsed);

  const settings = await loadSettingsBundle(orgId, locId, opts?.tx);
  // Agreement gate must match activationGates (home venue + plan), not acting-park override alone.
  const homeSettings =
    locId === member.homeLocationId
      ? settings
      : await loadSettingsBundle(orgId, member.homeLocationId, opts?.tx);
  const hard = evaluateHardBlocks({
    member,
    eligible: multi.eligible,
    settings: {
      ...settings,
      requireAgreementBeforeActive: homeSettings.requireAgreementBeforeActive,
    },
  });
  const warnings = hard.warnings;
  let blocked = hard.blocked;
  let blockReason = hard.blockReason;

  const visitsExhausted =
    !blocked &&
    remainingEntries !== null &&
    remainingEntries <= 0;
  // Structured exhausted reason for desks without conflating discount/perk eligibility.
  if (visitsExhausted && !blockReason) {
    blockReason = "exhausted";
  }

  const familyMembers = [
    {
      guestProfileId: member.guestProfileId,
      role: "primary",
      firstName: member.guestProfile.firstName,
      lastName: member.guestProfile.lastName,
      photoUrl: member.guestProfile.photoUrl,
    },
    ...member.familyLinks
      .filter((f) => f.guestProfileId !== member.guestProfileId)
      .map((f) => ({
        guestProfileId: f.guestProfileId,
        role: f.role,
        firstName: f.guestProfile.firstName,
        lastName: f.guestProfile.lastName,
        photoUrl: f.guestProfile.photoUrl,
      })),
  ];

  // Lean path skips re-fetch — codes already on the locked bundle when redeeming.
  const barcodeOrCode = member.barcodeOrCode;
  const qrPayload = member.qrPayload;

  return {
    guestMembershipId: member.id,
    orgId,
    locationId: locId,
    visitStatus: multi.visitStatus,
    eligible: multi.eligible,
    status: member.status,
    cancelAtPeriodEnd: member.cancelAtPeriodEnd,
    blocked,
    blockReason,
    visitsExhausted,
    warnings,
    entriesPerPeriod,
    entriesUsed,
    remainingEntries,
    discountPercent: Math.min(100, Math.max(0, discountPercent)),
    perks,
    freeProductRefs,
    familyAllowed: member.plan.familyAllowed,
    familyMembers,
    member: {
      customMembershipId: member.customMembershipId,
      barcodeOrCode,
      qrPayload,
      photoUrl: member.photoUrl,
      guestProfileId: member.guestProfileId,
      firstName: member.guestProfile.firstName,
      lastName: member.guestProfile.lastName,
      guestPhotoUrl: member.guestProfile.photoUrl,
      homeLocationId: member.homeLocationId,
    },
    periodStart: start?.toISOString() ?? null,
    periodEnd: end?.toISOString() ?? null,
  };
}

/**
 * Membership discount helper for POS / online quote hooks.
 * Uses verifyBenefits — does not invent a second discount source.
 */
export async function applyMembershipDiscount(input: {
  guestMembershipId: string;
  locationId: string;
  amountMajor: number;
  orgId: string;
}): Promise<{
  allowed: boolean;
  blockReason: EntitlementBlockReason;
  discountPercent: number;
  discountAmount: number;
  payable: number;
  verify: VerifyBenefitsResult;
}> {
  const verify = await verifyBenefits(
    input.guestMembershipId,
    input.locationId,
    { orgId: requireId(input.orgId, "orgId") }
  );
  const amount = Number.isFinite(input.amountMajor)
    ? Math.max(0, input.amountMajor)
    : 0;
  // Discounts survive visit exhaustion — only hard blocks deny.
  if (verify.blocked || verify.discountPercent <= 0) {
    return {
      allowed: false,
      blockReason: verify.blocked
        ? verify.blockReason
        : verify.discountPercent <= 0
          ? null
          : verify.blockReason,
      discountPercent: verify.blocked ? 0 : verify.discountPercent,
      discountAmount: 0,
      payable: amount,
      verify,
    };
  }
  const discountAmount =
    Math.round(((amount * verify.discountPercent) / 100) * 100) / 100;
  return {
    allowed: true,
    blockReason: null,
    discountPercent: verify.discountPercent,
    discountAmount,
    payable: Math.max(0, Math.round((amount - discountAmount) * 100) / 100),
    verify,
  };
}

function resolveConsumeGuests(
  member: MemberBundle,
  guestProfileIds: string[] | undefined,
  qtyHint: number
): string[] {
  const allowed = new Set<string>([
    member.guestProfileId,
    ...member.familyLinks.map((f) => f.guestProfileId),
  ]);
  const requested = (guestProfileIds ?? [])
    .filter((id) => isValidId(id))
    .filter((id, i, arr) => arr.indexOf(id) === i);

  if (requested.length === 0) {
    // Primary only — qty may still be > 1 for bulk visit without named guests.
    return Array.from({ length: Math.max(1, qtyHint) }, () => member.guestProfileId);
  }

  for (const id of requested) {
    if (!allowed.has(id)) {
      throw new MembershipBillingError(
        MembershipErrorCodes.FAMILY_MEMBER_REQUIRED,
        "Selected guest is not on this membership family"
      );
    }
  }
  return requested;
}

/**
 * consumeBenefit / redeemVisit — ledger + remaining decrement under row lock.
 * Pre-flight verify runs outside the transaction; only remaining recount +
 * ledger writes hold FOR UPDATE (remote Postgres cannot afford full verify in-tx).
 */
export async function consumeBenefit(
  input: ConsumeBenefitInput
): Promise<ConsumeBenefitResult> {
  const orgId = requireId(input.orgId, "orgId");
  const guestMembershipId = requireId(
    input.guestMembershipId,
    "guestMembershipId"
  );
  const locationId = requireId(input.locationId, "locationId");
  const kind = input.kind ?? "visit";
  const source = input.source ?? "admin";
  const idempotencyKey = input.idempotencyKey?.trim().slice(0, 128) || null;

  const verifyBefore = await verifyBenefits(guestMembershipId, locationId, {
    orgId,
    lean: true,
  });

  if (verifyBefore.blocked) {
    throwIfBlocked(verifyBefore.blockReason, verifyBefore.status);
  }

  if (kind === "perk_consumed") {
    const perk = (input.perkFlag || "").trim();
    if (!perk || !verifyBefore.perks.includes(perk)) {
      throw new MembershipBillingError(
        MembershipErrorCodes.PERK_NOT_AVAILABLE,
        "Perk is not available at this venue"
      );
    }
  }

  if (kind === "free_product") {
    const ref =
      (typeof input.meta?.freeProductRef === "string"
        ? input.meta.freeProductRef.trim()
        : "") ||
      (input.perkFlag || "").trim();
    if (!ref || !verifyBefore.freeProductRefs.includes(ref)) {
      throw new MembershipBillingError(
        MembershipErrorCodes.PERK_NOT_AVAILABLE,
        "Free product is not included on this membership at this venue"
      );
    }
  }

  const rawQty = Math.floor(Number(input.qty ?? 1));
  const qtyHint = Number.isFinite(rawQty)
    ? Math.max(1, Math.min(50, rawQty))
    : 1;

  const txResult = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM guest_memberships
        WHERE id = ${guestMembershipId} AND "orgId" = ${orgId}
        FOR UPDATE
      `;

      if (idempotencyKey) {
        const prior = await tx.membershipUsageEvent.findFirst({
          where: {
            orgId,
            guestMembershipId,
            kind,
            meta: {
              path: ["idempotencyKey"],
              equals: idempotencyKey,
            },
          },
        });
        if (prior && !isUsageUndone(prior.meta)) {
          return { events: [prior] as MembershipUsageEvent[] };
        }
      }

      const member = await loadMemberBundle(orgId, guestMembershipId, tx);

      // Re-validate venue under the lock — archive between pre-verify and
      // commit must not stamp usage on a deleted park.
      const venueLocked = await tx.venueLocation.findFirst({
        where: { id: locationId, orgId },
        select: { id: true, status: true },
      });
      if (!venueLocked || venueLocked.status === "archived") {
        throw new MembershipBillingError(
          MembershipErrorCodes.VENUE_INVALID,
          "Venue not found or archived"
        );
      }

      // Re-validate under the lock — status/period/eligibility may have changed.
      const eligibility = await tx.membershipVenueEligibility.findFirst({
        where: { orgId, planId: member.planId, locationId },
      });
      const multi = computeVisitStatus({
        homeLocationId: member.homeLocationId,
        actingLocationId: locationId,
        eligibility: eligibility
          ? {
              eligible: eligibility.eligible,
              localPerksAdd: eligibility.localPerksAdd,
              localPerksRemove: eligibility.localPerksRemove,
            }
          : null,
      });
      const settings = await loadSettingsBundle(orgId, locationId, tx);
      const homeSettings =
        locationId === member.homeLocationId
          ? settings
          : await loadSettingsBundle(orgId, member.homeLocationId, tx);
      const locked = evaluateHardBlocks({
        member,
        eligible: multi.eligible,
        settings: {
          ...settings,
          requireAgreementBeforeActive: homeSettings.requireAgreementBeforeActive,
        },
      });
      if (locked.blocked) {
        throwIfBlocked(locked.blockReason, member.status);
      }

      if (kind === "perk_consumed") {
        const perk = (input.perkFlag || "").trim();
        const planPerks = normalizePerkFlags(
          parseEntitlements(member.plan.entitlements).perkFlags
        );
        const perks = applyLocalPerks({
          planPerks,
          localPerksAdd: eligibility?.localPerksAdd,
          localPerksRemove: eligibility?.localPerksRemove,
        });
        if (!perk || !perks.includes(perk)) {
          throw new MembershipBillingError(
            MembershipErrorCodes.PERK_NOT_AVAILABLE,
            "Perk is not available at this venue"
          );
        }
      }

      if (kind === "free_product") {
        const entitlementsLocked = parseEntitlements(member.plan.entitlements);
        const freeRefs = Array.isArray(entitlementsLocked.freeProductRefs)
          ? entitlementsLocked.freeProductRefs
              .filter((x): x is string => typeof x === "string")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
        const ref =
          (typeof input.meta?.freeProductRef === "string"
            ? input.meta.freeProductRef.trim()
            : "") ||
          (input.perkFlag || "").trim();
        if (!ref || !freeRefs.includes(ref)) {
          throw new MembershipBillingError(
            MembershipErrorCodes.PERK_NOT_AVAILABLE,
            "Free product is not included on this membership at this venue"
          );
        }
      }

      const consumers = resolveConsumeGuests(
        member,
        input.guestProfileIds,
        qtyHint
      );
      const consumeQty =
        input.guestProfileIds && input.guestProfileIds.length > 0
          ? consumers.length
          : qtyHint;

      const entitlements = parseEntitlements(member.plan.entitlements);
      const familyEnt =
        member.familyEntitlements &&
        typeof member.familyEntitlements === "object" &&
        !Array.isArray(member.familyEntitlements)
          ? (member.familyEntitlements as MembershipPlanEntitlements)
          : null;
      const entriesPerPeriod =
        familyEnt?.entriesPerPeriod !== undefined
          ? familyEnt.entriesPerPeriod ?? null
          : entitlements.entriesPerPeriod ?? null;

      let runningRemaining: number | null = null;
      if (kind === "visit" || kind === "redeem") {
        const { start, end } = periodBounds(member);
        if (entriesPerPeriod != null && entriesPerPeriod >= 0 && (!start || !end)) {
          throw new MembershipBillingError(
            MembershipErrorCodes.MEMBERSHIP_NOT_ACTIVE,
            "Membership period bounds are missing — cannot redeem"
          );
        }
        const entriesUsed = await countConsumedEntries({
          orgId,
          guestMembershipId,
          periodStart: start,
          periodEnd: end,
          tx,
        });
        runningRemaining =
          entriesPerPeriod == null
            ? null
            : Math.max(0, entriesPerPeriod - entriesUsed);
        if (
          runningRemaining !== null &&
          (runningRemaining <= 0 || consumeQty > runningRemaining)
        ) {
          throw new MembershipBillingError(
            MembershipErrorCodes.ENTITLEMENT_EXHAUSTED,
            "Not enough remaining entitlements for this redeem"
          );
        }
      } else {
        // Perk / free_product — stamp remaining snapshot from locked recount when capped.
        const { start, end } = periodBounds(member);
        if (entriesPerPeriod != null && start && end) {
          const entriesUsed = await countConsumedEntries({
            orgId,
            guestMembershipId,
            periodStart: start,
            periodEnd: end,
            tx,
          });
          runningRemaining = Math.max(0, entriesPerPeriod - entriesUsed);
        } else if (verifyBefore.remainingEntries != null) {
          runningRemaining = verifyBefore.remainingEntries;
        }
      }

      const events: MembershipUsageEvent[] = [];
      const visitLabel = multi.visitStatus;

      if (kind === "visit" || kind === "redeem") {
        const targets =
          input.guestProfileIds && input.guestProfileIds.length > 0
            ? consumers
            : [member.guestProfileId];
        const perEventQty =
          input.guestProfileIds && input.guestProfileIds.length > 0
            ? 1
            : consumeQty;

        for (let i = 0; i < targets.length; i++) {
          const guestProfileId = targets[i];
          if (runningRemaining !== null) {
            runningRemaining = Math.max(0, runningRemaining - perEventQty);
          }
          const meta: Record<string, unknown> = {
            ...(input.meta ?? {}),
            visitStatus: visitLabel,
            perkFlag: input.perkFlag ?? null,
          };
          if (idempotencyKey && i === 0) meta.idempotencyKey = idempotencyKey;

          const event = await tx.membershipUsageEvent.create({
            data: {
              orgId,
              locationId,
              guestMembershipId,
              guestProfileId,
              kind,
              qty: perEventQty,
              remainingAfter: runningRemaining,
              meta: meta as Prisma.InputJsonValue,
              actorUserId: input.actorUserId ?? null,
              source,
            },
          });
          events.push(event);
        }

        // First visit/redeem: optional term from daysValidFromRedemption.
        const daysFromRedeem = member.plan.daysValidFromRedemption;
        if (
          daysFromRedeem != null &&
          Number.isInteger(daysFromRedeem) &&
          daysFromRedeem >= 1
        ) {
          const prior = await tx.membershipUsageEvent.count({
            where: {
              orgId,
              guestMembershipId,
              kind: { in: ["visit", "redeem"] },
              id: { notIn: events.map((e) => e.id) },
            },
          });
          if (prior === 0) {
            const now = new Date();
            const redeemEnds = addDaysFrom(now, daysFromRedeem);
            const nextEndsAt =
              member.endsAt == null || redeemEnds.getTime() < member.endsAt.getTime()
                ? redeemEnds
                : member.endsAt;
            await tx.guestMembership.update({
              where: { id: guestMembershipId },
              data: { endsAt: nextEndsAt },
            });
          }
        }
      } else {
        const meta: Record<string, unknown> = {
          ...(input.meta ?? {}),
          visitStatus: visitLabel,
          perkFlag: input.perkFlag ?? null,
        };
        if (idempotencyKey) meta.idempotencyKey = idempotencyKey;
        const event = await tx.membershipUsageEvent.create({
          data: {
            orgId,
            locationId,
            guestMembershipId,
            guestProfileId: consumers[0] ?? member.guestProfileId,
            kind,
            qty: consumeQty,
            remainingAfter: runningRemaining,
            meta: meta as Prisma.InputJsonValue,
            actorUserId: input.actorUserId ?? null,
            source,
          },
        });
        events.push(event);
      }

      return { events };
    },
    {
      isolationLevel: PrismaNS.TransactionIsolationLevel.ReadCommitted,
      maxWait: 8_000,
      // Remote Postgres RTT can exceed 10s under lock; keep fail-closed but generous.
      timeout: 20_000,
    }
  );

  // Lean post-verify — skip scan-code writes; remainingEntries is the hot field.
  const verify = await verifyBenefits(guestMembershipId, locationId, {
    orgId,
    lean: true,
  });
  return {
    events: txResult.events,
    remainingEntries: verify.remainingEntries,
    visitStatus: verify.visitStatus,
    verify,
  };
}

/** Alias — redeemVisit is the desk-facing name for visit consume. */
export async function redeemVisit(
  input: ConsumeBenefitInput
): Promise<ConsumeBenefitResult> {
  return consumeBenefit({ ...input, kind: input.kind ?? "visit" });
}

/**
 * Undo / reverse a consume when permissioned.
 * Marks original meta.undoneAt and writes an undo ledger row.
 */
export async function undoConsumeBenefit(input: {
  orgId: string;
  usageEventId: string;
  actorUserId?: string | null;
  source?: MembershipUsageSource;
}): Promise<{
  original: MembershipUsageEvent;
  undo: MembershipUsageEvent;
  remainingEntries: number | null;
}> {
  const orgId = requireId(input.orgId, "orgId");
  const usageEventId = requireId(input.usageEventId, "usageEventId");

  return prisma.$transaction(
    async (tx) => {
      // Lock usage row first so concurrent undos serialize on the same event.
      await tx.$queryRaw`
        SELECT id FROM membership_usage_events
        WHERE id = ${usageEventId} AND "orgId" = ${orgId}
        FOR UPDATE
      `;

      const original = await tx.membershipUsageEvent.findFirst({
        where: { id: usageEventId, orgId },
      });
      if (!original) {
        throw new MembershipBillingError(
          MembershipErrorCodes.USAGE_EVENT_NOT_FOUND,
          "Usage event not found"
        );
      }
      if (
        original.kind !== "visit" &&
        original.kind !== "redeem" &&
        original.kind !== "perk_consumed" &&
        original.kind !== "free_product"
      ) {
        throw new MembershipBillingError(
          MembershipErrorCodes.UNDO_NOT_ALLOWED,
          "Only consume events can be undone"
        );
      }
      if (isUsageUndone(original.meta)) {
        throw new MembershipBillingError(
          MembershipErrorCodes.UNDO_NOT_ALLOWED,
          "Usage event already undone"
        );
      }

      await tx.$queryRaw`
        SELECT id FROM guest_memberships
        WHERE id = ${original.guestMembershipId} AND "orgId" = ${orgId}
        FOR UPDATE
      `;

      // Re-check after membership lock — another undo may have finished waiting.
      const fresh = await tx.membershipUsageEvent.findFirst({
        where: { id: usageEventId, orgId },
      });
      if (!fresh || isUsageUndone(fresh.meta)) {
        throw new MembershipBillingError(
          MembershipErrorCodes.UNDO_NOT_ALLOWED,
          "Usage event already undone"
        );
      }

      const prevMeta =
        fresh.meta &&
        typeof fresh.meta === "object" &&
        !Array.isArray(fresh.meta)
          ? { ...(fresh.meta as Record<string, unknown>) }
          : {};
      prevMeta.undoneAt = new Date().toISOString();
      prevMeta.undoneByUserId = input.actorUserId ?? null;

      const updatedOriginal = await tx.membershipUsageEvent.update({
        where: { id: fresh.id },
        data: { meta: prevMeta as Prisma.InputJsonValue },
      });

      const member = await tx.guestMembership.findFirst({
        where: { id: fresh.guestMembershipId, orgId },
      });
      const { start, end } = member
        ? periodBounds(member)
        : { start: null, end: null };
      const used = member
        ? await countConsumedEntries({
            orgId,
            guestMembershipId: member.id,
            periodStart: start,
            periodEnd: end,
            tx,
          })
        : 0;
      let cap: number | null = null;
      if (member) {
        const plan = await tx.membershipPlan.findFirst({
          where: { id: member.planId },
          select: { entitlements: true },
        });
        const entitlements = parseEntitlements(plan?.entitlements);
        const familyEnt =
          member.familyEntitlements &&
          typeof member.familyEntitlements === "object" &&
          !Array.isArray(member.familyEntitlements)
            ? (member.familyEntitlements as MembershipPlanEntitlements)
            : null;
        cap =
          familyEnt?.entriesPerPeriod !== undefined
            ? familyEnt.entriesPerPeriod ?? null
            : entitlements.entriesPerPeriod ?? null;
      }
      const remainingAfter =
        cap == null ? null : Math.max(0, Number(cap) - used);

      const undo = await tx.membershipUsageEvent.create({
        data: {
          orgId,
          locationId: fresh.locationId,
          guestMembershipId: fresh.guestMembershipId,
          guestProfileId: fresh.guestProfileId,
          kind: "undo",
          qty: fresh.qty,
          remainingAfter,
          meta: {
            reversesEventId: fresh.id,
          } as Prisma.InputJsonValue,
          actorUserId: input.actorUserId ?? null,
          source: input.source ?? "admin",
        },
      });

      return { original: updatedOriginal, undo, remainingEntries: remainingAfter };
    },
    {
      isolationLevel: PrismaNS.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 12_000,
    }
  );
}

/** Lookup membership by custom id / barcode / qr for desk search. */
export async function findMembershipForRedeem(
  orgId: string,
  query: string
): Promise<GuestMembership | null> {
  const q = query.trim();
  if (!q) return null;
  if (isValidId(q)) {
    const byId = await prisma.guestMembership.findFirst({
      where: { orgId, id: q },
    });
    if (byId) return byId;
  }
  return prisma.guestMembership.findFirst({
    where: {
      orgId,
      OR: [
        { customMembershipId: { equals: q, mode: "insensitive" } },
        { barcodeOrCode: { equals: q, mode: "insensitive" } },
      ],
    },
  });
}
