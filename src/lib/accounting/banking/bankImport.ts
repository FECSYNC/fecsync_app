/**
 * Bank statement CSV import with column mapping and duplicate-safe hashing.
 */
import { createHash } from "crypto";
import moment from "moment-timezone";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { recordAccountingAudit } from "@/lib/accounting/audit";
import { D, toApiString, type Dec } from "@/lib/accounting/money";
import { parseCsv } from "@/lib/accounting/csv";
import { loadBankAccount } from "@/lib/accounting/banking/bankAccounts";
import type { AccountingCtx } from "@/lib/accounting/types";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20_000;

export const columnMappingSchema = z
  .object({
    date: z.string().min(1),
    description: z.string().min(1),
    reference: z.string().optional(),
    amount: z.string().optional(),
    debit: z.string().optional(),
    credit: z.string().optional(),
    balance: z.string().optional(),
    dateFormat: z.enum(["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "DD-MM-YYYY", "MM-DD-YYYY", "DD.MM.YYYY"]).default("YYYY-MM-DD"),
    decimalSeparator: z.enum([".", ","]).default("."),
  })
  .strict()
  .refine((m) => Boolean(m.amount) || (Boolean(m.debit) && Boolean(m.credit)), {
    message: "Map an amount column or both debit and credit columns",
    path: ["amount"],
  });

export type ColumnMapping = z.infer<typeof columnMappingSchema>;

function parseAmount(raw: string, decimal: "." | ","): Dec | null {
  let s = raw.trim().replace(/\s/g, "");
  if (!s) return null;
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/[^\d.,\-]/g, "");
  if (decimal === ",") s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const v = D(s);
  return negative ? v.abs().neg() : v;
}

export type ParsedStatementRow = {
  row: number;
  date: Date;
  description: string;
  reference: string | null;
  amount: Dec;
  balance: Dec | null;
};

export function parseStatementCsv(
  text: string,
  mapping: ColumnMapping,
  tz: string
): { rows: ParsedStatementRow[]; errors: Array<{ row: number; error: string }>; headers: string[] } {
  const table = parseCsv(text);
  if (table.length < 2) throw acctError(ACCT.BANK_IMPORT_INVALID, { message: "The file has no data rows" });
  if (table.length - 1 > MAX_IMPORT_ROWS) {
    throw acctError(ACCT.BANK_IMPORT_INVALID, { message: `More than ${MAX_IMPORT_ROWS} rows` });
  }
  const headers = table[0]!.map((h) => h.trim());
  const idx = (name?: string) => (name ? headers.findIndex((h) => h.toLowerCase() === name.toLowerCase()) : -1);
  const iDate = idx(mapping.date);
  const iDesc = idx(mapping.description);
  const iRef = idx(mapping.reference);
  const iAmt = idx(mapping.amount);
  const iDr = idx(mapping.debit);
  const iCr = idx(mapping.credit);
  const iBal = idx(mapping.balance);
  if (iDate < 0 || iDesc < 0 || (iAmt < 0 && (iDr < 0 || iCr < 0))) {
    throw acctError(ACCT.BANK_IMPORT_INVALID, { message: "Mapped columns were not found in the header row", details: { headers } });
  }
  const rows: ParsedStatementRow[] = [];
  const errors: Array<{ row: number; error: string }> = [];
  table.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    const m = moment.tz((r[iDate] ?? "").trim(), mapping.dateFormat, true, tz);
    if (!m.isValid()) {
      errors.push({ row: rowNo, error: "Invalid date" });
      return;
    }
    let amount: Dec | null;
    if (iAmt >= 0) {
      amount = parseAmount(r[iAmt] ?? "", mapping.decimalSeparator);
    } else {
      const dr = parseAmount(r[iDr] ?? "", mapping.decimalSeparator);
      const cr = parseAmount(r[iCr] ?? "", mapping.decimalSeparator);
      amount = (cr ?? D(0)).abs().sub((dr ?? D(0)).abs());
      if (!dr && !cr) amount = null;
    }
    if (!amount || amount.isZero()) {
      errors.push({ row: rowNo, error: "Invalid or zero amount" });
      return;
    }
    const description = (r[iDesc] ?? "").trim().slice(0, 500);
    if (!description) {
      errors.push({ row: rowNo, error: "Missing description" });
      return;
    }
    rows.push({
      row: rowNo,
      date: m.startOf("day").toDate(),
      description,
      reference: iRef >= 0 ? (r[iRef] ?? "").trim().slice(0, 200) || null : null,
      amount: amount.toDecimalPlaces(2),
      balance: iBal >= 0 ? parseAmount(r[iBal] ?? "", mapping.decimalSeparator) : null,
    });
  });
  return { rows, errors, headers };
}

