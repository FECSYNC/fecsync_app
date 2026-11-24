/**
 * Accounting posting outbox. Source modules call enqueueAccountingEvent in
 * their own transaction; postings run after commit (flush) and on the hourly
 * cron. A posting failure never fails the source operation (R10).
 */
import { after } from "next/server";
import { randomUUID } from "crypto";
import type { AccountingPostingQueue, AccountingSourceType, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { acctError, ACCT, isAccountingError } from "@/lib/accounting/errors";
import { recordAccountingAudit } from "@/lib/accounting/audit";
import { getAccountingSettingsCached, isPostingEnabled } from "@/lib/accounting/settings";
import type { AccountingCtx, Db } from "@/lib/accounting/types";

const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000];
const STALE_PROCESSING_MS = 10 * 60_000;
const FAR_FUTURE = new Date("9999-01-01T00:00:00.000Z");

export type EnqueueInput = {
  orgId: string;
  locationId?: string | null;
  sourceType: AccountingSourceType;
  sourceId: string;
  sourceEvent?: string;
  eventAt?: Date;
  payload?: Record<string, unknown>;
};

/**
 * Upsert the outbox row (unique per source + event). Re-enqueue resets the row
 * to pending and bumps version so a concurrent processor re-runs it.
 * No-op when the org has not enabled accounting.
 */
export async function enqueueAccountingEvent(db: Db, input: EnqueueInput): Promise<void> {
  if (!input.orgId || !input.sourceId) return;
  const settings = await getAccountingSettingsCached(input.orgId);
  if (!settings || !settings.enabled) return;
  const eventAt = input.eventAt ?? new Date();
  const payload = JSON.stringify(input.payload ?? {});
  await db.$executeRaw`
    INSERT INTO "accounting_posting_queue"
      ("id", "orgId", "locationId", "sourceType", "sourceId", "sourceEvent", "payload", "eventAt",
       "status", "version", "attempts", "nextAttemptAt", "createdAt")
    VALUES
      (${randomUUID()}, ${input.orgId}, ${input.locationId ?? null},
       ${input.sourceType}::"AccountingSourceType", ${input.sourceId}, ${input.sourceEvent ?? "sync"},
       ${payload}::jsonb, ${eventAt}, 'pending'::"PostingQueueStatus", 0, 0, NOW(), NOW())
    ON CONFLICT ("orgId", "sourceType", "sourceId", "sourceEvent")
    DO UPDATE SET
      "status" = 'pending'::"PostingQueueStatus",
      "version" = "accounting_posting_queue"."version" + 1,
      "attempts" = 0,
      "nextAttemptAt" = NOW(),
      "eventAt" = EXCLUDED."eventAt",
      "payload" = EXCLUDED."payload",
      "skippedReason" = NULL,
      "skippedById" = NULL
  `;
}

/** Enqueue without letting accounting errors escape into the source flow. */
export async function enqueueAccountingEventSafe(db: Db, input: EnqueueInput): Promise<void> {
  try {
    await enqueueAccountingEvent(db, input);
  } catch (err) {
    console.error("[accounting] enqueue failed", input.sourceType, input.sourceId, err);
  }
}

/** Fire-and-forget processing after the response (cron is the safety net). */
export function flushAccountingQueueSoon(orgId: string | null | undefined): void {
  if (!orgId) return;
  const run = () =>
    processPostingQueue({ orgId, limit: 50 }).catch((err) =>
      console.error("[accounting] flush failed", err)
    );
  try {
    after(run);
  } catch {
    void Promise.resolve().then(run);
  }
}

/** Enqueue (prisma, after the source commit) + flush. For non-transactional source flows. */
export async function queueAccountingSync(input: EnqueueInput): Promise<void> {
  await enqueueAccountingEventSafe(prisma, input);
  flushAccountingQueueSoon(input.orgId);
}

type ClaimedRow = { id: string; version: number };

async function claimRows(orgId: string | null, limit: number): Promise<ClaimedRow[]> {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
  if (orgId) {
    return prisma.$queryRaw<ClaimedRow[]>`
      UPDATE "accounting_posting_queue" q
      SET "status" = 'processing'::"PostingQueueStatus", "processedAt" = NOW()
      WHERE q."id" IN (
        SELECT "id" FROM "accounting_posting_queue"
        WHERE "orgId" = ${orgId}
          AND (("status" IN ('pending', 'failed') AND "nextAttemptAt" <= NOW())
               OR ("status" = 'processing' AND "processedAt" < ${staleBefore}))
        ORDER BY "eventAt" ASC, "createdAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING q."id", q."version"
    `;
  }
  return prisma.$queryRaw<ClaimedRow[]>`
    UPDATE "accounting_posting_queue" q
    SET "status" = 'processing'::"PostingQueueStatus", "processedAt" = NOW()
    WHERE q."id" IN (
      SELECT "id" FROM "accounting_posting_queue"
      WHERE (("status" IN ('pending', 'failed') AND "nextAttemptAt" <= NOW())
             OR ("status" = 'processing' AND "processedAt" < ${staleBefore}))
      ORDER BY "eventAt" ASC, "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING q."id", q."version"
  `;
}

export type PostingOutcome = {
  journalEntryId?: string | null;
  skippedReason?: string;
  warningCode?: string | null;
};

async function finishRow(row: ClaimedRow, data: Prisma.AccountingPostingQueueUpdateManyMutationInput) {
  const res = await prisma.accountingPostingQueue.updateMany({
    where: { id: row.id, version: row.version, status: "processing" },
    data,
  });
  if (res.count === 0) {
    // Re-enqueued while processing: leave it pending for the next pass.
    await prisma.accountingPostingQueue.updateMany({
      where: { id: row.id, status: "processing" },
      data: { status: "pending", nextAttemptAt: new Date() },
    });
  }
}

