/**
 * Approval queue (maker-checker). Status lives on the owning document; this
 * table is the inbox + history. Decisions call back into the owning lib.
 */
import type { AccountingApprovalEntity, AccountingSettings } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { D, toApiString, type Dec } from "@/lib/accounting/money";
import { ctxHas, type AccountingCtx, type Db } from "@/lib/accounting/types";

export const APPROVE_PERMISSION: Record<AccountingApprovalEntity, string[]> = {
  journal_entry: ["accounting:journals_approve"],
  supplier_bill: ["accounting:payables_approve"],
  supplier_payment: ["accounting:payables_approve"],
  purchase_order: ["accounting:payables_approve"],
  expense: ["accounting:expenses_approve"],
  write_off: ["accounting:receivables_write", "accounting:journals_approve"],
};

export function canApprove(ctx: AccountingCtx, entity: AccountingApprovalEntity): boolean {
  return APPROVE_PERMISSION[entity].every((p) => ctxHas(ctx, p));
}

export function needsApproval(
  s: AccountingSettings,
  entity: AccountingApprovalEntity,
  amount: Dec
): boolean {
  const over = (t: unknown) => t != null && amount.greaterThanOrEqualTo(D(t as never));
  switch (entity) {
    case "journal_entry":
      return s.requireApprovalForManualJournals || over(s.manualJournalApprovalThreshold);
    case "supplier_bill":
    case "purchase_order":
      return over(s.billApprovalThreshold);
    case "supplier_payment":
      return over(s.supplierPaymentApprovalThreshold);
    case "expense":
      return over(s.expenseApprovalThreshold);
    case "write_off":
      return true;
  }
}

export async function requestApproval(
  db: Db,
  input: {
    orgId: string;
    entity: AccountingApprovalEntity;
    entityId: string;
    amount: Dec;
    requestedById: string;
    locationId?: string | null;
  }
) {
  await db.accountingApproval.updateMany({
    where: { orgId: input.orgId, entity: input.entity, entityId: input.entityId, status: "pending" },
    data: { status: "cancelled", decidedAt: new Date() },
  });
  const row = await db.accountingApproval.create({
    data: {
      orgId: input.orgId,
      entity: input.entity,
      entityId: input.entityId,
      amount: input.amount,
      requestedById: input.requestedById,
      locationId: input.locationId ?? null,
    },
  });
  // Fire after the outer transaction commits (microtask + tick).
  const orgId = input.orgId;
  const entity = input.entity;
  const entityId = input.entityId;
  const amount = toApiString(input.amount);
  const requestedById = input.requestedById;
  const locationId = input.locationId ?? null;
  setTimeout(() => {
    void import("@/lib/accounting/notifications")
      .then((n) =>
        n.notifyApprovalRequested({
          orgId,
          entity,
          entityId,
          amount,
          requestedById,
          locationId,
        })
      )
      .catch(() => undefined);
  }, 0);
  return row;
}

/** Owning libs call this when a document is approved/rejected directly. */
export async function markApprovalDecided(
  db: Db,
  input: {
    orgId: string;
    entity: AccountingApprovalEntity;
    entityId: string;
    status: "approved" | "rejected" | "cancelled";
    actorId: string | null;
    reason?: string | null;
  }
) {
  await db.accountingApproval.updateMany({
    where: { orgId: input.orgId, entity: input.entity, entityId: input.entityId, status: "pending" },
    data: {
      status: input.status,
      decidedById: input.actorId,
      decidedAt: new Date(),
      decisionReason: input.reason?.slice(0, 500) ?? null,
    },
  });
}

/** Maker-checker shared check (approver ≠ requester unless allowed). */
export function assertNotSelfApproval(s: AccountingSettings, makerId: string | null | undefined, actorId: string | null) {
  if (!s.allowSelfApproval && makerId && actorId && makerId === actorId) {
    throw acctError(ACCT.SELF_APPROVAL);
  }
}

export const decideSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((v) => v.decision === "approve" || (v.reason && v.reason.length >= 3), {
    message: "Reason is required to reject",
    path: ["reason"],
  });

