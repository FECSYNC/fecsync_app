/**
 * Accounting CSV export — UTF-8 BOM, RFC 4180 quoting, formula-injection guard.
 */
import { NextResponse } from "next/server";

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Escape a single cell (formula injection + RFC 4180). */
export function csvEscapeCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (FORMULA_PREFIX.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Build CSV text with UTF-8 BOM. */
export function buildCsv(headers: string[], rows: unknown[][]): string {
  const lines = [
    headers.map(csvEscapeCell).join(","),
    ...rows.map((r) => headers.map((_, i) => csvEscapeCell(r[i])).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function csvResponse(filename: string, headers: string[], rows: unknown[][]): NextResponse {
  const body = buildCsv(headers, rows);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Flatten a JSON-ish object/array into rows for generic CSV download. */
export function flattenToCsvRows(
  data: unknown,
  preferredKeys?: string[]
): { headers: string[]; rows: unknown[][] } {
  const list: Record<string, unknown>[] = [];
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        list.push(flattenObject(item as Record<string, unknown>));
      }
    }
  } else if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const arrayKey = Object.keys(obj).find((k) => Array.isArray(obj[k]));
    if (arrayKey && Array.isArray(obj[arrayKey])) {
      for (const item of obj[arrayKey] as unknown[]) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          list.push(flattenObject(item as Record<string, unknown>));
        }
      }
    } else {
      // Report-style: sections → rows
      if (Array.isArray(obj.sections)) {
        for (const sec of obj.sections as Array<Record<string, unknown>>) {
          const rows = Array.isArray(sec.rows) ? sec.rows : Array.isArray(sec.accounts) ? sec.accounts : [];
          for (const r of rows) {
            if (r && typeof r === "object") {
              list.push(
                flattenObject({
                  section: sec.title ?? sec.name ?? sec.id,
                  ...(r as Record<string, unknown>),
                })
              );
            }
          }
        }
      }
      if (!list.length) list.push(flattenObject(obj));
    }
  }
  if (!list.length) return { headers: preferredKeys ?? ["value"], rows: [] };
  const keySet = new Set<string>();
  for (const row of list) Object.keys(row).forEach((k) => keySet.add(k));
  const headers =
    preferredKeys && preferredKeys.length
      ? preferredKeys.filter((k) => keySet.has(k)).concat([...keySet].filter((k) => !preferredKeys.includes(k)))
      : [...keySet];
  const rows = list.map((r) => headers.map((h) => r[h] ?? ""));
  return { headers, rows };
}

function flattenObject(obj: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[key] = v ?? "";
    } else if (v instanceof Date) {
      out[key] = v.toISOString();
    } else if (Array.isArray(v)) {
      out[key] = v
        .map((x) => (x && typeof x === "object" ? JSON.stringify(x) : String(x ?? "")))
        .join("; ");
    } else if (typeof v === "object") {
      // Keep one level of nested scalars; stringify deeper.
      const nested = v as Record<string, unknown>;
      const scalarKeys = Object.keys(nested).filter(
        (nk) => nested[nk] == null || ["string", "number", "boolean"].includes(typeof nested[nk])
      );
      if (scalarKeys.length && scalarKeys.length === Object.keys(nested).length) {
        for (const nk of scalarKeys) out[`${key}.${nk}`] = nested[nk] ?? "";
      } else {
        out[key] = JSON.stringify(v);
      }
    }
  }
  return out;
}

export const JOURNAL_LINES_EXPORT_HEADERS = [
  "Date",
  "Entry number",
  "Account code",
  "Account name",
  "Description",
  "Debit",
  "Credit",
  "Location",
  "Party",
  "Reference",
  "Source",
] as const;
