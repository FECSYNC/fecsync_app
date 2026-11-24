"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { adminBookingKeys } from "@/services/adminBookings";
import { ticketingKeys } from "@/services/ticketing";
import { meBookingKeys } from "@/services/meBookings";
import { adminListSnapshotSeed } from "@/lib/adminListSnapshot";
import { broadcastPartyChange } from "@/utils/partyCrossTabSync";
import {
  adminPartyKeys,
  addAdminPartyGuest,
  archiveAdminPartyPackage,
  cancelAdminParty,
  cancelAdminPartyFood,
  cancelAdminPartyInvitation,
  confirmAdminParty,
  createAdminParty,
  createAdminPartyInvitation,
  createAdminPartyMenuItem,
  createAdminPartyPackage,
  createAdminPartyPackageSessions,
  createAdminPartyRoom,
  deleteAdminPartyGuest,
  getAdminParty,
  getAdminPartyPackage,
  getAdminPartyRoomAvailability,
  getAdminPartySettings,
  listAdminParties,
  listAdminPartyBalances,
  listAdminPartyHosts,
  markAdminPartyInvitationBounced,
  listAdminPartyMenu,
  listAdminPartyMenuPosProducts,
  listAdminPartyPackageSessions,
  listAdminPartyPackages,
  listAdminPartyRooms,
  listAdminPartyRunSheets,
  moveAdminPartyRoom,
  patchAdminParty,
  patchAdminPartyGuest,
  patchAdminPartyMenuItem,
  patchAdminPartyPackage,
  patchAdminPartyRoom,
  patchAdminPartyRunSheet,
  patchAdminPartySettings,
  putAdminPartyFood,
  reactivateAdminParty,
  submitAdminPartyFood,
  type CreatePartyInvitationInput,
  type PartyListFilters,
  type PartyPackageInput,
  type PartySettingsValues,
} from "@/services/adminParties";

/** After any party mutation: party list/detail, balances, run sheets, bookings, ticketing availability. */
export function invalidatePartyQueries(qc: QueryClient, bookingId?: string) {
  void qc.invalidateQueries({ queryKey: [...adminPartyKeys.all, "list"] });
  void qc.invalidateQueries({ queryKey: [...adminPartyKeys.all, "balances"] });
  void qc.invalidateQueries({ queryKey: [...adminPartyKeys.all, "run-sheets"] });
  void qc.invalidateQueries({ queryKey: [...adminPartyKeys.all, "room-availability"] });
  void qc.invalidateQueries({ queryKey: adminBookingKeys.all });
  void qc.invalidateQueries({ queryKey: [...ticketingKeys.all, "availability"] });
  void qc.invalidateQueries({ queryKey: [...ticketingKeys.all, "sessions"] });
  void qc.invalidateQueries({ queryKey: meBookingKeys.all });
  broadcastPartyChange();
  if (bookingId) {
    void qc.invalidateQueries({ queryKey: adminPartyKeys.detail(bookingId) });
    void qc.invalidateQueries({ queryKey: adminPartyKeys.summary(bookingId) });
    void qc.invalidateQueries({ queryKey: adminPartyKeys.food(bookingId) });
    void qc.invalidateQueries({ queryKey: adminBookingKeys.detail(bookingId) });
  }
}

function invalidateCatalog(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: [...adminPartyKeys.all, "packages"] });
  void qc.invalidateQueries({ queryKey: [...adminPartyKeys.all, "package"] });
  void qc.invalidateQueries({ queryKey: [...adminPartyKeys.all, "package-sessions"] });
  void qc.invalidateQueries({ queryKey: [...adminPartyKeys.all, "rooms"] });
  void qc.invalidateQueries({ queryKey: [...adminPartyKeys.all, "menu"] });
  void qc.invalidateQueries({ queryKey: ticketingKeys.all });
  broadcastPartyChange();
}

/** Catalog / settings: paint cached rows instantly, then refresh on every open (desk modal or route) and tab focus. */
const LIVE_CATALOG_QUERY = {
  staleTime: 30_000,
  refetchOnMount: true,
  refetchOnWindowFocus: true,
} as const;