function dedupeHash(bankAccountId: string, r: { date: Date; amount: Dec; description: string; reference: string | null }, occurrence: number) {
  const normalized = r.description.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256")
    .update([bankAccountId, r.date.toISOString().slice(0, 10), r.amount.toFixed(2), normalized, r.reference ?? "", occurrence].join("|"))
    .digest("hex");
}

export async function importStatement(
  ctx: AccountingCtx,
  bankAccountId: string,
  file: { name: string; text: string; size: number },
  rawMapping: unknown
) {
  if (file.size > MAX_IMPORT_BYTES) throw acctError(ACCT.BANK_IMPORT_INVALID, { message: "File larger than 5 MB" });
  const mapping = columnMappingSchema.parse(rawMapping);
  const bank = await loadBankAccount(ctx, bankAccountId);
  if (bank.archivedAt) throw acctError(ACCT.BANK_ACCOUNT_IN_USE);
  const settings = await prisma.accountingSettings.findUniqueOrThrow({ where: { orgId: ctx.orgId } });
  const { rows, errors } = parseStatementCsv(file.text, mapping, settings.timezone);
  if (!rows.length) throw acctError(ACCT.BANK_IMPORT_INVALID, { message: "No valid rows", details: { errors: errors.slice(0, 200) } });
  const seen = new Map<string, number>();
  const prepared = rows.map((r) => {
    const base = `${r.date.toISOString().slice(0, 10)}|${r.amount.toFixed(2)}|${r.description.toLowerCase()}|${r.reference ?? ""}`;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return { ...r, hash: dedupeHash(bank.id, r, occurrence) };
  });
  const result = await prisma.$transaction(
    async (tx) => {
      const imp = await tx.bankStatementImport.create({
        data: {
          orgId: ctx.orgId,
          bankAccountId: bank.id,
          fileName: file.name.slice(0, 200),
          columnMapping: mapping,
          dateFormat: mapping.dateFormat,
          rowCount: rows.length + errors.length,
          importedCount: 0,
          duplicateCount: 0,
          errorRows: errors.length ? errors.slice(0, 500) : undefined,
          createdById: ctx.actorId ?? "system",
        },
      });
      const created = await tx.bankTransaction.createMany({
        data: prepared.map((r) => ({
          orgId: ctx.orgId,
          bankAccountId: bank.id,
          txnDate: r.date,
          description: r.description,
          reference: r.reference,
          amount: r.amount,
          runningBalance: r.balance,
          source: "import_csv" as const,
          importId: imp.id,
          dedupeHash: r.hash,
          createdById: ctx.actorId,
        })),
        skipDuplicates: true,
      });
      return tx.bankStatementImport.update({
        where: { id: imp.id },
        data: { importedCount: created.count, duplicateCount: prepared.length - created.count },
      });
    },
    { timeout: 120_000 }
  );
  recordAccountingAudit(ctx, {
    action: "bank.import",
    entityType: "BankTransaction",
    entityId: result.id,
    description: `Imported ${result.importedCount} bank lines (${result.duplicateCount} duplicates skipped)`,
  });
  return {
    importId: result.id,
    rowCount: result.rowCount,
    importedCount: result.importedCount,
    duplicateCount: result.duplicateCount,
    errors: errors.slice(0, 200),
  };
}

export const manualTransactionSchema = z
  .object({
    txnDate: z.string().min(10),
    description: z.string().trim().min(1).max(500),
    reference: z.string().trim().max(200).nullable().optional(),
    amount: z.union([z.string(), z.number()]).transform((v) => D(String(v))),
  })
  .strict();

export async function addManualTransaction(ctx: AccountingCtx, bankAccountId: string, raw: unknown) {
  const input = manualTransactionSchema.parse(raw);
  if (input.amount.isZero()) throw acctError(ACCT.VALIDATION, { fields: { amount: "Must not be zero" } });
  const bank = await loadBankAccount(ctx, bankAccountId);
  const date = new Date(input.txnDate);
  if (Number.isNaN(date.getTime())) throw acctError(ACCT.VALIDATION, { fields: { txnDate: "Invalid date" } });
  const hash = createHash("sha256")
    .update(`${bank.id}|manual|${Date.now()}|${Math.random()}`)
    .digest("hex");
  const row = await prisma.bankTransaction.create({
    data: {
      orgId: ctx.orgId,
      bankAccountId: bank.id,
      txnDate: date,
      description: input.description,
      reference: input.reference ?? null,
      amount: input.amount.toDecimalPlaces(2),
      source: "manual",
      dedupeHash: hash,
      createdById: ctx.actorId,
    },
  });
  recordAccountingAudit(ctx, {
    action: "bank.manual_line",
    entityType: "BankTransaction",
    entityId: row.id,
    description: `Manual bank line ${toApiString(row.amount)}`,
  });
  return row;
}