export async function decideApproval(ctx: AccountingCtx, approvalId: string, raw: unknown) {
  const input = decideSchema.parse(raw);
  if (!isValidId(approvalId)) throw acctError(ACCT.NOT_FOUND);
  const approval = await prisma.accountingApproval.findFirst({ where: { id: approvalId, orgId: ctx.orgId } });
  if (!approval) throw acctError(ACCT.NOT_FOUND);
  if (!ctx.scope.allLocations && (!approval.locationId || !ctx.scope.locationIds.includes(approval.locationId))) {
    throw acctError(ACCT.NOT_FOUND);
  }
  if (!canApprove(ctx, approval.entity)) throw acctError(ACCT.APPROVAL_REQUIRED, { message: "Missing approval permission" });
  if (approval.status !== "pending") throw acctError(ACCT.JOURNAL_NOT_EDITABLE, { message: "Approval already decided" });
  const approve = input.decision === "approve";
  const reason = input.reason ?? null;
  switch (approval.entity) {
    case "journal_entry": {
      const j = await import("@/lib/accounting/journalEngine");
      if (approve) await j.approveJournal(ctx, approval.entityId);
      else await j.rejectJournal(ctx, approval.entityId, reason ?? "");
      break;
    }
    case "supplier_bill": {
      const b = await import("@/lib/accounting/payables/bills");
      if (approve) await b.approveBill(ctx, approval.entityId);
      else await b.rejectBill(ctx, approval.entityId, reason ?? "");
      break;
    }
    case "supplier_payment": {
      const p = await import("@/lib/accounting/payables/supplierPayments");
      if (approve) await p.approveSupplierPayment(ctx, approval.entityId);
      else await p.rejectSupplierPayment(ctx, approval.entityId, reason ?? "");
      break;
    }
    case "purchase_order": {
      const po = await import("@/lib/accounting/payables/purchaseOrders");
      if (approve) await po.approvePurchaseOrder(ctx, approval.entityId);
      else await po.rejectPurchaseOrder(ctx, approval.entityId, reason ?? "");
      break;
    }
    case "expense": {
      const e = await import("@/lib/accounting/expenses/expenses");
      if (approve) await e.approveExpense(ctx, approval.entityId);
      else await e.rejectExpense(ctx, approval.entityId, reason ?? "");
      break;
    }
    case "write_off": {
      const inv = await import("@/lib/accounting/receivables/manualInvoices");
      if (approve) await inv.applyApprovedWriteOff(ctx, approval.id);
      else await inv.rejectWriteOff(ctx, approval.id, reason ?? "");
      break;
    }
  }
  await markApprovalDecided(prisma, {
    orgId: ctx.orgId,
    entity: approval.entity,
    entityId: approval.entityId,
    status: approve ? "approved" : "rejected",
    actorId: ctx.actorId,
    reason,
  });
  void import("@/lib/accounting/notifications")
    .then((n) =>
      approve
        ? n.notifyApprovalApproved({
            orgId: ctx.orgId,
            entity: approval.entity,
            entityId: approval.entityId,
            requestedById: approval.requestedById,
            reason,
          })
        : n.notifyApprovalRejected({
            orgId: ctx.orgId,
            entity: approval.entity,
            entityId: approval.entityId,
            requestedById: approval.requestedById,
            reason,
          })
    )
    .catch(() => undefined);
  return { id: approval.id, status: approve ? "approved" : "rejected" };
}

export async function listPendingApprovals(ctx: AccountingCtx) {
  const entities = (Object.keys(APPROVE_PERMISSION) as AccountingApprovalEntity[]).filter((e) => canApprove(ctx, e));
  if (!entities.length) return [];
  const rows = await prisma.accountingApproval.findMany({
    where: {
      orgId: ctx.orgId,
      status: "pending",
      entity: { in: entities },
      ...(ctx.scope.allLocations ? {} : { locationId: { in: ctx.scope.locationIds } }),
    },
    orderBy: { requestedAt: "asc" },
    take: 500,
  });
  const ids = (e: AccountingApprovalEntity) => rows.filter((r) => r.entity === e).map((r) => r.entityId);
  const [journals, bills, payments, pos, expenses, invoices, users] = await Promise.all([
    prisma.journalEntry.findMany({ where: { id: { in: ids("journal_entry") } }, select: { id: true, number: true, memo: true } }),
    prisma.supplierBill.findMany({ where: { id: { in: ids("supplier_bill") } }, select: { id: true, number: true, supplierInvoiceNumber: true, supplier: { select: { name: true } } } }),
    prisma.supplierPayment.findMany({ where: { id: { in: ids("supplier_payment") } }, select: { id: true, number: true, supplier: { select: { name: true } } } }),
    prisma.purchaseOrder.findMany({ where: { id: { in: ids("purchase_order") } }, select: { id: true, number: true, supplier: { select: { name: true } } } }),
    prisma.expense.findMany({ where: { id: { in: ids("expense") } }, select: { id: true, number: true, description: true } }),
    prisma.bookingInvoice.findMany({ where: { id: { in: ids("write_off") } }, select: { id: true, number: true } }),
    prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.requestedById))].filter(isValidId) } },
      select: { id: true, firstName: true, lastName: true, email: true },
    }),
  ]);
  const label = new Map<string, string>();
  journals.forEach((j) => label.set(j.id, `${j.number}${j.memo ? ` — ${j.memo}` : ""}`));
  bills.forEach((b) => label.set(b.id, `${b.number} ${b.supplier.name}${b.supplierInvoiceNumber ? ` (${b.supplierInvoiceNumber})` : ""}`));
  payments.forEach((p) => label.set(p.id, `${p.number} ${p.supplier.name}`));
  pos.forEach((p) => label.set(p.id, `${p.number} ${p.supplier.name}`));
  expenses.forEach((e) => label.set(e.id, `${e.number} — ${e.description}`));
  invoices.forEach((i) => label.set(i.id, `Write-off ${i.number}`));
  const userName = new Map(users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email]));
  return rows.map((r) => ({
    id: r.id,
    entity: r.entity,
    entityId: r.entityId,
    label: label.get(r.entityId) ?? r.entityId,
    amount: toApiString(r.amount),
    requestedById: r.requestedById,
    requestedByName: userName.get(r.requestedById) ?? null,
    requestedAt: r.requestedAt.toISOString(),
    locationId: r.locationId,
    selfRequested: r.requestedById === ctx.actorId,
  }));
}
