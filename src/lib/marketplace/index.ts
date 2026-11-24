/**
 * Marketplace module barrel.
 *
 * World A (SaaS): Organization.stripeCustomerId / stripeSubscriptionId +
 * metadata type=company_subscription — see src/lib/companyBilling.ts
 * World B (Marketplace): OrganizationMarketplaceAccount + marketplace_booking —
 * this module. Step 3 adds VenueLocationMarketplaceAccount for franchise parks.
 * World C (platform commerce): venue_booking / order / tailoring — franchise
 * park charge-ready paths use Connect destination via resolveGuestPayoutDestination.
 */

export * from "./fees";
export * from "./assertChargeReady";
export * from "./guestPayoutDestination";
export * from "./provider";
export * from "./account";
export * from "./parkAccount";
export * from "./packages";
export * from "./bookingCheckout";
export * from "./refunds";
