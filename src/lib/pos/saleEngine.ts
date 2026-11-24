import { randomBytes } from "crypto";
import prisma from "@/lib/prisma";
import type { PosCartLine, PosLineKind, Prisma } from "@prisma/client";
import { ForbiddenError } from "@/lib/auth/http-error";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import { previewBookingTax } from "@/lib/ticketing/tax";
import { createBooking, confirmBooking, cancelBooking } from "@/lib/ticketing/bookingEngine";
import { releaseHoldById } from "@/lib/ticketing/holds";
import { createSessionHold } from "@/lib/ticketing/holds";
import { resolveBookingSettings } from "@/lib/ticketing/settings";
import { PosError } from "@/lib/pos/errors";
import { money, num, roundMoney } from "@/lib/pos/money";
import { actorUserId, posListLocationWhere, requirePosVenue, type PosActor } from "@/lib/pos/scope";
import { resolvePosSettings } from "@/lib/pos/settings";
import { verifyManagerPin } from "@/lib/pos/pins";
import { requireOpenTill, expectedCashForSession } from "@/lib/pos/tills";
import { redeemPosGiftCard, adjustCashless, adjustParkWallet } from "@/lib/pos/storedValue";
import { issueGiftCard } from "@/lib/ticketing/giftCards";
import { fulfillCompletedPosSale } from "@/lib/pos/fulfillSale";
import { posSmokeAllowed } from "@/lib/pos/posSmoke";
import { createKitchenTicket, resolveKitchenStation } from "@/lib/pos/kitchen";
import { syncPartyMoney } from "@/lib/parties/deposits";
import { syncPartyAfterBookingWrite } from "@/lib/parties/bookingHooks";
import { createPartyFromPos, isPartyPackageProduct } from "@/lib/parties/posAdapter";
import {
  enqueueSource,
  flushAccountingQueueSoon,
} from "@/lib/accounting/enqueueHooks";
import {
  InsufficientStockError,
  recordInventoryMovement,
} from "@/lib/accounting/inventory/movements";
import { toMinor } from "@/lib/accounting/money";

