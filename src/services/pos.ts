/**
 * Park POS API client. Shop Product, Cart, Order, and Wallet are not used here.
 */
import { api, unwrap, type MaybeWrapped } from "@/utils/api";

export type PosSettingsDto = {
  id?: string;
  locationId: string | null;
  captureGuestPostcode: boolean;
  postcodeRequired: boolean;
  requireGuestOnSale: boolean;
  allowOpenPrice: boolean;
  allowParkedCarts: boolean;
  allowUnpaidBookings: boolean;
  paidRequiredForRedeem: boolean;
  defaultReceiptEmail: boolean;
  printTicketsOnSale: boolean;
  showExpectedTillTotals: boolean;
  tipPromptEnabled: boolean;
  tipSuggestedPercents: number[];
  managerPinRequiredForDiscount: boolean;
  managerPinRequiredForRefund: boolean;
  managerPinRequiredForVoid: boolean;
  managerPinRequiredForWastage: boolean;
  offlineEnabled: boolean;
  cashRequiresOpenTill: boolean;
  lateRedemptionGraceMinutes: number;
  allowPastDateRedemption: boolean;
  bannedGuestPrompt: boolean;
  hasManagerOverridePin: boolean;
};

export type PosDeviceDto = {
  id: string;
  name: string;
  code: string;
  locationId: string;
  templateKey?: string;
  archivedAt: string | null;
  printEnabled?: boolean;
  cashDrawerEnabled?: boolean;
  stripeTerminalId?: string | null;
  printAgentUrl?: string | null;
};

export type PosProductDto = {
  id: string;
  name: string;
  kind: string;
  sku?: string | null;
  price: number;
  suspendSales: boolean;
  onHand: number | null;
  avgCost?: number;
  lastCost?: number | null;
  inventoryAccountId?: string | null;
  cogsAccountId?: string | null;
  revenueAccountId?: string | null;
  openPrice?: boolean;
  trackInventory?: boolean;
  membershipPlanId?: string | null;
  admissionProductId?: string | null;
  giftCardDefaultAmount?: number | null;
  modifierGroups?: Array<{
    id: string;
    name: string;
    minSelect: number;
    maxSelect: number;
    required: boolean;
    modifiers: Array<{ id: string; name: string; priceDelta: number }>;
  }>;
  parentLinks?: Array<{
    childProductId: string;
    required: boolean;
    child?: { id: string; name: string; price: number };
  }>;
};

export type PosCartDto = {
  id: string;
  status: string;
  locationId: string;
  deviceId: string;
  guestProfileId: string | null;
  bookingHoldIds?: string[];
  expiresAt?: string | null;
  lines: Array<{
    id: string;
    name: string;
    qty: number;
    unitPrice: number | string;
    kind: string;
    productId?: string | null;
    sessionId?: string | null;
    admissionProductId?: string | null;
    membershipPlanId?: string | null;
  }>;
};

export type PosSaleDto = {
  id: string;
  publicId: string;
  status: string;
  total: number;
  amountPaid: number;
  amountDue: number;
  subtotal?: number;
  taxAmount?: number;
  tipAmount?: number;
  discountTotal?: number;
  guestProfileId?: string | null;
  locationId?: string;
  deviceId?: string;
  lines?: Array<{ id: string; name: string; qty: number; unitPrice: number; kind: string }>;
  payments?: Array<{
    id: string;
    tender: string;
    amount: number;
    amountRefunded?: number;
    status: string;
    stripePaymentIntentId?: string | null;
    connectedAccountId?: string | null;
  }>;
  bookingIds?: string[];
  issuedGiftCodes?: string[];
  paymentLinkUrl?: string;
  cardClientSecrets?: Array<{ paymentIntentId: string; clientSecret: string }>;
};

export type PosTender =
  | "cash"
  | "card"
  | "gift_card"
  | "park_wallet"
  | "cashless"
  | "stored_card"
  | "payment_link";

export type PosTenderInput = {
  tender: PosTender | string;
  amount: number;
  code?: string;
  giftCardId?: string;
  guestProfileId?: string;
  simulate?: string;
};

