import { api, unwrap, type MaybeWrapped } from "@/utils/api";

export type PartyRunSheetItemDto = {
  id?: string;
  title: string;
  notes?: string | null;
  startsAt?: string | null;
  sortOrder?: number;
};

export type PartyRunSheetRow = {
  bookingId: string;
  publicId: string;
  partyName?: string | null;
  honoreeName?: string | null;
  status: string;
  opsStatus?: string;
  visitStartsAt: string | null;
  visitEndsAt?: string | null;
  timezone?: string | null;
  location: { id: string; name: string } | null;
  room: { id: string; name: string | null } | null;
  kidCount?: number | null;
  adultCount?: number | null;
  hostName?: string | null;
  amountDue?: number;
  amountDueCents?: number;
  food?: Array<{ nameSnapshot: string; qty: number }>;
  addOns?: Array<{ name: string; qty: number }>;
  notes?: string | null;
  hostNotes?: string | null;
  foodNotes?: string | null;
  items: Array<{
    id: string;
    title?: string;
    notes?: string | null;
    startsAt?: string | null;
    sortOrder?: number;
  }>;
};

export const adminPartyKeys = {
  all: ["admin", "parties"] as const,
  runSheets: (date: string, locationId?: string) =>
    [...adminPartyKeys.all, "run-sheets", date, locationId ?? ""] as const,
  summary: (bookingId: string) =>
    [...adminPartyKeys.all, "summary", bookingId] as const,
  list: (filters: PartyListFilters) =>
    [...adminPartyKeys.all, "list", filters] as const,
  detail: (bookingId: string) =>
    [...adminPartyKeys.all, "detail", bookingId] as const,
  food: (bookingId: string) =>
    [...adminPartyKeys.all, "food", bookingId] as const,
  balances: (filters: Record<string, string | number | boolean | undefined>) =>
    [...adminPartyKeys.all, "balances", filters] as const,
  roomAvailability: (q: { locationId?: string; startsAt: string; endsAt: string; excludeBookingId?: string }) =>
    [...adminPartyKeys.all, "room-availability", q] as const,
  packages: (filters: { locationId?: string; status?: string }) =>
    [...adminPartyKeys.all, "packages", filters] as const,
  package: (id: string) => [...adminPartyKeys.all, "package", id] as const,
  packageSessions: (id: string) =>
    [...adminPartyKeys.all, "package-sessions", id] as const,
  rooms: (filters: { locationId?: string; includeArchived?: boolean }) =>
    [...adminPartyKeys.all, "rooms", filters] as const,
  menu: (filters: { locationId?: string; includeArchived?: boolean }) =>
    [...adminPartyKeys.all, "menu", filters] as const,
  menuPosProducts: (locationId: string) =>
    [...adminPartyKeys.all, "menu-pos-products", locationId] as const,
  settings: (locationId: string | null) =>
    [...adminPartyKeys.all, "settings", locationId ?? "org"] as const,
  hosts: () => [...adminPartyKeys.all, "hosts"] as const,
};

export type PartyListFilters = {
  date?: string;
  locationId?: string;
  q?: string;
  opsStatus?: string;
  amountDueOnly?: boolean;
  roomResourceId?: string;
  hostStaffUserId?: string;
  take?: number;
  skip?: number;
};

export type PartyListRow = {
  bookingId: string;
  publicId: string;
  status: string;
  opsStatus: string;
  channel: string;
  locationId: string;
  location: { id: string; name: string };
  timezone: string | null;
  visitStartsAt: string | null;
  visitEndsAt: string | null;
  partyName: string;
  honoreeName: string | null;
  honoreeAge: number | null;
  kidCount: number;
  adultCount: number;
  package: { id: string; name: string } | null;
  room: { id: string; name: string | null } | null;
  host: { id: string; name: string } | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  totalCents: number;
  amountPaidCents: number;
  amountDueCents: number;
  depositRequiredCents: number;
  depositPaidCents: number;
  depositDueAt: string | null;
  balanceDueAt: string | null;
  waiverMissingCount: number;
};

