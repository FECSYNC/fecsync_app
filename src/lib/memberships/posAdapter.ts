/**
 * POS → Memberships billing + entitlement bridge (Feature 08 Phase 2–3).
 *
 * POS Feature is not fully shipped (bookings-only adapters exist). Export
 * functions so POS can call billingEngine + entitlementEngine without forking.
 *
 * Product→membership upgrade: creates GuestMembership via sellMembership with
 * idempotency key `pos-upgrade:{posSaleLineId}`. Does NOT mutate a POS sale
 * ledger (absent here) — callers should add a compensating membership line /
 * mark the original product line upgraded in their own ledger.
 */
import {
  sellMembership,
  upgradeMembership,
  downgradeMembership,
  renewMembership,
  type SellMembershipInput,
  type MembershipLifecycleResult,
} from "@/lib/memberships/billingEngine";
import {
  verifyBenefits,
  consumeBenefit,
  redeemVisit,
  undoConsumeBenefit,
  applyMembershipDiscount,
  type ConsumeBenefitInput,
  type VerifyBenefitsResult,
  type ConsumeBenefitResult,
} from "@/lib/memberships/entitlementEngine";
import {
  MembershipBillingError,
  MembershipErrorCodes,
} from "@/lib/memberships/errors";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import { requireId, isValidId } from "@/lib/ids";
import { resolveDefaultHomeLocationId } from "@/lib/memberships/settings";

export type PosMembershipSellAdapterInput = Omit<
  SellMembershipInput,
  "source"
> & {
  /** POS open-sale / line id used as sell idempotency key when not set. */
  posSaleLineId?: string;
};

export async function posSellMembership(
  input: PosMembershipSellAdapterInput
): Promise<MembershipLifecycleResult> {
  const idempotencyKey =
    input.idempotencyKey?.trim() ||
    (input.posSaleLineId ? `pos:${input.posSaleLineId}` : "");
  return sellMembership({
    ...input,
    idempotencyKey,
    source: "pos",
  });
}

export async function posUpgradeMembership(
  input: Parameters<typeof upgradeMembership>[0]
): Promise<MembershipLifecycleResult> {
  return upgradeMembership(input);
}

export async function posDowngradeMembership(
  input: Parameters<typeof downgradeMembership>[0]
): Promise<MembershipLifecycleResult> {
  return downgradeMembership(input);
}

export async function posRenewMembership(
  input: Parameters<typeof renewMembership>[0]
): Promise<MembershipLifecycleResult> {
  return renewMembership(input);
}

export async function posVerifyMembership(
  guestMembershipId: string,
  locationId: string,
  orgId: string
): Promise<VerifyBenefitsResult> {
  return verifyBenefits(guestMembershipId, locationId, { orgId });
}

export async function posRedeemMembership(
  input: Omit<ConsumeBenefitInput, "source"> & {
    source?: ConsumeBenefitInput["source"];
  }
): Promise<ConsumeBenefitResult> {
  return redeemVisit({ ...input, source: input.source ?? "pos" });
}

export async function posUndoMembershipRedeem(
  input: Parameters<typeof undoConsumeBenefit>[0]
) {
  return undoConsumeBenefit({ ...input, source: input.source ?? "pos" });
}

export async function posApplyMembershipDiscount(
  input: Parameters<typeof applyMembershipDiscount>[0]
) {
  return applyMembershipDiscount(input);
}

export type PosUpgradeProductToMembershipInput = {
  orgId: string;
  actorUserId: string;
  /** Required for idempotency — POS sale line / adapter key. */
  posSaleLineId: string;
  guestProfileId: string;
  planId: string;
  locationId: string;
  homeLocationId?: string;
  familyMemberIds?: string[];
  paymentMethod?: SellMembershipInput["paymentMethod"];
  collectedAmount?: number;
  allowPendingWithoutStripe?: boolean;
  /** Original non-membership product ref for audit only. */
  originalProductRef?: string;
  originalProductName?: string;
};

/**
 * Upgrade a non-membership POS product/sale line into a membership sell.
 * Idempotent on posSaleLineId. Does not rewrite POS ledger rows (absent).
 */
export async function posUpgradeProductToMembership(
  input: PosUpgradeProductToMembershipInput
): Promise<
  MembershipLifecycleResult & {
    compensatingNote: string;
    originalProductRef: string | null;
  }
> {
  const orgId = requireId(input.orgId, "orgId");
  const posSaleLineId = String(input.posSaleLineId || "").trim();
  if (!posSaleLineId || posSaleLineId.length > 128) {
    throw new MembershipBillingError(
      MembershipErrorCodes.AMOUNT_REQUIRED,
      "posSaleLineId is required for product→membership upgrade"
    );
  }
  if (!isValidId(input.guestProfileId) || !isValidId(input.planId)) {
    throw new MembershipBillingError(
      MembershipErrorCodes.GUEST_NOT_FOUND,
      "guestProfileId and planId are required"
    );
  }
  const locationId = requireId(input.locationId, "locationId");
  const homeLocationId = input.homeLocationId
    ? requireId(input.homeLocationId, "homeLocationId")
    : ((await resolveDefaultHomeLocationId(orgId, locationId)) ?? locationId);

  const idempotencyKey = `pos-upgrade:${posSaleLineId}`;
  const result = await sellMembership({
    orgId,
    guestProfileId: input.guestProfileId,
    planId: input.planId,
    locationId,
    homeLocationId,
    familyMemberIds: input.familyMemberIds,
    paymentMethod: input.paymentMethod ?? "collected",
    collectedAmount: input.collectedAmount,
    actorUserId: input.actorUserId,
    idempotencyKey,
    source: "pos",
    allowPendingWithoutStripe: input.allowPendingWithoutStripe,
  });

  logStaffActivityEntry(
    { sub: input.actorUserId, orgId },
    {
      action: "memberships.pos.upgrade_product",
      entityType: "GuestMembership",
      entityId: result.membership.id,
      description: `Upgraded non-membership sale line ${posSaleLineId} → membership ${result.membership.customMembershipId}`,
      metadata: {
        posSaleLineId,
        originalProductRef: input.originalProductRef ?? null,
        originalProductName: input.originalProductName ?? null,
      },
    }
  );

  return {
    ...result,
    originalProductRef: input.originalProductRef ?? null,
    compensatingNote:
      "Membership created via billingEngine. POS should add a compensating membership sale line (or mark the original product line upgraded) without deleting historical tender rows.",
  };
}

export { verifyBenefits, consumeBenefit, redeemVisit, applyMembershipDiscount };