export type PosGuestDto = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  postalCode?: string | null;
  bannedAt?: string | null;
  photoUrl?: string | null;
};

export type PosTillDto = {
  id: string;
  locationId: string;
  deviceId: string;
  status: string;
  openingFloat: number;
  expectedCash: number | null;
  countedCash: number | null;
  variance: number | null;
  notes: string | null;
  closedAt: string | null;
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const payload = await api<MaybeWrapped<T>>(path, init);
  return unwrap(payload);
}

function withManagerPin(body: Record<string, unknown>, managerPin?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (managerPin) headers["x-manager-pin"] = managerPin;
  return {
    method: "POST" as const,
    headers,
    body: JSON.stringify(managerPin ? { ...body, managerPin } : body),
  };
}

export function getPosSettings(locationId: string) {
  return call<{ settings: PosSettingsDto }>(
    `/api/admin/pos/settings?locationId=${encodeURIComponent(locationId)}`
  );
}

export function savePosSettings(locationId: string, patch: Partial<PosSettingsDto>) {
  return call<{ settings: PosSettingsDto }>("/api/admin/pos/settings", {
    method: "PUT",
    body: JSON.stringify({ locationId, ...patch }),
  });
}

export function listPosDevices(locationId?: string) {
  const q = locationId ? `?locationId=${encodeURIComponent(locationId)}` : "";
  return call<{ devices: PosDeviceDto[] }>(`/api/admin/pos/devices${q}`);
}