function publicId() {
  return `PS-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function devicePrefersTerminalReader(stripeTerminalId: string | null | undefined): boolean {
  return Boolean(stripeTerminalId?.trim().startsWith("tmr_"));
}

/** Create a card PaymentIntent for Terminal (card_present) or in-browser Elements. */
async function createPosCardPaymentIntent(opts: {
  amountCents: number;
  posSaleId: string;
  publicId: string;
  preferTerminal: boolean;
  orgId?: string;
  locationId?: string;
}) {
  const { getStripe } = await import("@/lib/stripe");
  const stripe = getStripe();
  let connect: Awaited<
    ReturnType<
      typeof import("@/lib/marketplace/posConnect").resolvePosConnectChargeFields
    >
  > | null = null;
  if (opts.orgId && opts.locationId) {
    const { resolvePosConnectChargeFields } = await import(
      "@/lib/marketplace/posConnect"
    );
    connect = await resolvePosConnectChargeFields({
      orgId: opts.orgId,
      locationId: opts.locationId,
      amountMinor: opts.amountCents,
    });
  }
  const metadata: Record<string, string> = {
    type: "pos_sale",
    posSaleId: opts.posSaleId,
    publicId: opts.publicId,
    ...(connect?.metadataExtras ?? {}),
  };
  if (opts.preferTerminal) {
    return stripe.paymentIntents.create({
      amount: opts.amountCents,
      currency: "usd",
      payment_method_types: ["card_present"],
      capture_method: "automatic",
      metadata,
      ...(connect?.paymentIntentExtras ?? {}),
    });
  }
  return stripe.paymentIntents.create({
    amount: opts.amountCents,
    currency: "usd",
    automatic_payment_methods: { enabled: true },
    metadata,
    ...(connect?.paymentIntentExtras ?? {}),
  });
}

/**
 * card_present intents cannot be confirmed with Stripe Elements. Cancel and
 * replace with an online PI so the cashier can finish in-browser.
 * Must reuse resolvePosConnectChargeFields so franchise park money does not
 * silently settle on the platform.
 */
async function convertCardPresentIntentToBrowser(opts: {
  paymentId: string;
  paymentIntentId: string;
  amountCents: number;
  posSaleId: string;
  publicId: string;
  orgId: string;
  locationId: string;
}): Promise<{ paymentIntentId: string; clientSecret: string } | null> {
  const { getStripe } = await import("@/lib/stripe");
  const stripe = getStripe();
  try {
    const existing = await stripe.paymentIntents.retrieve(opts.paymentIntentId);
    if (existing.status === "succeeded") return null;
    if (existing.status !== "canceled") {
      try {
        await stripe.paymentIntents.cancel(opts.paymentIntentId);
      } catch {
        /* already terminal / uncancellable — still try a replacement */
      }
    }
    const { resolvePosConnectChargeFields } = await import(
      "@/lib/marketplace/posConnect"
    );
    const connect = await resolvePosConnectChargeFields({
      orgId: opts.orgId,
      locationId: opts.locationId,
      amountMinor: opts.amountCents,
    });
    const pi = await stripe.paymentIntents.create({
      amount: opts.amountCents,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: {
        type: "pos_sale",
        posSaleId: opts.posSaleId,
        publicId: opts.publicId,
        replacedFrom: opts.paymentIntentId,
        ...(connect.metadataExtras ?? {}),
      },
      ...(connect.paymentIntentExtras ?? {}),
    });
    if (!pi.client_secret) return null;
    await prisma.posSalePayment.update({
      where: { id: opts.paymentId },
      data: {
        stripePaymentIntentId: pi.id,
        connectedAccountId: connect.connectedAccountId,
        platformFeeMinor: connect.applicationFeeMinor,
      },
    });
    return { paymentIntentId: pi.id, clientSecret: pi.client_secret };
  } catch (err) {
    if (err instanceof ForbiddenError) throw err;
    return null;
  }
}

async function loadCart(orgId: string, cartId: string) {
  const cart = await prisma.posCart.findFirst({
    where: { id: cartId, orgId },
    include: { lines: true, device: true },
  });
  if (!cart) throw new PosError("NOT_FOUND", "Cart not found", 404);
  return cart;
}

/** Park-scoped cart load — never trust orgId alone for park-locked seats. */
async function loadCartForActor(actor: PosActor, cartId: string) {
  const where = await posListLocationWhere(actor);
  const cart = await prisma.posCart.findFirst({
    where: { id: cartId, ...where },
    include: { lines: true, device: true },
  });
  if (!cart) {
    const foreign = await prisma.posCart.findFirst({ where: { id: cartId }, select: { id: true } });
    if (foreign) throw new ForbiddenError("Cart is outside this company");
    throw new PosError("NOT_FOUND", "Cart not found", 404);
  }
  return cart;
}

export async function openCart(actor: PosActor, body: Record<string, unknown>) {
  const locationId = String(body.locationId || "");
  const deviceId = String(body.deviceId || "");
  const { orgId } = await requirePosVenue(actor, locationId);
  const device = await prisma.posDevice.findFirst({
    where: { id: deviceId, orgId, locationId, archivedAt: null },
  });
  if (!device) {
    const foreign = await prisma.posDevice.findFirst({
      where: { id: deviceId },
      select: { orgId: true },
    });
    if (foreign && foreign.orgId !== orgId) {
      throw new ForbiddenError("Device is outside this company");
    }
    throw new PosError("NOT_FOUND", "Device not found", 404);
  }
  const cart = await prisma.posCart.create({
    data: {
      orgId,
      locationId,
      deviceId,
      cashierUserId: actorUserId(actor),
      guestProfileId: body.guestProfileId ? String(body.guestProfileId) : null,
    },
    include: { lines: true },
  });
  return cart;
}

export async function getCart(actor: PosActor, cartId: string) {
  const where = await posListLocationWhere(actor);
  const cart = await prisma.posCart.findFirst({
    where: { id: cartId, ...where },
    include: { lines: true },
  });
  if (!cart) {
    const foreign = await prisma.posCart.findFirst({ where: { id: cartId }, select: { id: true } });
    if (foreign) throw new ForbiddenError("Cart is outside this company");
    throw new PosError("NOT_FOUND", "Cart not found", 404);
  }
  return cart;
}

export async function addCartLine(actor: PosActor, cartId: string, body: Record<string, unknown>) {
  const cart = await getCart(actor, cartId);
  if (cart.status !== "open" && cart.status !== "parked") {
    throw new PosError("CART_STATUS", "Cart is not open");
  }
  const qty = Math.max(1, Math.floor(Number(body.qty ?? 1)));
  let name = String(body.name || "");
  let unitPrice = roundMoney(Number(body.unitPrice ?? 0));
  let kind: PosLineKind = "sku";
  let productId: string | null = body.productId ? String(body.productId) : null;
  let modifiers: unknown = body.modifiers ?? null;

  if (productId) {
    const product = await prisma.posProduct.findFirst({
      where: { id: productId, orgId: cart.orgId, locationId: cart.locationId },
      include: {
        modifierGroups: { include: { modifiers: true } },
        parentLinks: { include: { child: true } },
      },
    });
    if (!product || product.archivedAt) throw new PosError("NOT_FOUND", "Product not found", 404);
    if (product.suspendSales) throw new PosError("SUSPENDED", "This product is suspended", 400);
    name = product.name;
    if (product.openPrice || product.kind === "open_price") {
      if (!(unitPrice > 0)) throw new PosError("OPEN_PRICE", "Open price must be greater than zero");
      kind = "open_price";
    } else if (product.kind === "gift_card") {
      unitPrice = roundMoney(Number(body.giftAmount ?? num(product.giftCardDefaultAmount) ?? num(product.price)));
      if (!(unitPrice > 0)) throw new PosError("GIFT_AMOUNT", "Gift card amount must be greater than zero");
      kind = "gift_card_issue";
    } else if (product.kind === "admission_proxy" || product.kind === "party_package_proxy") {
      kind = "booking";
      unitPrice = unitPrice > 0 ? unitPrice : num(product.price);
      if (!body.admissionProductId && product.admissionProductId) {
        body.admissionProductId = product.admissionProductId;
      }
    } else if (product.kind === "membership_plan") {
      kind = "membership";
      unitPrice = unitPrice > 0 ? unitPrice : num(product.price);
      body.membershipPlanId = body.membershipPlanId || product.membershipPlanId;
    } else if (product.kind === "package") {
      kind = "sku";
      unitPrice = num(product.price);
    } else {
      unitPrice = num(product.price);
      kind = "sku";
    }
    const selected = Array.isArray(body.modifiers)
      ? (body.modifiers as Array<Record<string, unknown>>).map((m) => String(m.modifierId || m.id || ""))
      : [];
    for (const group of product.modifierGroups) {
      const hits = group.modifiers.filter((m) => selected.includes(m.id));
      if (hits.length < group.minSelect || (group.required && hits.length < 1)) {
        throw new PosError("MODIFIER", `Choose options for ${group.name}`);
      }
      if (hits.length > group.maxSelect) {
        throw new PosError("MODIFIER", `Too many options for ${group.name}`);
      }
      unitPrice = roundMoney(unitPrice + hits.reduce((s, m) => s + num(m.priceDelta), 0));
    }
    modifiers = selected;
    if (body.guestMembershipId) {
      modifiers = {
        selected,
        guestMembershipId: String(body.guestMembershipId),
      };
    }

    // Explode package / add-on links into package_component lines (required children only when required).
    if (product.parentLinks.length > 0) {
      for (const link of product.parentLinks) {
        if (link.child.archivedAt || link.child.suspendSales) {
          if (link.required) {
            throw new PosError("PACKAGE", `Package child ${link.child.name} is not sellable`);
          }
          continue;
        }
        const childQty = Math.max(1, Math.min(link.maxQty ?? 1, 1)) * qty;
        await prisma.posCartLine.create({
          data: {
            cartId: cart.id,
            orgId: cart.orgId,
            kind: "package_component",
            productId: link.childProductId,
            name: link.child.name,
            qty: childQty,
            unitPrice: money(0),
            modifiers: { parentProductId: product.id, required: link.required } as Prisma.InputJsonValue,
          },
        });
      }
    }
  } else if (body.admissionProductId) {
    kind = "booking";
    name = name || "Admission";
    const price = await prisma.admissionProductPrice.findFirst({
      where: {
        productId: String(body.admissionProductId),
        orgId: cart.orgId,
        ...(body.priceBandCode ? { code: String(body.priceBandCode) } : {}),
      },
    });
    if (price) unitPrice = num(price.amount);
    if (!(unitPrice >= 0)) throw new PosError("PRICE", "Admission price is required");
  } else if (!(unitPrice > 0)) {
    throw new PosError("PRICE", "A price is required");
  }

  const line = await prisma.posCartLine.create({
    data: {
      cartId: cart.id,
      orgId: cart.orgId,
      kind,
      productId,
      name: name || "Item",
      qty,
      unitPrice: money(unitPrice),
      modifiers: modifiers as Prisma.InputJsonValue,
      sessionId: body.sessionId ? String(body.sessionId) : null,
      admissionProductId: body.admissionProductId ? String(body.admissionProductId) : null,
      priceBandCode: body.priceBandCode ? String(body.priceBandCode) : null,
      membershipPlanId: body.membershipPlanId ? String(body.membershipPlanId) : null,
      membershipAction: body.membershipAction ? String(body.membershipAction) : null,
      giftAmount: kind === "gift_card_issue" ? money(unitPrice) : null,
    },
  });
  return line;
}

export async function updateCartLine(
  actor: PosActor,
  cartId: string,
  lineId: string,
  body: Record<string, unknown>
) {
  const cart = await getCart(actor, cartId);
  const line = cart.lines.find((l) => l.id === lineId);
  if (!line) throw new PosError("NOT_FOUND", "Line not found", 404);
  if (body.remove === true) {
    await prisma.posCartLine.delete({ where: { id: line.id } });
    return { removed: true };
  }
  const qty = body.qty == null ? line.qty : Math.max(1, Math.floor(Number(body.qty)));
  const updated = await prisma.posCartLine.update({
    where: { id: line.id },
    data: { qty },
  });
  return updated;
}

export async function removeCartLine(actor: PosActor, cartId: string, lineId: string) {
  return updateCartLine(actor, cartId, lineId, { remove: true });
}

export async function parkCart(actor: PosActor, cartId: string) {
  const cart = await getCart(actor, cartId);
  const settings = await resolvePosSettings(cart.orgId, cart.locationId);
  if (!settings.allowParkedCarts) throw new PosError("PARK", "Parked carts are turned off");
  const bookingSettings = await resolveBookingSettings(cart.orgId, cart.locationId);
  const ttl = bookingSettings.holdTtlMinutes || 15;
  const expiresAt = new Date(Date.now() + ttl * 60_000);
  const holdIds: string[] = [...cart.bookingHoldIds];
  for (const line of cart.lines) {
    if (line.kind !== "booking" || !line.sessionId) continue;
    const hold = await createSessionHold({
      orgId: cart.orgId,
      locationId: cart.locationId,
      sessionId: line.sessionId,
      qty: line.qty,
      expiresAt,
    });
    holdIds.push(hold.hold.id);
  }
  return prisma.posCart.update({
    where: { id: cart.id },
    data: { status: "parked", bookingHoldIds: holdIds, expiresAt },
    include: { lines: true },
  });
}

export async function abandonCart(actor: PosActor, cartId: string) {
  const cart = await getCart(actor, cartId);
  for (const holdId of cart.bookingHoldIds) {
    await releaseHoldById(holdId).catch(() => undefined);
  }
  await prisma.posCart.update({
    where: { id: cart.id },
    data: { status: "open", bookingHoldIds: [], expiresAt: null },
  });
  return { abandoned: true };
}

export async function listParkedCarts(
  actor: PosActor,
  locationId: string,
  deviceId?: string | null
) {
  const { orgId } = await requirePosVenue(actor, locationId);
  const rows = await prisma.posCart.findMany({
    where: {
      orgId,
      locationId,
      status: "parked",
      ...(deviceId ? { deviceId } : {}),
    },
    include: { lines: true },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  return rows;
}

async function quoteLines(orgId: string, lines: PosCartLine[], discountTotal: number, tipAmount: number) {
  const subtotal = roundMoney(lines.reduce((s, l) => s + num(l.unitPrice) * l.qty, 0));
  const taxable = roundMoney(
    lines
      .filter((l) => l.kind !== "discount")
      .reduce((s, l) => s + num(l.unitPrice) * l.qty, 0) - discountTotal
  );
  const tax = await previewBookingTax({
    orgId,
    subtotal: Math.max(0, taxable),
    taxExempt: false,
  });
  const total = roundMoney(Math.max(0, taxable) + tax.taxAmount + tipAmount);
  return { subtotal, discountTotal, taxAmount: tax.taxAmount, tipAmount, total };
}

export async function previewDiscount(actor: PosActor, body: Record<string, unknown>) {
  const cart = await getCart(actor, String(body.cartId || ""));
  const code = String(body.code || "").trim().toUpperCase();
  const row = await prisma.posDiscountCode.findFirst({
    where: { orgId: cart.orgId, code, archivedAt: null },
  });
  if (!row) throw new PosError("DISCOUNT", "Discount code was not found", 404);
  const subtotal = cart.lines.reduce((s, l) => s + num(l.unitPrice) * l.qty, 0);
  let amount = 0;
  if (row.percentOff != null) amount = roundMoney(subtotal * (num(row.percentOff) / 100));
  if (row.amountOff != null) amount = roundMoney(num(row.amountOff));
  return { code: row.code, amount, requiresManagerPin: row.requiresManagerPin };
}

type TenderInput = {
  tender: string;
  amount: number;
  code?: string;
  simulate?: string;
  giftCardId?: string;
  guestProfileId?: string;
  /** Already-captured Stripe PI (e.g. tab preauth) — do not create a second charge. */
  stripePaymentIntentId?: string;
  alreadyCaptured?: boolean;
};

/**
 * Remaining-value credit when a membership is upgraded or downgraded at the till.
 * credit = max(0, oldPrice * remainingFraction - newPrice)
 * remainingFraction = remainingMs / periodMs when both period dates exist, otherwise 0.
 * The credit is stored as a discount line on the POS sale. The membership row itself
 * still changes only through posUpgradeMembership / posDowngradeMembership.
 */
export function membershipRemainingCredit(opts: {
  oldPrice: number;
  newPrice: number;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  now?: Date;
}): number {
  const now = opts.now ?? new Date();
  if (!opts.periodStart || !opts.periodEnd) return 0;
  const span = opts.periodEnd.getTime() - opts.periodStart.getTime();
  if (!(span > 0)) return 0;
  const remaining = Math.max(0, opts.periodEnd.getTime() - now.getTime());
  const fraction = Math.min(1, remaining / span);
  return roundMoney(Math.max(0, opts.oldPrice * fraction - opts.newPrice));
}

export async function checkoutCart(actor: PosActor, cartId: string, body: Record<string, unknown>) {
  const where = await posListLocationWhere(actor);
  const idempotencyKey = String(body.idempotencyKey || "").trim();
  if (!idempotencyKey) throw new PosError("IDEMPOTENCY", "idempotencyKey is required");
  const replay = await prisma.posSale.findFirst({
    where: { orgId: where.orgId, idempotencyKey },
    include: { lines: true, payments: true, bookings: true },
  });
  if (replay) {
    const cardClientSecrets =
      replay.status === "voided" || replay.status === "refunded"
        ? []
        : await loadPendingCardClientSecrets(replay.payments);
    return {
      ...saleDto(replay),
      issuedGiftCodes: [] as string[],
      ...(cardClientSecrets.length ? { cardClientSecrets } : {}),
    };
  }

  const cart = await loadCartForActor(actor, cartId);
  if (cart.status !== "open" && cart.status !== "parked") {
    throw new PosError("CART_STATUS", "Cart is not open for checkout");
  }
  if (!cart.lines.length) {
    throw new PosError("EMPTY_CART", "Cart has no lines");
  }
  const preferTerminalReader = devicePrefersTerminalReader(
    (cart as { device?: { stripeTerminalId?: string | null } }).device?.stripeTerminalId
  );
  const settings = await resolvePosSettings(cart.orgId, cart.locationId);
  const guestId = body.guestProfileId
    ? String(body.guestProfileId)
    : cart.guestProfileId;
  const postal = body.postalCode == null ? null : String(body.postalCode).trim();
  if (settings.requireGuestOnSale && !guestId) {
    throw new PosError("GUEST_REQUIRED", "A guest is required for this sale");
  }
  if (settings.postcodeRequired && !postal) {
    throw new PosError("POSTCODE_REQUIRED", "A postcode is required for this sale");
  }
  if (settings.captureGuestPostcode && guestId && postal) {
    await prisma.guestProfile.updateMany({
      where: { id: guestId, orgId: cart.orgId },
      data: { postalCode: postal },
    });
  }
  if (guestId && settings.bannedGuestPrompt) {
    const guest = await prisma.guestProfile.findFirst({
      where: { id: guestId, orgId: cart.orgId },
    });
    if (guest?.bannedAt) {
      if (body.allowBannedGuest !== true) {
        throw new ForbiddenError("Banned guest requires a manager override");
      }
      await verifyManagerPin(actor, String(body.managerPin || ""), cart.locationId);
      logStaffActivityEntry(actor, {
        action: "pos.banned_guest.override",
        entityType: "GuestProfile",
        entityId: guest.id,
        description: "Manager approved a sale for a banned guest",
      });
    }
  }

  let discountTotal = 0;
  const discountCode = body.discountCode ? String(body.discountCode).trim().toUpperCase() : "";
  if (discountCode) {
    const code = await prisma.posDiscountCode.findFirst({
      where: { orgId: cart.orgId, code: discountCode, archivedAt: null },
    });
    if (!code) throw new PosError("DISCOUNT", "Discount code was not found", 404);
    if (settings.managerPinRequiredForDiscount || code.requiresManagerPin) {
      await verifyManagerPin(actor, String(body.managerPin || ""), cart.locationId);
      logStaffActivityEntry(actor, {
        action: "pos.discount.override",
        entityType: "PosSale",
        description: `Discount ${code.code} approved`,
      });
    }
    const subtotal = cart.lines.reduce((s, l) => s + num(l.unitPrice) * l.qty, 0);
    if (code.percentOff != null) discountTotal = roundMoney(subtotal * (num(code.percentOff) / 100));
    if (code.amountOff != null) discountTotal = roundMoney(num(code.amountOff));
  }

  const tipAmount = roundMoney(Number(body.tipAmount ?? 0));
  let allocations = Array.isArray(body.tipAllocations)
    ? (body.tipAllocations as Array<Record<string, unknown>>)
    : [];
  const tipCashierId = actorUserId(actor);
  if (tipAmount > 0) {
    if (!allocations.length) {
      // Default: allocate the full tip to the cashier when the pad omits a split.
      allocations = [{ userId: tipCashierId, amount: tipAmount }];
    } else {
      allocations = allocations.map((a) => ({
        ...a,
        userId: String(a.userId || tipCashierId),
      }));
    }
    const sum = roundMoney(allocations.reduce((s, a) => s + Number(a.amount || 0), 0));
    if (sum !== tipAmount) {
      throw new PosError("TIP_SUM", "Tip allocations must add up to the tip amount");
    }
  }

  const quote = await quoteLines(cart.orgId, cart.lines, discountTotal, tipAmount);
  const tenders = (Array.isArray(body.tenders) ? body.tenders : []) as TenderInput[];
  const tenderSum = roundMoney(tenders.reduce((s, t) => s + Number(t.amount || 0), 0));
  const unpaidOk = settings.allowUnpaidBookings && body.allowUnpaid === true;
  if (tenderSum + 0.001 < quote.total && !unpaidOk) {
    throw new PosError("TENDER", "Tenders do not cover the sale total");
  }
  const hasCash = tenders.some((t) => t.tender === "cash" && Number(t.amount) > 0);
  let tillId: string | null = null;
  if (hasCash && settings.cashRequiresOpenTill) {
    const till = await requireOpenTill(cart.orgId, cart.deviceId);
    tillId = till.id;
  }

  const userId = actorUserId(actor);
  const bookingIds: string[] = [];
  const admissionLines = cart.lines.filter(
    (l) => l.kind === "booking" && (l.admissionProductId || l.sessionId)
  );

  let saleId = "";
  let completedPaid = 0;
  let saleStatus: "completed" | "unpaid" = "unpaid";
  let checkoutPaymentLinkUrl: string | null = null;
  let checkoutCardClientSecrets: Array<{ paymentIntentId: string; clientSecret: string }> = [];

  try {
    // Party packages go through the party engine (one party per cart line).
    const partyFlags = await Promise.all(
      admissionLines.map((l) => isPartyPackageProduct(cart.orgId, l.admissionProductId))
    );
    const partyLines = admissionLines.filter((_, i) => partyFlags[i]);
    const ticketLines = admissionLines.filter((_, i) => !partyFlags[i]);
    const cartHolds = cart.bookingHoldIds.length && partyLines.length
      ? await prisma.bookingHold.findMany({
          where: { id: { in: cart.bookingHoldIds }, bookingId: null },
          select: { id: true, sessionId: true },
        })
      : [];
    const partySessionIds = new Set(partyLines.map((l) => l.sessionId).filter(Boolean));
    for (const line of partyLines) {
      const party = await createPartyFromPos(actor, {
        locationId: cart.locationId,
        admissionProductId: String(line.admissionProductId || ""),
        sessionId: line.sessionId,
        modifiers: line.modifiers,
        guestName: body.guestName ? String(body.guestName) : null,
        holdIds: cartHolds.filter((h) => h.sessionId === line.sessionId).map((h) => h.id),
      });
      bookingIds.push(party.bookingId);
    }
    if (ticketLines.length) {
      const booking = await createBooking(actor, {
        locationId: cart.locationId,
        channel: "pos",
        createMode: "hold",
        activate: true,
        holdIds: partyLines.length
          ? cartHolds
              .filter((h) => !h.sessionId || !partySessionIds.has(h.sessionId))
              .map((h) => h.id)
          : cart.bookingHoldIds,
        lines: ticketLines.map((l) => ({
          productId: String(l.admissionProductId || ""),
          qty: l.qty,
          sessionId: l.sessionId,
          priceBandCode: l.priceBandCode,
          unitPrice: num(l.unitPrice),
        })),
        primaryContactName: body.guestName ? String(body.guestName) : "POS guest",
        notes: "POS sale",
      });
      bookingIds.push(booking.id);
    }

    const txResult = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM pos_carts WHERE id = ${cart.id} FOR UPDATE`;
        const liveCart = await tx.posCart.findFirst({
          where: { id: cart.id },
          include: { lines: true },
        });
        if (!liveCart || liveCart.lines.length === 0) {
          throw new PosError("CART_GONE", "Cart is empty or already checked out", 409);
        }

        for (const line of liveCart.lines) {
          if (!line.productId) continue;
          const product = await tx.posProduct.findFirst({ where: { id: line.productId } });
          if (!product) continue;
          if (product.suspendSales) throw new PosError("SUSPENDED", "This product is suspended");
        }

        const offlineEventAtRaw =
          body.eventAt ?? body.occurredAt ?? body.clientCreatedAt ?? null;
        const offlineEventAt =
          offlineEventAtRaw != null
            ? new Date(String(offlineEventAtRaw))
            : null;
        const saleCreatedAt =
          offlineEventAt && !Number.isNaN(offlineEventAt.getTime())
            ? offlineEventAt
            : undefined;

        const created = await tx.posSale.create({
          data: {
            publicId: publicId(),
            orgId: cart.orgId,
            locationId: cart.locationId,
            deviceId: cart.deviceId,
            tillSessionId: tillId,
            cashierUserId: userId,
            guestProfileId: guestId,
            postalCodeCaptured: postal,
            status: "open",
            currency: "USD",
            subtotal: money(quote.subtotal),
            discountTotal: money(discountTotal),
            taxAmount: money(quote.taxAmount),
            tipAmount: money(tipAmount),
            total: money(quote.total),
            amountPaid: money(0),
            amountDue: money(quote.total),
            receiptEmail: body.receiptEmail ? String(body.receiptEmail) : null,
            idempotencyKey,
            ...(saleCreatedAt ? { createdAt: saleCreatedAt } : {}),
            lines: {
              create: liveCart.lines.map((l) => {
                const baseMods =
                  l.modifiers && typeof l.modifiers === "object" && !Array.isArray(l.modifiers)
                    ? { ...(l.modifiers as Record<string, unknown>) }
                    : Array.isArray(l.modifiers)
                      ? { selected: l.modifiers }
                      : {};
                if (l.membershipAction) baseMods.membershipAction = l.membershipAction;
                if (l.membershipPlanId) baseMods.membershipPlanId = l.membershipPlanId;
                return {
                  orgId: cart.orgId,
                  kind: l.kind,
                  name: l.name,
                  qty: l.qty,
                  unitPrice: l.unitPrice,
                  lineTotal: money(num(l.unitPrice) * l.qty),
                  modifiers: baseMods as Prisma.InputJsonValue,
                  productId: l.productId,
                  refId: l.admissionProductId || l.membershipPlanId || null,
                };
              }),
            },
            bookings: {
              create: bookingIds.map((bookingId) => ({ orgId: cart.orgId, bookingId })),
            },
            tips: {
              create: allocations.map((a) => ({
                orgId: cart.orgId,
                userId: String(a.userId),
                amount: money(Number(a.amount)),
              })),
            },
          },
          include: { lines: true, payments: true, bookings: true },
        });

        for (const line of created.lines) {
          if (!line.productId) continue;
          const product = await tx.posProduct.findFirst({ where: { id: line.productId } });
          if (!product?.trackInventory) continue;
          try {
            await recordInventoryMovement(tx, {
              orgId: cart.orgId,
              productRef: { posProductId: product.id },
              kind: "sale",
              qty: -line.qty,
              sourceType: "pos_sale",
              sourceId: `${created.id}:line:${line.id}`,
              failIfInsufficient: true,
              actorId: userId,
            });
          } catch (err) {
            if (err instanceof InsufficientStockError) {
              throw new PosError("STOCK", `Not enough stock for ${product.name}`);
            }
            throw err;
          }
        }

        let paid = 0;
        let i = 0;
        let paymentLinkUrl: string | null = null;
        const cardClientSecrets: Array<{ paymentIntentId: string; clientSecret: string }> = [];
        for (const tender of tenders) {
          i += 1;
          const amount = roundMoney(Number(tender.amount));
          if (!(amount > 0)) continue;
          let status: "completed" | "pending" = "completed";
          let stripePaymentIntentId: string | null = null;
          let posConnectSnapshot: {
            connectedAccountId: string | null;
            platformFeeMinor: number | null;
          } | null = null;
          let giftCardId: string | null = tender.giftCardId ?? null;
          const walletGuestId = String(tender.guestProfileId || guestId || "").trim();

          if (tender.tender === "gift_card") {
            if (!String(tender.code || "").trim()) {
              throw new PosError("GIFT_CODE", "Gift card code is required", 400);
            }
            const redeemed = await redeemPosGiftCard({
              orgId: cart.orgId,
              code: String(tender.code),
              amount,
              saleId: created.id,
              createdById: userId,
              idempotencyKey: `${idempotencyKey}:gift:${i}`,
              db: tx,
            });
            giftCardId = redeemed.giftCardId;
          } else if (tender.tender === "park_wallet") {
            if (!walletGuestId) {
              throw new PosError("WALLET_GUEST", "Park wallet needs a guest on the sale or tender", 400);
            }
            await adjustParkWallet(
              {
                orgId: cart.orgId,
                locationId: cart.locationId,
                guestProfileId: walletGuestId,
                amount,
                type: "redeem",
                saleId: created.id,
                reference: `${idempotencyKey}:wallet:${i}`,
              },
              tx
            );
          } else if (tender.tender === "cashless") {
            if (!String(tender.code || "").trim()) {
              throw new PosError("CASHLESS_CODE", "Cashless code is required", 400);
            }
            await adjustCashless(
              {
                orgId: cart.orgId,
                code: String(tender.code),
                amount: -amount,
                saleId: created.id,
              },
              tx
            );
          } else if (
            tender.tender === "card" ||
            tender.tender === "stored_card" ||
            tender.tender === "payment_link"
          ) {
            if (tender.alreadyCaptured && tender.stripePaymentIntentId) {
              stripePaymentIntentId = String(tender.stripePaymentIntentId);
              status = "completed";
            } else if (posSmokeAllowed() && tender.simulate === "succeeded") {
              stripePaymentIntentId = `pi_smoke_${created.id}_${i}`;
              status = "completed";
            } else if (posSmokeAllowed() && tender.simulate === "pending") {
              stripePaymentIntentId = `pi_smoke_pending_${created.id}_${i}`;
              status = "pending";
              if (tender.tender === "card" || tender.tender === "stored_card") {
                cardClientSecrets.push({
                  paymentIntentId: stripePaymentIntentId,
                  clientSecret: `smoke_secret_${stripePaymentIntentId}`,
                });
              }
            } else if (!process.env.STRIPE_SECRET_KEY?.trim()) {
              throw new PosError(
                "STRIPE_NOT_CONFIGURED",
                "Card payments need STRIPE_SECRET_KEY",
                400
              );
            } else if (tender.tender === "payment_link") {
              // Checkout Session — not a bare PaymentIntent. Sale stays unpaid until webhook.
              const { getStripe } = await import("@/lib/stripe");
              const { publicAppBaseUrl } = await import("@/lib/publicAppBaseUrl");
              const { resolvePosConnectChargeFields } = await import(
                "@/lib/marketplace/posConnect"
              );
              const connect = await resolvePosConnectChargeFields({
                orgId: cart.orgId,
                locationId: cart.locationId,
                amountMinor: Math.round(amount * 100),
              });
              const base = publicAppBaseUrl() || "https://example.com";
              const meta = {
                type: "pos_sale",
                posSaleId: created.id,
                publicId: created.publicId,
                ...connect.metadataExtras,
              };
              const session = await getStripe().checkout.sessions.create({
                mode: "payment",
                success_url: `${base}/admin/pos/sales?paid=1`,
                cancel_url: `${base}/admin/pos/sales?paid=0`,
                line_items: [
                  {
                    quantity: 1,
                    price_data: {
                      currency: "usd",
                      unit_amount: Math.round(amount * 100),
                      product_data: { name: `POS ${created.publicId}` },
                    },
                  },
                ],
                metadata: meta,
                payment_intent_data: {
                  metadata: meta,
                  ...connect.paymentIntentExtras,
                },
              });
              stripePaymentIntentId = `cs:${session.id}`;
              status = "pending";
              paymentLinkUrl = session.url;
              posConnectSnapshot = {
                connectedAccountId: connect.connectedAccountId,
                platformFeeMinor: connect.applicationFeeMinor,
              };
            } else {
              const pi = await createPosCardPaymentIntent({
                amountCents: Math.round(amount * 100),
                posSaleId: created.id,
                publicId: created.publicId,
                preferTerminal: preferTerminalReader,
                orgId: cart.orgId,
                locationId: cart.locationId,
              });
              stripePaymentIntentId = pi.id;
              // Terminal devices get card_present; others use Elements client_secret.
              status = pi.status === "succeeded" ? "completed" : "pending";
              if (pi.client_secret && status === "pending") {
                cardClientSecrets.push({
                  paymentIntentId: pi.id,
                  clientSecret: pi.client_secret,
                });
              }
              const destId =
                typeof pi.transfer_data?.destination === "string"
                  ? pi.transfer_data.destination
                  : null;
              posConnectSnapshot = {
                connectedAccountId: destId,
                platformFeeMinor:
                  typeof pi.application_fee_amount === "number"
                    ? pi.application_fee_amount
                    : null,
              };
            }
          }
          await tx.posSalePayment.create({
            data: {
              saleId: created.id,
              orgId: cart.orgId,
              tender: tender.tender as never,
              amount: money(amount),
              status,
              stripePaymentIntentId,
              giftCardId,
              idempotencyKey: `${idempotencyKey}:pay:${i}`,
              connectedAccountId: posConnectSnapshot?.connectedAccountId ?? null,
              platformFeeMinor: posConnectSnapshot?.platformFeeMinor ?? null,
            },
          });
          if (status === "completed") paid = roundMoney(paid + amount);
          if (tender.tender === "cash" && tillId) {
            await tx.tillMovement.create({
              data: {
                sessionId: tillId,
                orgId: cart.orgId,
                kind: "sale_cash",
                amount: money(amount),
                saleId: created.id,
                reason: "sale",
                createdById: userId,
              },
            });
          }
        }

        const amountPaid = roundMoney(Math.min(paid, quote.total));
        const amountDue = roundMoney(Math.max(0, quote.total - amountPaid));
        const status: "completed" | "unpaid" = amountDue <= 0.001 ? "completed" : "unpaid";

        const productIds = liveCart.lines
          .map((l) => l.productId)
          .filter((id): id is string => Boolean(id));
        const kitchenProducts =
          productIds.length > 0
            ? await tx.posProduct.findMany({
                where: {
                  id: { in: productIds },
                  OR: [
                    { kind: { in: ["food", "beverage"] } },
                    { kitchenRoute: { not: null } },
                  ],
                },
                select: { id: true, kitchenRoute: true, kind: true },
              })
            : [];
        const kitchenById = new Map(kitchenProducts.map((p) => [p.id, p]));
        const kitchenLines = liveCart.lines.filter(
          (l) => l.productId && kitchenById.has(l.productId)
        );
        // Kitchen only when the sale is already paid — unpaid card/link sales
        // get tickets from fulfillCompletedPosSale after settle.
        if (kitchenLines.length && status === "completed") {
          await createKitchenTicket(tx, {
            orgId: cart.orgId,
            locationId: cart.locationId,
            saleId: created.id,
            station: resolveKitchenStation(
              kitchenLines.map((l) => kitchenById.get(l.productId!)?.kitchenRoute)
            ),
            items: kitchenLines.map((l) => ({ name: l.name, qty: l.qty })),
          });
        }

        await tx.posSale.update({
          where: { id: created.id },
          data: {
            amountPaid: money(amountPaid),
            amountDue: money(amountDue),
            status,
          },
        });

        await enqueueSource(tx, {
          orgId: cart.orgId,
          locationId: cart.locationId,
          sourceType: "pos_sale",
          sourceId: created.id,
          sourceEvent: status,
          eventAt: created.createdAt,
        });

        await tx.posCartLine.deleteMany({ where: { cartId: cart.id } });
        await tx.posCart.delete({ where: { id: cart.id } });

        return {
          saleId: created.id,
          amountPaid,
          amountDue,
          status,
          paymentLinkUrl,
          cardClientSecrets,
        };
      },
      { maxWait: 15_000, timeout: 90_000 }
    );
    flushAccountingQueueSoon(cart.orgId);

    saleId = txResult.saleId;
    completedPaid = txResult.amountPaid;
    saleStatus = txResult.status;
    checkoutPaymentLinkUrl = txResult.paymentLinkUrl;
    checkoutCardClientSecrets = txResult.cardClientSecrets;
  } catch (err) {
    for (const bookingId of bookingIds) {
      await cancelBooking(actor, bookingId, {
        reason: "pos_checkout_failed",
        skipStaffGate: true,
      }).catch(() => undefined);
    }
    throw err;
  }

  if (tillId && hasCash) {
    const expected = await expectedCashForSession(tillId);
    await prisma.tillSession.update({
      where: { id: tillId },
      data: { expectedCash: money(expected) },
    });
  }

  const settled = completedPaid + 0.001 >= quote.total;
  if (bookingIds.length && settled) {
    for (const bookingId of bookingIds) {
      const booking = await prisma.booking.findFirst({ where: { id: bookingId } });
      if (!booking) continue;
      await prisma.bookingPayment.create({
        data: {
          orgId: cart.orgId,
          locationId: cart.locationId,
          bookingId,
          tender: hasCash ? "cash" : "card",
          amount: booking.total,
          status: "completed",
          posSaleId: saleId,
          stripePaymentIntentId:
            (
              await prisma.posSalePayment.findFirst({
                where: { saleId, stripePaymentIntentId: { not: null }, status: "completed" },
              })
            )?.stripePaymentIntentId ?? null,
        },
      });
      await prisma.booking.update({
        where: { id: bookingId },
        data: { amountPaid: booking.total, amountDue: money(0) },
      });
      await syncPartyMoney(prisma, bookingId);
      await confirmBooking(actor, bookingId, { allowUnpaid: false, autoReview: true });
    }
  } else if (bookingIds.length) {
    // Unpaid card/link: move hold → pending_payment (or confirmed when allowUnpaid)
    // so capacity holds do not expire while the cashier confirms Elements / opens the link.
    for (const bookingId of bookingIds) {
      await confirmBooking(actor, bookingId, {
        allowUnpaid: unpaidOk,
        autoReview: true,
      });
    }
  }

  let issuedGiftCodes: string[] = [];
  if (saleStatus === "completed") {
    const fulfilled = await fulfillCompletedPosSale({ saleId, actorUserId: userId });
    issuedGiftCodes = fulfilled.issuedGiftCodes;
  }

  const sale = await prisma.posSale.findFirstOrThrow({
    where: { id: saleId },
    select: { publicId: true, orgId: true, guestProfileId: true },
  });

  if (saleStatus === "completed" && sale.guestProfileId) {
    void import("@/lib/guests/visitTouch")
      .then(({ touchGuestVisit }) =>
        touchGuestVisit({
          orgId: sale.orgId,
          guestProfileId: sale.guestProfileId!,
        })
      )
      .catch(() => undefined);
  }
  logStaffActivityEntry(actor, {
    action: "pos.sale.complete",
    entityType: "PosSale",
    entityId: saleId,
    description: `POS sale ${sale.publicId} ${saleStatus}`,
  });

  const dto = await getSale(actor, saleId);
  return {
    ...dto,
    issuedGiftCodes,
    ...(checkoutPaymentLinkUrl ? { paymentLinkUrl: checkoutPaymentLinkUrl } : {}),
    ...(checkoutCardClientSecrets.length
      ? { cardClientSecrets: checkoutCardClientSecrets }
      : {}),
  };
}

