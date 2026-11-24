import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import { ok, created, badRequest } from "@/lib/response";
import { authErrorToResponse, authAudit, serverError } from "@/lib/response";
import { requireAnyPermissionFresh } from "@/lib/middleware/requireAuth";
import {
  P,
  hasAnyPermission,
  lookupApiPermission,
} from "@/lib/auth/permissions";
import { ForbiddenError, isAuthHttpError } from "@/lib/auth/http-error";
import { isPosError } from "@/lib/pos/errors";
import { assertPosStaff, rejectPosClientOrg, type PosActor } from "@/lib/pos/scope";
import { getPosSettings, putPosSettings } from "@/lib/pos/settings";
import {
  createPosDevice,
  kickDrawer,
  listPosDevices,
  updatePosDevice,
} from "@/lib/pos/devices";
import {
  addMenuCategory,
  addMenuItem,
  createDiscountCode,
  createMenu,
  createPosProduct,
  getPosCatalog,
  listDiscountCodes,
  listMenus,
  listPosProducts,
  suspendPosProduct,
  updatePosProduct,
} from "@/lib/pos/catalog";
import { createPosGuest, searchPosGuests } from "@/lib/pos/guests";
import { setManagerPin, setVenueOverridePin, verifyManagerPin } from "@/lib/pos/pins";
import {
  abandonCart,
  addCartLine,
  availability,
  checkoutCart,
  confirmCardPayment,
  getCart,
  getPendingCardSecrets,
  getSale,
  listParkedCarts,
  listSales,
  openCart,
  parkCart,
  previewDiscount,
  recordWastage,
  refundSale,
  removeCartLine,
  updateCartLine,
  voidSale,
} from "@/lib/pos/saleEngine";
import {
  addTillMovement,
  closeTill,
  editClosedTill,
  listTills,
  openTill,
} from "@/lib/pos/tills";
import {
  adjustCashless,
  adjustParkWallet,
  cashlessBalance,
  giftBalance,
  issueCashless,
  issuePosGiftCard,
  redeemPosGiftCard,
  walletBalance,
} from "@/lib/pos/storedValue";
import { assignPosCustomIds, redeemAtPos, searchPosWaivers } from "@/lib/pos/checkin";
import { addTabLine, listTabs, openTab, preauthTab, settleTab, splitTab } from "@/lib/pos/tabs";
import { syncOffline } from "@/lib/pos/offline";
import { emailPosReceipt } from "@/lib/pos/receipts";
import { posVerifyMembership } from "@/lib/memberships/posAdapter";
import { findMembershipForRedeem } from "@/lib/memberships/entitlementEngine";
import { replaceBookingLines, rescheduleBooking } from "@/lib/ticketing/bookingEngine";
import { requirePosVenue } from "@/lib/pos/scope";
import prisma from "@/lib/prisma";
import { money, num, roundMoney } from "@/lib/pos/money";
import { PosError } from "@/lib/pos/errors";
import { requireOpenTill } from "@/lib/pos/tills";
import { posSmokeAllowed } from "@/lib/pos/posSmoke";
import { consumeRateLimit } from "@/lib/rateLimit";
import { isValidId } from "@/lib/ids";

function asActor(actor: { orgId?: string | null; sub?: string | null; permissions?: Iterable<string> | null }): PosActor {
  return actor;
}

async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  if (request.method === "GET") {
    const out: Record<string, unknown> = {};
    request.nextUrl.searchParams.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  try {
    const json = (await request.json()) as Record<string, unknown>;
    const headerKey = request.headers.get("idempotency-key");
    if (headerKey && json.idempotencyKey == null) json.idempotencyKey = headerKey;
    const pin = request.headers.get("x-manager-pin");
    if (pin && json.managerPin == null) json.managerPin = pin;
    return json ?? {};
  } catch {
    return {};
  }
}

