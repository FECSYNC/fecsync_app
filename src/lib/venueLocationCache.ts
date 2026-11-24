/**
 * Keep every admin venue-location React Query list in sync after create/edit/archive.
 * Also persists the company-wide list snapshot so soft-nav hydrate cannot restore a
 * pre-create list and hide a brand-new park for several seconds.
 */
import type { QueryClient } from "@tanstack/react-query";
import {
  venueLocationKeys,
  type VenueLocationDto,
} from "@/services/venueLocations";
import { writeAdminListSnapshot } from "@/lib/adminListSnapshot";
import { useAuthStore, peekAuthSnapshotUser } from "@/store/authStore";

function actorOrgId(): string | null {
  return (
    useAuthStore.getState().user?.orgId ??
    peekAuthSnapshotUser()?.orgId ??
    null
  );
}

/** Instant list update — do not wait on refetch after create/edit/archive. */
export function upsertVenueInLists(
  queryClient: QueryClient,
  venue: VenueLocationDto
): void {
  queryClient.setQueriesData<VenueLocationDto[]>(
    { queryKey: venueLocationKeys.all },
    (old) => {
      if (!Array.isArray(old)) {
        return venue.status === "archived" ? [] : [venue];
      }
      const without = old.filter((v) => v.id !== venue.id);
      if (venue.status === "archived") return without;
      return [venue, ...without];
    }
  );

  const orgId = actorOrgId();
  if (!orgId) return;
  const listAllKey = venueLocationKeys.list("all");
  const current = queryClient.getQueryData<VenueLocationDto[]>(listAllKey);
  if (Array.isArray(current)) {
    writeAdminListSnapshot(orgId, listAllKey, current);
  }
}

/** Remove an archived venue from every list cache immediately. */
export function removeVenueFromLists(
  queryClient: QueryClient,
  venueId: string
): void {
  queryClient.setQueriesData<VenueLocationDto[]>(
    { queryKey: venueLocationKeys.all },
    (old) => {
      if (!Array.isArray(old)) return old;
      return old.filter((v) => v.id !== venueId);
    }
  );

  const orgId = actorOrgId();
  if (!orgId) return;
  const listAllKey = venueLocationKeys.list("all");
  const current = queryClient.getQueryData<VenueLocationDto[]>(listAllKey);
  if (Array.isArray(current)) {
    writeAdminListSnapshot(orgId, listAllKey, current);
  }
}

/**
 * Abort in-flight venue GETs (sidebar prefetch / soft-nav) so an older response
 * cannot overwrite a just-created row, then apply the optimistic list update.
 */
export async function applyVenueListMutation(
  queryClient: QueryClient,
  venue: VenueLocationDto
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: venueLocationKeys.all });
  upsertVenueInLists(queryClient, venue);
}
