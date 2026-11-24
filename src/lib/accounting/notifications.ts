/**
 * Accounting transactional notices (email via org-branded mailer, SMS via
 * sms.ts when configured, in-app NotificationType `accounting`).
 * A failed channel never fails the business action — failures go to ActivityLog.
 */
import type { AccountingApprovalEntity } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  brandSmtpReplyTo,
  guestMailConfigured,
  notificationTransporter,
  sanitizeSmtpDisplayName,
  wrapEmailHtml,
  type EmailBrandOptions,
} from "@/lib/mailer";
import { resolveBrandForOrg } from "@/lib/companyProfile";
import { sendSms, smsIsConfigured } from "@/lib/sms";
import { publicAppBaseUrl } from "@/lib/publicAppBaseUrl";
import { logActivityEntryAsync } from "@/lib/audit/activityLog";
import {
  effectiveMembershipPermissions,
  templatePermissionsForMembership,
} from "@/lib/membership";
import { hasPermission, P, type Permission } from "@/lib/auth/permissions";
import { createNotification } from "@/services/notificationService";
import { APPROVE_PERMISSION } from "@/lib/accounting/approvals";
import { consumeRateLimit } from "@/lib/rateLimit";
import { sendInvoiceMail } from "@/lib/sendInvoice";
import { toApiString, D } from "@/lib/accounting/money";