export function usePartiesQuery(filters: PartyListFilters, enabled = true) {
  const queryKey = adminPartyKeys.list(filters);
  type ListData = Awaited<ReturnType<typeof listAdminParties>>;
  return useQuery({
    queryKey,
    queryFn: () => listAdminParties(filters),
    enabled,
    ...LIVE_PARTY_QUERY,
    refetchInterval: 30_000,
    // Last visit's rows (sessionStorage) paint instantly on hard refresh; seeded stale → background refetch.
    // Function form: read only when the query is first created, not on every render.
    initialData: () => adminListSnapshotSeed<ListData>(queryKey).initialData,
    initialDataUpdatedAt: () => adminListSnapshotSeed<ListData>(queryKey).initialDataUpdatedAt,
    placeholderData: (prev) => prev,
  });
}

/** Party state also changes from guest payments, RSVPs, host edits, webhooks and cron — keep live surfaces polling. */
const LIVE_PARTY_QUERY = {
  staleTime: 15_000,
  refetchOnMount: true,
  refetchOnWindowFocus: true,
} as const;

export function usePartyQuery(bookingId: string | null | undefined) {
  return useQuery({
    queryKey: adminPartyKeys.detail(bookingId ?? ""),
    queryFn: () => getAdminParty(bookingId!),
    enabled: Boolean(bookingId),
    ...LIVE_PARTY_QUERY,
    refetchInterval: 30_000,
  });
}

export function usePartyBalancesQuery(filters: { locationId?: string; dueBefore?: string; depositUnpaidOnly?: boolean; take?: number }) {
  return useQuery({
    queryKey: adminPartyKeys.balances(filters),
    queryFn: () => listAdminPartyBalances(filters),
    ...LIVE_PARTY_QUERY,
    refetchInterval: 60_000,
  });
}

export function usePartyRunSheetsQuery(date: string, locationId?: string) {
  return useQuery({
    queryKey: adminPartyKeys.runSheets(date, locationId),
    queryFn: () => listAdminPartyRunSheets(date, locationId),
    enabled: Boolean(date),
    ...LIVE_PARTY_QUERY,
    refetchInterval: 60_000,
    // Day switches keep the previous day on screen (dimmed) until the new one lands.
    placeholderData: (prev) => prev,
  });
}

export function usePartyRoomAvailabilityQuery(
  q: { locationId?: string; startsAt: string; endsAt: string; excludeBookingId?: string } | null
) {
  return useQuery({
    queryKey: adminPartyKeys.roomAvailability(q ?? { startsAt: "", endsAt: "" }),
    queryFn: () => getAdminPartyRoomAvailability(q!),
    enabled: Boolean(q?.startsAt && q?.endsAt),
  });
}

