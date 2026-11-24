/**
 * Park context React Query hooks — Growth multi-venue filter + park-locked seats.
 * Enterprise HQ still uses hqKeys / HqVenueSwitcher when entitled.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import {
  getAdminParkContext,
  setAdminParkContext,
  parkContextKeys,
  type ParkContextDto,
} from "@/services/parkContext";
import { hqKeys } from "@/services/hq";
import { venueLocationKeys } from "@/services/venueLocations";
import { broadcastHqLocationContextChange } from "@/utils/hqLocationContextSync";
import { invalidateTicketingQueries } from "@/utils/invalidateTicketingQueries";
import { invalidateMembershipsQueries } from "@/utils/invalidateMembershipsQueries";
import { invalidateWaiversQueries } from "@/utils/invalidateWaiversQueries";
import { invalidateMarketingQueries } from "@/utils/invalidateMarketingQueries";
import { P } from "@/lib/auth/permissions";
import { sessionIsDemoPlan } from "@/lib/demoPlanLock";

function canLoadParkContext(user: ReturnType<typeof useAuthStore.getState>["user"]) {
  if (!user?.orgId || sessionIsDemoPlan(user)) return false;
  const can = useAuthStore.getState().can;
  return (
    can(P.SettingsManage) ||
    can(P.AnalyticsRead) ||
    can(P.ProductsRead) ||
    can(P.ProductsWrite) ||
    can(P.OrdersRead) ||
    can(P.TicketingRead) ||
    can(P.TicketingWrite) ||
    can(P.BookingsRead) ||
    can(P.BookingsWrite) ||
    can(P.MembershipsRead) ||
    can(P.MembershipsWrite) ||
    can(P.MembershipsSell) ||
    can(P.MembershipsBilling) ||
    can(P.MembershipsAdmin) ||
    can(P.WaiversRead) ||
    can(P.WaiversWrite) ||
    can(P.WaiversVerify) ||
    can(P.WaiversAdmin) ||
    can(P.MarketingRead) ||
    can(P.MarketingWrite) ||
    can(P.MarketingSurveys) ||
    can(P.PosRead) ||
    can(P.PosSell) ||
    can(P.PosAdmin) ||
    can(P.PosCheckin) ||
    can(P.PosTabs) ||
    can(P.PosTillOpen)
  );
}

export function useParkContextQuery(enabled: boolean = true) {
  const user = useAuthStore((s) => s.user);
  const allow = enabled && canLoadParkContext(user);
  return useQuery({
    queryKey: parkContextKeys.context(),
    queryFn: getAdminParkContext,
    enabled: allow,
    staleTime: 30_000,
  });
}

export function useSetParkContextMutation() {
  const queryClient = useQueryClient();
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);

  return useMutation({
    mutationFn: (locationId: string | null) => setAdminParkContext(locationId),
    onSuccess: (ctx: ParkContextDto) => {
      void queryClient.setQueryData(parkContextKeys.context(), ctx);
      void queryClient.invalidateQueries({ queryKey: parkContextKeys.all });
      // HQ context shares Membership.hqSelectedLocationId — keep in sync.
      void queryClient.invalidateQueries({ queryKey: hqKeys.all });
      void queryClient.invalidateQueries({
        queryKey: venueLocationKeys.all,
      });
      invalidateTicketingQueries(queryClient);
      invalidateMembershipsQueries(queryClient);
      invalidateWaiversQueries(queryClient);
      invalidateMarketingQueries(queryClient);
      // Keep /me effectiveLocationId + hqSelectedLocationId aligned with preference.
      // force: coalesce window must not skip this after a recent /me.
      void useAuthStore.getState().silentRefresh({ force: true });
      if (orgId) {
        broadcastHqLocationContextChange({
          orgId,
          locationId: ctx.effectiveLocationId,
        });
      }
    },
  });
}
