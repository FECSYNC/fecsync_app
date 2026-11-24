import { randomBytes } from "crypto";
import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { ForbiddenError } from "@/lib/auth/http-error";
import { PosError } from "@/lib/pos/errors";
import { money, num, roundMoney } from "@/lib/pos/money";
import { requirePosVenue, type PosActor } from "@/lib/pos/scope";
import {
  creditGiftCard,
  hashGiftCardCode,
  issueGiftCard,
  redeemGiftCard,
} from "@/lib/ticketing/giftCards";
import {
  enqueueSource,
  flushAccountingQueueSoon,
} from "@/lib/accounting/enqueueHooks";

function last4(code: string) {
  return code.replace(/[^A-Za-z0-9]/g, "").slice(-4);
}

export async function issuePosGiftCard(opts: {
  orgId: string;
  locationId: string;
  amount: number;
  currency?: string;
  guestProfileId?: string | null;
  saleId?: string | null;
  kind?: "digital" | "physical";
  createdById?: string | null;
  idempotencyKey?: string;
}) {
  const issued = await issueGiftCard({
    orgId: opts.orgId,
    amount: opts.amount,
    currency: opts.currency,
    locationId: opts.locationId,
    issuedToGuestId: opts.guestProfileId,
    issuedSaleId: opts.saleId,
    kind: opts.kind ?? "digital",
    createdById: opts.createdById,
    idempotencyKey: opts.idempotencyKey,
  });
  return issued;
}

export async function giftBalance(actor: PosActor, code: string, locationId: string) {
  const { orgId } = await requirePosVenue(actor, locationId);
  const card = await prisma.giftCard.findFirst({
    where: { orgId, codeHash: hashGiftCardCode(code) },
  });
  if (!card || card.status === "void" || card.status === "disabled") {
    throw new PosError("GIFT_CARD", "Gift card was not found", 404);
  }
  return {
    id: card.id,
    last4: card.last4 ?? last4(code),
    balance: num(card.remainingBalance),
    currency: card.currency,
    status: card.status,
  };
}

export async function redeemPosGiftCard(opts: {
  orgId: string;
  code: string;
  amount: number;
  saleId?: string | null;
  createdById?: string | null;
  idempotencyKey?: string;
  db?: Prisma.TransactionClient | typeof prisma;
}) {
  const codeHash = hashGiftCardCode(opts.code);
  const foreign = await prisma.giftCard.findFirst({
    where: { codeHash, orgId: { not: opts.orgId } },
    select: { id: true },
  });
  const own = await prisma.giftCard.findFirst({
    where: { codeHash, orgId: opts.orgId },
    select: { id: true },
  });
  if (foreign && !own) {
    throw new ForbiddenError("Gift card is outside this company");
  }
  return redeemGiftCard({
    orgId: opts.orgId,
    code: opts.code,
    amount: opts.amount,
    saleId: opts.saleId,
    createdById: opts.createdById,
    idempotencyKey: opts.idempotencyKey,
    ledgerType: "redeem",
    db: opts.db,
  });
}

export async function creditPosGiftCard(opts: {
  orgId: string;
  giftCardId: string;
  amount: number;
  saleId?: string | null;
  createdById?: string | null;
  idempotencyKey?: string;
}) {
  await creditGiftCard(opts.giftCardId, opts.amount, prisma, {
    orgId: opts.orgId,
    saleId: opts.saleId,
    createdById: opts.createdById,
    idempotencyKey: opts.idempotencyKey,
    type: "refund",
  });
}

export async function cashlessBalance(actor: PosActor, code: string, locationId: string) {
  const { orgId } = await requirePosVenue(actor, locationId);
  const row = await prisma.cashlessAccount.findFirst({
    where: { orgId, codeHash: hashGiftCardCode(code) },
  });
  if (!row) throw new PosError("CASHLESS", "Cashless card was not found", 404);
  return { id: row.id, last4: row.last4, balance: num(row.balance), status: row.status };
}

export async function issueCashless(opts: {
  orgId: string;
  locationId: string;
  amount: number;
  guestProfileId?: string | null;
  saleId?: string | null;
}) {
  const code = `CL-${randomBytes(4).toString("hex").toUpperCase()}`;
  const amount = roundMoney(opts.amount);
  const row = await prisma.cashlessAccount.create({
    data: {
      orgId: opts.orgId,
      locationId: opts.locationId,
      codeHash: hashGiftCardCode(code),
      last4: last4(code),
      guestProfileId: opts.guestProfileId ?? null,
      balance: money(amount),
      issuedSaleId: opts.saleId ?? null,
    },
  });
  // Sale-issued cards are posted by the POS sale tender/issue lines.
  if (!opts.saleId && amount > 0) {
    await enqueueSource(prisma, {
      orgId: opts.orgId,
      locationId: opts.locationId,
      sourceType: "cashless",
      sourceId: `cashless:${row.id}:issue`,
      sourceEvent: "issue",
      eventAt: row.createdAt,
      payload: { cashlessAccountId: row.id, delta: String(amount) },
    });
    flushAccountingQueueSoon(opts.orgId);
  }
  return { id: row.id, code, last4: row.last4, balance: num(row.balance) };
}

