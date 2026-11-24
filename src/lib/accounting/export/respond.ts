/**
 * format=csv|pdf helpers for accounting admin GET handlers.
 */
import { NextResponse } from "next/server";
import { ForbiddenError } from "@/lib/auth/http-error";
import { P } from "@/lib/auth/permissions";
import { ctxHas, type AccountingCtx } from "@/lib/accounting/types";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { flattenToCsvRows, csvResponse, JOURNAL_LINES_EXPORT_HEADERS, buildCsv } from "@/lib/accounting/export/csv";
import {
  pdfResponse,
  renderInvoicePdf,
  renderJournalVoucherPdf,
  renderCustomerStatementPdf,
  renderSupplierStatementPdf,
  renderPurchaseOrderPdf,
  renderRemittancePdf,
  renderReportPdf,
} from "@/lib/accounting/export/pdf";
import { parseOptionalDate } from "@/lib/accounting/http";

const PDF_REPORTS = new Set([
  "profit-and-loss",
  "balance-sheet",
  "cash-flow",
  "trial-balance",
  "ar-aging",
  "ap-aging",
]);

const FIVE_YEARS_MS = 5 * 365.25 * 86_400_000;

export function assertExportFormat(ctx: AccountingCtx, format: string | null, opts?: { audit?: boolean }) {
  if (!format || format === "json") return null;
  if (format !== "csv" && format !== "pdf") {
    throw acctError(ACCT.VALIDATION, { fields: { format: "Must be csv, pdf, or omitted" } });
  }
  if (!ctxHas(ctx, P.AccountingExport)) {
    throw new ForbiddenError("accounting:export required");
  }
  if (opts?.audit && !ctxHas(ctx, P.AccountingAuditRead)) {
    throw new ForbiddenError("accounting:audit_read required");
  }
  return format as "csv" | "pdf";
}

export function assertExportDateRange(from?: Date | null, to?: Date | null) {
  if (from && to && to.getTime() - from.getTime() > FIVE_YEARS_MS) {
    throw acctError(ACCT.DATE_RANGE_INVALID, { message: "Export range limited to 5 years" });
  }
}

export async function maybeFormatResponse(opts: {
  ctx: AccountingCtx;
  pattern: string;
  params: Record<string, string>;
  sp: URLSearchParams;
  data: unknown;
}): Promise<NextResponse | Response | null> {
  const format = assertExportFormat(opts.ctx, opts.sp.get("format"), {
    audit: opts.pattern === "audit" || opts.params.report === "audit-trail",
  });
  if (!format) return null;

  const from = parseOptionalDate(opts.sp.get("from"));
  const to = parseOptionalDate(opts.sp.get("to"));
  assertExportDateRange(from, to);

  const { pattern, params, ctx, sp, data } = opts;

  if (format === "pdf") {
    if (pattern === "invoices/[id]") {
      const buf = await renderInvoicePdf(ctx.orgId, params.id!);
      return pdfResponse(`invoice-${params.id}.pdf`, buf);
    }
    if (pattern === "journals/[id]") {
      const buf = await renderJournalVoucherPdf(ctx.orgId, params.id!);
      return pdfResponse(`journal-${params.id}.pdf`, buf);
    }
    if (pattern === "customers/[partyKey]/statement") {
      const f = from ?? new Date(Date.now() - 90 * 86_400_000);
      const t = to ?? new Date();
      const buf = await renderCustomerStatementPdf(ctx.orgId, decodeURIComponent(params.partyKey!), f, t);
      return pdfResponse("customer-statement.pdf", buf);
    }
    if (pattern === "suppliers/[id]/statement") {
      const f = from ?? new Date(Date.now() - 90 * 86_400_000);
      const t = to ?? new Date();
      const buf = await renderSupplierStatementPdf(ctx.orgId, params.id!, f, t);
      return pdfResponse("supplier-statement.pdf", buf);
    }
    if (pattern === "purchase-orders/[id]") {
      const buf = await renderPurchaseOrderPdf(ctx.orgId, params.id!);
      return pdfResponse(`po-${params.id}.pdf`, buf);
    }
    if (pattern === "supplier-payments/[id]") {
      const buf = await renderRemittancePdf(ctx.orgId, params.id!);
      return pdfResponse(`remittance-${params.id}.pdf`, buf);
    }
    if (pattern === "reports/[report]" && PDF_REPORTS.has(params.report!)) {
      const buf = await renderReportPdf(ctx.orgId, params.report!, sp, ctx);
      return pdfResponse(`${params.report}.pdf`, buf);
    }
    // Fallback: treat as unsupported PDF — CSV of JSON instead is clearer than 501.
    throw acctError(ACCT.VALIDATION, { message: "PDF not available for this resource; use format=csv" });
  }

  // CSV
  const { headers, rows } = flattenToCsvRows(data);
  const name = pattern.replace(/[\[\]]/g, "").replace(/\//g, "-") || "export";
  return csvResponse(`${name}.csv`, headers, rows);
}

export { JOURNAL_LINES_EXPORT_HEADERS, buildCsv, csvResponse };
