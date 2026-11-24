/**
 * Gift card tender ledger for venue bookings (not a full gift-card shop).
 */
import { createHash, randomBytes } from "crypto";
import { Decimal } from "@prisma/client/runtime/library";
import type { GiftCardKind, GiftCardLedgerType, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { TicketingError, GIFT_CARD_INSUFFICIENT } from "@/lib/ticketing/errors";
import {
  enqueueSource,
  flushAccountingQueueSoon,
} from "@/lib/accounting/enqueueHooks";

type Db = Prisma.TransactionClient | typeof prisma;

function last4(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, "").slice(-4);
}

async function writeGiftLedger(
  db: Db,
  opts: {
    giftCardId: string;
    orgId: string;
    type: GiftCardLedgerType;
    amount: number;
    saleId?: string | null;
    bookingId?: string | null;
    createdById?: string | null;
    idempotencyKey?: string | null;
  }
) {
  const idempotencyKey =
    opts.idempotencyKey?.trim() ||
    `${opts.type}:${opts.giftCardId}:${randomBytes(6).toString("hex")}`;
  const row = await db.giftCardLedger.create({
    data: {
      giftCardId: opts.giftCardId,
      orgId: opts.orgId,
      type: opts.type,
      amount: new Decimal(Math.round(opts.amount * 100) / 100),
      saleId: opts.saleId ?? null,
      bookingId: opts.bookingId ?? null,
      createdById: opts.createdById ?? null,
      idempotencyKey,
    },
  });
  const card = await db.giftCard.findFirst({
    where: { id: opts.giftCardId },
    select: { locationId: true },
  });
  await enqueueSource(db, {
    orgId: opts.orgId,
    locationId: card?.locationId ?? null,
    sourceType: "gift_card",
    sourceId: row.id,
    sourceEvent: opts.type,
    eventAt: row.createdAt,
  });
  // Flush only when not nested in a caller transaction (db === prisma).
  if (db === prisma) flushAccountingQueueSoon(opts.orgId);
  return row;
}

export function hashGiftCardCode(code: string): string {
  return createHash("sha256")
    .update(code.trim().toUpperCase())
    .digest("hex");
}

