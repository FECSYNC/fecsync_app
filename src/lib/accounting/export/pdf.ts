/**
 * Accounting PDF documents (pdfkit). Text is escaped for control chars;
 * bank ciphertext / secrets are never included.
 */
import PDFDocument from "pdfkit";
import prisma from "@/lib/prisma";
import { toApiString } from "@/lib/accounting/money";
import { resolveBrandForOrg } from "@/lib/companyProfile";
import { buildCustomerStatement, buildSupplierStatement } from "@/lib/accounting/receivables/statements";
import { systemCtx, type AccountingCtx } from "@/lib/accounting/types";
import { runReport } from "@/lib/accounting/reports/index";

function safeText(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .slice(0, 2000);
}

async function companyTitle(orgId: string): Promise<string> {
  const brand = await resolveBrandForOrg(orgId).catch(() => null);
  return brand?.displayName || "Company";
}

function pdfBuffer(build: (doc: PDFKit.PDFDocument) => void | Promise<void>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    Promise.resolve(build(doc))
      .then(() => doc.end())
      .catch(reject);
  });
}

function writeHeader(doc: PDFKit.PDFDocument, company: string, title: string) {
  doc.fontSize(16).fillColor("#1f2937").text(safeText(company), { align: "left" });
  doc.fontSize(12).fillColor("#D4AF37").text(safeText(title), { align: "left" });
  doc.moveDown(0.5);
  doc.fillColor("#111827");
}

function moneyRow(doc: PDFKit.PDFDocument, label: string, value: string) {
  doc.fontSize(10).text(`${safeText(label)}: ${safeText(value)}`);
}

export async function renderInvoicePdf(orgId: string, invoiceId: string): Promise<Buffer> {
  const inv = await prisma.bookingInvoice.findFirst({
    where: { id: invoiceId, orgId },
    include: { lines: { orderBy: { lineNo: "asc" } }, location: { select: { name: true } } },
  });
  if (!inv) throw new Error("Invoice not found");
  const company = await companyTitle(orgId);
  return pdfBuffer((doc) => {
    writeHeader(doc, company, inv.kind === "credit_note" ? `Credit note ${inv.number}` : `Invoice ${inv.number}`);
    doc.fontSize(10).text(`Customer: ${safeText(inv.customerName)}`);
    doc.text(`Email: ${safeText(inv.customerEmail)}`);
    doc.text(`Issue date: ${safeText((inv.issueDate ?? inv.createdAt).toISOString().slice(0, 10))}`);
    if (inv.dueAt) doc.text(`Due: ${inv.dueAt.toISOString().slice(0, 10)}`);
    doc.text(`Venue: ${safeText(inv.location?.name)}`);
    doc.text(`Status: ${safeText(inv.status)}`);
    doc.moveDown();
    doc.fontSize(10).text("Lines", { underline: true });
    for (const l of inv.lines) {
      doc.text(
        `${l.lineNo}. ${safeText(l.description)}  qty ${toApiString(l.qty)} × ${toApiString(l.unitPrice)} = ${toApiString(l.lineTotal)}`
      );
    }
    doc.moveDown();
    moneyRow(doc, "Subtotal", toApiString(inv.subtotal));
    moneyRow(doc, "Tax", toApiString(inv.taxTotal));
    moneyRow(doc, "Total", toApiString(inv.amount));
    moneyRow(doc, "Paid", toApiString(inv.amountPaid));
    moneyRow(doc, "Amount due", toApiString(inv.amountDue));
  });
}

export async function renderCreditNotePdf(orgId: string, invoiceId: string): Promise<Buffer> {
  return renderInvoicePdf(orgId, invoiceId);
}