export function createPosDevice(input: {
  locationId: string;
  name: string;
  code: string;
  templateKey?: string;
  printAgentUrl?: string | null;
  stripeTerminalId?: string | null;
}) {
  return call<{ device: PosDeviceDto }>("/api/admin/pos/devices", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updatePosDevice(id: string, patch: Record<string, unknown>) {
  return call<{ device: PosDeviceDto }>(`/api/admin/pos/devices/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function listPosProducts(locationId: string) {
  return call<{ products: PosProductDto[] }>(
    `/api/admin/pos/products?locationId=${encodeURIComponent(locationId)}`
  );
}

export function createPosProduct(input: Record<string, unknown>) {
  return call<{ product: PosProductDto }>("/api/admin/pos/products", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updatePosProduct(id: string, patch: Record<string, unknown>) {
  return call<{ product: PosProductDto }>(`/api/admin/pos/products/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function suspendPosProduct(id: string, suspend = true) {
  return call<{ product: PosProductDto }>(`/api/admin/pos/products/${id}/suspend`, {
    method: "POST",
    body: JSON.stringify({ suspend }),
  });
}

export function listPosMenus(locationId: string) {
  return call<{ menus: unknown[] }>(
    `/api/admin/pos/menus?locationId=${encodeURIComponent(locationId)}`
  );
}

export function createPosMenu(input: Record<string, unknown>) {
  return call<{ menu: unknown }>("/api/admin/pos/menus", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function addPosMenuCategory(menuId: string, input: Record<string, unknown>) {
  return call<{ category: unknown }>(`/api/admin/pos/menus/${menuId}/categories`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function addPosMenuItem(menuId: string, input: Record<string, unknown>) {
  return call<{ item: unknown }>(`/api/admin/pos/menus/${menuId}/items`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listPosDiscountCodes(locationId?: string) {
  const q = locationId ? `?locationId=${encodeURIComponent(locationId)}` : "";
  return call<{ codes: unknown[] }>(`/api/admin/pos/discount-codes${q}`);
}

export function createPosDiscountCode(input: Record<string, unknown>) {
  return call<{ code: unknown }>("/api/admin/pos/discount-codes", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function setPosManagerPin(pin: string, locationId?: string) {
  return call<{ ok: boolean; hasManagerOverridePin?: boolean }>("/api/admin/pos/manager-pin", {
    method: "POST",
    body: JSON.stringify({ pin, locationId }),
  });
}

export function verifyManagerPin(pin: string, locationId?: string) {
  return call<{ ok: boolean; userId: string }>("/api/pos/manager-pin/verify", {
    method: "POST",
    body: JSON.stringify({ pin, locationId }),
  });
}

export function getPosCatalog(locationId: string, deviceId?: string) {
  const q = new URLSearchParams({ locationId });
  if (deviceId) q.set("deviceId", deviceId);
  return call<{
    device: { id: string; name: string; templateKey: string } | null;
    menus: unknown[];
    products: PosProductDto[];
    admissions: Array<{
      id: string;
      name: string;
      type: string;
      prices: Array<{ code: string; amount: number }>;
    }>;
  }>(`/api/pos/catalog?${q.toString()}`);
}

export function getPosAvailability(locationId: string) {
  return call<{
    sessions: Array<{
      id: string;
      productId: string;
      label: string | null;
      startsAt: string;
      endsAt: string;
      capacity: number;
      remaining: number;
      closed?: boolean;
      isClosed?: boolean;
    }>;
    resources?: Array<{ id: string; name: string; remaining?: number }>;
  }>(`/api/pos/availability?locationId=${encodeURIComponent(locationId)}`);
}

export function searchPosGuests(q: string) {
  return call<{ guests: PosGuestDto[] }>(
    `/api/pos/guests/search?q=${encodeURIComponent(q)}`
  );
}

export function createPosGuest(input: Record<string, unknown>) {
  return call<{ guest: PosGuestDto }>("/api/pos/guests", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function openPosCart(input: {
  locationId: string;
  deviceId: string;
  guestProfileId?: string | null;
}) {
  return call<{ cart: PosCartDto }>("/api/pos/carts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getPosCart(cartId: string) {
  return call<{ cart: PosCartDto }>(`/api/pos/carts/${cartId}`);
}

export function addPosCartLine(cartId: string, line: Record<string, unknown>) {
  return call<{ line: unknown }>(`/api/pos/carts/${cartId}`, {
    method: "PATCH",
    body: JSON.stringify(line),
  });
}

export function updatePosCartLine(cartId: string, lineId: string, patch: Record<string, unknown>) {
  return call<{ line: unknown }>(`/api/pos/carts/${cartId}`, {
    method: "PATCH",
    body: JSON.stringify({ lineId, ...patch }),
  });
}

export function removePosCartLine(cartId: string, removeLineId: string) {
  return call<{ cart: PosCartDto }>(`/api/pos/carts/${cartId}`, {
    method: "PATCH",
    body: JSON.stringify({ removeLineId }),
  });
}

export function parkPosCart(cartId: string) {
  return call<{ cart: PosCartDto }>(`/api/pos/carts/${cartId}/park`, {
    method: "POST",
    body: "{}",
  });
}

export function abandonPosCart(cartId: string) {
  return call<{ cart: { abandoned: boolean } }>(`/api/pos/carts/${cartId}/abandon`, {
    method: "POST",
    body: "{}",
  });
}

export function listParkedPosCarts(locationId: string, deviceId?: string) {
  const q = new URLSearchParams({ locationId, status: "parked" });
  if (deviceId) q.set("deviceId", deviceId);
  return call<{ carts: PosCartDto[] }>(`/api/pos/carts?${q.toString()}`);
}

export function checkoutPosCart(
  cartId: string,
  body: {
    idempotencyKey: string;
    tenders: PosTenderInput[];
    guestProfileId?: string | null;
    postalCode?: string | null;
    discountCode?: string;
    tipAmount?: number;
    tipAllocations?: Array<{ userId?: string; amount: number }>;
    allowUnpaid?: boolean;
    allowBannedGuest?: boolean;
    managerPin?: string;
    receiptEmail?: string;
    guestName?: string;
  }
) {
  const { managerPin, ...rest } = body;
  return call<{ sale: PosSaleDto }>(
    `/api/pos/carts/${cartId}/checkout`,
    withManagerPin(rest as Record<string, unknown>, managerPin)
  );
}

/** Settle a card PaymentIntent after in-browser Elements confirmPayment. */
export function confirmPosCardPayment(
  saleId: string,
  body: { paymentIntentId: string }
) {
  return call<{ sale: PosSaleDto }>(`/api/pos/sales/${saleId}/confirm-card`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Re-fetch client_secrets for pending card tenders (resume unpaid sale). */
export function getPosCardSecrets(saleId: string) {
  return call<{
    saleId: string;
    publicId: string;
    cardClientSecrets: Array<{ paymentIntentId: string; clientSecret: string }>;
  }>(`/api/pos/sales/${saleId}/card-secrets`);
}

export function listPosSales() {
  return call<{ sales: PosSaleDto[] }>("/api/pos/sales");
}

export function getPosSale(saleId: string) {
  return call<{ sale: PosSaleDto }>(`/api/pos/sales/${saleId}`);
}

export function voidPosSale(
  saleId: string,
  bodyOrPin?: string | { managerPin?: string; locationId?: string; reason?: string }
) {
  const body =
    typeof bodyOrPin === "string"
      ? { managerPin: bodyOrPin }
      : bodyOrPin ?? {};
  const { managerPin, ...rest } = body;
  return call<{ sale: PosSaleDto }>(
    `/api/pos/sales/${saleId}/void`,
    withManagerPin(rest as Record<string, unknown>, managerPin)
  );
}

export function refundPosSale(
  saleId: string,
  body: {
    amount?: number;
    reason?: string;
    refundToGiftCard?: boolean;
    idempotencyKey?: string;
    managerPin?: string;
    locationId?: string;
  }
) {
  const { managerPin, ...rest } = body;
  return call<{ sale: PosSaleDto }>(
    `/api/pos/sales/${saleId}/refunds`,
    withManagerPin(rest, managerPin)
  );
}

export function addPosSalePayment(saleId: string, body: Record<string, unknown>) {
  return call<{ sale: PosSaleDto }>(`/api/pos/sales/${saleId}/payments`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function createPosPaymentLink(saleId: string, body: Record<string, unknown> = {}) {
  return call<{ url?: string; paymentLink?: string; status?: string }>(
    `/api/pos/sales/${saleId}/payment-link`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

/** @deprecated use createPosPaymentLink */
export const sendPosPaymentLink = createPosPaymentLink;

export function emailPosReceipt(saleId: string, to?: string) {
  return call<{ sent: boolean; publicId: string; credentialCodes: string[] }>(
    `/api/pos/sales/${saleId}/receipt`,
    { method: "POST", body: JSON.stringify({ to }) }
  );
}

export function previewPosDiscount(body: Record<string, unknown>) {
  return call<{ discountTotal?: number }>("/api/pos/discounts/preview", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function giftCardBalance(code: string, locationId: string) {
  return call<{ balance: number; last4?: string }>(
    `/api/pos/gift-cards/balance?code=${encodeURIComponent(code)}&locationId=${encodeURIComponent(locationId)}`
  );
}

export function issuePosGiftCard(input: Record<string, unknown>) {
  return call<{ code: string; giftCard: { id: string; remainingBalance: number } }>(
    "/api/pos/gift-cards/issue",
    { method: "POST", body: JSON.stringify(input) }
  );
}

export function redeemPosGiftCardApi(input: Record<string, unknown>) {
  return call<{ giftCardId: string; remainingBalance: number }>("/api/pos/gift-cards/redeem", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function cashlessBalance(code: string, locationId: string) {
  return call<{ balance: number }>(
    `/api/pos/cashless/balance?code=${encodeURIComponent(code)}&locationId=${encodeURIComponent(locationId)}`
  );
}

export function cashlessTopUp(input: Record<string, unknown>) {
  return call<{ balance: number }>("/api/pos/cashless/top-up", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function parkWalletBalance(guestProfileId: string, locationId: string) {
  return call<{ balance: number }>(
    `/api/pos/wallets/balance?guestProfileId=${encodeURIComponent(guestProfileId)}&locationId=${encodeURIComponent(locationId)}`
  );
}

export function parkWalletTopUp(input: Record<string, unknown>) {
  return call<{ balance: number }>("/api/pos/wallets/top-up", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function recordPosWastage(input: Record<string, unknown>, managerPin?: string) {
  return call<unknown>("/api/pos/wastage", withManagerPin(input, managerPin));
}

export function lookupPosMembership(locationId: string, q: string, guestMembershipId?: string) {
  const params = new URLSearchParams({ locationId, q });
  if (guestMembershipId) params.set("guestMembershipId", guestMembershipId);
  return call<{ membership: unknown }>(`/api/pos/memberships/lookup?${params.toString()}`);
}

export function reschedulePosBooking(
  bookingId: string,
  body: { sessionId: string; lineId?: string | null; allowOverbook?: boolean }
) {
  return call<{ booking: unknown }>(`/api/pos/bookings/${bookingId}/reschedule`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function adjustPosBookingItems(bookingId: string, body: Record<string, unknown>) {
  return call<{ booking: unknown }>(`/api/pos/bookings/${bookingId}/adjust-items`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function redeemPosCheckIn(body: Record<string, unknown>, managerPin?: string) {
  return call<{ kind: string; result?: unknown; credential?: unknown }>(
    "/api/pos/check-in/redeem",
    withManagerPin(body, managerPin)
  );
}

export function searchPosWaivers(q: string, locationId: string) {
  return call<{
    waivers: Array<{
      id?: string;
      status?: string;
      templateName?: string;
      guestName?: string;
      expiresAt?: string | null;
    }>;
  }>(
    `/api/pos/waivers/search?q=${encodeURIComponent(q)}&locationId=${encodeURIComponent(locationId)}`
  );
}

export function assignPosCustomIds(body: Record<string, unknown>) {
  return call<unknown>("/api/pos/credentials/custom-ids", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function openPosTab(body: Record<string, unknown>) {
  return call<{ tab: { id: string; status: string; locationId: string } }>("/api/pos/tabs", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listPosTabs(locationId: string) {
  return call<{ tabs: Array<{ id: string; status: string; tableLabel: string | null; lines?: unknown[] }> }>(
    `/api/pos/tabs?locationId=${encodeURIComponent(locationId)}`
  );
}

export function addPosTabLine(tabId: string, body: Record<string, unknown>) {
  return call<{ line: unknown }>(`/api/pos/tabs/${tabId}/lines`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function splitPosTab(tabId: string, body: Record<string, unknown>) {
  return call<{ beta: boolean; parentId: string; child: unknown }>(`/api/pos/tabs/${tabId}/split`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function preauthPosTab(tabId: string, body: Record<string, unknown>) {
  return call<{ beta: boolean; paymentIntentId?: string; status?: string; message?: string }>(
    `/api/pos/tabs/${tabId}/preauth`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

export function settlePosTab(tabId: string, body: Record<string, unknown>) {
  return call<{ beta: boolean; sale: PosSaleDto }>(`/api/pos/tabs/${tabId}/settle`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function openPosTill(body: Record<string, unknown>) {
  return call<{ till: PosTillDto }>("/api/pos/tills/open", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listPosTills() {
  return call<{ tills: PosTillDto[] }>("/api/pos/tills");
}

export function addPosTillMovement(tillId: string, body: Record<string, unknown>) {
  return call<{ till: PosTillDto }>(`/api/pos/tills/${tillId}/movements`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function closePosTill(tillId: string, body: Record<string, unknown>) {
  return call<{ till: PosTillDto }>(`/api/pos/tills/${tillId}/close`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function closePosTillNoCount(tillId: string, body: Record<string, unknown> = {}) {
  return call<{ till: PosTillDto }>(`/api/pos/tills/${tillId}/close-no-count`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function editPosTill(tillId: string, body: Record<string, unknown>) {
  return call<{ till: PosTillDto }>(`/api/pos/tills/${tillId}/edit`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function syncPosOffline(body: Record<string, unknown>) {
  return call<{ mutation: { id: string; status: string; error?: string | null } }>(
    "/api/pos/offline/sync",
    { method: "POST", body: JSON.stringify(body) }
  );
}

export function kickPosDrawer(deviceId: string, saleId?: string) {
  return call<{ kicked: boolean; reason: string; agentUrl?: string }>(
    `/api/pos/devices/${deviceId}/drawer-kick`,
    { method: "POST", body: JSON.stringify({ saleId }) }
  );
}

export function getPosTerminalConnectionToken() {
  return call<{ secret: string }>("/api/pos/terminal/connection-token", {
    method: "POST",
    body: "{}",
  });
}