function fail(err: unknown, request: NextRequest, pathname: string) {
  if (isPosError(err)) {
    return NextResponse.json(
      { success: false, message: err.message, code: err.code },
      { status: err.status }
    );
  }
  if (isAuthHttpError(err)) {
    return (
      authErrorToResponse(err, authAudit(request, pathname)) ??
      serverError("Failed")
    );
  }
  if (err instanceof Error && /not found|forbidden|outside/i.test(err.message)) {
    const status = /forbidden|outside/i.test(err.message) ? 403 : 400;
    return NextResponse.json({ success: false, message: err.message }, { status });
  }
  console.error(pathname, err);
  return serverError("POS request failed");
}

export async function handlePosRequest(request: NextRequest, pathname: string) {
  const rule = lookupApiPermission(request.method, pathname);
  if (!rule || rule.permissions.length === 0) {
    return NextResponse.json({ success: false, message: "Not found" }, { status: 404 });
  }
  let actor;
  try {
    actor = await requireAnyPermissionFresh(request, rule.permissions);
  } catch (err) {
    return (
      authErrorToResponse(err, authAudit(request, pathname, { permission: rule.permissions[0] })) ??
      serverError("Failed to authorize")
    );
  }
  let body: Record<string, unknown> = {};
  try {
    await connectDB();
    body = await readBody(request);
    if (request.method !== "GET") rejectPosClientOrg(body);
    const staff = asActor(actor);
    // Every POS catch-all route fails closed before dispatch (no storefront bypass).
    await assertPosStaff(staff);
    const parts = pathname.split("/").filter(Boolean);
    const data = await dispatch(staff, request.method, parts, body, actor.permissions);
    if (request.method === "POST") return created(data as never);
    return ok(data as never);
  } catch (err) {
    return fail(err, request, pathname);
  }
}

