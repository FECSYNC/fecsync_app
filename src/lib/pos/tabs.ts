import prisma from "@/lib/prisma";
import { PosError } from "@/lib/pos/errors";
import { money, num, roundMoney } from "@/lib/pos/money";
import { requirePosVenue, type PosActor } from "@/lib/pos/scope";
import { checkoutCart, openCart, addCartLine } from "@/lib/pos/saleEngine";

export async function openTab(actor: PosActor, body: Record<string, unknown>) {
  const locationId = String(body.locationId || "");
  const { orgId } = await requirePosVenue(actor, locationId);
  const tab = await prisma.guestTab.create({
    data: {
      orgId,
      locationId,
      deviceId: body.deviceId ? String(body.deviceId) : null,
      guestProfileId: body.guestProfileId ? String(body.guestProfileId) : null,
      tableLabel: body.tableLabel ? String(body.tableLabel) : null,
    },
  });
  return tab;
}

export async function listTabs(actor: PosActor, locationId: string) {
  const { orgId } = await requirePosVenue(actor, locationId);
  return prisma.guestTab.findMany({
    where: {
      orgId,
      locationId,
      status: { in: ["open", "authorized", "split_child"] },
    },
    include: { lines: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function addTabLine(actor: PosActor, tabId: string, body: Record<string, unknown>) {
  const locationId = String(body.locationId || "");
  const { orgId } = await requirePosVenue(actor, locationId);
  const tab = await prisma.guestTab.findFirst({ where: { id: tabId, orgId, status: "open" } });
  if (!tab) throw new PosError("NOT_FOUND", "Tab not found", 404);
  const line = await prisma.guestTabLine.create({
    data: {
      tabId: tab.id,
      orgId,
      name: String(body.name || "Item"),
      qty: Math.max(1, Number(body.qty ?? 1)),
      unitPrice: money(Number(body.unitPrice ?? 0)),
      productId: body.productId ? String(body.productId) : null,
    },
  });
  return line;
}

export async function splitTab(actor: PosActor, tabId: string, body: Record<string, unknown>) {
  const locationId = String(body.locationId || "");
  const { orgId } = await requirePosVenue(actor, locationId);
  const parent = await prisma.guestTab.findFirst({
    where: { id: tabId, orgId },
    include: { lines: true },
  });
  if (!parent) throw new PosError("NOT_FOUND", "Tab not found", 404);
  const child = await prisma.guestTab.create({
    data: {
      orgId,
      locationId: parent.locationId,
      deviceId: parent.deviceId,
      parentTabId: parent.id,
      status: "split_child",
      tableLabel: body.tableLabel ? String(body.tableLabel) : parent.tableLabel,
    },
  });
  return { beta: true, parentId: parent.id, child };
}

export async function preauthTab(actor: PosActor, tabId: string, body: Record<string, unknown>) {
  const locationId = String(body.locationId || "");
  const { orgId } = await requirePosVenue(actor, locationId);
  const tab = await prisma.guestTab.findFirst({ where: { id: tabId, orgId } });
  if (!tab) throw new PosError("NOT_FOUND", "Tab not found", 404);
  if (!process.env.STRIPE_SECRET_KEY?.trim()) {
    throw new PosError("STRIPE_NOT_CONFIGURED", "Card preauth needs STRIPE_SECRET_KEY", 400);
  }
  const { getStripe } = await import("@/lib/stripe");
  const dollarAmount = Number(body.amount);
  if (!(dollarAmount > 0) || !Number.isFinite(dollarAmount)) {
    throw new PosError("AMOUNT", "Preauth amount must be a positive number", 400);
  }
  const amount = Math.round(dollarAmount * 100);
  const { resolvePosConnectChargeFields } = await import(
    "@/lib/marketplace/posConnect"
  );
  const connect = await resolvePosConnectChargeFields({
    orgId,
    locationId,
    amountMinor: amount,
  });
  const pi = await getStripe().paymentIntents.create({
    amount,
    currency: "usd",
    capture_method: "manual",
    automatic_payment_methods: { enabled: true },
    metadata: {
      type: "pos_tab_preauth",
      tabId: tab.id,
      ...connect.metadataExtras,
    },
    ...connect.paymentIntentExtras,
  });
  await prisma.guestTab.update({
    where: { id: tab.id },
    data: { status: "authorized", preauthPaymentIntentId: pi.id },
  });
  return { beta: true, paymentIntentId: pi.id, status: pi.status };
}

export async function settleTab(actor: PosActor, tabId: string, body: Record<string, unknown>) {
  const locationId = String(body.locationId || "");
  const { orgId } = await requirePosVenue(actor, locationId);
  const tab = await prisma.guestTab.findFirst({
    where: { id: tabId, orgId },
    include: { lines: true },
  });
  if (!tab) throw new PosError("NOT_FOUND", "Tab not found", 404);
  if (tab.status === "settled" && tab.saleId) {
    const { getSale } = await import("@/lib/pos/saleEngine");
    const sale = await getSale(actor, tab.saleId);
    return { beta: Boolean(tab.parentTabId), sale, replay: true as const };
  }
  if (tab.status !== "open" && tab.status !== "authorized" && tab.status !== "split_child") {
    throw new PosError("TAB_STATUS", "Tab cannot be settled in its current status", 400);
  }
  if (!tab.lines.length) throw new PosError("EMPTY_TAB", "Tab has no lines");
  const deviceId = String(body.deviceId || tab.deviceId || "");
  if (!deviceId) throw new PosError("DEVICE", "deviceId is required to settle a tab");

  // Beta preauth: capture held funds when present; do not invent a fake auth code.
  // Captured PI becomes the sale tender so settle does not double-charge.
  let capturedPreauthId: string | null = null;
  const lineTotal = tab.lines.reduce((s, l) => s + num(l.unitPrice) * l.qty, 0);
  if (tab.preauthPaymentIntentId && process.env.STRIPE_SECRET_KEY?.trim()) {
    const { getStripe } = await import("@/lib/stripe");
    const pi = await getStripe().paymentIntents.retrieve(tab.preauthPaymentIntentId);
    if (pi.status === "requires_capture") {
      await getStripe().paymentIntents.capture(tab.preauthPaymentIntentId);
    } else if (pi.status !== "succeeded") {
      throw new PosError(
        "PREAUTH_STATUS",
        `Preauth PaymentIntent is ${pi.status}; cannot settle`,
        400
      );
    }
    capturedPreauthId = tab.preauthPaymentIntentId;
  } else if (tab.preauthPaymentIntentId && !process.env.STRIPE_SECRET_KEY?.trim()) {
    throw new PosError("STRIPE_NOT_CONFIGURED", "Card preauth capture needs STRIPE_SECRET_KEY", 400);
  }

  const tipAmount = roundMoney(Number(body.tipAmount ?? 0));
  const clientTenders = Array.isArray(body.tenders) ? (body.tenders as Array<Record<string, unknown>>) : [];
  let tenders: Array<Record<string, unknown>>;
  if (capturedPreauthId) {
    // Ignore client card tenders — preauth already captured the line total.
    // Never inflate the captured PI amount with tip: Stripe already captured
    // the authorized amount; tip must be a separate cash/gift/wallet tender.
    const tipOnly = clientTenders.filter(
      (t) => String(t.tender) !== "card" && String(t.tender) !== "stored_card"
    );
    const tipFromTenders = roundMoney(
      tipOnly.reduce((s, t) => s + Number(t.amount || 0), 0)
    );
    if (tipAmount > tipFromTenders + 0.001) {
      throw new PosError(
        "TIP_TENDER",
        "Preauth captured the tab total only — tip must be a separate cash, gift, wallet, or cashless tender",
        400
      );
    }
    tenders = [
      {
        tender: "card",
        amount: roundMoney(lineTotal),
        stripePaymentIntentId: capturedPreauthId,
        alreadyCaptured: true,
      },
      ...tipOnly.map((t) => ({
        ...t,
        code: t.code || t.giftCode || t.cashlessCode,
        guestProfileId: t.guestProfileId,
      })),
    ];
  } else {
    tenders = clientTenders.map((t) => ({
      ...t,
      code: t.code || t.giftCode || t.cashlessCode,
      guestProfileId: t.guestProfileId,
    }));
  }

  const cart = await openCart(actor, {
    locationId: tab.locationId,
    deviceId,
    guestProfileId: tab.guestProfileId,
  });
  for (const line of tab.lines) {
    await addCartLine(actor, cart.id, {
      name: line.name,
      qty: line.qty,
      unitPrice: num(line.unitPrice),
      productId: line.productId ?? undefined,
    });
  }
  const sale = await checkoutCart(actor, cart.id, {
    ...body,
    tenders,
    tipAmount,
    idempotencyKey: String(body.idempotencyKey || `tab:${tab.id}`),
    guestProfileId: tab.guestProfileId,
  });
  // Card without Terminal stays unpaid until Elements confirm — do not mark
  // the tab settled while the sale is still unpaid.
  const tabStatus = sale.status === "completed" ? "settled" : "authorized";
  await prisma.guestTab.update({
    where: { id: tab.id },
    data: { status: tabStatus, saleId: sale.id },
  });
  return { beta: Boolean(tab.parentTabId), sale };
}
