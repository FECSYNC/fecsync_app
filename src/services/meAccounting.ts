/**
 * Customer-owned accounting endpoints (S1-Q2).
 */
import { api, unwrap, type MaybeWrapped } from "@/utils/api";

const BASE = "/api/me/accounting";

type JsonRecord = Record<string, unknown>;

function qs(
  params: Record<string, string | number | boolean | null | undefined> = {}
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function getJson<T>(path: string): Promise<T> {
  const raw = await api<MaybeWrapped<T>>(path, {
    method: "GET",
    credentials: "include",
  });
  return unwrap(raw) as T;
}

export async function getMeAccountingSummary(): Promise<JsonRecord> {
  return getJson(`${BASE}/summary`);
}

export async function listMeAccountingInvoices(
  params: { cursor?: string; status?: string } = {}
): Promise<JsonRecord> {
  return getJson(`${BASE}/invoices${qs(params)}`);
}

export async function getMeAccountingInvoice(id: string): Promise<JsonRecord> {
  return getJson(`${BASE}/invoices/${encodeURIComponent(id)}`);
}

export async function getMeAccountingStatement(params: {
  from: string;
  to: string;
  orgId?: string;
}): Promise<JsonRecord> {
  return getJson(`${BASE}/statement${qs(params)}`);
}
