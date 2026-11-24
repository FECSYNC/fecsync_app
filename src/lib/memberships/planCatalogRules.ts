/**
 * MembershipPlan merchandising / availability rules shared by sell + redeem.
 */
import type {
  MembershipPlan,
  MembershipSellChannel,
  Prisma,
} from "@prisma/client";
import {
  MembershipBillingError,
  MembershipErrorCodes,
} from "@/lib/memberships/errors";
import { addMembershipCycle } from "@/lib/memberships/cycles";

export type PlanSellabilityFields = Pick<
  MembershipPlan,
  | "archivedAt"
  | "hideFromOnlineSales"
  | "salesStartsAt"
  | "salesEndsAt"
  | "daysValidFromPurchase"
  | "intervalCount"
  | "intervalUnit"
  | "billing"
>;

export type PlanRedemptionFields = Pick<
  MembershipPlan,
  "redemptionStartsAt" | "redemptionEndsAt" | "daysValidFromRedemption"
>;

/** Guest-safe slice of plan merchandising for self-serve / desk detail. */
export const GUEST_SAFE_PLAN_SELECT = {
  id: true,
  name: true,
  description: true,
  detailedDescription: true,
  imageUrl: true,
  membershipType: true,
  billing: true,
  currency: true,
  price: true,
  intervalUnit: true,
  intervalCount: true,
  upgradeGroupKey: true,
  pauseAllowed: true,
  familyAllowed: true,
  instructions: true,
  termsAndConditions: true,
  cancellationTerms: true,
  customRedemptionDescription: true,
  reportingCategory: true,
  categoryId: true,
  hideFromOnlineSales: true,
  salesStartsAt: true,
  salesEndsAt: true,
} as const;

export function isPlanInSalesWindow(
  plan: Pick<MembershipPlan, "salesStartsAt" | "salesEndsAt">,
  now: Date = new Date()
): boolean {
  if (plan.salesStartsAt && plan.salesStartsAt.getTime() > now.getTime()) {
    return false;
  }
  if (plan.salesEndsAt && plan.salesEndsAt.getTime() < now.getTime()) {
    return false;
  }
  return true;
}

export function isPlanInRedemptionWindow(
  plan: Pick<MembershipPlan, "redemptionStartsAt" | "redemptionEndsAt">,
  now: Date = new Date()
): boolean {
  if (
    plan.redemptionStartsAt &&
    plan.redemptionStartsAt.getTime() > now.getTime()
  ) {
    return false;
  }
  if (plan.redemptionEndsAt && plan.redemptionEndsAt.getTime() < now.getTime()) {
    return false;
  }
  return true;
}

/** Prisma where fragment for upgrade / public catalog lists. */
export function sellablePlanWhere(
  now: Date = new Date()
): Prisma.MembershipPlanWhereInput {
  return {
    archivedAt: null,
    hideFromOnlineSales: false,
    AND: [
      {
        OR: [{ salesStartsAt: null }, { salesStartsAt: { lte: now } }],
      },
      {
        OR: [{ salesEndsAt: null }, { salesEndsAt: { gte: now } }],
      },
    ],
  };
}

/**
 * Fail closed before creating/upgrading a membership on this plan.
 * Desk/POS may sell hideFromOnlineSales; online source may not.
 */
export function assertPlanSellable(
  plan: PlanSellabilityFields,
  source: MembershipSellChannel,
  now: Date = new Date()
): void {
  if (plan.archivedAt) {
    throw new MembershipBillingError(
      MembershipErrorCodes.PLAN_ARCHIVED,
      "Cannot sell an archived plan"
    );
  }
  if (source === "online" && plan.hideFromOnlineSales) {
    throw new MembershipBillingError(
      MembershipErrorCodes.PLAN_NOT_SELLABLE,
      "This membership is hidden from online sales"
    );
  }
  if (!isPlanInSalesWindow(plan, now)) {
    throw new MembershipBillingError(
      MembershipErrorCodes.PLAN_NOT_SELLABLE,
      "This membership is outside its online checkout sales period"
    );
  }
}

/**
 * Period / term bounds for a new sell (or renew).
 * `daysValidFromPurchase` overrides cycle length when set (ROLLER validity).
 */
export function membershipPeriodBounds(
  plan: PlanSellabilityFields,
  from: Date
): { start: Date; end: Date | null } {
  const start = from;
  if (
    plan.daysValidFromPurchase != null &&
    plan.daysValidFromPurchase >= 1
  ) {
    const end = new Date(from.getTime());
    end.setUTCDate(end.getUTCDate() + plan.daysValidFromPurchase);
    return { start, end };
  }
  const count = plan.intervalCount ?? 1;
  const unit = plan.intervalUnit ?? "month";
  return { start, end: addMembershipCycle(start, count, unit) };
}

/** Whether membership hard-ends at period end (fixed term or purchase-validity). */
export function membershipSetsEndsAt(plan: PlanSellabilityFields): boolean {
  if (plan.daysValidFromPurchase != null && plan.daysValidFromPurchase >= 1) {
    return true;
  }
  return plan.billing === "fixed";
}

export function addDaysFrom(from: Date, days: number): Date {
  const end = new Date(from.getTime());
  end.setUTCDate(end.getUTCDate() + days);
  return end;
}
