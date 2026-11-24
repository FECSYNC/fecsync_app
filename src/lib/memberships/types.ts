/**
 * Guest park Memberships — shared types (Feature 08).
 * Distinct from staff org seats (`src/lib/membership.ts`).
 */

import type {
  GuestMembershipStatus,
  MembershipIntervalUnit,
  MembershipPlanBilling,
  MembershipPlanType,
  MembershipSellChannel,
  MembershipVisitStatus,
} from "@prisma/client";

/** Flexible cycle: intervalCount + intervalUnit (e.g. 1 month, 3 month, 14 day). */
export type MembershipCycle = {
  intervalCount: number | null;
  intervalUnit: MembershipIntervalUnit | null;
};

/**
 * Plan entitlements JSON SSOT (entitlementEngine reads this — Phase 3).
 * Prefer this over a parallel normalized table for v1.
 */
export type MembershipPlanEntitlements = {
  /** Visits / entries allowed per billing period (null = unlimited). */
  entriesPerPeriod?: number | null;
  discountPercent?: number | null;
  /** Family / group size including primary. */
  guestCount?: number | null;
  perkFlags?: string[];
  freeProductRefs?: string[];
  /**
   * Products offered as add-ons at membership purchase (Online Booking product
   * ids, or `membership:{planId}` for other membership plans).
   */
  addOnProductIds?: string[];
  /** Guest-info forms attached to this plan (Forms / Digital Waivers catalog ids). */
  formIds?: string[];
  /** Denormalized labels for formIds (picker chips + reports). */
  attachedForms?: { id: string; name: string }[];
  /**
   * Percent used when overrideTax is on. Null follows Tax Settings.
   * 0 means no tax on this plan.
   */
  overrideTaxRate?: number | null;
  ticketHolderCaptured?: boolean;
  customTicketIdCaptured?: boolean;
  waiverRequired?: boolean;
  [key: string]: unknown;
};

/** ROLLER-style membership variation row (catalog merchandising). */
export type MembershipPlanVariation = {
  name: string;
  sell: boolean;
  /** Decimal string, e.g. "29.00". */
  price: string;
  /** one_time → plan billing fixed; recurring → recurring. */
  frequency: "one_time" | "recurring";
  /** Optional installment / payment note (display only until billing supports it). */
  payments: string | null;
  intervalCount?: number | null;
  intervalUnit?: MembershipIntervalUnit | null;
};

export type MembershipPlanDto = {
  id: string;
  orgId: string;
  locationId: string | null;
  name: string;
  description: string | null;
  billing: MembershipPlanBilling;
  intervalCount: number | null;
  intervalUnit: MembershipIntervalUnit | null;
  price: string;
  currency: string;
  entitlements: MembershipPlanEntitlements;
  familyAllowed: boolean;
  upgradeGroupKey: string | null;
  agreementRequired: boolean;
  pauseAllowed: boolean;
  /** Content */
  membershipType: MembershipPlanType;
  detailedDescription: string | null;
  physicalPassMessage: string | null;
  imageUrl: string | null;
  tags: string[];
  /** Sales availability */
  daysValidFromPurchase: number | null;
  daysValidFromRedemption: number | null;
  redemptionStartsAt: string | null;
  redemptionEndsAt: string | null;
  customRedemptionDescription: string | null;
  salesStartsAt: string | null;
  salesEndsAt: string | null;
  hideFromOnlineSales: boolean;
  /** Additional options */
  addOnsEnabled: boolean;
  alternateAddress: string | null;
  cancellationTerms: string | null;
  formsEnabled: boolean;
  instructions: string | null;
  reportingCategory: string | null;
  /** Membership catalog folder (MembershipCategory), not shop ProductCategory. */
  categoryId: string | null;
  categoryName: string | null;
  overrideTax: boolean;
  termsAndConditions: string | null;
  variations: MembershipPlanVariation[];
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GuestProfileDto = {
  id: string;
  orgId: string;
  locationId: string | null;
  userId: string | null;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  photoUrl: string | null;
  postalCode: string | null;
  hasStripeCustomer: boolean;
  bannedAt: string | null;
  bannedReason: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GuestMembershipDto = {
  id: string;
  orgId: string;
  locationId: string;
  homeLocationId: string;
  guestProfileId: string;
  planId: string;
  status: GuestMembershipStatus;
  startsAt: string | null;
  endsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  customMembershipId: string;
  barcodeOrCode: string | null;
  photoUrl: string | null;
  source: MembershipSellChannel;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  creditBalanceMinor: number;
  visitStatus: MembershipVisitStatus | null;
  hasStripeSubscription: boolean;
  createdAt: string;
  updatedAt: string;
};

/** List row with guest + plan labels for the Members table. */
export type GuestMembershipListItem = GuestMembershipDto & {
  guest: {
    id: string;
    firstName: string;
    lastName: string;
    displayName: string;
    email: string | null;
    phone: string | null;
    userId: string | null;
  };
  plan: {
    id: string;
    name: string;
    billing: string;
    price: string;
    currency: string;
    categoryId: string | null;
    categoryName: string | null;
  };
  homeLocation: { id: string; name: string } | null;
};

export type MembershipSettingsDto = {
  id: string;
  orgId: string;
  locationId: string | null;
  requirePhotoOnRedeem: boolean;
  requireAgreementBeforeActive: boolean;
  dunningEnabled: boolean;
  clickToCancelEnabled: boolean;
  cancelAlternativesEnabled: boolean;
  graceDays: number | null;
  allowPause: boolean;
  walletPassEnabled: boolean;
  defaultHomeLocationId: string | null;
  other: Record<string, unknown> | null;
  /** False when no row is stored for this scope yet (built-in or inherited values). */
  persisted: boolean;
  /**
   * True when a park scope has no saved row and the fields are the org default
   * (or built-in defaults when the org has no row either).
   */
  inherited: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MembershipVenueEligibilityDto = {
  id: string;
  orgId: string;
  planId: string;
  locationId: string;
  eligible: boolean;
  localPerksAdd: unknown;
  localPerksRemove: unknown;
  createdAt: string;
  updatedAt: string;
};

export const MEMBERSHIP_INTERVAL_UNITS: readonly MembershipIntervalUnit[] = [
  "day",
  "week",
  "month",
  "year",
] as const;

export const MEMBERSHIP_BILLING_MODES: readonly MembershipPlanBilling[] = [
  "recurring",
  "fixed",
] as const;

export const MEMBERSHIP_PLAN_TYPES: readonly MembershipPlanType[] = [
  "single",
  "group",
] as const;

/** Blank MembershipSettings.graceDays — billing, dunning, and guest cancel use this. */
export const MEMBERSHIP_GRACE_DAYS_WHEN_UNSET = 7;