function esc(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function brandForOrg(orgId: string): Promise<EmailBrandOptions | null> {
  try {
    const brand = await resolveBrandForOrg(orgId);
    return {
      displayName: brand.displayName,
      logoUrl: brand.logoUrl,
      supportEmail: brand.supportEmail || brand.replyToEmail,
      replyToEmail: brand.replyToEmail || brand.supportEmail,
    };
  } catch {
    return null;
  }
}

function abs(path: string): string {
  return `${publicAppBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

async function logNotifyFailure(
  orgId: string,
  action: string,
  err: unknown,
  metadata?: Record<string, unknown>
): Promise<void> {
  await logActivityEntryAsync({
    orgId,
    action: `accounting.notify.${action}`,
    entityType: "AccountingSettings",
    entityId: orgId,
    description: err instanceof Error ? err.message.slice(0, 400) : "notify failed",
    metadata: { ...(metadata ?? {}), error: String(err).slice(0, 500) },
  }).catch(() => undefined);
}

async function sendAcctEmail(input: {
  orgId: string;
  to: string;
  subject: string;
  htmlBody: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
  label?: string;
}): Promise<boolean> {
  try {
    if (!guestMailConfigured() && !process.env.NOTIFICATION_EMAIL_USER?.trim()) {
      console.info(`[accounting] email_skipped:${input.label ?? "mail"}`);
      return false;
    }
    const brand = await brandForOrg(input.orgId);
    const displayName = brand?.displayName || "Company";
    const fromUser =
      process.env.NOTIFICATION_EMAIL_USER?.trim() ||
      process.env.TEAM_EMAIL_USER?.trim();
    if (!fromUser) {
      console.info(`[accounting] email_skipped:no_from`);
      return false;
    }
    const replyTo = brandSmtpReplyTo(brand);
    await notificationTransporter.sendMail({
      from: `"${sanitizeSmtpDisplayName(displayName)}" <${fromUser}>`,
      to: input.to,
      subject: input.subject,
      html: wrapEmailHtml(input.htmlBody, input.subject, brand),
      ...(replyTo ? { replyTo } : {}),
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType ?? "application/pdf",
      })),
    });
    return true;
  } catch (err) {
    await logNotifyFailure(input.orgId, input.label ?? "email", err, { to: input.to });
    return false;
  }
}

async function sendAcctSms(orgId: string, to: string | null | undefined, body: string, label: string): Promise<boolean> {
  const phone = to?.trim();
  if (!phone) return false;
  if (process.env.ACCOUNTING_SMS_REMINDERS !== "on") return false;
  if (!smsIsConfigured()) {
    console.info(`[accounting] sms_skipped:${label}`);
    return false;
  }
  try {
    await sendSms(phone, body);
    return true;
  } catch (err) {
    await logNotifyFailure(orgId, `sms.${label}`, err, { to: phone });
    return false;
  }
}

async function inApp(
  userId: string | null | undefined,
  title: string,
  message: string,
  metadata: Record<string, unknown>
): Promise<void> {
  if (!userId) return;
  try {
    await createNotification(userId, title, message, "accounting", metadata);
  } catch (err) {
    console.error("[accounting] in-app notify failed:", err);
  }
}

/** Active staff members in org who hold every listed permission (preset / template / override). */
export async function findStaffWithPermissions(
  orgId: string,
  needed: string[],
  opts?: { excludeUserId?: string | null; locationId?: string | null }
): Promise<Array<{ userId: string; email: string | null; name: string }>> {
  const members = await prisma.membership.findMany({
    where: { orgId, status: "active" },
    select: {
      userId: true,
      rolePreset: true,
      roleTemplateId: true,
      permissionsOverride: true,
      venueAssignments: { select: { locationId: true } },
      user: { select: { email: true, firstName: true, lastName: true } },
    },
    take: 500,
  });
  const out: Array<{ userId: string; email: string | null; name: string }> = [];
  for (const m of members) {
    if (opts?.excludeUserId && m.userId === opts.excludeUserId) continue;
    if (opts?.locationId && m.venueAssignments.length > 0) {
      if (!m.venueAssignments.some((a) => a.locationId === opts.locationId)) continue;
    }
    const templatePermissions = await templatePermissionsForMembership({
      orgId,
      roleTemplateId: m.roleTemplateId,
    });
    const perms = effectiveMembershipPermissions({
      rolePreset: String(m.rolePreset ?? ""),
      permissionsOverride: m.permissionsOverride,
      templatePermissions,
    });
    if (!needed.every((p) => hasPermission(perms, p as Permission))) continue;
    const name =
      [m.user.firstName, m.user.lastName].filter(Boolean).join(" ").trim() ||
      m.user.email ||
      "Team member";
    out.push({ userId: m.userId, email: m.user.email, name });
  }
  return out;
}

function entityLabel(entity: AccountingApprovalEntity): string {
  switch (entity) {
    case "journal_entry":
      return "journal entry";
    case "supplier_bill":
      return "supplier bill";
    case "supplier_payment":
      return "supplier payment";
    case "purchase_order":
      return "purchase order";
    case "expense":
      return "expense";
    case "write_off":
      return "write-off";
    default:
      return "document";
  }
}

function approvalHref(entity: AccountingApprovalEntity, entityId: string): string {
  switch (entity) {
    case "journal_entry":
      return `/admin/accounting/journals/${entityId}`;
    case "supplier_bill":
      return `/admin/accounting/bills/${entityId}`;
    case "supplier_payment":
      return `/admin/accounting/supplier-payments/${entityId}`;
    case "purchase_order":
      return `/admin/accounting/purchase-orders/${entityId}`;
    case "expense":
      return `/admin/accounting/expenses/${entityId}`;
    case "write_off":
      return `/admin/accounting/invoices/${entityId}`;
    default:
      return "/admin/accounting/approvals";
  }
}

export async function notifyApprovalRequested(input: {
  orgId: string;
  entity: AccountingApprovalEntity;
  entityId: string;
  amount: string;
  requestedById: string;
  locationId?: string | null;
  label?: string;
}): Promise<void> {
  try {
    const needed = APPROVE_PERMISSION[input.entity];
    const staff = await findStaffWithPermissions(input.orgId, needed, {
      excludeUserId: input.requestedById,
      locationId: input.locationId,
    });
    const title = "Approval requested";
    const label = input.label ?? entityLabel(input.entity);
    const message = `${label} (${input.amount}) needs your approval`;
    const href = "/admin/accounting/approvals";
    const deep = approvalHref(input.entity, input.entityId);
    for (const s of staff) {
      await inApp(s.userId, title, message, {
        event: "approval_requested",
        entity: input.entity,
        entityId: input.entityId,
        href,
        deepHref: deep,
      });
      if (s.email) {
        await sendAcctEmail({
          orgId: input.orgId,
          to: s.email,
          subject: `${title} — ${label}`,
          htmlBody: `<h1>${esc(title)}</h1><p>Hi ${esc(s.name.split(" ")[0])},</p><p>${esc(message)}.</p><p><a href="${esc(abs(href))}" class="button">Open approvals</a></p>`,
          label: "approval_requested",
        });
      }
    }
  } catch (err) {
    await logNotifyFailure(input.orgId, "approval_requested", err, { entityId: input.entityId });
  }
}

export async function notifyApprovalApproved(input: {
  orgId: string;
  entity: AccountingApprovalEntity;
  entityId: string;
  requestedById: string | null;
  reason?: string | null;
  label?: string;
}): Promise<void> {
  try {
    if (!input.requestedById) return;
    const label = input.label ?? entityLabel(input.entity);
    const title = "Approved";
    const message = `Your ${label} was approved${input.reason ? `: ${input.reason}` : ""}`;
    const href = approvalHref(input.entity, input.entityId);
    await inApp(input.requestedById, title, message, {
      event: "approval_approved",
      entity: input.entity,
      entityId: input.entityId,
      href,
    });
    const user = await prisma.user.findUnique({
      where: { id: input.requestedById },
      select: { email: true, firstName: true },
    });
    if (user?.email) {
      await sendAcctEmail({
        orgId: input.orgId,
        to: user.email,
        subject: `${title} — ${label}`,
        htmlBody: `<h1>${esc(title)}</h1><p>Hi ${esc(user.firstName || "there")},</p><p>${esc(message)}.</p><p><a href="${esc(abs(href))}" class="button">View</a></p>`,
        label: "approval_approved",
      });
    }
  } catch (err) {
    await logNotifyFailure(input.orgId, "approval_approved", err, { entityId: input.entityId });
  }
}

export async function notifyApprovalRejected(input: {
  orgId: string;
  entity: AccountingApprovalEntity;
  entityId: string;
  requestedById: string | null;
  reason?: string | null;
  label?: string;
}): Promise<void> {
  try {
    if (!input.requestedById) return;
    const label = input.label ?? entityLabel(input.entity);
    const title = "Rejected";
    const message = `Your ${label} was rejected${input.reason ? `: ${input.reason}` : ""}`;
    const href = approvalHref(input.entity, input.entityId);
    await inApp(input.requestedById, title, message, {
      event: "approval_rejected",
      entity: input.entity,
      entityId: input.entityId,
      href,
    });
    const user = await prisma.user.findUnique({
      where: { id: input.requestedById },
      select: { email: true, firstName: true },
    });
    if (user?.email) {
      await sendAcctEmail({
        orgId: input.orgId,
        to: user.email,
        subject: `${title} — ${label}`,
        htmlBody: `<h1>${esc(title)}</h1><p>Hi ${esc(user.firstName || "there")},</p><p>${esc(message)}.</p><p><a href="${esc(abs(href))}" class="button">View</a></p>`,
        label: "approval_rejected",
      });
    }
  } catch (err) {
    await logNotifyFailure(input.orgId, "approval_rejected", err, { entityId: input.entityId });
  }
}

export async function notifyExpenseSubmitted(expenseId: string): Promise<void> {
  try {
    const e = await prisma.expense.findUnique({
      where: { id: expenseId },
      select: {
        id: true,
        orgId: true,
        number: true,
        submittedById: true,
      },
    });
    if (!e) return;
    // Approver fan-out comes from requestApproval → notifyApprovalRequested.
    if (e.submittedById) {
      await inApp(e.submittedById, "Expense submitted", `${e.number} submitted for approval`, {
        event: "expense_submitted",
        expenseId: e.id,
        href: `/admin/accounting/expenses/${e.id}`,
      });
    }
  } catch (err) {
    console.error("[accounting] notifyExpenseSubmitted", err);
  }
}

export async function notifyExpenseApproved(expenseId: string): Promise<void> {
  try {
    const e = await prisma.expense.findUnique({
      where: { id: expenseId },
      select: { id: true, orgId: true, number: true, submittedById: true, createdById: true },
    });
    if (!e) return;
    const to = e.submittedById ?? e.createdById;
    await inApp(to, "Expense approved", `${e.number} was approved`, {
      event: "expense_approved",
      expenseId: e.id,
      href: `/admin/accounting/expenses/${e.id}`,
    });
    if (to) {
      const user = await prisma.user.findUnique({ where: { id: to }, select: { email: true, firstName: true } });
      if (user?.email) {
        await sendAcctEmail({
          orgId: e.orgId,
          to: user.email,
          subject: `Expense ${e.number} approved`,
          htmlBody: `<h1>Expense approved</h1><p>Hi ${esc(user.firstName || "there")},</p><p>Expense <strong>${esc(e.number)}</strong> was approved.</p>`,
          label: "expense_approved",
        });
      }
    }
  } catch (err) {
    console.error("[accounting] notifyExpenseApproved", err);
  }
}

export async function notifyExpenseRejected(expenseId: string, reason?: string | null): Promise<void> {
  try {
    const e = await prisma.expense.findUnique({
      where: { id: expenseId },
      select: { id: true, orgId: true, number: true, submittedById: true, createdById: true },
    });
    if (!e) return;
    const to = e.submittedById ?? e.createdById;
    const msg = `${e.number} was rejected${reason ? `: ${reason}` : ""}`;
    await inApp(to, "Expense rejected", msg, {
      event: "expense_rejected",
      expenseId: e.id,
      href: `/admin/accounting/expenses/${e.id}`,
    });
    if (to) {
      const user = await prisma.user.findUnique({ where: { id: to }, select: { email: true, firstName: true } });
      if (user?.email) {
        await sendAcctEmail({
          orgId: e.orgId,
          to: user.email,
          subject: `Expense ${e.number} rejected`,
          htmlBody: `<h1>Expense rejected</h1><p>Hi ${esc(user.firstName || "there")},</p><p>${esc(msg)}.</p>`,
          label: "expense_rejected",
        });
      }
    }
  } catch (err) {
    console.error("[accounting] notifyExpenseRejected", err);
  }
}

export async function notifyExpenseReimbursed(expenseId: string): Promise<void> {
  try {
    const e = await prisma.expense.findUnique({
      where: { id: expenseId },
      select: {
        id: true,
        orgId: true,
        number: true,
        amount: true,
        currency: true,
        employeeUserId: true,
        submittedById: true,
        createdById: true,
      },
    });
    if (!e) return;
    const to = e.employeeUserId ?? e.submittedById ?? e.createdById;
    const msg = `${e.number} reimbursed (${toApiString(e.amount)} ${e.currency})`;
    await inApp(to, "Expense reimbursed", msg, {
      event: "expense_reimbursed",
      expenseId: e.id,
      href: `/admin/accounting/expenses/${e.id}`,
    });
    if (to) {
      const user = await prisma.user.findUnique({ where: { id: to }, select: { email: true, firstName: true } });
      if (user?.email) {
        await sendAcctEmail({
          orgId: e.orgId,
          to: user.email,
          subject: `Expense ${e.number} reimbursed`,
          htmlBody: `<h1>Reimbursed</h1><p>Hi ${esc(user.firstName || "there")},</p><p>${esc(msg)}.</p>`,
          label: "expense_reimbursed",
        });
      }
    }
  } catch (err) {
    console.error("[accounting] notifyExpenseReimbursed", err);
  }
}

export async function notifyManualInvoiceIssued(invoiceId: string): Promise<void> {
  try {
    const inv = await prisma.bookingInvoice.findUnique({
      where: { id: invoiceId },
      include: { lines: { orderBy: { lineNo: "asc" } } },
    });
    if (!inv || inv.kind === "booking") return;
    const to = inv.customerEmail?.trim();
    if (!to) return;
    const token = inv.viewToken;
    const payUrl = token ? abs(`/invoice/${token}`) : null;
    const items = inv.lines.map((l) => ({
      product: { name: l.description, price: Number(l.unitPrice.toString()) },
      quantity: Number(l.qty.toString()),
    }));
    try {
      await sendInvoiceMail({
        to,
        subject: `${inv.kind === "credit_note" ? "Credit note" : "Invoice"} ${inv.number}`,
        orgId: inv.orgId,
        data: {
          customerName: inv.customerName || "Customer",
          invoiceId: inv.number,
          items: items.length
            ? items
            : [{ product: { name: inv.kind === "credit_note" ? "Credit note" : "Invoice", price: Number(inv.amount.toString()) }, quantity: 1 }],
          totalAmount: Number(inv.amountDue.toString() || inv.amount.toString()),
          dueDate: inv.dueAt?.toISOString().slice(0, 10) ?? "",
          date: (inv.issueDate ?? inv.createdAt).toISOString().slice(0, 10),
          paymentMethod: "Invoice",
          payUrl,
        },
      });
    } catch (err) {
      await logNotifyFailure(inv.orgId, "manual_invoice", err, { invoiceId });
      if (payUrl) {
        await sendAcctEmail({
          orgId: inv.orgId,
          to,
          subject: `Invoice ${inv.number}`,
          htmlBody: `<h1>Invoice ${esc(inv.number)}</h1><p>Hi ${esc((inv.customerName || "Customer").split(" ")[0])},</p><p>Your invoice is ready. Amount due: <strong>${esc(toApiString(inv.amountDue))}</strong>.</p><p><a href="${esc(payUrl)}" class="button">View invoice</a></p>`,
          label: "manual_invoice_fallback",
        });
      }
    }
  } catch (err) {
    console.error("[accounting] notifyManualInvoiceIssued", err);
  }
}

/** One reminder offset per invoice (uses lastReminderAt + reminderCount). */
export async function sendInvoiceReminderForOffset(input: {
  orgId: string;
  invoiceId: string;
  offsetDays: number;
}): Promise<{ sent: boolean; reason?: string }> {
  try {
    const inv = await prisma.bookingInvoice.findFirst({
      where: {
        id: input.invoiceId,
        orgId: input.orgId,
        kind: "manual",
        status: { in: ["sent", "overdue"] },
        amountDue: { gt: 0 },
        writtenOffAt: null,
      },
    });
    if (!inv) return { sent: false, reason: "not_due" };
    const to = inv.customerEmail?.trim();
    if (!to) return { sent: false, reason: "no_email" };
    const payUrl = inv.viewToken ? abs(`/invoice/${inv.viewToken}`) : abs(`/admin/accounting/invoices/${inv.id}`);
    const subject =
      input.offsetDays < 0
        ? `Reminder: invoice ${inv.number} due soon`
        : input.offsetDays === 0
          ? `Invoice ${inv.number} is due today`
          : `Overdue: invoice ${inv.number}`;
    const sent = await sendAcctEmail({
      orgId: input.orgId,
      to,
      subject,
      htmlBody: `<h1>${esc(subject)}</h1><p>Hi ${esc((inv.customerName || "Customer").split(" ")[0])},</p><p>Amount due: <strong>${esc(toApiString(inv.amountDue))} ${esc(inv.currency)}</strong>.</p><p><a href="${esc(payUrl)}" class="button">Pay invoice</a></p>`,
      label: "invoice_reminder",
    });
    let phone: string | null = null;
    if (inv.guestProfileId) {
      const g = await prisma.guestProfile.findUnique({ where: { id: inv.guestProfileId }, select: { phone: true } });
      phone = g?.phone ?? null;
    } else if (inv.customerUserId) {
      const u = await prisma.user.findUnique({
        where: { id: inv.customerUserId },
        select: { phoneNumber: true },
      });
      phone = u?.phoneNumber ?? null;
    }
    await sendAcctSms(
      input.orgId,
      phone,
      `Invoice ${inv.number}: ${toApiString(inv.amountDue)} ${inv.currency} due. ${payUrl}`,
      "invoice_reminder"
    );
    return { sent };
  } catch (err) {
    await logNotifyFailure(input.orgId, "invoice_reminder", err, { invoiceId: input.invoiceId });
    return { sent: false, reason: "error" };
  }
}

export async function notifyCustomerStatementSent(input: {
  orgId: string;
  partyKey: string;
  email: string;
  token: string;
  pdf?: Buffer | null;
}): Promise<boolean> {
  try {
    const rl = consumeRateLimit(`acct:statement:${input.orgId}:${input.email.toLowerCase()}`, 3, 86_400_000);
    if (!rl.allowed) return false;
    const link = abs(`/statement/${input.token}`);
    return sendAcctEmail({
      orgId: input.orgId,
      to: input.email,
      subject: "Your account statement",
      htmlBody: `<h1>Account statement</h1><p>Your statement is ready.</p><p><a href="${esc(link)}" class="button">View statement</a></p>`,
      attachments: input.pdf
        ? [{ filename: "statement.pdf", content: input.pdf, contentType: "application/pdf" }]
        : undefined,
      label: "customer_statement",
    });
  } catch (err) {
    await logNotifyFailure(input.orgId, "customer_statement", err, { partyKey: input.partyKey });
    return false;
  }
}

export async function notifyPurchaseOrderSent(poId: string, pdf?: Buffer | null): Promise<void> {
  try {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { supplier: { select: { email: true, name: true } }, lines: { orderBy: { lineNo: "asc" } } },
    });
    if (!po?.supplier.email) return;
    let buf = pdf ?? null;
    if (!buf) {
      try {
        const { renderPurchaseOrderPdf } = await import("@/lib/accounting/export/pdf");
        buf = await renderPurchaseOrderPdf(po.orgId, po.id);
      } catch {
        buf = null;
      }
    }
    await sendAcctEmail({
      orgId: po.orgId,
      to: po.supplier.email,
      subject: `Purchase order ${po.number}`,
      htmlBody: `<h1>Purchase order ${esc(po.number)}</h1><p>Hi ${esc(po.supplier.name)},</p><p>Please find purchase order <strong>${esc(po.number)}</strong> attached.</p>`,
      attachments: buf ? [{ filename: `${po.number}.pdf`, content: buf }] : undefined,
      label: "po_sent",
    });
  } catch (err) {
    console.error("[accounting] notifyPurchaseOrderSent", err);
  }
}

export async function notifySupplierRemittance(paymentId: string, pdf?: Buffer | null): Promise<void> {
  try {
    const p = await prisma.supplierPayment.findUnique({
      where: { id: paymentId },
      include: {
        supplier: { select: { email: true, name: true } },
        allocations: { include: { bill: { select: { number: true, supplierInvoiceNumber: true } } } },
      },
    });
    if (!p?.supplier.email || p.status !== "posted") return;
    let buf = pdf ?? null;
    if (!buf) {
      try {
        const { renderRemittancePdf } = await import("@/lib/accounting/export/pdf");
        buf = await renderRemittancePdf(p.orgId, p.id);
      } catch {
        buf = null;
      }
    }
    const rows = p.allocations
      .map(
        (a) =>
          `<tr><td>${esc(a.bill.number)}</td><td>${esc(a.bill.supplierInvoiceNumber || "")}</td><td style="text-align:right;">${esc(toApiString(a.amount))}</td></tr>`
      )
      .join("");
    const sent = await sendAcctEmail({
      orgId: p.orgId,
      to: p.supplier.email,
      subject: `Remittance advice ${p.number}`,
      htmlBody: `<h1>Remittance ${esc(p.number)}</h1><p>Hi ${esc(p.supplier.name)},</p><p>Payment of <strong>${esc(toApiString(p.amount))} ${esc(p.currency)}</strong> has been applied:</p><table width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse;"><thead><tr><th align="left">Bill</th><th align="left">Supplier inv</th><th align="right">Amount</th></tr></thead><tbody>${rows}</tbody></table>`,
      attachments: buf ? [{ filename: `remittance-${p.number}.pdf`, content: buf }] : undefined,
      label: "remittance",
    });
    if (sent) {
      await prisma.supplierPayment.update({
        where: { id: p.id },
        data: { remittanceSentAt: new Date() },
      });
    }
  } catch (err) {
    console.error("[accounting] notifySupplierRemittance", err);
  }
}