export async function renderCustomerStatementPdf(
  orgId: string,
  partyKey: string,
  from: Date,
  to: Date
): Promise<Buffer> {
  const stmt = await buildCustomerStatement(systemCtx(orgId), partyKey, from, to);
  const company = await companyTitle(orgId);
  return pdfBuffer((doc) => {
    writeHeader(doc, company, "Customer statement");
    doc.fontSize(10).text(`Customer: ${safeText(stmt.customer.name)}`);
    doc.text(`Period: ${safeText(stmt.from.slice(0, 10))} — ${safeText(stmt.to.slice(0, 10))}`);
    moneyRow(doc, "Opening", stmt.openingBalance);
    doc.moveDown(0.5);
    for (const line of stmt.items.slice(0, 200)) {
      doc
        .fontSize(9)
        .text(
          `${safeText(line.date.slice(0, 10))}  ${safeText(line.entryNumber)}  ${safeText(line.description)}  ${safeText(line.charges)} / ${safeText(line.credits)}  bal ${safeText(line.balance)}`
        );
    }
    doc.moveDown();
    moneyRow(doc, "Closing", stmt.closingBalance);
    if (stmt.footer) {
      doc.moveDown();
      doc.fontSize(8).fillColor("#6b7280").text(safeText(stmt.footer));
    }
  });
}

export async function renderSupplierStatementPdf(
  orgId: string,
  supplierId: string,
  from: Date,
  to: Date
): Promise<Buffer> {
  const stmt = await buildSupplierStatement(systemCtx(orgId), supplierId, from, to);
  const company = await companyTitle(orgId);
  return pdfBuffer((doc) => {
    writeHeader(doc, company, "Supplier statement");
    doc.fontSize(10).text(`Supplier: ${safeText(stmt.supplier.name)} (${safeText(stmt.supplier.code)})`);
    doc.text(`Period: ${safeText(stmt.from.slice(0, 10))} — ${safeText(stmt.to.slice(0, 10))}`);
    moneyRow(doc, "Opening", stmt.openingBalance);
    for (const line of stmt.items.slice(0, 200)) {
      doc
        .fontSize(9)
        .text(
          `${safeText(line.date.slice(0, 10))}  ${safeText(line.entryNumber)}  ${safeText(line.description)}  ${safeText(line.charges)} / ${safeText(line.credits)}`
        );
    }
    moneyRow(doc, "Closing", stmt.closingBalance);
  });
}

export async function renderPurchaseOrderPdf(orgId: string, poId: string): Promise<Buffer> {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: poId, orgId },
    include: {
      supplier: true,
      lines: { orderBy: { lineNo: "asc" } },
      location: { select: { name: true } },
    },
  });
  if (!po) throw new Error("PO not found");
  const company = await companyTitle(orgId);
  return pdfBuffer((doc) => {
    writeHeader(doc, company, `Purchase order ${po.number}`);
    doc.fontSize(10).text(`Supplier: ${safeText(po.supplier.name)}`);
    doc.text(`Email: ${safeText(po.supplier.email)}`);
    doc.text(`Order date: ${po.orderDate.toISOString().slice(0, 10)}`);
    doc.text(`Venue: ${safeText(po.location?.name)}`);
    doc.moveDown();
    for (const l of po.lines) {
      doc.text(
        `${l.lineNo}. ${safeText(l.description)}  qty ${toApiString(l.qty)} × ${toApiString(l.unitCost)} = ${toApiString(l.lineTotal)}`
      );
    }
    doc.moveDown();
    moneyRow(doc, "Subtotal", toApiString(po.subtotal));
    moneyRow(doc, "Tax", toApiString(po.taxTotal));
    moneyRow(doc, "Total", toApiString(po.total));
    if (po.notes) {
      doc.moveDown();
      doc.fontSize(9).text(`Notes: ${safeText(po.notes)}`);
    }
  });
}

export async function renderRemittancePdf(orgId: string, paymentId: string): Promise<Buffer> {
  const p = await prisma.supplierPayment.findFirst({
    where: { id: paymentId, orgId },
    include: {
      supplier: { select: { name: true, email: true } },
      allocations: { include: { bill: { select: { number: true, supplierInvoiceNumber: true } } } },
      bankAccount: { select: { name: true, accountLast4: true } },
    },
  });
  if (!p) throw new Error("Payment not found");
  const company = await companyTitle(orgId);
  return pdfBuffer((doc) => {
    writeHeader(doc, company, `Remittance ${p.number}`);
    doc.fontSize(10).text(`Supplier: ${safeText(p.supplier.name)}`);
    doc.text(`Payment date: ${p.paymentDate.toISOString().slice(0, 10)}`);
    doc.text(`Method: ${safeText(p.method)}`);
    doc.text(
      `Bank: ${safeText(p.bankAccount.name)}${p.bankAccount.accountLast4 ? ` ••••${p.bankAccount.accountLast4}` : ""}`
    );
    moneyRow(doc, "Amount", `${toApiString(p.amount)} ${p.currency}`);
    doc.moveDown();
    doc.text("Allocations", { underline: true });
    for (const a of p.allocations) {
      doc.text(
        `${safeText(a.bill.number)} (${safeText(a.bill.supplierInvoiceNumber || "")}) — ${toApiString(a.amount)}`
      );
    }
  });
}