export type PartyPackageDto = {
  id: string;
  locationId: string;
  location: { id: string; name: string } | null;
  name: string;
  description: string | null;
  images: string[];
  published: boolean;
  archivedAt: string | null;
  status: "published" | "draft" | "archived";
  minGuests: number | null;
  maxGuests: number | null;
  waiverRequired: boolean;
  categoryId: string | null;
  room: { id: string; name: string; defaultCapacity: number } | null;
  prices: Array<{ code: string; amountCents: number; currency: string }>;
  hasConfig: boolean;
  config: {
    durationMinutes: number;
    includedKids: number;
    includedAdults: number;
    extraKidPriceCents: number | null;
    extraAdultPriceCents: number | null;
    roomResourceId: string | null;
    roomAssignedAtBooking: boolean;
    depositPercentOverride: number | null;
    depositFixedCentsOverride: number | null;
    includesFood: boolean;
    defaultMenuItemIds: string[];
    basePriceCents: number | null;
    basePriceBand: string | null;
  };
  depositPreviewCents: number;
  addOns: Array<{
    productId: string;
    name: string;
    required: boolean;
    maxQty: number | null;
    published: boolean;
    archived: boolean;
    priceCents: number | null;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type PartyPackageInput = Partial<{
  locationId: string;
  name: string;
  description: string | null;
  minGuests: number | null;
  maxGuests: number | null;
  durationMinutes: number | null;
  includedKids: number | null;
  includedAdults: number | null;
  extraKidPriceCents: number | null;
  extraAdultPriceCents: number | null;
  packagePriceCents: number | null;
  roomResourceId: string | null;
  roomAssignedAtBooking: boolean;
  depositPercentOverride: number | null;
  depositFixedCentsOverride: number | null;
  includesFood: boolean;
  defaultMenuItemIds: string[];
  addOns: Array<{ productId: string; required?: boolean; maxQty?: number | null }>;
  newAddOns: Array<{ name: string; priceCents: number }>;
  published: boolean;
  unarchive: boolean;
}>;

export type PartyRoomDto = {
  id: string;
  locationId: string;
  name: string;
  type: string;
  defaultCapacity: number;
  archivedAt: string | null;
  location: { id: string; name: string } | null;
};

export type PartyMenuItemDto = {
  id: string;
  locationId: string;
  location: { id: string; name: string } | null;
  name: string;
  description: string | null;
  kind: "food" | "beverage" | "cake" | "other";
  priceCents: number;
  currency: string;
  available: boolean;
  archivedAt: string | null;
  posProductId: string | null;
  sortOrder: number;
};

export type PartySettingsValues = {
  defaultDepositPercent: number | null;
  defaultDepositFixedCents: number | null;
  depositDueMode: "at_booking" | "days_before_event" | "on_arrival";
  depositDaysBefore: number;
  requireDepositToConfirm: boolean;
  allowConfirmWithoutDeposit: boolean;
  balanceDueMode: "at_booking" | "days_before_event" | "on_arrival";
  balanceDaysBefore: number;
  defaultPartyDurationMinutes: number;
  defaultMinKids: number;
  defaultMaxKids: number;
  defaultIncludedAdults: number;
  invitationExpiresHours: number;
  allowOnlinePartyBooking: boolean;
  allowHostEditGuestList: boolean;
  allowHostEditFood: boolean;
  foodOrderCutoffMinutes: number;
  sendBalanceReminder: boolean;
  balanceReminderDaysBefore: number[];
  hostCancelCutoffHours: number;
};

export type PartySettingsDto = {
  locationId: string | null;
  values: PartySettingsValues;
  sources: Record<keyof PartySettingsValues, "schema_default" | "org_default" | "venue_override">;
  orgDefaultId: string | null;
  venueOverrideId: string | null;
  defaults: PartySettingsValues;
};

export type PartyGuestDto = {
  id: string;
  kind: "honoree" | "kid" | "adult" | "chaperone" | "other";
  name: string | null;
  age: number | null;
  email: string | null;
  phone: string | null;
  rsvpStatus: string;
  waiverStatus: string;
  invitationId: string | null;
  bookingGuestId: string | null;
};

export type PartyInvitationDto = {
  id: string;
  guestId: string | null;
  channel: "email" | "sms" | "link";
  toEmail: string | null;
  toPhone: string | null;
  sentTo: string | null;
  status: string;
  sentAt: string | null;
  respondedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type PartyFoodOrderDto = {
  id: string;
  status: string;
  promisedAt: string | null;
  kitchenTicketId: string | null;
  notes: string | null;
  submittedAt: string | null;
  fulfilledAt: string | null;
  cutoffOverrideReason: string | null;
  totalCents: number;
  lines: Array<{
    id: string;
    menuItemId: string | null;
    posProductId: string | null;
    nameSnapshot: string;
    qty: number;
    unitPriceCents: number;
    modifiers: unknown;
    notes: string | null;
  }>;
  createdAt: string;
};

/** Staff party detail DTO (GET /api/admin/parties/[bookingId]). */
export type PartyDetailDto = {
  bookingId: string;
  publicId: string;
  status: string;
  opsStatus: string;
  channel: string;
  locationId: string;
  location: { id: string; name: string } | null;
  timezone: string | null;
  visitStartsAt: string | null;
  visitEndsAt: string | null;
  sessionId: string | null;
  partyName: string;
  honoreeName: string | null;
  honoreeAge: number | null;
  honoreeBirthDate: string | null;
  kidCount: number;
  adultCount: number;
  package: { id: string; name: string } | null;
  room: { id: string; name: string | null } | null;
  roomNameSnapshot: string | null;
  addOns: Array<{ productId: string; name: string; qty: number; lineTotalCents: number }>;
  waiverMissingCount: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  amountPaidCents: number;
  amountDueCents: number;
  depositRequiredCents: number;
  depositPaidCents: number;
  depositOutstandingCents: number;
  depositDueAt: string | null;
  balanceDueAt: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  userId: string | null;
  accountId: string | null;
  notes: string | null;
  posNotes: string | null;
  hostStaffUserId: string | null;
  host: { id: string; name: string | null; email: string } | null;
  hostNotes: string | null;
  foodNotes: string | null;
  holdExpiresAt: string | null;
  reservedUntil: string | null;
  lines: Array<{
    id: string;
    productId: string | null;
    productName: string;
    productType: string;
    priceBandCode: string | null;
    qty: number;
    unitPriceCents: number;
    lineTotalCents: number;
    sessionId: string | null;
    resourceId: string | null;
  }>;
  guests: PartyGuestDto[];
  invitations: PartyInvitationDto[];
  foodOrders: PartyFoodOrderDto[];
  runSheet: Array<{ id: string; title: string; notes: string | null; startsAt: string | null; sortOrder: number }>;
  payments: Array<{
    id: string;
    tender: string;
    amountCents: number;
    amountRefundedCents: number;
    status: string;
    createdAt: string;
  }>;
  activities: Array<{ id: string; kind: string; payload: unknown; actorUserId: string | null; createdAt: string }>;
  capabilities?: {
    smsAvailable: boolean;
    waiversEnabled: boolean;
    requireDepositToConfirm: boolean;
    allowConfirmWithoutDeposit: boolean;
    foodOrderCutoffMinutes: number;
    foodCutoffPassed: boolean;
  };
  createdAt: string;
  updatedAt: string;
};

/** Staff summary downloads (CSV attachment / printable HTML). */
export function partySummaryUrl(bookingId: string, format: "csv" | "html") {
  return `/api/admin/parties/${encodeURIComponent(bookingId)}/summary?format=${format}`;
}

function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    sp.set(k, v === true ? "1" : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const raw = await api<MaybeWrapped<T>>(path, {
    credentials: "include",
    ...rest,
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  });
  return unwrap(raw) as T;
}

const enc = encodeURIComponent;

export type PartyListSummary = {
  parties: number;
  kids: number;
  adults: number;
  balanceDueCents: number;
  waiversMissing: number;
  unassignedRooms: number;
};

export type PartyListResponse = {
  parties: PartyListRow[];
  total: number;
  take: number;
  skip: number;
  waiversEnabled: boolean;
  /** Older cached snapshots may lack it. */
  summary?: PartyListSummary;
};

export async function listAdminParties(filters: PartyListFilters = {}) {
  return call<PartyListResponse>(`/api/admin/parties${qs(filters)}`);
}

export async function createAdminParty(payload: Record<string, unknown>) {
  return (await call<{ party: PartyDetailDto }>(`/api/admin/parties`, { method: "POST", json: payload })).party;
}

export type PartyQuoteDto = {
  packageCents: number;
  includedKids: number;
  includedAdults: number;
  extraKids: number;
  extraKidUnitCents: number;
  extraAdults: number;
  extraAdultUnitCents: number;
  addOnCents: number;
  foodCents: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  depositRequiredCents: number;
  depositDueAt: string | null;
  balanceDueAt: string | null;
  visitStartsAt: string;
  visitEndsAt: string;
  timezone: string | null;
  room: { id: string; name: string; defaultCapacity: number } | null;
  roomConflict: boolean;
  sessionRemaining: number | null;
  soldOut: boolean;
  createModePrompt: boolean;
  defaultCreateMode: "hold" | "reserve" | "prompt";
};

export type PartyContactDto = { name: string | null; email: string | null; phone: string | null; hasAccount: boolean };

export type PartyHostCandidateDto = { userId: string; name: string; email: string };

export async function listAdminPartyHosts() {
  return (await call<{ hosts: PartyHostCandidateDto[] }>(`/api/admin/parties/hosts`)).hosts;
}

export async function searchAdminPartyContacts(q: string) {
  return (await call<{ contacts: PartyContactDto[] }>(`/api/admin/parties/contacts${qs({ q })}`)).contacts;
}

export async function quoteAdminParty(payload: Record<string, unknown>) {
  return (await call<{ quote: PartyQuoteDto }>(`/api/admin/parties/quote`, { method: "POST", json: payload })).quote;
}

export async function getAdminParty(bookingId: string) {
  return (await call<{ party: PartyDetailDto }>(`/api/admin/parties/${enc(bookingId)}`)).party;
}

export async function patchAdminParty(bookingId: string, payload: Record<string, unknown>) {
  return (await call<{ party: PartyDetailDto }>(`/api/admin/parties/${enc(bookingId)}`, { method: "PATCH", json: payload })).party;
}

export async function confirmAdminParty(bookingId: string, payload: { depositOverrideReason?: string } = {}) {
  return (await call<{ party: PartyDetailDto }>(`/api/admin/parties/${enc(bookingId)}/confirm`, { method: "POST", json: payload })).party;
}

export async function cancelAdminParty(bookingId: string, reason: string) {
  return (await call<{ party: PartyDetailDto }>(`/api/admin/parties/${enc(bookingId)}/cancel`, { method: "POST", json: { reason } })).party;
}

export async function reactivateAdminParty(
  bookingId: string,
  payload: { target?: "held" | "confirmed"; overbook?: boolean; overbookReason?: string; depositOverrideReason?: string }
) {
  return (await call<{ party: PartyDetailDto }>(`/api/admin/parties/${enc(bookingId)}/reactivate`, { method: "POST", json: payload })).party;
}

export async function addAdminPartyGuest(bookingId: string, guest: Record<string, unknown>) {
  return (await call<{ guest: unknown }>(`/api/admin/parties/${enc(bookingId)}/guests`, { method: "POST", json: guest })).guest;
}

export async function patchAdminPartyGuest(bookingId: string, guestId: string, guest: Record<string, unknown>) {
  return (await call<{ guest: unknown }>(`/api/admin/parties/${enc(bookingId)}/guests/${enc(guestId)}`, { method: "PATCH", json: guest })).guest;
}

export async function deleteAdminPartyGuest(bookingId: string, guestId: string) {
  return call<{ ok: boolean }>(`/api/admin/parties/${enc(bookingId)}/guests/${enc(guestId)}`, { method: "DELETE" });
}

export async function cancelAdminPartyInvitation(bookingId: string, inviteId: string) {
  return (await call<{ invitation: unknown }>(`/api/admin/parties/${enc(bookingId)}/invitations/${enc(inviteId)}/cancel`, { method: "POST", json: {} })).invitation;
}

export async function markAdminPartyInvitationBounced(bookingId: string, inviteId: string) {
  return (await call<{ invitation: PartyInvitationDto }>(`/api/admin/parties/${enc(bookingId)}/invitations/${enc(inviteId)}/bounced`, { method: "POST", json: {} })).invitation;
}

export async function putAdminPartyFood(bookingId: string, payload: { lines: Array<Record<string, unknown>>; notes?: string | null }) {
  return (await call<{ orders: unknown[] }>(`/api/admin/parties/${enc(bookingId)}/food`, { method: "PUT", json: payload })).orders;
}

export async function submitAdminPartyFood(bookingId: string, payload: { overrideReason?: string } = {}) {
  return (await call<{ orders: unknown[] }>(`/api/admin/parties/${enc(bookingId)}/food/submit`, { method: "POST", json: payload })).orders;
}

export async function cancelAdminPartyFood(bookingId: string, payload: { foodOrderId?: string; reason?: string } = {}) {
  return (await call<{ orders: unknown[] }>(`/api/admin/parties/${enc(bookingId)}/food/cancel`, { method: "POST", json: payload })).orders;
}

export async function moveAdminPartyRoom(
  bookingId: string,
  payload: { roomResourceId: string | null; overbook?: boolean; overbookReason?: string }
) {
  return (await call<{ party: PartyDetailDto }>(`/api/admin/parties/${enc(bookingId)}/room`, { method: "POST", json: payload })).party;
}

export async function listAdminPartyBalances(
  filters: { locationId?: string; dueBefore?: string; depositUnpaidOnly?: boolean; take?: number } = {}
) {
  return call<{ balances: Array<Record<string, unknown>>; total: number; outstandingCents: number }>(
    `/api/admin/parties/balances${qs({ status: "due", ...filters })}`
  );
}

export async function getAdminPartyRoomAvailability(q: { locationId?: string; startsAt: string; endsAt: string; excludeBookingId?: string }) {
  return call<{
    rooms: Array<{
      id: string;
      name: string;
      available: boolean;
      defaultCapacity?: number;
      conflicts: Array<{
        bookingId: string;
        publicId: string;
        partyName: string;
        visitStartsAt: string | null;
        visitEndsAt: string | null;
      }>;
    }>;
  }>(
    `/api/admin/parties/rooms/availability${qs(q)}`
  );
}

export async function getAdminPartySettings(locationId: string | null) {
  return (await call<{ settings: PartySettingsDto }>(`/api/admin/parties/settings${qs({ locationId })}`)).settings;
}

export async function patchAdminPartySettings(payload: {
  locationId?: string | null;
  values?: Partial<PartySettingsValues>;
  resetFields?: Array<keyof PartySettingsValues>;
}) {
  return (await call<{ settings: PartySettingsDto }>(`/api/admin/parties/settings`, { method: "PATCH", json: payload })).settings;
}

export async function listAdminPartyPackages(filters: { locationId?: string; status?: string } = {}) {
  return (await call<{ packages: PartyPackageDto[] }>(`/api/admin/parties/packages${qs(filters)}`)).packages;
}

export async function getAdminPartyPackage(id: string) {
  return (await call<{ package: PartyPackageDto }>(`/api/admin/parties/packages/${enc(id)}`)).package;
}

export async function createAdminPartyPackage(payload: PartyPackageInput) {
  return (await call<{ package: PartyPackageDto }>(`/api/admin/parties/packages`, { method: "POST", json: payload })).package;
}

export async function patchAdminPartyPackage(id: string, payload: PartyPackageInput) {
  return (await call<{ package: PartyPackageDto }>(`/api/admin/parties/packages/${enc(id)}`, { method: "PATCH", json: payload })).package;
}

export async function archiveAdminPartyPackage(id: string) {
  return (await call<{ package: PartyPackageDto }>(`/api/admin/parties/packages/${enc(id)}`, { method: "DELETE" })).package;
}

export type PartySessionDto = {
  id: string;
  label: string | null;
  startsAt: string;
  endsAt: string;
  capacity: number;
  remaining: number;
  isClosed: boolean;
};

export async function listAdminPartyPackageSessions(id: string) {
  return (await call<{ sessions: PartySessionDto[] }>(`/api/admin/parties/packages/${enc(id)}/sessions`)).sessions;
}

export async function createAdminPartyPackageSessions(
  id: string,
  payload: { startsAt: string; endsAt?: string; capacity?: number; label?: string; weekdays?: number[]; untilDate?: string }
) {
  return (await call<{ sessions: PartySessionDto[] }>(`/api/admin/parties/packages/${enc(id)}/sessions`, { method: "POST", json: payload })).sessions;
}

export async function listAdminPartyRooms(filters: { locationId?: string; includeArchived?: boolean } = {}) {
  return (await call<{ rooms: PartyRoomDto[] }>(`/api/admin/parties/rooms${qs(filters)}`)).rooms;
}

export async function createAdminPartyRoom(payload: { locationId: string; name: string; defaultCapacity: number }) {
  return (await call<{ room: PartyRoomDto }>(`/api/admin/parties/rooms`, { method: "POST", json: payload })).room;
}

export async function patchAdminPartyRoom(
  id: string,
  payload: Partial<{ name: string; defaultCapacity: number; archive: boolean; unarchive: boolean }>
) {
  return (await call<{ room: PartyRoomDto }>(`/api/admin/parties/rooms/${enc(id)}`, { method: "PATCH", json: payload })).room;
}

export async function listAdminPartyMenu(filters: { locationId?: string; includeArchived?: boolean } = {}) {
  return (await call<{ items: PartyMenuItemDto[] }>(`/api/admin/parties/menu${qs(filters)}`)).items;
}

export async function listAdminPartyMenuPosProducts(locationId: string) {
  return (
    await call<{ posProducts: Array<{ id: string; name: string; kind: string; priceCents: number }> }>(
      `/api/admin/parties/menu${qs({ posProducts: true, locationId })}`
    )
  ).posProducts;
}

export async function createAdminPartyMenuItem(payload: Partial<PartyMenuItemDto> & { locationId: string }) {
  return (await call<{ item: PartyMenuItemDto }>(`/api/admin/parties/menu`, { method: "POST", json: payload })).item;
}

export async function patchAdminPartyMenuItem(
  id: string,
  payload: Partial<PartyMenuItemDto> & { archive?: boolean; unarchive?: boolean }
) {
  return (await call<{ item: PartyMenuItemDto }>(`/api/admin/parties/menu/${enc(id)}`, { method: "PATCH", json: payload })).item;
}

/** Field errors from a 400 PARTY_PACKAGE_INVALID / PARTY_SETTINGS_INVALID response. */
export function partyFieldErrors(err: unknown): Record<string, string> {
  const payload = (err as { payload?: { fields?: unknown } } | null)?.payload;
  const fields = payload?.fields;
  return fields && typeof fields === "object" ? (fields as Record<string, string>) : {};
}

export async function listAdminPartyRunSheets(
  date: string,
  locationId?: string
): Promise<PartyRunSheetRow[]> {
  const sp = new URLSearchParams({ date });
  if (locationId) sp.set("locationId", locationId);
  const raw = await api<MaybeWrapped<{ runSheets?: PartyRunSheetRow[] }>>(
    `/api/admin/parties/run-sheets?${sp.toString()}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  return Array.isArray(data?.runSheets) ? data.runSheets : [];
}

export type CreatePartyInvitationInput =
  | { to: string; channel?: "email" | "sms" }
  | {
      channel: "email" | "sms" | "link";
      guestId?: string | null;
      toEmail?: string | null;
      toPhone?: string | null;
      send?: boolean;
    };

export async function createAdminPartyInvitation(bookingId: string, opts: CreatePartyInvitationInput) {
  const raw = await api<
    MaybeWrapped<{ invitation?: PartyInvitationDto & { token?: string; rsvpUrl?: string; rsvpPath?: string } }>
  >(
    `/api/admin/parties/${encodeURIComponent(bookingId)}/invitations`,
    {
      method: "POST",
      credentials: "include",
      body: JSON.stringify(opts),
    }
  );
  return unwrap(raw)?.invitation;
}

export async function patchAdminPartyRunSheet(
  bookingId: string,
  items: Array<{
    title?: string;
    notes?: string | null;
    startsAt?: string | null;
    sortOrder?: number;
  }>
) {
  const raw = await api<
    MaybeWrapped<{
      items?: PartyRunSheetItemDto[];
    }>
  >(`/api/admin/parties/${encodeURIComponent(bookingId)}/run-sheet`, {
    method: "PATCH",
    credentials: "include",
    body: JSON.stringify({ items }),
  });
  return unwrap(raw) ?? {};
}
