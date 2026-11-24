/** Normalize list API payloads that may be arrays or `{ items|… }` wrappers. */
export function asItems<T = Record<string, unknown>>(
  data: unknown,
  keys: string[] = ["items", "suppliers", "bills", "payments", "purchaseOrders", "expenses", "transfers", "reconciliations", "bankAccounts", "accounts", "rows"]
): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const rec = data as Record<string, unknown>;
    for (const k of keys) {
      if (Array.isArray(rec[k])) return rec[k] as T[];
    }
  }
  return [];
}

export function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

export function unwrapEntity<T = Record<string, unknown>>(
  data: unknown,
  keys: string[]
): T {
  const rec = asRecord(data);
  for (const k of keys) {
    if (rec[k] && typeof rec[k] === "object") return rec[k] as T;
  }
  return rec as T;
}

export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}
