import type { QueryClient } from "@tanstack/react-query";
import { broadcastPartyChange } from "@/utils/partyCrossTabSync";

/**
 * Ticketing / bookings React Query roots (admin + guest profile + public wizard).
 * Used on logout, plan-cap flips, and HQ park-scope changes.
 */
export function invalidateTicketingQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ["admin", "ticketing"] });
  void queryClient.invalidateQueries({ queryKey: ["admin", "bookings"] });
  void queryClient.invalidateQueries({ queryKey: ["admin", "parties"] });
  void queryClient.invalidateQueries({
    queryKey: ["admin", "booking-invoices"],
  });
  void queryClient.invalidateQueries({
    queryKey: ["admin", "booking-payments"],
  });
  void queryClient.invalidateQueries({
    queryKey: ["admin", "booking-accounts"],
  });
  void queryClient.invalidateQueries({ queryKey: ["me", "bookings"] });
  void queryClient.invalidateQueries({ queryKey: ["public", "booking"] });
}

/**
 * After create / cancel / confirm / edit / refund / assign / tax / payment —
 * keep list, calendar occupancy, availability, invoices, and guest caches aligned.
 */
export function invalidateAfterBookingMutation(queryClient: QueryClient) {
  broadcastPartyChange();
  void queryClient.invalidateQueries({ queryKey: ["admin", "bookings"] });
  void queryClient.invalidateQueries({ queryKey: ["admin", "parties"] });
  void queryClient.invalidateQueries({
    queryKey: ["admin", "booking-invoices"],
  });
  void queryClient.invalidateQueries({
    queryKey: ["admin", "booking-payments"],
  });
  void queryClient.invalidateQueries({
    queryKey: ["admin", "ticketing", "sessions"],
  });
  void queryClient.invalidateQueries({
    queryKey: ["admin", "ticketing", "availability"],
  });
  void queryClient.invalidateQueries({
    queryKey: ["admin", "ticketing", "stock-periods"],
  });
  void queryClient.invalidateQueries({ queryKey: ["me", "bookings"] });
  void queryClient.invalidateQueries({ queryKey: ["public", "booking"] });
}

/** Hard-drop (logout / account switch) — same roots as invalidate. */
export function removeTicketingQueries(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: ["admin", "ticketing"] });
  queryClient.removeQueries({ queryKey: ["admin", "bookings"] });
  queryClient.removeQueries({ queryKey: ["admin", "parties"] });
  queryClient.removeQueries({ queryKey: ["admin", "booking-invoices"] });
  queryClient.removeQueries({ queryKey: ["admin", "booking-payments"] });
  queryClient.removeQueries({ queryKey: ["admin", "booking-accounts"] });
  queryClient.removeQueries({ queryKey: ["me", "bookings"] });
  queryClient.removeQueries({ queryKey: ["public", "booking"] });
}