async function loadPendingCardClientSecrets(
  payments: Array<{
    id?: string;
    tender: string;
    status: string;
    amount?: number;
    stripePaymentIntentId?: string | null;
  }>,
  opts?: {
    posSaleId?: string;
    publicId?: string;
    convertTerminalToBrowser?: boolean;
    orgId?: string;
    locationId?: string;
  }
): Promise<Array<{ paymentIntentId: string; clientSecret: string }>> {
  const pending = payments.filter(
    (p) =>
      (p.tender === "card" || p.tender === "stored_card") &&
      (p.status === "pending" || p.status === "authorized") &&
      Boolean(p.stripePaymentIntentId?.startsWith("pi_"))
  );
  if (!pending.length) return [];
  if (posSmokeAllowed()) {
    return pending
      .filter((p) => p.stripePaymentIntentId?.startsWith("pi_smoke_"))
      .map((p) => ({
        paymentIntentId: String(p.stripePaymentIntentId),
        clientSecret: `smoke_secret_${p.stripePaymentIntentId}`,
      }));
  }
  if (!process.env.STRIPE_SECRET_KEY?.trim()) return [];
  const { getStripe } = await import("@/lib/stripe");
  const stripe = getStripe();
  const out: Array<{ paymentIntentId: string; clientSecret: string }> = [];
  for (const p of pending) {
    const piId = String(p.stripePaymentIntentId);
    try {
      const pi = await stripe.paymentIntents.retrieve(piId);
      if (pi.status === "succeeded" || pi.status === "canceled") continue;
      const types = pi.payment_method_types ?? [];
      const terminalOnly =
        types.includes("card_present") && !types.includes("card");
      if (
        terminalOnly &&
        opts?.convertTerminalToBrowser &&
        p.id &&
        opts.posSaleId &&
        opts.publicId
      ) {
        if (!opts.orgId || !opts.locationId) {
          throw new PosError(
            "POS_CONNECT_SCOPE",
            "Park scope required to convert Terminal card payment",
            400
          );
        }
        const converted = await convertCardPresentIntentToBrowser({
          paymentId: p.id,
          paymentIntentId: piId,
          amountCents: pi.amount ?? Math.round(Number(p.amount ?? 0) * 100),
          posSaleId: opts.posSaleId,
          publicId: opts.publicId,
          orgId: opts.orgId,
          locationId: opts.locationId,
        });
        if (converted) {
          out.push(converted);
          continue;
        }
      }
      if (pi.client_secret) {
        out.push({ paymentIntentId: pi.id, clientSecret: pi.client_secret });
      }
    } catch (err) {
      if (err instanceof ForbiddenError || err instanceof PosError) throw err;
      // Skip unretrievable intents; cashier can use payment link / cash.
    }
  }
  return out;
}

