/**
 * Accounting audit trail from ActivityLog (action prefix "accounting.").
 */
import type { ActivityEntityType, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { reportMeta, type ReportQuery } from "@/lib/accounting/reports/common";
import type { AccountingCtx } from "@/lib/accounting/types";

export const ACCOUNTING_ENTITY_TYPES: ActivityEntityType[] = [
  "LedgerAccount",
  "JournalEntry",
  "AccountingPeriod",
  "AccountingSettings",
  "AccountingMapping",
  "TaxCode",
  "Supplier",
  "PurchaseOrder",
  "SupplierBill",
  "SupplierPayment",
  "CustomerReceipt",
  "Expense",
  "BankAccount",
  "BankTransaction",
  "BankTransfer",
  "BankReconciliation",
  "InventoryMovement",
  "BookingInvoice",
];

export async function listAuditTrail(
  ctx: AccountingCtx,
  q: { entityType?: string | null; entityId?: string | null; userId?: string | null; from?: Date; to?: Date; cursor?: string | null; limit?: number }
) {
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
  const where: Prisma.ActivityLogWhereInput = {
    orgId: ctx.orgId,
    action: { startsWith: "accounting." },
  };
  if (q.entityType && (ACCOUNTING_ENTITY_TYPES as string[]).includes(q.entityType)) where.entityType = q.entityType as ActivityEntityType;
  if (q.entityId) where.entityId = q.entityId;
  if (q.userId && isValidId(q.userId)) where.userId = q.userId;
  if (q.from || q.to) where.createdAt = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
  const rows = await prisma.activityLog.findMany({
    where,
    include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(q.cursor && isValidId(q.cursor) ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    items: page.map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        description: r.description,
        actor: r.user ? { id: r.user.id, name: [r.user.firstName, r.user.lastName].filter(Boolean).join(" ") || r.user.email } : null,
        reason: typeof meta.reason === "string" ? meta.reason : null,
        diff: meta.diff ?? null,
        system: Boolean(meta.system),
        createdAt: r.createdAt.toISOString(),
      };
    }),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}

export async function auditTrailReport(ctx: AccountingCtx, q: ReportQuery, sp: URLSearchParams) {
  const data = await listAuditTrail(ctx, {
    entityType: sp.get("entityType"),
    entityId: sp.get("entityId"),
    userId: sp.get("userId"),
    from: q.from,
    to: q.to,
    cursor: sp.get("cursor"),
    limit: Math.min(q.limit, 500),
  });
  return { meta: await reportMeta(ctx, q, "Audit trail"), sections: [{ key: "events", title: "Events", rows: data.items }], nextCursor: data.nextCursor, totals: {} };
}