async function dispatch(
  actor: PosActor,
  method: string,
  parts: string[],
  body: Record<string, unknown>,
  permissions: Iterable<string> | null | undefined
) {
  const joined = parts.join("/");
  const locationId = body.locationId == null ? null : String(body.locationId);
  const canSeeExpected = hasAnyPermission(permissions, [P.PosTillEdit]);

  if (joined === "api/admin/pos/settings" && method === "GET") {
    return { settings: await getPosSettings(actor, locationId) };
  }
  if (joined === "api/admin/pos/settings" && method === "PUT") {
    return { settings: await putPosSettings(actor, locationId, body) };
  }
  if (joined === "api/admin/pos/devices" && method === "GET") {
    return { devices: await listPosDevices(actor, locationId) };
  }
  if (joined === "api/admin/pos/devices" && method === "POST") {
    return { device: await createPosDevice(actor, body) };
  }
  if (parts[0] === "api" && parts[1] === "admin" && parts[2] === "pos" && parts[3] === "devices" && parts[4] && method === "GET") {
    const devices = await listPosDevices(actor);
    const device = devices.find((d) => d.id === parts[4]);
    if (!device) throw new ForbiddenError("Device is outside this company");
    return { device };
  }
  if (parts[0] === "api" && parts[1] === "admin" && parts[2] === "pos" && parts[3] === "devices" && parts[4] && method === "PATCH") {
    return { device: await updatePosDevice(actor, parts[4], body) };
  }
  if (joined === "api/admin/pos/menus" && method === "GET") {
    return { menus: await listMenus(actor, String(locationId || "")) };
  }
  if (joined === "api/admin/pos/menus" && method === "POST") {
    return { menu: await createMenu(actor, body) };
  }
  if (parts[3] === "menus" && parts[5] === "categories" && method === "POST") {
    return { category: await addMenuCategory(actor, parts[4], body) };
  }
  if (parts[3] === "menus" && parts[5] === "items" && method === "POST") {
    return { item: await addMenuItem(actor, parts[4], body) };
  }
  if (joined === "api/admin/pos/products" && method === "GET") {
    return { products: await listPosProducts(actor, locationId) };
  }
  if (joined === "api/admin/pos/products" && method === "POST") {
    return { product: await createPosProduct(actor, body) };
  }
  if (parts[3] === "products" && parts[5] === "suspend" && method === "POST") {
    return { product: await suspendPosProduct(actor, parts[4], body.suspend !== false) };
  }
  if (parts[3] === "products" && parts[4] && method === "PATCH") {
    return { product: await updatePosProduct(actor, parts[4], body) };
  }
  if (joined === "api/admin/pos/discount-codes" && method === "GET") {
    return { codes: await listDiscountCodes(actor, locationId) };
  }
  if (joined === "api/admin/pos/discount-codes" && method === "POST") {
    return { code: await createDiscountCode(actor, body) };
  }
  if (joined === "api/admin/pos/manager-pin" && method === "POST") {
    const locationId = String(body.locationId || "");
    // Venue override PIN when locationId is sent; else staff Membership pinHash.
    if (locationId) {
      return setVenueOverridePin(actor, locationId, String(body.pin || ""));
    }
    return setManagerPin(actor, String(body.pin || ""));
  }
  if (joined === "api/admin/pos/guests" && method === "GET") {
    return { guests: await searchPosGuests(actor, String(body.q || "")) };
  }
  if (joined === "api/admin/pos/guests" && method === "POST") {
    return { guest: await createPosGuest(actor, body) };
  }
  if (joined === "api/pos/manager-pin/verify" && method === "POST") {
    const verified = await verifyManagerPin(actor, String(body.pin || body.managerPin || ""), locationId);
    return { ok: true, userId: verified.userId };
  }
  if (joined === "api/pos/guests/search" && method === "GET") {
    return { guests: await searchPosGuests(actor, String(body.q || "")) };
  }
  if (joined === "api/pos/guests" && method === "POST") {
    return { guest: await createPosGuest(actor, body) };
  }
  if (joined === "api/pos/catalog" && method === "GET") {
    return getPosCatalog(actor, String(locationId || ""), body.deviceId ? String(body.deviceId) : null);
  }
  if (joined === "api/pos/availability" && method === "GET") {
    return availability(actor, String(locationId || ""));
  }
  if (joined === "api/pos/waivers/search" && method === "GET") {
    const rows = await searchPosWaivers(actor, String(body.q || ""), String(locationId || ""));
    return { waivers: rows };
  }
  if (joined === "api/pos/carts" && method === "POST") {
    return { cart: await openCart(actor, body) };
  }
  if (joined === "api/pos/carts" && method === "GET") {
    const parkId = String(locationId || "").trim();
    // Parked-cart list is park-scoped. Missing/invalid locationId used to 403
    // with "Venue location is required" and paint a sticky red banner on POS.
    if (!parkId || !isValidId(parkId)) {
      return { carts: [] as unknown[] };
    }
    return {
      carts: await listParkedCarts(
        actor,
        parkId,
        body.deviceId ? String(body.deviceId) : null
      ),
    };
  }
  if (parts[2] === "carts" && parts[3] && parts.length === 4 && method === "GET") {
    return { cart: await getCart(actor, parts[3]) };
  }
  if (parts[2] === "carts" && parts[3] && parts.length === 4 && method === "PATCH") {
    if (body.removeLineId) {
      return { cart: await removeCartLine(actor, parts[3], String(body.removeLineId)) };
    }
    if (body.lineId) {
      return { line: await updateCartLine(actor, parts[3], String(body.lineId), body) };
    }
    return { line: await addCartLine(actor, parts[3], (body.line as Record<string, unknown>) || body) };
  }
  if (parts[2] === "carts" && parts[4] === "park") {
    return { cart: await parkCart(actor, parts[3]) };
  }
  if (parts[2] === "carts" && parts[4] === "checkout") {
    await assertTenderPermissions(permissions, body);
    return { sale: await checkoutCart(actor, parts[3], body) };
  }
  if (joined === "api/pos/sales" && method === "GET") {
    return { sales: await listSales(actor) };
  }
  if (parts[2] === "sales" && parts[3] && parts.length === 4 && method === "GET") {
    return { sale: await getSale(actor, parts[3]) };
  }
  if (parts[2] === "sales" && parts[4] === "void") {
    return { sale: await voidSale(actor, parts[3], body) };
  }
  if (parts[2] === "sales" && parts[4] === "refunds") {
    return { sale: await refundSale(actor, parts[3], body) };
  }
  if (parts[2] === "sales" && parts[4] === "payments") {
    await assertTenderPermissions(permissions, body);
    return { sale: await addSalePayment(actor, parts[3], body) };
  }
  if (parts[2] === "sales" && parts[4] === "payment-link") {
    return createPaymentLink(actor, parts[3], body);
  }
  if (parts[2] === "sales" && parts[4] === "confirm-card" && method === "POST") {
    assertPosCardActionRateLimit(actor, "confirm-card");
    return { sale: await confirmCardPayment(actor, parts[3], body) };
  }
  if (parts[2] === "sales" && parts[4] === "card-secrets" && method === "GET") {
    assertPosCardActionRateLimit(actor, "card-secrets");
    return getPendingCardSecrets(actor, parts[3]);
  }
  if (parts[2] === "sales" && parts[4] === "receipt") {
    return emailPosReceipt(actor, parts[3], body.to ? String(body.to) : null);
  }
  if (joined === "api/pos/discounts/preview") {
    return previewDiscount(actor, body);
  }
  if (joined === "api/pos/gift-cards/balance") {
    return giftBalance(actor, String(body.code || ""), String(locationId || ""));
  }
  if (joined === "api/pos/gift-cards/issue") {
    const { orgId } = await requirePosVenue(actor, String(locationId || ""));
    return issuePosGiftCard({
      orgId,
      locationId: String(locationId || ""),
      amount: Number(body.amount),
      guestProfileId: body.guestProfileId ? String(body.guestProfileId) : null,
      createdById: actor.sub,
      idempotencyKey: body.idempotencyKey ? String(body.idempotencyKey) : undefined,
      kind: body.kind === "physical" ? "physical" : "digital",
    });
  }
  if (joined === "api/pos/gift-cards/redeem") {
    const { orgId } = await requirePosVenue(actor, String(locationId || ""));
    return redeemPosGiftCard({
      orgId,
      code: String(body.code || ""),
      amount: Number(body.amount),
      createdById: actor.sub,
      idempotencyKey: body.idempotencyKey ? String(body.idempotencyKey) : undefined,
    });
  }
  if (joined === "api/pos/cashless/balance") {
    return cashlessBalance(actor, String(body.code || ""), String(locationId || ""));
  }
  if (joined === "api/pos/cashless/issue") {
    const { orgId } = await requirePosVenue(actor, String(locationId || ""));
    return issueCashless({
      orgId,
      locationId: String(locationId),
      amount: Number(body.amount ?? 0),
      guestProfileId: body.guestProfileId ? String(body.guestProfileId) : null,
    });
  }
  if (joined === "api/pos/cashless/top-up") {
    const { orgId } = await requirePosVenue(actor, String(locationId || ""));
    return adjustCashless({ orgId, code: String(body.code || ""), amount: Number(body.amount) });
  }
  if (joined === "api/pos/wallets/balance") {
    return walletBalance(actor, String(body.guestProfileId || ""), String(locationId || ""));
  }
  if (joined === "api/pos/wallets/issue" || joined === "api/pos/wallets/top-up") {
    const { orgId } = await requirePosVenue(actor, String(locationId || ""));
    return adjustParkWallet({
      orgId,
      locationId: String(locationId),
      guestProfileId: String(body.guestProfileId || ""),
      amount: Number(body.amount),
      type: joined.endsWith("issue") ? "issue" : "topup",
      reference: String(body.idempotencyKey || body.reference || `${joined}:${Date.now()}`),
    });
  }
  if (joined === "api/pos/wallets/redeem") {
    const { orgId } = await requirePosVenue(actor, String(locationId || ""));
    return adjustParkWallet({
      orgId,
      locationId: String(locationId),
      guestProfileId: String(body.guestProfileId || ""),
      amount: Number(body.amount),
      type: "redeem",
      reference: String(body.idempotencyKey || body.reference || `redeem:${Date.now()}`),
    });
  }
  if (joined === "api/pos/wastage") return recordWastage(actor, body);
  if (joined === "api/pos/memberships/lookup") {
    const { orgId } = await requirePosVenue(actor, String(locationId || ""));
    let membershipId = body.guestMembershipId ? String(body.guestMembershipId) : "";
    if (!membershipId) {
      const found = await findMembershipForRedeem(orgId, String(body.q || body.query || ""));
      if (!found) return { membership: null };
      membershipId = found.id;
    }
    // Always verify against this park so photo / eligibility stay in sync with Memberships.
    const verified = await posVerifyMembership(membershipId, String(locationId), orgId);
    const displayName = `${verified.member.firstName} ${verified.member.lastName}`.trim() || "Member";
    return {
      membership: {
        id: verified.guestMembershipId,
        guestMembershipId: verified.guestMembershipId,
        displayName,
        guestName: displayName,
        photoUrl: verified.member.photoUrl || verified.member.guestPhotoUrl,
        guestPhotoUrl: verified.member.guestPhotoUrl,
        customMembershipId: verified.member.customMembershipId,
        blocked: verified.blocked,
        blockReason: verified.blockReason,
        remainingEntries: verified.remainingEntries,
        visitsExhausted: verified.visitsExhausted,
        warnings: verified.warnings,
        status: verified.status,
      },
    };
  }
  if (
    parts[2] === "bookings" &&
    (parts[4] === "reschedule" || parts[4] === "adjust-items") &&
    (await prisma.partyBookingDetail.findFirst({
      where: { bookingId: parts[3], orgId: String(actor.orgId ?? "") },
      select: { id: true },
    }))
  ) {
    // Party bookings are edited through the party engine (counts, add-ons, session, room).
    const { editPartyFromPos } = await import("@/lib/parties/posAdapter");
    const patch =
      parts[4] === "reschedule"
        ? { sessionId: body.sessionId, overbook: body.allowOverbook === true, overbookReason: body.overbookReason }
        : body;
    return { party: await editPartyFromPos(actor as never, parts[3], patch) };
  }
  if (parts[2] === "bookings" && parts[4] === "reschedule") {
    return {
      booking: await rescheduleBooking(actor as never, parts[3], {
        sessionId: String(body.sessionId || ""),
        lineId: body.lineId ? String(body.lineId) : null,
        allowOverbook: body.allowOverbook === true,
      }),
    };
  }
  if (parts[2] === "bookings" && parts[4] === "adjust-items") {
    const lines = Array.isArray(body.lines) ? body.lines : [];
    return {
      booking: await replaceBookingLines(
        actor as never,
        parts[3],
        lines as never,
        { allowOverbook: body.allowOverbook === true }
      ),
    };
  }
  if (joined === "api/pos/check-in/redeem") return redeemAtPos(actor, body);
  if (joined === "api/pos/credentials/custom-ids") return assignPosCustomIds(actor, body);
  if (joined === "api/pos/tabs" && method === "GET") {
    return { tabs: await listTabs(actor, String(locationId || "")) };
  }
  if (joined === "api/pos/tabs" && method === "POST") return { tab: await openTab(actor, body) };
  if (parts[2] === "tabs" && parts[4] === "lines") return { line: await addTabLine(actor, parts[3], body) };
  if (parts[2] === "tabs" && parts[4] === "split") return splitTab(actor, parts[3], body);
  if (parts[2] === "tabs" && parts[4] === "preauth") return preauthTab(actor, parts[3], body);
  if (parts[2] === "tabs" && parts[4] === "settle") return settleTab(actor, parts[3], body);
  if (joined === "api/pos/tills/open") return { till: await openTill(actor, body) };
  if (joined === "api/pos/tills" && method === "GET") {
    return { tills: await listTills(actor, canSeeExpected) };
  }
  if (parts[2] === "tills" && parts[4] === "movements") {
    return { till: await addTillMovement(actor, parts[3], body) };
  }
  if (parts[2] === "tills" && parts[4] === "close") {
    return { till: await closeTill(actor, parts[3], body, { noCount: false, allowNoCount: false }) };
  }
  if (parts[2] === "tills" && parts[4] === "close-no-count") {
    return {
      till: await closeTill(actor, parts[3], body, {
        noCount: true,
        allowNoCount: hasAnyPermission(permissions, [P.PosTillNoCount]),
      }),
    };
  }
  if (parts[2] === "tills" && parts[4] === "edit") {
    return { till: await editClosedTill(actor, parts[3], body) };
  }
  if (joined === "api/pos/offline/sync") return { mutation: await syncOffline(actor, body) };
  if (parts[2] === "devices" && parts[4] === "drawer-kick") {
    return kickDrawer(actor, parts[3], body.saleId ? String(body.saleId) : null);
  }
  if (joined === "api/pos/terminal/connection-token") {
    if (!process.env.STRIPE_SECRET_KEY?.trim()) {
      throw new PosError("STRIPE_NOT_CONFIGURED", "Card payments need STRIPE_SECRET_KEY", 400);
    }
    const { getStripe } = await import("@/lib/stripe");
    const token = await getStripe().terminal.connectionTokens.create();
    return { secret: token.secret };
  }
  if (parts[2] === "carts" && parts[4] === "abandon") {
    return { cart: await abandonCart(actor, parts[3]) };
  }
  throw new PosError("NOT_FOUND", "POS route was not found", 404);
}