/** Re-fetch client_secrets for unpaid card tenders (sale detail resume / checkout replay). */
export async function getPendingCardSecrets(actor: PosActor, saleId: string) {
  const sale = await getSale(actor, saleId);
  if (sale.status === "voided" || sale.status === "refunded") {
    return { saleId: sale.id, publicId: sale.publicId, cardClientSecrets: [] };
  }
  // Resume / Elements path: convert Terminal-only PIs so in-browser confirm works.
  const cardClientSecrets = await loadPendingCardClientSecrets(sale.payments ?? [], {
    posSaleId: sale.id,
    publicId: sale.publicId,
    convertTerminalToBrowser: true,
    orgId: sale.orgId,
    locationId: sale.locationId,
  });
  return { saleId: sale.id, publicId: sale.publicId, cardClientSecrets };
}

/**
 * After the cashier confirms a PaymentIntent in-browser (Elements), settle the
 * matching pending PosSalePayment. Verifies Stripe status before settle.
 */
export async function confirmCardPayment(
  actor: PosActor,
  saleId: string,
  body: Record<string, unknown>
) {
  // Park + org scope: getSale fails closed for other companies / park-locked seats.
  const sale = await getSale(actor, saleId);
  if (sale.status === "voided" || sale.status === "refunded") {
    throw new PosError(
      "SALE_STATUS",
      `Sale is ${sale.status} and cannot accept card confirmation`,
      400
    );
  }
  const paymentIntentId = String(body.paymentIntentId || "").trim();
  if (!paymentIntentId.startsWith("pi_")) {
    throw new PosError("PAYMENT_INTENT", "paymentIntentId is required", 400);
  }
  const payment = (sale.payments ?? []).find(
    (p) => p.stripePaymentIntentId === paymentIntentId
  );
  if (!payment) {
    throw new PosError("NOT_FOUND", "Payment not found on this sale", 404);
  }
  if (payment.tender !== "card" && payment.tender !== "stored_card") {
    throw new PosError(
      "TENDER",
      "confirm-card only settles card / stored_card PaymentIntents",
      400
    );
  }
  if (payment.status === "completed") {
    return getSale(actor, saleId);
  }
  if (payment.status === "cancelled") {
    throw new PosError("PAYMENT_STATUS", "Payment was cancelled", 400);
  }
  if (
    payment.status !== "pending" &&
    payment.status !== "failed" &&
    payment.status !== "authorized"
  ) {
    throw new PosError(
      "PAYMENT_STATUS",
      `Payment is ${payment.status} and cannot be confirmed`,
      400
    );
  }

  const { settlePosSalePayment } = await import("@/lib/pos/webhook");

  if (posSmokeAllowed() && paymentIntentId.startsWith("pi_smoke_")) {
    const settled = await settlePosSalePayment(paymentIntentId, { posSaleId: saleId });
    if (!settled.ok) {
      throw new PosError(
        "SETTLE_FAILED",
        `Could not settle card payment (${settled.reason})`,
        400
      );
    }
    return getSale(actor, saleId);
  }

  if (!process.env.STRIPE_SECRET_KEY?.trim()) {
    throw new PosError("STRIPE_NOT_CONFIGURED", "Card confirm needs STRIPE_SECRET_KEY", 400);
  }
  const { getStripe } = await import("@/lib/stripe");
  let pi: {
    metadata?: { type?: string | null; posSaleId?: string | null } | null;
    amount?: number;
    status: string;
  };
  try {
    pi = await getStripe().paymentIntents.retrieve(paymentIntentId);
  } catch (err) {
    throw new PosError(
      "STRIPE_ERROR",
      err instanceof Error ? err.message : "Could not retrieve PaymentIntent from Stripe",
      502
    );
  }
  // Hard ownership: never settle a PI that is not stamped for this POS sale.
  if (pi.metadata?.type !== "pos_sale" || pi.metadata?.posSaleId !== saleId) {
    throw new PosError(
      "PAYMENT_INTENT",
      "PaymentIntent does not belong to this sale",
      400
    );
  }
  const expectedCents = Math.round(Number(payment.amount) * 100);
  if (!Number.isFinite(expectedCents) || expectedCents <= 0) {
    throw new PosError("AMOUNT_MISMATCH", "POS payment amount is invalid", 400);
  }
  if (typeof pi.amount === "number" && pi.amount !== expectedCents) {
    throw new PosError(
      "AMOUNT_MISMATCH",
      "PaymentIntent amount does not match the POS payment row",
      400
    );
  }
  if (pi.status === "canceled") {
    throw new PosError(
      "PAYMENT_STATUS",
      "PaymentIntent was canceled — use cash or a new payment link",
      400
    );
  }
  if (pi.status !== "succeeded") {
    throw new PosError(
      "CARD_PENDING",
      `PaymentIntent is ${pi.status}; confirm with Stripe Elements first`,
      400
    );
  }

  // Re-check sale/payment after Stripe round-trip (void may have won the race).
  const fresh = await getSale(actor, saleId);
  if (fresh.status === "voided" || fresh.status === "refunded") {
    throw new PosError(
      "SALE_STATUS",
      `Sale is ${fresh.status} and cannot accept card confirmation`,
      400
    );
  }
  const freshPay = (fresh.payments ?? []).find(
    (p) => p.stripePaymentIntentId === paymentIntentId
  );
  if (!freshPay || freshPay.status === "cancelled") {
    throw new PosError(
      "PAYMENT_STATUS",
      "Payment was cancelled while confirming — check Stripe if the card was charged",
      409
    );
  }
  if (freshPay.status === "completed") {
    return fresh;
  }

  const settled = await settlePosSalePayment(paymentIntentId, { posSaleId: saleId });
  if (!settled.ok) {
    throw new PosError(
      "SETTLE_FAILED",
      settled.reason === "unsettled_status"
        ? "Could not settle card payment — payment may already be cancelled. Check the sale and Stripe."
        : `Could not settle card payment (${settled.reason})`,
      400
    );
  }
  return getSale(actor, saleId);
}