export async function notifyBillsDueDigest(orgId: string, bills: Array<{ id: string; number: string; dueDate: Date; amountDue: unknown; supplierName: string }>): Promise<void> {
  try {
    if (!bills.length) return;
    const staff = await findStaffWithPermissions(orgId, [P.AccountingPayablesWrite]);
    const lines = bills
      .slice(0, 25)
      .map(
        (b) =>
          `<li><a href="${esc(abs(`/admin/accounting/bills/${b.id}`))}">${esc(b.number)}</a> — ${esc(b.supplierName)} due ${esc(b.dueDate.toISOString().slice(0, 10))} (${esc(toApiString(D(b.amountDue as never)))})</li>`
      )
      .join("");
    const title = "Bills due soon";
    const message = `${bills.length} bill(s) approaching due date`;
    for (const s of staff) {
      await inApp(s.userId, title, message, { event: "bills_due_digest", href: "/admin/accounting/bills" });
      if (s.email) {
        await sendAcctEmail({
          orgId,
          to: s.email,
          subject: title,
          htmlBody: `<h1>${esc(title)}</h1><p>Hi ${esc(s.name.split(" ")[0])},</p><ul>${lines}</ul>`,
          label: "bills_due",
        });
      }
    }
  } catch (err) {
    await logNotifyFailure(orgId, "bills_due", err);
  }
}