export async function processOneRow(row: ClaimedRow): Promise<"posted" | "skipped" | "failed"> {
  const item = await prisma.accountingPostingQueue.findUnique({ where: { id: row.id } });
  if (!item) return "skipped";
  const settings = await prisma.accountingSettings.findUnique({ where: { orgId: item.orgId } });
  if (!settings || !isPostingEnabled(settings, item.eventAt)) {
    await finishRow(row, {
      status: "skipped",
      skippedReason: !settings?.enabled ? "accounting_disabled" : "before_go_live",
      processedAt: new Date(),
    });
    return "skipped";
  }
  try {
    const { dispatchPosting } = await import("@/lib/accounting/posting");
    const outcome = await prisma.$transaction(
      async (tx) => dispatchPosting(tx, settings, item),
      { maxWait: 15_000, timeout: 60_000 }
    );
    if (outcome.skippedReason) {
      await finishRow(row, {
        status: "skipped",
        skippedReason: outcome.skippedReason,
        warningCode: outcome.warningCode ?? null,
        processedAt: new Date(),
        errorCode: null,
        lastError: null,
      });
      return "skipped";
    }
    await finishRow(row, {
      status: "posted",
      journalEntryId: outcome.journalEntryId ?? null,
      warningCode: outcome.warningCode ?? null,
      processedAt: new Date(),
      errorCode: null,
      lastError: null,
    });
    return "posted";
  } catch (err) {
    const attempts = item.attempts + 1;
    const delay = BACKOFF_MS[attempts - 1];
    await finishRow(row, {
      status: "failed",
      attempts,
      errorCode: isAccountingError(err) ? err.code : "ACCT_POSTING_ERROR",
      lastError: (err instanceof Error ? err.message : String(err)).slice(0, 2000),
      nextAttemptAt: delay ? new Date(Date.now() + delay) : FAR_FUTURE,
      processedAt: new Date(),
    });
    return "failed";
  }
}

export async function processPostingQueue(opts: { orgId?: string | null; limit?: number } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const summary = { claimed: 0, posted: 0, skipped: 0, failed: 0 };
  const rows = await claimRows(opts.orgId ?? null, limit);
  summary.claimed = rows.length;
  for (const row of rows) {
    const result = await processOneRow(row);
    summary[result] += 1;
  }
  return summary;
}

export function toQueueDto(q: AccountingPostingQueue) {
  return {
    id: q.id,
    locationId: q.locationId,
    sourceType: q.sourceType,
    sourceId: q.sourceId,
    sourceEvent: q.sourceEvent,
    eventAt: q.eventAt.toISOString(),
    status: q.status,
    attempts: q.attempts,
    errorCode: q.errorCode,
    lastError: q.lastError,
    warningCode: q.warningCode,
    nextAttemptAt: q.nextAttemptAt.toISOString(),
    journalEntryId: q.journalEntryId,
    skippedReason: q.skippedReason,
    createdAt: q.createdAt.toISOString(),
    processedAt: q.processedAt?.toISOString() ?? null,
  };
}

export async function listQueue(
  ctx: AccountingCtx,
  filters: { status?: string; warningsOnly?: boolean; cursor?: string; limit?: number }
) {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const where: Prisma.AccountingPostingQueueWhereInput = { orgId: ctx.orgId };
  if (filters.status && ["pending", "processing", "posted", "skipped", "failed"].includes(filters.status)) {
    where.status = filters.status as never;
  }
  if (filters.warningsOnly) where.warningCode = { not: null };
  if (!ctx.scope.allLocations) where.locationId = { in: ctx.scope.locationIds };
  const rows = await prisma.accountingPostingQueue.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(filters.cursor && isValidId(filters.cursor) ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
  });
  const counts = await prisma.accountingPostingQueue.groupBy({
    by: ["status"],
    where: { orgId: ctx.orgId },
    _count: { _all: true },
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    items: page.map(toQueueDto),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
  };
}

async function loadQueueRow(ctx: AccountingCtx, id: string) {
  if (!isValidId(id)) throw acctError(ACCT.NOT_FOUND);
  const row = await prisma.accountingPostingQueue.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!row) throw acctError(ACCT.NOT_FOUND);
  return row;
}

export async function retryQueueItem(ctx: AccountingCtx, id: string) {
  const row = await loadQueueRow(ctx, id);
  await prisma.accountingPostingQueue.update({
    where: { id: row.id },
    data: {
      status: "pending",
      attempts: 0,
      nextAttemptAt: new Date(),
      version: { increment: 1 },
      skippedReason: null,
      skippedById: null,
    },
  });
  recordAccountingAudit(ctx, {
    action: "queue.retry",
    entityType: "JournalEntry",
    entityId: row.id,
    description: `Retry posting ${row.sourceType} ${row.sourceId}`,
  });
  await processPostingQueue({ orgId: ctx.orgId, limit: 20 });
  return toQueueDto(await loadQueueRow(ctx, id));
}

export async function skipQueueItem(ctx: AccountingCtx, id: string, reason: string) {
  const row = await loadQueueRow(ctx, id);
  if (row.status === "posted") throw acctError(ACCT.ALREADY_POSTED);
  const updated = await prisma.accountingPostingQueue.update({
    where: { id: row.id },
    data: {
      status: "skipped",
      skippedReason: reason.slice(0, 500),
      skippedById: ctx.actorId,
      processedAt: new Date(),
    },
  });
  recordAccountingAudit(ctx, {
    action: "queue.skip",
    entityType: "JournalEntry",
    entityId: row.id,
    description: `Skipped posting ${row.sourceType} ${row.sourceId}`,
    reason,
  });
  return toQueueDto(updated);
}