function saleDto(sale: {
  id: string;
  publicId: string;
  orgId: string;
  locationId: string;
  deviceId: string;
  status: string;
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  tipAmount: Prisma.Decimal;
  total: Prisma.Decimal;
  amountPaid: Prisma.Decimal;
  amountDue: Prisma.Decimal;
  postalCodeCaptured: string | null;
  guestProfileId: string | null;
  lines?: Array<{ id: string; name: string; qty: number; unitPrice: Prisma.Decimal; kind: string }>;
  payments?: Array<{
    id: string;
    tender: string;
    amount: Prisma.Decimal;
    amountRefunded?: Prisma.Decimal | null;
    status: string;
    stripePaymentIntentId?: string | null;
    connectedAccountId?: string | null;
  }>;
  bookings?: Array<{ bookingId: string }>;
}) {
  return {
    id: sale.id,
    publicId: sale.publicId,
    orgId: sale.orgId,
    locationId: sale.locationId,
    deviceId: sale.deviceId,
    status: sale.status,
    subtotal: num(sale.subtotal),
    discountTotal: num(sale.discountTotal),
    taxAmount: num(sale.taxAmount),
    tipAmount: num(sale.tipAmount),
    total: num(sale.total),
    amountPaid: num(sale.amountPaid),
    amountDue: num(sale.amountDue),
    postalCodeCaptured: sale.postalCodeCaptured,
    guestProfileId: sale.guestProfileId,
    lines: (sale.lines ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      qty: l.qty,
      unitPrice: num(l.unitPrice),
      kind: l.kind,
    })),
    payments: (sale.payments ?? []).map((p) => ({
      id: p.id,
      tender: p.tender,
      amount: num(p.amount),
      amountRefunded: num(p.amountRefunded ?? 0),
      status: p.status,
      stripePaymentIntentId: p.stripePaymentIntentId ?? null,
      connectedAccountId: p.connectedAccountId ?? null,
    })),
    bookingIds: (sale.bookings ?? []).map((b) => b.bookingId),
  };
}

