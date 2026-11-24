/**
 * Historical backfill: enqueue every money source since go-live (oldest
 * first) and process the queue. Idempotent: outbox and journal keys dedupe.
 */
import type { AccountingSourceType } from "@prisma/client";
import prisma from "@/lib/prisma";
import { newInvoiceViewToken } from "@/lib/ticketing/invoices";
import { enqueueAccountingEvent, processPostingQueue } from "@/lib/accounting/postingQueue";
import { clearAccountingSettingsCache } from "@/lib/accounting/settings";

export const BACKFILL_SOURCES = ["booking", "pos", "membership", "marketplace", "shop", "tailoring", "gift_card", "till"] as const;
export type BackfillSource = (typeof BACKFILL_SOURCES)[number];

type Item = { sourceType: AccountingSourceType; sourceId: string; locationId: string | null; eventAt: Date; event?: string };

async function collect(orgId: string, from: Date, sources: Set<BackfillSource>): Promise<Item[]> {
  const items: Item[] = [];
  if (sources.has("booking")) {
    const rows = await prisma.booking.findMany({
      where: { orgId, OR: [{ createdAt: { gte: from } }, { updatedAt: { gte: from } }] },
      select: { id: true, locationId: true, updatedAt: true },
    });
    rows.forEach((r) => items.push({ sourceType: "booking", sourceId: r.id, locationId: r.locationId, eventAt: r.updatedAt }));
  }
  if (sources.has("pos")) {
    const rows = await prisma.posSale.findMany({ where: { orgId, createdAt: { gte: from } }, select: { id: true, locationId: true, createdAt: true } });
    rows.forEach((r) => items.push({ sourceType: "pos_sale", sourceId: r.id, locationId: r.locationId, eventAt: r.createdAt }));
  }
  if (sources.has("till")) {
    const movements = await prisma.tillMovement.findMany({
      where: { orgId, createdAt: { gte: from }, kind: { notIn: ["sale_cash", "refund_cash"] } },
      select: { id: true, createdAt: true, session: { select: { locationId: true } } },
    });
    movements.forEach((m) => items.push({ sourceType: "till_movement", sourceId: m.id, locationId: m.session.locationId, eventAt: m.createdAt }));
    const sessions = await prisma.tillSession.findMany({
      where: { orgId, closedAt: { gte: from } },
      select: { id: true, locationId: true, closedAt: true },
    });
    sessions.forEach((s) => items.push({ sourceType: "till_close", sourceId: s.id, locationId: s.locationId, eventAt: s.closedAt ?? from }));
  }
  if (sources.has("membership")) {
    const rows = await prisma.membershipPaymentAttempt.findMany({
      where: { orgId, status: "succeeded", createdAt: { gte: from } },
      select: { id: true, locationId: true, createdAt: true },
    });
    rows.forEach((r) => items.push({ sourceType: "membership_payment", sourceId: r.id, locationId: r.locationId, eventAt: r.createdAt }));
  }
  if (sources.has("marketplace")) {
    const rows = await prisma.marketplaceBooking.findMany({
      where: { orgId, OR: [{ paidAt: { gte: from } }, { updatedAt: { gte: from } }] },
      select: { id: true, locationId: true, updatedAt: true },
    });
    rows.forEach((r) => items.push({ sourceType: "marketplace_booking", sourceId: r.id, locationId: r.locationId, eventAt: r.updatedAt }));
  }
  if (sources.has("shop")) {
    const rows = await prisma.order.findMany({
      where: { orgId, createdAt: { gte: from } },
      select: { id: true, venueLocationId: true, updatedAt: true },
    });
    rows.forEach((r) => items.push({ sourceType: "shop_order", sourceId: r.id, locationId: r.venueLocationId, eventAt: r.updatedAt }));
  }
  if (sources.has("tailoring")) {
    const rows = await prisma.tailoringJob.findMany({ where: { orgId, paidAt: { gte: from } }, select: { id: true, paidAt: true } });
    rows.forEach((r) => items.push({ sourceType: "tailoring_payment", sourceId: r.id, locationId: null, eventAt: r.paidAt ?? from }));
  }
  if (sources.has("gift_card")) {
    const rows = await prisma.giftCardLedger.findMany({
      where: { orgId, createdAt: { gte: from }, saleId: null, bookingId: null },
      select: { id: true, createdAt: true, giftCard: { select: { locationId: true } } },
    });
    rows.forEach((r) => items.push({ sourceType: "gift_card", sourceId: r.id, locationId: r.giftCard.locationId, eventAt: r.createdAt }));
    const wallet = await prisma.parkWalletTxn.findMany({
      where: { orgId, createdAt: { gte: from }, saleId: null },
      select: { id: true, createdAt: true, wallet: { select: { locationId: true } } },
    });
    wallet.forEach((r) => items.push({ sourceType: "park_wallet", sourceId: r.id, locationId: r.wallet.locationId, eventAt: r.createdAt }));
  }
  return items.sort((a, b) => a.eventAt.getTime() - b.eventAt.getTime());
}

export async function backfillOrgHistory(
  orgId: string,
  opts: { from?: Date; sources?: BackfillSource[]; dryRun?: boolean; inlineLimit?: number; batchSize?: number } = {}
): Promise<{ enqueued: Record<string, number>; processed: number }> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { isDefault: true } });
  if (!org || org.isDefault) throw new Error("Backfill refuses the storefront / unknown organization");
  const settings = await prisma.accountingSettings.findUnique({ where: { orgId } });
  if (!settings?.enabled) throw new Error("Accounting is not initialized for this organization");
  clearAccountingSettingsCache(orgId);
  const from = opts.from && opts.from > settings.goLiveDate ? opts.from : settings.goLiveDate;
  const sources = new Set<BackfillSource>(opts.sources?.length ? opts.sources : BACKFILL_SOURCES);
  const items = await collect(orgId, from, sources);
  const enqueued: Record<string, number> = {};
  for (const i of items) enqueued[i.sourceType] = (enqueued[i.sourceType] ?? 0) + 1;
  if (opts.dryRun) return { enqueued, processed: 0 };

  const missingTokens = await prisma.bookingInvoice.findMany({ where: { orgId, viewToken: null }, select: { id: true } });
  for (const inv of missingTokens) {
    await prisma.bookingInvoice.update({ where: { id: inv.id }, data: { viewToken: newInvoiceViewToken() } });
  }
  for (const i of items) {
    await enqueueAccountingEvent(prisma, {
      orgId,
      locationId: i.locationId,
      sourceType: i.sourceType,
      sourceId: i.sourceId,
      sourceEvent: i.event ?? "sync",
      eventAt: i.eventAt,
    });
  }
  const batch = Math.min(Math.max(opts.batchSize ?? Number(process.env.ACCOUNTING_POSTING_BATCH_SIZE ?? 200), 1), 500);
  const limit = opts.inlineLimit ?? Number.POSITIVE_INFINITY;
  let processed = 0;
  while (processed < limit) {
    const r = await processPostingQueue({ orgId, limit: Math.min(batch, limit - processed) });
    processed += r.claimed;
    if (r.claimed === 0) break;
  }
  return { enqueued, processed };
}
