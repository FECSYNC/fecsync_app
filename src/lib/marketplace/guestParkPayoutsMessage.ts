/**
 * Client-safe guest copy for park Connect fail-closed errors.
 * Keep strings/matching in lockstep with admin messages in
 * `@/lib/marketplace/guestPayoutDestination` (that module imports prisma —
 * client components must import this file instead).
 */

export const PARK_PAYOUTS_NOT_READY_GUEST_MESSAGE =
  "Online card payment is not available for this park right now. Please contact the venue or try again later.";

export const PARK_PAYOUTS_ARCHIVED_GUEST_MESSAGE =
  "This park is not accepting online card payments right now. Please contact the venue.";

export const PARK_PAYOUTS_DISABLED_GUEST_MESSAGE =
  "Online card payment is not available for this park right now. Please contact the venue.";

/** Map admin/staff park payout ForbiddenError messages to guest-safe copy. */
export function guestSafeParkPayoutsMessage(adminMessage: string): string {
  const m = adminMessage.trim();
  if (
    m.includes("Park payouts are not ready") ||
    m.includes("/admin/payouts")
  ) {
    return PARK_PAYOUTS_NOT_READY_GUEST_MESSAGE;
  }
  if (
    m.includes("This franchise park is archived") ||
    (m.includes("archived") && m.toLowerCase().includes("park"))
  ) {
    return PARK_PAYOUTS_ARCHIVED_GUEST_MESSAGE;
  }
  if (m.includes("Park payouts are disabled")) {
    return PARK_PAYOUTS_DISABLED_GUEST_MESSAGE;
  }
  return m;
}