export async function getSale(actor: PosActor, saleId: string) {
  const where = await posListLocationWhere(actor);
  const sale = await prisma.posSale.findFirst({
    where: { id: saleId, ...where },
    include: { lines: true, payments: true, bookings: true },
  });
  if (!sale) throw new PosError("NOT_FOUND", "Sale not found", 404);
  return saleDto(sale);
}

export async function listSales(actor: PosActor) {
  const where = await posListLocationWhere(actor);
  const rows = await prisma.posSale.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { lines: true, payments: true, bookings: true },
  });
  return rows.map(saleDto);
}

export async function voidSale(actor: PosActor, saleId: string, body: Record<string, unknown>) {
  const sale = await getSale(actor, saleId);
  const settings = await resolvePosSettings(sale.orgId, sale.locationId);
  if (settings.managerPinRequiredForVoid) {
    await verifyManagerPin(actor, String(body.managerPin || ""), sale.locationId);
  }
  if (sale.status === "voided") return sale;

  // Cancel open card intents so cashier Elements cannot charge after void.
  // If a PI already succeeded, leave the payment row open: webhook still records
  // money on voided/refunded sales without fulfilling (see settlePosSalePayment).
  const openPayments = (sale.payments ?? []).filter(
    (p) =>
      (p.status === "pending" || p.status === "authorized" || p.status === "failed") &&
      Boolean(p.stripePaymentIntentId)
  );
  const cancelPaymentIds: string[] = [];
  for (const p of openPayments) {
    const key = String(p.stripePaymentIntentId);
    if (key.startsWith("cs:")) {
      // Expire Checkout Session so the guest cannot pay after void; only then
      // cancel the local row. If the session already completed, leave the row
      // so webhook can still record money without fulfill.
      if (!process.env.STRIPE_SECRET_KEY?.trim()) {
        cancelPaymentIds.push(p.id);
        continue;
      }
      const { getStripe } = await import("@/lib/stripe");
      const stripe = getStripe();
      const sessionId = key.slice(3);
      try {
        await stripe.checkout.sessions.expire(sessionId);
        cancelPaymentIds.push(p.id);
      } catch {
        try {
          const session = await stripe.checkout.sessions.retrieve(sessionId);
          if (session.status === "complete") {
            // Paid — leave open for settle-without-fulfill.
          } else {
            // expired / open-but-unusable — close local row (no dangling "awaiting").
            cancelPaymentIds.push(p.id);
          }
        } catch {
          cancelPaymentIds.push(p.id);
        }
      }
      continue;
    }
    if (!key.startsWith("pi_")) {
      // Unknown placeholder — close local row only.
      cancelPaymentIds.push(p.id);
      continue;
    }
    if (key.startsWith("pi_smoke_")) {
      cancelPaymentIds.push(p.id);
      continue;
    }
    if (!process.env.STRIPE_SECRET_KEY?.trim()) {
      // Cannot cancel remotely; close local row so confirm-card cannot settle.
      cancelPaymentIds.push(p.id);
      continue;
    }
    const { getStripe } = await import("@/lib/stripe");
    const stripe = getStripe();
    try {
      await stripe.paymentIntents.cancel(key);
      cancelPaymentIds.push(p.id);
    } catch {
      try {
        const pi = await stripe.paymentIntents.retrieve(key);
        if (pi.status === "succeeded" || pi.status === "processing") {
          // Money in flight / captured — leave open for settle-without-fulfill.
        } else {
          // canceled / requires_* — close local so UI does not show awaiting card.
          cancelPaymentIds.push(p.id);
        }
      } catch {
        cancelPaymentIds.push(p.id);
      }
    }
  }
  if (cancelPaymentIds.length) {
    await prisma.posSalePayment.updateMany({
      where: { id: { in: cancelPaymentIds }, saleId: sale.id },
      data: { status: "cancelled" },
    });
  }
  await prisma.$transaction(async (tx) => {
    await tx.guestTab.updateMany({
      where: { saleId: sale.id, status: { in: ["open", "authorized"] } },
      data: { status: "voided" },
    });
    await tx.posSale.update({ where: { id: sale.id }, data: { status: "voided" } });
    const lines = await tx.posSaleLine.findMany({
      where: { saleId: sale.id, productId: { not: null } },
      select: { id: true, productId: true, qty: true },
    });
    for (const line of lines) {
      if (!line.productId) continue;
      const product = await tx.posProduct.findFirst({ where: { id: line.productId } });
      if (!product?.trackInventory) continue;
      await recordInventoryMovement(tx, {
        orgId: sale.orgId,
        productRef: { posProductId: product.id },
        kind: "sale_return",
        qty: line.qty,
        sourceType: "pos_void",
        sourceId: `${sale.id}:void:${line.id}`,
        reason: "pos_void",
        actorId: actorUserId(actor),
      });
    }
    await enqueueSource(tx, {
      orgId: sale.orgId,
      locationId: sale.locationId,
      sourceType: "pos_void",
      sourceId: sale.id,
      sourceEvent: "voided",
    });
  });
  flushAccountingQueueSoon(sale.orgId);
  for (const bookingId of sale.bookingIds) {
    await cancelBooking(actor, bookingId, { reason: "pos_void" }).catch(() => undefined);
  }
  logStaffActivityEntry(actor, {
    action: "pos.sale.void",
    entityType: "PosSale",
    entityId: sale.id,
    description: `Voided POS sale ${sale.publicId}`,
  });
  return getSale(actor, sale.id);
}

type PosRefundClaim = {
  paymentId: string;
  tender: string;
  slice: number;
  payAmt: number;
  prevRefunded: number;
  nextRefunded: number;
  stripePaymentIntentId: string | null;
  connectedAccountId: string | null;
  giftCardId: string | null;
};

function isStripeCardTender(tender: string): boolean {
  return tender === "card" || tender === "stored_card" || tender === "payment_link";
}

function isCashLikeTender(tender: string): boolean {
  return (
    tender === "cash" ||
    tender === "cashless" ||
    tender === "park_wallet" ||
    tender === "split_component" ||
    tender === "other"
  );
}

function posRefundLedgerTender(tender: string): "card" | "cash" | "gift_card" | "other" {
  if (isStripeCardTender(tender)) return "card";
  if (tender === "gift_card") return "gift_card";
  if (tender === "cash" || isCashLikeTender(tender)) return "cash";
  return "other";
}

function posPaymentRefundableRemaining(p: {
  amount: unknown;
  amountRefunded?: unknown;
  status: string;
}): number {
  if (!["completed", "partial_refund"].includes(p.status)) return 0;
  const payAmt = roundMoney(num(p.amount as never));
  const already = roundMoney(num((p.amountRefunded as never) ?? 0));
  return Math.max(0, roundMoney(payAmt - already));
}