export async function adjustCashless(
  opts: {
    orgId: string;
    code?: string;
    id?: string;
    amount: number;
    /** When set (POS checkout/refund), sale JE owns the tender — skip cashless outbox. */
    saleId?: string | null;
  },
  db: Prisma.TransactionClient | typeof prisma = prisma
) {
  const row = opts.id
    ? await db.cashlessAccount.findFirst({ where: { id: opts.id, orgId: opts.orgId } })
    : await db.cashlessAccount.findFirst({
        where: { orgId: opts.orgId, codeHash: hashGiftCardCode(opts.code || "") },
      });
  if (!row) throw new PosError("CASHLESS", "Cashless card was not found", 404);
  const delta = roundMoney(opts.amount);
  const result = await db.$executeRaw`
    UPDATE cashless_accounts
    SET balance = balance + ${delta}, "updatedAt" = NOW()
    WHERE id = ${row.id} AND balance + ${delta} >= 0
  `;
  if (result !== 1) throw new PosError("CASHLESS_BALANCE", "Cashless balance is too low", 400);
  const updated = await db.cashlessAccount.findFirstOrThrow({ where: { id: row.id } });
  if (!opts.saleId) {
    await enqueueSource(db, {
      orgId: opts.orgId,
      locationId: row.locationId,
      sourceType: "cashless",
      sourceId: `cashless:${row.id}:${updated.updatedAt.getTime()}:${delta}`,
      sourceEvent: "adjust",
      eventAt: updated.updatedAt,
      payload: { cashlessAccountId: row.id, delta: String(delta) },
    });
    if (db === prisma) flushAccountingQueueSoon(opts.orgId);
  }
  return { id: updated.id, balance: num(updated.balance) };
}

export async function walletBalance(actor: PosActor, guestProfileId: string, locationId: string) {
  const { orgId } = await requirePosVenue(actor, locationId);
  const row = await prisma.parkWallet.findFirst({
    where: { orgId, locationId, guestProfileId },
  });
  return { balance: row ? num(row.balance) : 0, id: row?.id ?? null, status: row?.status ?? null };
}

export async function adjustParkWallet(
  opts: {
    orgId: string;
    locationId: string;
    guestProfileId: string;
    amount: number;
    type: "issue" | "topup" | "redeem" | "refund" | "adjust";
    saleId?: string | null;
    reference: string;
  },
  db: Prisma.TransactionClient | typeof prisma = prisma
) {
  const existingTxn = await db.parkWalletTxn.findFirst({
    where: { orgId: opts.orgId, reference: opts.reference },
  });
  if (existingTxn) {
    const wallet = await db.parkWallet.findFirstOrThrow({ where: { id: existingTxn.walletId } });
    return { id: wallet.id, balance: num(wallet.balance), replay: true };
  }
  const wallet = await db.parkWallet.upsert({
    where: {
      orgId_locationId_guestProfileId: {
        orgId: opts.orgId,
        locationId: opts.locationId,
        guestProfileId: opts.guestProfileId,
      },
    },
    create: {
      orgId: opts.orgId,
      locationId: opts.locationId,
      guestProfileId: opts.guestProfileId,
      balance: 0,
    },
    update: {},
  });
  const delta = roundMoney(opts.amount);
  const signed = opts.type === "redeem" ? -Math.abs(delta) : Math.abs(delta);
  const result = await db.$executeRaw`
    UPDATE park_wallets
    SET balance = balance + ${signed}, "updatedAt" = NOW()
    WHERE id = ${wallet.id} AND balance + ${signed} >= 0
  `;
  if (result !== 1) throw new PosError("WALLET_BALANCE", "Park wallet balance is too low", 400);
  const txn = await db.parkWalletTxn.create({
    data: {
      walletId: wallet.id,
      orgId: opts.orgId,
      type: opts.type,
      amount: money(Math.abs(delta)),
      saleId: opts.saleId ?? null,
      reference: opts.reference,
    },
  });
  // Sale-tied top-ups/redeems are posted by the POS sale. Standalone top-ups must enqueue.
  const coveredBySale = Boolean(opts.saleId);
  if (!coveredBySale) {
    await enqueueSource(db, {
      orgId: opts.orgId,
      locationId: opts.locationId,
      sourceType: "park_wallet",
      sourceId: txn.id,
      sourceEvent: opts.type,
      eventAt: txn.createdAt,
    });
    if (db === prisma) flushAccountingQueueSoon(opts.orgId);
  }
  const updated = await db.parkWallet.findFirstOrThrow({ where: { id: wallet.id } });
  return { id: updated.id, balance: num(updated.balance), replay: false };
}
