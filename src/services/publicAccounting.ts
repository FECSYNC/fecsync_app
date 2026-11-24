/**
 * Public token-based accounting endpoints (S1-Q2).
 */
import { api, unwrap, type MaybeWrapped } from "@/utils/api";

const BASE = "/api/public/accounting";

type JsonRecord = Record<string, unknown>;

async function getJson<T>(path: string): Promise<T> {
  const raw = await api<MaybeWrapped<T>>(path, { method: "GET" });
  return unwrap(raw) as T;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const raw = await api<MaybeWrapped<T>>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return unwrap(raw) as T;
}

export async function getPublicAccountingInvoice(
  token: string
): Promise<JsonRecord> {
  return getJson(`${BASE}/invoices/${encodeURIComponent(token)}`);
}

export async function payPublicAccountingInvoice(
  token: string,
  body: JsonRecord = {}
): Promise<JsonRecord> {
  return postJson(`${BASE}/invoices/${encodeURIComponent(token)}/pay`, body);
}

export async function getPublicAccountingStatement(
  token: string
): Promise<JsonRecord> {
  return getJson(`${BASE}/statements/${encodeURIComponent(token)}`);
}