/** Resolve a refundable PaymentIntent id from a POS payment row key (pi_ / cs: / smoke). */
async function resolvePosRefundPaymentIntentId(
  stripePaymentIntentId: string
): Promise<{ kind: "stripe" | "smoke" | "none"; paymentIntentId: string | null }> {
  const key = stripePaymentIntentId.trim();
  if (!key) return { kind: "none", paymentIntentId: null };
  if (key.startsWith("pi_smoke_")) return { kind: "smoke", paymentIntentId: key };
  if (key.startsWith("pi_")) return { kind: "stripe", paymentIntentId: key };
  if (key.startsWith("cs:")) {
    if (!process.env.STRIPE_SECRET_KEY?.trim()) {
      return { kind: "none", paymentIntentId: null };
    }
    const { getStripe } = await import("@/lib/stripe");
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(key.slice(3));
    const pi = session.payment_intent;
    const piId = typeof pi === "string" ? pi : pi?.id ?? null;
    if (!piId) return { kind: "none", paymentIntentId: null };
    return { kind: "stripe", paymentIntentId: piId };
  }
  return { kind: "none", paymentIntentId: null };
}

async function reversePosPaymentRefundClaim(claim: PosRefundClaim) {
  try {
    await prisma.posSalePayment.update({
      where: { id: claim.paymentId },
      data: {
        amountRefunded: money(claim.prevRefunded),
        status:
          claim.prevRefunded <= 0.001
            ? "completed"
            : claim.prevRefunded + 0.001 >= claim.payAmt
              ? "refunded"
              : "partial_refund",
      },
    });
  } catch (err) {
    console.error("[pos refund] failed to reverse payment claim", claim.paymentId, err);
  }
}