export function usePartyPackagesQuery(filters: { locationId?: string; status?: string } = {}) {
  return useQuery({
    queryKey: adminPartyKeys.packages(filters),
    queryFn: () => listAdminPartyPackages(filters),
    ...LIVE_CATALOG_QUERY,
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function usePartyPackageQuery(id: string | null | undefined) {
  return useQuery({
    queryKey: adminPartyKeys.package(id ?? ""),
    queryFn: () => getAdminPartyPackage(id!),
    enabled: Boolean(id),
  });
}

export function usePartyPackageSessionsQuery(id: string | null | undefined) {
  return useQuery({
    queryKey: adminPartyKeys.packageSessions(id ?? ""),
    queryFn: () => listAdminPartyPackageSessions(id!),
    enabled: Boolean(id),
  });
}

export function usePartyRoomsQuery(
  filters: { locationId?: string; includeArchived?: boolean } = {},
  enabled = true
) {
  return useQuery({
    queryKey: adminPartyKeys.rooms(filters),
    queryFn: () => listAdminPartyRooms(filters),
    enabled,
    ...LIVE_CATALOG_QUERY,
    placeholderData: (prev) => prev,
  });
}

export function usePartyMenuQuery(filters: { locationId?: string; includeArchived?: boolean } = {}) {
  return useQuery({
    queryKey: adminPartyKeys.menu(filters),
    queryFn: () => listAdminPartyMenu(filters),
    ...LIVE_CATALOG_QUERY,
    placeholderData: (prev) => prev,
  });
}

export function usePartyMenuPosProductsQuery(locationId: string | null | undefined) {
  return useQuery({
    queryKey: adminPartyKeys.menuPosProducts(locationId ?? ""),
    queryFn: () => listAdminPartyMenuPosProducts(locationId!),
    enabled: Boolean(locationId),
  });
}

export function usePartyHostsQuery(enabled = true) {
  return useQuery({
    queryKey: adminPartyKeys.hosts(),
    queryFn: listAdminPartyHosts,
    enabled,
    staleTime: 60_000,
  });
}

export function usePartySettingsQuery(
  locationId: string | null,
  /** Shown while this scope loads (e.g. the company default while a venue's overrides load). */
  placeholder?: Awaited<ReturnType<typeof getAdminPartySettings>>
) {
  return useQuery({
    queryKey: adminPartyKeys.settings(locationId),
    queryFn: () => getAdminPartySettings(locationId),
    ...LIVE_CATALOG_QUERY,
    placeholderData: placeholder,
  });
}

function usePartyMutation<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
  bookingIdOf?: (vars: TVars) => string | undefined
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (_res, vars) => invalidatePartyQueries(qc, bookingIdOf?.(vars)),
  });
}

export function useCreatePartyMutation() {
  return usePartyMutation((payload: Record<string, unknown>) => createAdminParty(payload));
}

export function usePatchPartyMutation() {
  return usePartyMutation(
    (v: { bookingId: string; payload: Record<string, unknown> }) => patchAdminParty(v.bookingId, v.payload),
    (v) => v.bookingId
  );
}

export function useConfirmPartyMutation() {
  return usePartyMutation(
    (v: { bookingId: string; depositOverrideReason?: string }) =>
      confirmAdminParty(v.bookingId, v.depositOverrideReason ? { depositOverrideReason: v.depositOverrideReason } : {}),
    (v) => v.bookingId
  );
}

export function useCancelPartyMutation() {
  return usePartyMutation(
    (v: { bookingId: string; reason: string }) => cancelAdminParty(v.bookingId, v.reason),
    (v) => v.bookingId
  );
}

export function useReactivatePartyMutation() {
  return usePartyMutation(
    (v: { bookingId: string; target?: "held" | "confirmed"; overbook?: boolean; overbookReason?: string }) =>
      reactivateAdminParty(v.bookingId, v),
    (v) => v.bookingId
  );
}

export function useAddPartyGuestMutation() {
  return usePartyMutation(
    (v: { bookingId: string; guest: Record<string, unknown> }) => addAdminPartyGuest(v.bookingId, v.guest),
    (v) => v.bookingId
  );
}

export function usePatchPartyGuestMutation() {
  return usePartyMutation(
    (v: { bookingId: string; guestId: string; guest: Record<string, unknown> }) =>
      patchAdminPartyGuest(v.bookingId, v.guestId, v.guest),
    (v) => v.bookingId
  );
}

export function useDeletePartyGuestMutation() {
  return usePartyMutation(
    (v: { bookingId: string; guestId: string }) => deleteAdminPartyGuest(v.bookingId, v.guestId),
    (v) => v.bookingId
  );
}

export function useCreatePartyInvitationMutation() {
  return usePartyMutation(
    (v: { bookingId: string; input: CreatePartyInvitationInput }) => createAdminPartyInvitation(v.bookingId, v.input),
    (v) => v.bookingId
  );
}

export function useCancelPartyInvitationMutation() {
  return usePartyMutation(
    (v: { bookingId: string; inviteId: string }) => cancelAdminPartyInvitation(v.bookingId, v.inviteId),
    (v) => v.bookingId
  );
}