export async function notifyPostingExceptionsDigest(
  orgId: string,
  summary: { failed: number; suspense: string }
): Promise<void> {
  try {
    if (summary.failed <= 0 && !(Number(summary.suspense) > 0)) return;
    const staff = await findStaffWithPermissions(orgId, [P.AccountingManage]);
    const title = "Accounting posting exceptions";
    const message = `${summary.failed} failed queue item(s); suspense balance ${summary.suspense}`;
    for (const s of staff) {
      await inApp(s.userId, title, message, {
        event: "posting_exceptions_digest",
        href: "/admin/accounting/posting-queue",
      });
      if (s.email) {
        await sendAcctEmail({
          orgId,
          to: s.email,
          subject: title,
          htmlBody: `<h1>${esc(title)}</h1><p>${esc(message)}.</p><p><a href="${esc(abs("/admin/accounting/posting-queue"))}" class="button">Review queue</a></p>`,
          label: "posting_exceptions",
        });
      }
    }
  } catch (err) {
    await logNotifyFailure(orgId, "posting_exceptions", err);
  }
}

export async function notifyPeriodReadyToClose(
  orgId: string,
  periods: Array<{ id: string; fiscalYear: number; periodNumber: number }>
): Promise<void> {
  try {
    if (!periods.length) return;
    const staff = await findStaffWithPermissions(orgId, [P.AccountingPeriodsClose]);
    for (const p of periods) {
      const title = "Period ready to close";
      const message = `FY${p.fiscalYear} P${p.periodNumber} ended more than 5 days ago and is still open`;
      for (const s of staff) {
        await inApp(s.userId, title, message, {
          event: "period_ready_to_close",
          periodId: p.id,
          href: "/admin/accounting/periods",
        });
      }
    }
  } catch (err) {
    await logNotifyFailure(orgId, "period_ready", err);
  }
}

export async function notifyBankUnreconciled(
  orgId: string,
  accounts: Array<{ id: string; name: string; days: number }>
): Promise<void> {
  try {
    if (!accounts.length) return;
    const staff = await findStaffWithPermissions(orgId, [P.AccountingReconcile]);
    for (const a of accounts) {
      const title = "Bank account needs reconciliation";
      const message = `${a.name} has not been reconciled for ${a.days} days`;
      for (const s of staff) {
        await inApp(s.userId, title, message, {
          event: "bank_unreconciled",
          bankAccountId: a.id,
          href: `/admin/accounting/banking/${a.id}`,
        });
      }
    }
  } catch (err) {
    await logNotifyFailure(orgId, "bank_unreconciled", err);
  }
}

/** Fire-and-forget wrapper — never rejects to callers. */
export function fireAndForget(task: Promise<unknown>): void {
  void task.catch((err) => console.error("[accounting] notify ff", err));
}
