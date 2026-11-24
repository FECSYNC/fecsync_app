import { useQuery } from "@tanstack/react-query";
import {
  adminBookingKeys,
  listAdminBookings,
  getAdminBooking,
  type AdminBookingListParams,
} from "@/services/adminBookings";
import { ADMIN_LIST_STALE_MS, adminListQueryDefaults } from "@/lib/adminListCache";
import { withAdminListSnapshot } from "@/lib/adminListSnapshot";

export function useAdminBookings(filters: AdminBookingListParams = {}) {
  const key = adminBookingKeys.list(filters);
  return useQuery({
    queryKey: key,
    queryFn: () => listAdminBookings(filters),
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(key),
    placeholderData: (previous) => previous,
  });
}

export function useAdminBooking(id: string) {
  return useQuery({
    queryKey: adminBookingKeys.detail(id),
    queryFn: () => getAdminBooking(id),
    enabled: Boolean(id),
    staleTime: ADMIN_LIST_STALE_MS,
    refetchOnMount: false,
  });
}