export function generateGiftCardCode(): string {
  return `GC-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export async function issueGiftCard(opts: {
  orgId: string;
  amount: number;
  currency?: string;
  issuedFromRefundBookingId?: string | null;
  code?: string;
  db?: Db;
  locationId?: string | null;
  issuedToGuestId?: string | null;
  issuedSaleId?: string | null;
  kind?: GiftCardKind;
  createdById?: string | null;
  idempotencyKey?: string | null;
  saleId?: string | null;
  bookingId?: string | null;
}): Promise<{ giftCard: { id: string; remainingBalance: number; last4: string | null }; code: string }> {
  const db = opts.db ?? prisma;
  const code = opts.code ?? generateGiftCardCode();
  const codeHash = hashGiftCardCode(code);
  const amount = Math.round(Number(opts.amount) * 100) / 100;
  if (!(amount > 0)) throw new Error("Gift card amount must be > 0");

  const giftCard = await db.giftCard.create({
    data: {
      orgId: opts.orgId,
      codeHash,
      last4: last4(code),
      kind: opts.kind ?? "digital",
      status: "active",
      remainingBalance: new Decimal(amount),
      currency: (opts.currency || "USD").toUpperCase().slice(0, 3),
      locationId: opts.locationId ?? null,
      issuedToGuestId: opts.issuedToGuestId ?? null,
      issuedSaleId: opts.issuedSaleId ?? opts.saleId ?? null,
      issuedFromRefundBookingId: opts.issuedFromRefundBookingId ?? null,
    },
  });
  await writeGiftLedger(db, {
    giftCardId: giftCard.id,
    orgId: opts.orgId,
    type: "issue",
    amount,
    saleId: opts.saleId ?? opts.issuedSaleId ?? null,
    bookingId: opts.bookingId ?? opts.issuedFromRefundBookingId ?? null,
    createdById: opts.createdById,
    idempotencyKey: opts.idempotencyKey,
  });

  return {
    giftCard: {
      id: giftCard.id,
      remainingBalance: Number(giftCard.remainingBalance.toString()),
      last4: giftCard.last4,
    },
    code,
  };
}

export async function redeemGiftCard(opts: {
  orgId: string;
  code: string;
  amount: number;
  db?: Db;
  saleId?: string | null;
  bookingId?: string | null;
  createdById?: string | null;
  idempotencyKey?: string | null;
  ledgerType?: GiftCardLedgerType;
}): Promise<{ giftCardId: string; remainingBalance: number }> {
  const db = opts.db ?? prisma;
  const amount = Math.round(Number(opts.amount) * 100) / 100;
  if (!(amount > 0)) throw new Error("Redeem amount must be > 0");
  const codeHash = hashGiftCardCode(opts.code);

  const card = await db.giftCard.findFirst({
    where: { orgId: opts.orgId, codeHash },
  });
  if (!card) throw new TicketingError(GIFT_CARD_INSUFFICIENT, 400);

  const result = await db.$executeRaw`
    UPDATE gift_cards
    SET "remainingBalance" = "remainingBalance" - ${amount}, "updatedAt" = NOW()
    WHERE id = ${card.id}
      AND "remainingBalance" >= ${amount}
  `;
  if (result !== 1) throw new TicketingError(GIFT_CARD_INSUFFICIENT, 400);

  const updated = await db.giftCard.findFirstOrThrow({ where: { id: card.id } });
  await writeGiftLedger(db, {
    giftCardId: card.id,
    orgId: opts.orgId,
    type: opts.ledgerType ?? "redeem",
    amount,
    saleId: opts.saleId,
    bookingId: opts.bookingId,
    createdById: opts.createdById,
    idempotencyKey: opts.idempotencyKey,
  });

  return {
    giftCardId: updated.id,
    remainingBalance: Number(updated.remainingBalance.toString()),
  };
}

export async function creditGiftCard(
  giftCardId: string,
  amount: number,
  db: Db = prisma,
  ledger?: {
    orgId: string;
    saleId?: string | null;
    bookingId?: string | null;
    createdById?: string | null;
    idempotencyKey?: string | null;
    type?: GiftCardLedgerType;
  }
) {
  const amt = Math.round(Number(amount) * 100) / 100;
  if (!(amt > 0)) throw new Error("Credit amount must be > 0");
  const result = await db.$executeRaw`
    UPDATE gift_cards
    SET "remainingBalance" = "remainingBalance" + ${amt}, "updatedAt" = NOW()
    WHERE id = ${giftCardId}
  `;
  if (result !== 1) throw new Error("Gift card not found");
  const updated = await db.giftCard.findFirstOrThrow({ where: { id: giftCardId } });
  if (ledger?.orgId) {
    await writeGiftLedger(db, {
      giftCardId,
      orgId: ledger.orgId,
      type: ledger.type ?? "refund",
      amount: amt,
      saleId: ledger.saleId,
      bookingId: ledger.bookingId,
      createdById: ledger.createdById,
      idempotencyKey: ledger.idempotencyKey,
    });
  }
  return updated;
}

/**
 * Void a gift card: status=void, remainingBalance=0, ledger type void.
 * Idempotent via ledger key `void:{giftCardId}` (or caller key).
 */
export async function voidGiftCard(opts: {
  giftCardId: string;
  orgId: string;
  db?: Db;
  createdById?: string | null;
  idempotencyKey?: string | null;
  bookingId?: string | null;
  saleId?: string | null;
}): Promise<{ id: string; status: string; remainingBalance: number }> {
  const db = opts.db ?? prisma;
  const idempotencyKey =
    opts.idempotencyKey?.trim() || `void:${opts.giftCardId}`;

  const existingLedger = await db.giftCardLedger.findFirst({
    where: { orgId: opts.orgId, idempotencyKey },
  });
  if (existingLedger) {
    const card = await db.giftCard.findFirstOrThrow({
      where: { id: opts.giftCardId, orgId: opts.orgId },
    });
    return {
      id: card.id,
      status: card.status,
      remainingBalance: Number(card.remainingBalance.toString()),
    };
  }

  const card = await db.giftCard.findFirst({
    where: { id: opts.giftCardId, orgId: opts.orgId },
  });
  if (!card) throw new Error("Gift card not found");

  if (card.status === "void") {
    const bal = Number(card.remainingBalance.toString());
    if (bal > 0) {
      await db.giftCard.update({
        where: { id: card.id },
        data: { remainingBalance: new Decimal(0) },
      });
    }
    await writeGiftLedger(db, {
      giftCardId: card.id,
      orgId: opts.orgId,
      type: "void",
      amount: bal > 0 ? bal : 0,
      saleId: opts.saleId,
      bookingId: opts.bookingId,
      createdById: opts.createdById,
      idempotencyKey,
    });
    return { id: card.id, status: "void", remainingBalance: 0 };
  }

  const bal = Math.round(Number(card.remainingBalance.toString()) * 100) / 100;
  await db.giftCard.update({
    where: { id: card.id },
    data: { status: "void", remainingBalance: new Decimal(0) },
  });
  await writeGiftLedger(db, {
    giftCardId: card.id,
    orgId: opts.orgId,
    type: "void",
    amount: bal > 0 ? bal : 0,
    saleId: opts.saleId,
    bookingId: opts.bookingId,
    createdById: opts.createdById,
    idempotencyKey,
  });

  return { id: card.id, status: "void", remainingBalance: 0 };
}