export async function renderJournalVoucherPdf(orgId: string, entryId: string): Promise<Buffer> {
  const entry = await prisma.journalEntry.findFirst({
    where: { id: entryId, orgId },
    include: {
      lines: {
        orderBy: { lineNo: "asc" },
        include: { account: { select: { code: true, name: true } } },
      },
    },
  });
  if (!entry) throw new Error("Journal not found");
  const company = await companyTitle(orgId);
  return pdfBuffer((doc) => {
    writeHeader(doc, company, `Journal voucher ${entry.number}`);
    doc.fontSize(10).text(`Date: ${entry.entryDate.toISOString().slice(0, 10)}`);
    doc.text(`Status: ${entry.status} · Kind: ${entry.kind}`);
    doc.text(`Memo: ${safeText(entry.memo)}`);
    doc.text(`Reference: ${safeText(entry.reference)}`);
    doc.moveDown();
    for (const l of entry.lines) {
      doc
        .fontSize(9)
        .text(
          `${l.lineNo}. ${safeText(l.account.code)} ${safeText(l.account.name)}  Dr ${toApiString(l.debit)}  Cr ${toApiString(l.credit)}  ${safeText(l.description)}`
        );
    }
    doc.moveDown();
    moneyRow(doc, "Total debit", toApiString(entry.totalDebit));
    moneyRow(doc, "Total credit", toApiString(entry.totalCredit));
  });
}

export async function renderReportPdf(
  orgId: string,
  reportId: string,
  sp: URLSearchParams,
  ctx: AccountingCtx = systemCtx(orgId)
): Promise<Buffer> {
  const data = (await runReport(ctx, reportId, sp)) as {
    meta?: { orgName?: string; currency?: string };
    sections?: Array<{
      title?: string;
      name?: string;
      rows?: Array<Record<string, unknown>>;
      accounts?: Array<Record<string, unknown>>;
    }>;
    totals?: Record<string, unknown>;
  };
  const titleMap: Record<string, string> = {
    "profit-and-loss": "Profit and loss",
    "balance-sheet": "Balance sheet",
    "cash-flow": "Cash flow",
    "trial-balance": "Trial balance",
    "ar-aging": "Receivables aging",
    "ap-aging": "Payables aging",
  };
  const company = await companyTitle(orgId);
  return pdfBuffer((doc) => {
    writeHeader(doc, company, titleMap[reportId] ?? reportId);
    doc.fontSize(9).text(`Currency: ${safeText(data.meta?.currency)}`);
    doc.moveDown(0.5);
    for (const sec of data.sections ?? []) {
      doc.fontSize(11).fillColor("#D4AF37").text(safeText(sec.title ?? sec.name ?? "Section"));
      doc.fillColor("#111827");
      const rows = (sec.rows ?? sec.accounts ?? []) as Array<Record<string, unknown>>;
      for (const r of rows.slice(0, 80)) {
        const label = safeText(r.name ?? r.label ?? r.code ?? r.partyName ?? "");
        const amount = safeText(r.amount ?? r.balance ?? r.total ?? r.debit ?? "");
        doc.fontSize(9).text(`${label}  ${amount}`);
      }
      doc.moveDown(0.4);
    }
    if (data.totals) {
      doc.moveDown(0.3);
      doc.fontSize(10).text("Totals", { underline: true });
      for (const [k, v] of Object.entries(data.totals)) {
        doc.fontSize(9).text(`${safeText(k)}: ${safeText(typeof v === "object" ? JSON.stringify(v) : v)}`);
      }
    }
  });
}

export function pdfResponse(filename: string, buffer: Buffer): Response {
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}