function assertPosCardActionRateLimit(actor: PosActor, action: string) {
  const userId = actor.sub ? String(actor.sub) : "anon";
  const rl = consumeRateLimit(`pos:${action}:${userId}`, 40, 60_000);
  if (!rl.allowed) {
    throw new PosError(
      "RATE_LIMIT",
      "Too many card confirm attempts. Try again shortly.",
      429
    );
  }
}

async function assertTenderPermissions(
  permissions: Iterable<string> | null | undefined,
  body: Record<string, unknown>
) {
  const tenders = Array.isArray(body.tenders)
    ? (body.tenders as Array<Record<string, unknown>>)
    : body.tender
      ? [body]
      : [];
  if (tenders.some((t) => t.tender === "cash") && !hasAnyPermission(permissions, [P.PosCash])) {
    throw new ForbiddenError("Cash tender requires pos:cash");
  }
  if (
    tenders.some((t) => t.tender === "stored_card") &&
    !hasAnyPermission(permissions, [P.PosChargeStored])
  ) {
    throw new ForbiddenError("Stored card charges require pos:charge_stored");
  }
}

async function addSalePayment(actor: PosActor, saleId: string, body: Record<string, unknown>) {
  const sale = await getSale(actor, saleId);
  if (sale.status === "voided" || sale.status === "refunded") {
    throw new PosError(
      "SALE_STATUS",
      `Sale is ${sale.status} and cannot accept new payments`,
      400
    );
  }
  const amount = roundMoney(Number(body.amount));
  if (!(amount > 0)) throw new PosError("AMOUNT", "amount must be greater than zero");
  const tender = String(body.tender || "");
  if (tender === "payment_link") {
    throw new PosError(
      "USE_PAYMENT_LINK",
      "Use POST …/payment-link for Stripe Checkout payment links",
      400
    );
  }
  if (tender === "cash") {
    const settings = await prisma.posSettings.findFirst({
      where: { orgId: sale.orgId, locationId: sale.locationId },
    });
    const orgDefault = settings
      ? settings
      : await prisma.posSettings.findFirst({ where: { orgId: sale.orgId, locationId: null } });
    if (orgDefault?.cashRequiresOpenTill !== false) {
      await requireOpenTill(sale.orgId, sale.deviceId);
    }
  }

  let status: "completed" | "pending" =
    body.simulate === "succeeded" && posSmokeAllowed() ? "completed" : "pending";
  let stripePaymentIntentId: string | null =
    body.simulate === "succeeded" && posSmokeAllowed()
      ? `pi_smoke_${sale.id}`
      : null;
  let cardClientSecrets: Array<{ paymentIntentId: string; clientSecret: string }> = [];
  let connectedAccountId: string | null = null;
  let platformFeeMinor: number | null = null;

  if (tender === "card" || tender === "stored_card") {
    if (body.simulate === "pending" && posSmokeAllowed()) {
      stripePaymentIntentId = `pi_smoke_pending_${sale.id}`;
      status = "pending";
      cardClientSecrets = [
        {
          paymentIntentId: stripePaymentIntentId,
          clientSecret: `smoke_secret_${stripePaymentIntentId}`,
        },
      ];
    } else if (body.simulate === "succeeded" && posSmokeAllowed()) {
      // smoke completed path already set above
    } else if (!process.env.STRIPE_SECRET_KEY?.trim()) {
      throw new PosError("STRIPE_NOT_CONFIGURED", "Card payments need STRIPE_SECRET_KEY", 400);
    } else {
      let pi: { id: string; status: string; client_secret: string | null };
      try {
        const device = sale.deviceId
          ? await prisma.posDevice.findFirst({
              where: { id: sale.deviceId, orgId: sale.orgId, archivedAt: null },
              select: { stripeTerminalId: true },
            })
          : null;
        const preferTerminal = Boolean(
          device?.stripeTerminalId?.trim().startsWith("tmr_")
        );
        const { getStripe } = await import("@/lib/stripe");
        const { resolvePosConnectChargeFields } = await import(
          "@/lib/marketplace/posConnect"
        );
        const connect = await resolvePosConnectChargeFields({
          orgId: sale.orgId,
          locationId: sale.locationId,
          amountMinor: Math.round(amount * 100),
        });
        connectedAccountId = connect.connectedAccountId;
        platformFeeMinor = connect.applicationFeeMinor;
        const stripe = getStripe();
        const meta = {
          type: "pos_sale",
          posSaleId: sale.id,
          publicId: sale.publicId,
          ...connect.metadataExtras,
        };
        pi = preferTerminal
          ? await stripe.paymentIntents.create({
              amount: Math.round(amount * 100),
              currency: "usd",
              payment_method_types: ["card_present"],
              capture_method: "automatic",
              metadata: meta,
              ...connect.paymentIntentExtras,
            })
          : await stripe.paymentIntents.create({
              amount: Math.round(amount * 100),
              currency: "usd",
              automatic_payment_methods: { enabled: true },
              metadata: meta,
              ...connect.paymentIntentExtras,
            });
      } catch (err) {
        throw new PosError(
          "STRIPE_ERROR",
          err instanceof Error ? err.message : "Could not create card PaymentIntent",
          502
        );
      }
      stripePaymentIntentId = pi.id;
      status = pi.status === "succeeded" ? "completed" : "pending";
      if (pi.client_secret && status === "pending") {
        cardClientSecrets = [
          { paymentIntentId: pi.id, clientSecret: pi.client_secret },
        ];
      }
    }
  }

  const key = String(body.idempotencyKey || `${sale.id}:${tender}:${amount}`);
  const existing = await prisma.posSalePayment.findFirst({
    where: { orgId: sale.orgId, idempotencyKey: key },
  });
  if (!existing) {
    await prisma.posSalePayment.create({
      data: {
        saleId: sale.id,
        orgId: sale.orgId,
        tender: tender as never,
        amount: money(amount),
        status,
        idempotencyKey: key,
        stripePaymentIntentId,
        connectedAccountId,
        platformFeeMinor,
      },
    });
  } else if (
    (tender === "card" || tender === "stored_card") &&
    existing.status === "pending" &&
    existing.stripePaymentIntentId?.startsWith("pi_")
  ) {
    const secrets = await getPendingCardSecrets(actor, saleId);
    cardClientSecrets = secrets.cardClientSecrets;
  }
  const payments = await prisma.posSalePayment.findMany({ where: { saleId: sale.id } });
  const paid = roundMoney(
    payments.filter((p) => p.status === "completed").reduce((s, p) => s + num(p.amount), 0)
  );
  const nextStatus =
    sale.status === "voided" || sale.status === "refunded"
      ? sale.status
      : paid + 0.001 >= num(sale.total)
        ? "completed"
        : "unpaid";
  await prisma.posSale.update({
    where: { id: sale.id },
    data: {
      amountPaid: money(paid),
      amountDue: money(Math.max(0, num(sale.total) - paid)),
      status: nextStatus,
    },
  });
  if (nextStatus === "completed" && sale.status !== "completed") {
    const { fulfillCompletedPosSale } = await import("@/lib/pos/fulfillSale");
    await fulfillCompletedPosSale({
      saleId: sale.id,
      actorUserId: actor.sub ? String(actor.sub) : null,
    });
    await prisma.guestTab.updateMany({
      where: { saleId: sale.id, status: { in: ["open", "authorized"] } },
      data: { status: "settled" },
    });
  }
  const dto = await getSale(actor, sale.id);
  return {
    ...dto,
    ...(cardClientSecrets.length ? { cardClientSecrets } : {}),
  };
}

