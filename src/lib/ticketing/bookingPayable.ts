/**
 * Shared payable-status gate for tenders + invoices (keeps invoices off the
 * heavy payments module import graph).
 */
/** Stripe metadata types settled by the venue booking handler (`venue_party` is a party alias). */
export function isVenueBookingPaymentType(type: string | null | undefined): boolean {
  return type === "venue_booking" || type === "venue_party";
}

export function isBookingStatusPayable(status: string): boolean {
  return ["hold", "reserved", "pending_payment", "confirmed", "draft"].includes(
    status
  );
}
