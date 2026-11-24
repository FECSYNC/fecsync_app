/**
 * Atomic per-org document numbers (JE-000001, BILL-000001, …).
 * INSERT … ON CONFLICT DO UPDATE … RETURNING so concurrent creates never collide.
 */
import { randomUUID } from "crypto";
import type { Db } from "@/lib/accounting/types";

export type SequenceKey =
  | "journal"
  | "bill"
  | "supplier_payment"
  | "receipt"
  | "expense"
  | "purchase_order"
  | "transfer"
  | "reconciliation"
  | "supplier_code";

export const SEQUENCE_PREFIX: Record<SequenceKey, { prefix: string; pad: number }> = {
  journal: { prefix: "JE-", pad: 6 },
  bill: { prefix: "BILL-", pad: 6 },
  supplier_payment: { prefix: "SPAY-", pad: 6 },
  receipt: { prefix: "RCPT-", pad: 6 },
  expense: { prefix: "EXP-", pad: 6 },
  purchase_order: { prefix: "PO-", pad: 6 },
  transfer: { prefix: "TRF-", pad: 6 },
  reconciliation: { prefix: "REC-", pad: 6 },
  supplier_code: { prefix: "SUP-", pad: 4 },
};

export async function nextNumber(db: Db, orgId: string, key: SequenceKey): Promise<string> {
  const rows = await db.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "accounting_sequences" ("id", "orgId", "key", "nextValue")
    VALUES (${randomUUID()}, ${orgId}, ${key}, 2)
    ON CONFLICT ("orgId", "key")
    DO UPDATE SET "nextValue" = "accounting_sequences"."nextValue" + 1
    RETURNING ("nextValue" - 1)::int AS value
  `;
  const value = rows[0]?.value ?? 1;
  const { prefix, pad } = SEQUENCE_PREFIX[key];
  return `${prefix}${String(value).padStart(pad, "0")}`;
}