export function useMarkPartyInvitationBouncedMutation() {
  return usePartyMutation(
    (v: { bookingId: string; inviteId: string }) => markAdminPartyInvitationBounced(v.bookingId, v.inviteId),
    (v) => v.bookingId
  );
}

export function usePutPartyFoodMutation() {
  return usePartyMutation(
    (v: { bookingId: string; lines: Array<Record<string, unknown>>; notes?: string | null }) =>
      putAdminPartyFood(v.bookingId, { lines: v.lines, notes: v.notes }),
    (v) => v.bookingId
  );
}

export function useSubmitPartyFoodMutation() {
  return usePartyMutation(
    (v: { bookingId: string; overrideReason?: string }) =>
      submitAdminPartyFood(v.bookingId, v.overrideReason ? { overrideReason: v.overrideReason } : {}),
    (v) => v.bookingId
  );
}

export function useCancelPartyFoodMutation() {
  return usePartyMutation(
    (v: { bookingId: string; foodOrderId?: string; reason?: string }) =>
      cancelAdminPartyFood(v.bookingId, { foodOrderId: v.foodOrderId, reason: v.reason }),
    (v) => v.bookingId
  );
}

export function useMovePartyRoomMutation() {
  return usePartyMutation(
    (v: { bookingId: string; roomResourceId: string | null; overbook?: boolean; overbookReason?: string }) =>
      moveAdminPartyRoom(v.bookingId, v),
    (v) => v.bookingId
  );
}

export function usePutPartyRunSheetMutation() {
  return usePartyMutation(
    (v: { bookingId: string; items: Array<{ title?: string; notes?: string | null; startsAt?: string | null; sortOrder?: number }> }) =>
      patchAdminPartyRunSheet(v.bookingId, v.items),
    (v) => v.bookingId
  );
}

function useCatalogMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => invalidateCatalog(qc) });
}

export function useCreatePartyPackageMutation() {
  return useCatalogMutation((payload: PartyPackageInput) => createAdminPartyPackage(payload));
}

export function usePatchPartyPackageMutation() {
  return useCatalogMutation((v: { id: string; payload: PartyPackageInput }) => patchAdminPartyPackage(v.id, v.payload));
}

export function useArchivePartyPackageMutation() {
  return useCatalogMutation((id: string) => archiveAdminPartyPackage(id));
}

export function useCreatePartyPackageSessionsMutation() {
  return useCatalogMutation(
    (v: { id: string; payload: { startsAt: string; endsAt?: string; capacity?: number; label?: string; weekdays?: number[]; untilDate?: string } }) =>
      createAdminPartyPackageSessions(v.id, v.payload)
  );
}

export function useCreatePartyRoomMutation() {
  return useCatalogMutation((payload: { locationId: string; name: string; defaultCapacity: number }) => createAdminPartyRoom(payload));
}

export function usePatchPartyRoomMutation() {
  return useCatalogMutation(
    (v: { id: string; payload: Partial<{ name: string; defaultCapacity: number; archive: boolean; unarchive: boolean }> }) =>
      patchAdminPartyRoom(v.id, v.payload)
  );
}

export function useCreatePartyMenuItemMutation() {
  return useCatalogMutation((payload: Parameters<typeof createAdminPartyMenuItem>[0]) => createAdminPartyMenuItem(payload));
}

export function usePatchPartyMenuItemMutation() {
  return useCatalogMutation(
    (v: { id: string; payload: Parameters<typeof patchAdminPartyMenuItem>[1] }) => patchAdminPartyMenuItem(v.id, v.payload)
  );
}

export function usePatchPartySettingsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      locationId?: string | null;
      values?: Partial<PartySettingsValues>;
      resetFields?: Array<keyof PartySettingsValues>;
    }) => patchAdminPartySettings(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...adminPartyKeys.all, "settings"] });
      void qc.invalidateQueries({ queryKey: [...adminPartyKeys.all, "packages"] });
      broadcastPartyChange();
    },
  });
}