async function createPaymentLink(actor: PosActor, saleId: string, body: Record<string, unknown>) {
  const sale = await getSale(actor, saleId);
  if (sale.status === "voided" || sale.status === "refunded") {
    throw new PosError(
      "SALE_STATUS",
      `Sale is ${sale.status} and cannot accept payment links`,
      400
    );
  }
  const due = roundMoney(num(sale.amountDue));
  if (!(due > 0)) {
    throw new PosError("AMOUNT_DUE", "Sale has no amount due for a payment link", 400);
  }
  if (!process.env.STRIPE_SECRET_KEY?.trim()) {
    throw new PosError("STRIPE_NOT_CONFIGURED", "Payment links need STRIPE_SECRET_KEY", 400);
  }
  const { getStripe } = await import("@/lib/stripe");
  const { publicAppBaseUrl } = await import("@/lib/publicAppBaseUrl");
  const { resolvePosConnectChargeFields } = await import(
    "@/lib/marketplace/posConnect"
  );
  const connect = await resolvePosConnectChargeFields({
    orgId: sale.orgId,
    locationId: sale.locationId,
    amountMinor: Math.round(due * 100),
  });
  const base = publicAppBaseUrl() || "https://example.com";
  const meta = {
    type: "pos_sale",
    posSaleId: sale.id,
    publicId: sale.publicId,
    ...connect.metadataExtras,
  };
  let session: { id: string; url: string | null };
  try {
    session = await getStripe().checkout.sessions.create({
      mode: "payment",
      success_url: `${base}/admin/pos/sales?paid=1`,
      cancel_url: `${base}/admin/pos/sales?paid=0`,
      customer_email: body.email ? String(body.email) : undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(due * 100),
            product_data: { name: `POS ${sale.publicId}` },
          },
        },
      ],
      metadata: meta,
      payment_intent_data: {
        metadata: meta,
        ...connect.paymentIntentExtras,
      },
    });
  } catch (err) {
    throw new PosError(
      "STRIPE_ERROR",
      err instanceof Error ? err.message : "Could not create payment link",
      502
    );
  }
  await prisma.posSalePayment.create({
    data: {
      saleId: sale.id,
      orgId: sale.orgId,
      tender: "payment_link",
      connectedAccountId: connect.connectedAccountId,
      platformFeeMinor: connect.applicationFeeMinor,
      amount: money(due),
      status: "pending",
      // Session id until Checkout creates the PI; webhook attaches the real PI then settles.
      stripePaymentIntentId: `cs:${session.id}`,
      idempotencyKey: String(body.idempotencyKey || `link:${sale.id}:${session.id}`),
    },
  });
  return { url: session.url, unpaid: true };
}
