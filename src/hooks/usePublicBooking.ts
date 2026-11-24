import { useQuery } from "@tanstack/react-query";
import { isValidId } from "@/lib/ids";
import {
  getPublicVenue,
  listPublicProducts,
  listPublicAvailability,
  publicBookingKeys,
} from "@/services/publicBooking";

export function usePublicVenue(orgSlug: string, venueSlug: string) {
  return useQuery({
    queryKey: publicBookingKeys.venue(orgSlug, venueSlug),
    queryFn: () => getPublicVenue(orgSlug, venueSlug),
    enabled: Boolean(orgSlug && venueSlug),
  });
}

export function usePublicProducts(orgSlug: string, venueSlug: string) {
  return useQuery({
    queryKey: publicBookingKeys.products(orgSlug, venueSlug),
    queryFn: () => listPublicProducts(orgSlug, venueSlug),
    enabled: Boolean(orgSlug && venueSlug),
  });
}

export function usePublicAvailability(
  productId: string,
  date?: string,
  qty?: number,
  range?: { from?: string; to?: string }
) {
  const idOk = isValidId(productId);
  return useQuery({
    queryKey: publicBookingKeys.availability(
      productId,
      date,
      qty,
      range?.from,
      range?.to
    ),
    queryFn: () =>
      listPublicAvailability({
        productId,
        date,
        qty,
        from: range?.from,
        to: range?.to,
      }),
    // Avoid firing (and toasting "Invalid productId") for bad URL segments.
    enabled: idOk,
    // Keep seats honest while another guest may be holding the same slot.
    refetchInterval: idOk ? 12_000 : false,
    refetchOnWindowFocus: idOk,
  });
}