export async function refundSale(actor: PosActor, saleId: string, body: Record<string, unknown>) {
  const sale = await getSale(actor, saleId);
  const settings = await resolvePosSettings(sale.orgId, sale.locationId);
  if (settings.managerPinRequiredForRefund) {
    await verifyManagerPin(actor, String(body.managerPin || ""), sale.locationId);
  }
  if (sale.status === "voided") {
    throw new PosError("VOIDED", "Cannot refund a voided sale", 400);
  }
  if (sale.status === "refunded") {
    throw new PosError("ALREADY_REFUNDED", "Sale is already fully refunded", 400);
  }

  const toGift = body.refundToGiftCard === true;
  const reason = body.reason == null ? null : String(body.reason);
  const createdById = actorUserId(actor);
  const requestedRaw = body.amount == null ? null : Number(body.amount);

  // Claim under lock (ticketing parity) before any Stripe / gift external mover.
  const claims: PosRefundClaim[] = [];
  let claimAmount = 0;
  let paidCap = 0;
  let tillSessionId: string | null = null;
  let saleOrgId = sale.orgId;
  let salePublicId = sale.publicId;
  let bookingIds = sale.bookingIds;
  let guestProfileId = sale.guestProfileId;
  let locationId = sale.locationId;
  let idempotencyKey = "";
  let primaryRefundId: string | null = null;

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM pos_sales WHERE id = ${sale.id} FOR UPDATE
    `;
    const locked = await tx.posSale.findFirst({
      where: { id: sale.id },
      include: { payments: true },
    });
    if (!locked) throw new PosError("NOT_FOUND", "Sale not found", 404);
    if (locked.status === "voided") {
      throw new PosError("VOIDED", "Cannot refund a voided sale", 400);
    }
    if (locked.status === "refunded") {
      throw new PosError("ALREADY_REFUNDED", "Sale is already fully refunded", 400);
    }

    tillSessionId = locked.tillSessionId;
    saleOrgId = locked.orgId;
    salePublicId = locked.publicId;
    guestProfileId = locked.guestProfileId;
    locationId = locked.locationId;
    paidCap = roundMoney(num(locked.amountPaid));

    // Legacy sync: older refundSale wrote PosSaleRefund without amountRefunded claims.
    // Burn ledger totals into payment claims so historical refunds cannot be charged twice.
    const ledgerAgg = await tx.posSaleRefund.aggregate({
      where: { saleId: locked.id },
      _sum: { amount: true },
    });
    const ledgerTotal = roundMoney(num(ledgerAgg._sum.amount ?? 0));
    let payments = (locked.payments ?? []).filter((p) =>
      ["completed", "partial_refund", "refunded"].includes(p.status)
    );
    const claimedTotal = roundMoney(
      payments.reduce((s, p) => s + num(p.amountRefunded ?? 0), 0)
    );
    if (ledgerTotal > claimedTotal + 0.001) {
      let burn = roundMoney(ledgerTotal - claimedTotal);
      const oldest = [...payments].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
      );
      for (const p of oldest) {
        if (burn <= 0) break;
        const payAmt = roundMoney(num(p.amount));
        const already = roundMoney(num(p.amountRefunded ?? 0));
        const room = roundMoney(payAmt - already);
        if (room <= 0) continue;
        const take = roundMoney(Math.min(room, burn));
        const next = roundMoney(already + take);
        await tx.posSalePayment.update({
          where: { id: p.id },
          data: {
            amountRefunded: money(next),
            status: next + 0.001 >= payAmt ? "refunded" : "partial_refund",
          },
        });
        burn = roundMoney(burn - take);
      }
      payments = await tx.posSalePayment.findMany({
        where: {
          saleId: locked.id,
          status: { in: ["completed", "partial_refund", "refunded"] },
        },
        orderBy: { createdAt: "asc" },
      });
    }

    const remainingTotal = roundMoney(
      payments.reduce((s, p) => s + posPaymentRefundableRemaining(p), 0)
    );
    if (remainingTotal <= 0.001) {
      throw new PosError("ALREADY_REFUNDED", "Sale has no remaining refundable amount", 400);
    }

    claimAmount =
      requestedRaw == null || !Number.isFinite(requestedRaw)
        ? remainingTotal
        : roundMoney(requestedRaw);
    if (!(claimAmount > 0)) {
      throw new PosError("AMOUNT", "Refund amount must be greater than zero", 400);
    }
    if (claimAmount > remainingTotal + 0.001) {
      throw new PosError(
        "REFUND_EXCEEDS",
        "Refund exceeds remaining refundable amount on this sale",
        400
      );
    }

    idempotencyKey = String(
      body.idempotencyKey || `refund:${locked.id}:${claimAmount}`
    );
    const existing = await tx.posSaleRefund.findFirst({
      where: { orgId: locked.orgId, idempotencyKey },
    });
    if (existing) {
      // Signal idempotent hit via empty claims; caller returns getSale.
      return;
    }

    let need = claimAmount;
    const takeFrom = (pred: (tender: string) => boolean) => {
      const pool = payments
        .filter((p) => pred(p.tender) && posPaymentRefundableRemaining(p) > 0)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      for (const p of pool) {
        if (need <= 0) break;
        const payAmt = roundMoney(num(p.amount));
        const prevRefunded = roundMoney(num(p.amountRefunded ?? 0));
        // Recompute left from live claim map if we already stamped this payment in-loop.
        const priorClaim = claims.filter((c) => c.paymentId === p.id).reduce((s, c) => s + c.slice, 0);
        const left = roundMoney(payAmt - prevRefunded - priorClaim);
        if (left <= 0) continue;
        const slice = roundMoney(Math.min(left, need));
        const nextRefunded = roundMoney(prevRefunded + priorClaim + slice);
        claims.push({
          paymentId: p.id,
          tender: p.tender,
          slice,
          payAmt,
          prevRefunded: roundMoney(prevRefunded + priorClaim),
          nextRefunded,
          stripePaymentIntentId: p.stripePaymentIntentId ?? null,
          connectedAccountId: p.connectedAccountId ?? null,
          giftCardId: p.giftCardId ?? null,
        });
        need = roundMoney(need - slice);
      }
    };

    takeFrom(isStripeCardTender);
    takeFrom((t) => t === "gift_card");
    takeFrom(isCashLikeTender);

    if (!claims.length || need > 0.001) {
      throw new PosError(
        "REFUND_ALLOCATE",
        "Refund could not be fully allocated across payment tenders",
        400
      );
    }

    // Stamp amountRefunded claims (released after TX); reverse on external failure.
    for (const claim of claims) {
      await tx.posSalePayment.update({
        where: { id: claim.paymentId },
        data: {
          amountRefunded: money(claim.nextRefunded),
          status:
            claim.nextRefunded + 0.001 >= claim.payAmt ? "refunded" : "partial_refund",
        },
      });
    }
  });

  if (!claims.length) {
    // Idempotent replay (refund row already existed under lock).
    return getSale(actor, sale.id);
  }

  const key = idempotencyKey;
  const succeeded: PosRefundClaim[] = [];

  try {
    if (toGift) {
      // Store credit: payments already claimed; issue gift instead of reversing Stripe.
      const issued = await issueGiftCard({
        orgId: saleOrgId,
        locationId,
        amount: claimAmount,
        issuedToGuestId: guestProfileId,
        issuedSaleId: sale.id,
        saleId: sale.id,
        idempotencyKey: `${key}:gift`,
      });
      await prisma.posSaleRefund.create({
        data: {
          saleId: sale.id,
          orgId: saleOrgId,
          amount: money(claimAmount),
          tender: "gift_card",
          giftCardId: issued.giftCard.id,
          reason,
          createdById,
          idempotencyKey: key,
        },
      });
      succeeded.push(...claims);
    } else {
      const { refundPayment } = await import("@/lib/stripe");
      const { creditGiftCard } = await import("@/lib/ticketing/giftCards");

      for (const claim of claims) {
        try {
          if (isStripeCardTender(claim.tender)) {
            if (!claim.stripePaymentIntentId) {
              throw new PosError(
                "CARD_REFUND_PI",
                "Card payment has no refundable PaymentIntent",
                400
              );
            }
            const resolved = await resolvePosRefundPaymentIntentId(
              claim.stripePaymentIntentId
            );
            if (resolved.kind === "smoke") {
              if (!posSmokeAllowed()) {
                throw new PosError(
                  "SMOKE_REFUND",
                  "Smoke card refunds require POS smoke mode",
                  400
                );
              }
            } else if (resolved.kind === "stripe" && resolved.paymentIntentId) {
              if (!process.env.STRIPE_SECRET_KEY?.trim()) {
                throw new PosError(
                  "STRIPE_NOT_CONFIGURED",
                  "Card refunds need STRIPE_SECRET_KEY",
                  400
                );
              }
              await refundPayment(resolved.paymentIntentId, claim.slice, {
                refundApplicationFee: Boolean(claim.connectedAccountId?.trim()),
                idempotencyKey: `${key}:pi:${claim.paymentId}`,
              });
            } else {
              throw new PosError(
                "CARD_REFUND_PI",
                "Card payment has no refundable PaymentIntent",
                400
              );
            }
          } else if (claim.tender === "gift_card") {
            if (!claim.giftCardId) {
              throw new PosError(
                "GIFT_REFUND",
                "Gift card payment is missing giftCardId",
                400
              );
            }
            await creditGiftCard(claim.giftCardId, claim.slice, prisma, {
              orgId: saleOrgId,
              saleId: sale.id,
              createdById,
              idempotencyKey: `${key}:gc:${claim.paymentId}`,
              type: "refund",
            });
          }
          // cash-like: ledger-only
          succeeded.push(claim);
        } catch (err) {
          console.warn("[pos refund] external refund failed", err);
          const toReverse = claims.filter((c) => !succeeded.includes(c));
          for (const rest of toReverse) {
            await reversePosPaymentRefundClaim(rest);
          }
          if (succeeded.length === 0) {
            if (err instanceof PosError) throw err;
            throw new PosError(
              "REFUND_FAILED",
              err instanceof Error ? err.message : "Refund could not be processed",
              400
            );
          }
          break;
        }
      }

      if (!succeeded.length) {
        throw new PosError("REFUND_FAILED", "Refund could not be processed", 400);
      }

      const refundedAmount = roundMoney(succeeded.reduce((s, c) => s + c.slice, 0));
      const byTender = new Map<string, { amount: number; giftCardId: string | null }>();
      for (const c of succeeded) {
        const tenderKey = posRefundLedgerTender(c.tender);
        const prev = byTender.get(tenderKey) ?? { amount: 0, giftCardId: null };
        byTender.set(tenderKey, {
          amount: roundMoney(prev.amount + c.slice),
          giftCardId: c.giftCardId ?? prev.giftCardId,
        });
      }

      let tenderIdx = 0;
      for (const [tender, group] of byTender) {
        const refundRow = await prisma.posSaleRefund.create({
          data: {
            saleId: sale.id,
            orgId: saleOrgId,
            amount: money(group.amount),
            tender: tender as "card" | "cash" | "gift_card" | "other",
            giftCardId: tender === "gift_card" ? group.giftCardId : null,
            reason,
            createdById,
            idempotencyKey: tenderIdx === 0 ? key : `${key}:${tender}:${tenderIdx}`,
          },
        });
        if (tenderIdx === 0) primaryRefundId = refundRow.id;
        tenderIdx += 1;
      }

      // Cash drawer: only cash ledger refunds move till expected cash.
      const cashRefund = byTender.get("cash")?.amount ?? 0;
      if (cashRefund > 0 && tillSessionId) {
        const till = await prisma.tillSession.findFirst({
          where: { id: tillSessionId, status: "open" },
        });
        if (till) {
          await prisma.tillMovement.create({
            data: {
              sessionId: till.id,
              orgId: saleOrgId,
              kind: "refund_cash",
              amount: money(cashRefund),
              saleId: sale.id,
              reason: "pos_refund",
              createdById,
            },
          });
          const expected = await expectedCashForSession(till.id);
          await prisma.tillSession.update({
            where: { id: till.id },
            data: { expectedCash: money(expected) },
          });
        }
      }

      claimAmount = refundedAmount;
    }
  } catch (err) {
    // toGift or total failure before any succeeded persist: reverse all claims.
    if (!succeeded.length) {
      for (const claim of claims) {
        await reversePosPaymentRefundClaim(claim);
      }
    }
    throw err;
  }

  const claimedTotal = roundMoney(
    (
      await prisma.posSalePayment.findMany({
        where: { saleId: sale.id },
        select: { amountRefunded: true },
      })
    ).reduce((s, p) => s + num(p.amountRefunded), 0)
  );
  const nextStatus =
    claimedTotal + 0.001 >= paidCap ? "refunded" : "partially_refunded";
  const refundEventKey =
    primaryRefundId != null
      ? `refund:${primaryRefundId}:${toMinor(claimAmount)}`
      : `refund:legacy:${toMinor(claimAmount)}`;
  await prisma.$transaction(async (tx) => {
    await tx.posSale.update({ where: { id: sale.id }, data: { status: nextStatus } });
    // Full refund restores stock; partial refunds restock only when returnLines are provided.
    const returnLinesRaw = Array.isArray(body.returnLines) ? body.returnLines : null;
    if (nextStatus === "refunded" || returnLinesRaw) {
      const lines = await tx.posSaleLine.findMany({
        where: { saleId: sale.id, productId: { not: null } },
        select: { id: true, productId: true, qty: true },
      });
      const byId = new Map(lines.map((l) => [l.id, l]));
      const toRestock: Array<{ lineId: string; productId: string; qty: number }> = [];
      if (returnLinesRaw) {
        for (const raw of returnLinesRaw) {
          if (!raw || typeof raw !== "object") continue;
          const lineId = String((raw as { lineId?: unknown }).lineId || "");
          const qty = Math.floor(Number((raw as { qty?: unknown }).qty));
          const line = byId.get(lineId);
          if (!line?.productId || !(qty > 0)) continue;
          toRestock.push({
            lineId,
            productId: line.productId,
            qty: Math.min(qty, line.qty),
          });
        }
      } else if (nextStatus === "refunded") {
        for (const line of lines) {
          if (!line.productId) continue;
          toRestock.push({ lineId: line.id, productId: line.productId, qty: line.qty });
        }
      }
      for (const item of toRestock) {
        const product = await tx.posProduct.findFirst({ where: { id: item.productId } });
        if (!product?.trackInventory) continue;
        await recordInventoryMovement(tx, {
          orgId: saleOrgId,
          productRef: { posProductId: product.id },
          kind: "sale_return",
          qty: item.qty,
          sourceType: "pos_refund",
          sourceId: `${sale.id}:refund:${primaryRefundId ?? key}:${item.lineId}`,
          reason: reason ?? "pos_refund",
          actorId: createdById,
        });
      }
    }
    await enqueueSource(tx, {
      orgId: saleOrgId,
      locationId,
      sourceType: "pos_refund",
      sourceId: sale.id,
      sourceEvent: refundEventKey,
    });
  });
  flushAccountingQueueSoon(saleOrgId);
  if (nextStatus === "refunded") {
    for (const bookingId of bookingIds) {
      await cancelBooking(actor, bookingId, { reason: "pos_refund" }).catch(() => undefined);
    }
  }
  for (const bookingId of bookingIds) {
    await syncPartyAfterBookingWrite(prisma, bookingId);
  }
  logStaffActivityEntry(actor, {
    action: "pos.sale.refund",
    entityType: "PosSale",
    entityId: sale.id,
    description: toGift
      ? `Refunded ${claimAmount} to gift card on POS sale ${salePublicId}`
      : `Refunded ${claimAmount} on POS sale ${salePublicId}`,
  });
  return getSale(actor, sale.id);
}

export async function recordWastage(actor: PosActor, body: Record<string, unknown>) {
  const locationId = String(body.locationId || "");
  const { orgId } = await requirePosVenue(actor, locationId);
  const settings = await resolvePosSettings(orgId, locationId);
  let managerOverrideId: string | null = null;
  if (settings.managerPinRequiredForWastage) {
    const pin = await verifyManagerPin(actor, String(body.managerPin || ""), locationId);
    managerOverrideId = pin.userId;
  }
  const product = await prisma.posProduct.findFirst({
    where: { id: String(body.productId || ""), orgId, locationId },
  });
  if (!product) throw new PosError("NOT_FOUND", "Product not found", 404);
  const qty = Math.floor(Number(body.qty));
  if (!(qty > 0)) throw new PosError("QTY", "qty must be greater than zero");
  const row = await prisma.posWastage.create({
    data: {
      orgId,
      locationId,
      productId: product.id,
      qty,
      reason: String(body.reason || "wastage"),
      recordedById: actorUserId(actor),
      managerOverrideId,
    },
  });
  if (product.trackInventory) {
    await recordInventoryMovement(prisma, {
      orgId,
      productRef: { posProductId: product.id },
      kind: "wastage",
      qty: -qty,
      sourceType: "inventory_movement",
      sourceId: row.id,
      reason: String(body.reason || "wastage"),
      actorId: actorUserId(actor),
    });
    flushAccountingQueueSoon(orgId);
  }
  logStaffActivityEntry(actor, {
    action: "pos.wastage",
    entityType: "PosSale",
    entityId: row.id,
    description: `Recorded wastage of ${qty} ${product.name}`,
  });
  return row;
}

export async function availability(actor: PosActor, locationId: string) {
  const { orgId } = await requirePosVenue(actor, locationId);
  const now = new Date();
  const sessions = await prisma.ticketSession.findMany({
    where: { orgId, locationId, endsAt: { gte: now } },
    orderBy: { startsAt: "asc" },
    take: 100,
    select: {
      id: true,
      productId: true,
      label: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      remaining: true,
      isClosed: true,
    },
  });
  const resources = await prisma.capacityResource.findMany({
    where: { orgId, locationId, archivedAt: null },
    select: { id: true, name: true, defaultCapacity: true },
  });
  return {
    sessions: sessions.map((s) => ({
      ...s,
      // Client filters historically used `closed`; keep both keys.
      closed: s.isClosed,
    })),
    resources,
  };
}
