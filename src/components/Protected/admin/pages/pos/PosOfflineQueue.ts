const QUEUE_KEY = "harewa.pos.offline.queue";

export type OfflineQueueLine = {
  productId?: string;
  kind: string;
  name: string;
  qty: number;
  unitPrice: number;
};

export type OfflineQueueEntry = {
  clientMutationId: string;
  locationId: string;
  deviceId: string;
  createdAt: string;
  lines: OfflineQueueLine[];
  total: number;
  status: "queued" | "syncing" | "applied" | "conflict" | "failed";
  serverError?: string;
};

const ALLOWED_KINDS = new Set([
  "merchandise",
  "food",
  "beverage",
  "open_price",
  "sku",
]);

function readQueue(): OfflineQueueEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OfflineQueueEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(entries: OfflineQueueEntry[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(QUEUE_KEY, JSON.stringify(entries));
}

export function listOfflineQueue(): OfflineQueueEntry[] {
  return readQueue();
}

export function enqueueOfflineSale(entry: Omit<OfflineQueueEntry, "createdAt" | "status">) {
  const blocked = entry.lines.some((l) => l.kind && !ALLOWED_KINDS.has(l.kind));
  if (blocked) {
    throw new Error("Only merchandise, food, beverage, and open price can be queued offline.");
  }
  const rows = readQueue();
  if (rows.some((r) => r.clientMutationId === entry.clientMutationId)) {
    return rows.find((r) => r.clientMutationId === entry.clientMutationId)!;
  }
  const row: OfflineQueueEntry = {
    ...entry,
    createdAt: new Date().toISOString(),
    status: "queued",
  };
  rows.push(row);
  writeQueue(rows);
  return row;
}

export function updateOfflineQueueEntry(
  clientMutationId: string,
  patch: Partial<OfflineQueueEntry>
) {
  const rows = readQueue();
  const idx = rows.findIndex((r) => r.clientMutationId === clientMutationId);
  if (idx < 0) return;
  rows[idx] = { ...rows[idx], ...patch };
  writeQueue(rows);
}

export function discardOfflineQueueEntry(clientMutationId: string) {
  writeQueue(readQueue().filter((r) => r.clientMutationId !== clientMutationId));
}

export function pendingOfflineCount() {
  return readQueue().filter((r) => r.status === "queued" || r.status === "conflict").length;
}

export { QUEUE_KEY, ALLOWED_KINDS as OFFLINE_ALLOWED_KINDS };
