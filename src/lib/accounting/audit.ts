/**
 * Accounting audit trail on ActivityLog (no parallel audit table).
 */
import type { ActivityEntityType } from "@prisma/client";
import { logActivityEntryAsync } from "@/lib/audit/activityLog";
import type { AccountingCtx } from "@/lib/accounting/types";

type Plain = Record<string, unknown> | null | undefined;

function normalize(value: unknown): unknown {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "toFixed" in (value as object)) {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalize(v);
    }
    return out;
  }
  return value;
}

/** Field-level diff of two plain snapshots (top-level keys). */
export function diffSnapshots(before: Plain, after: Plain): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of keys) {
    if (key === "updatedAt" || key === "bankAccountCiphertext") continue;
    const a = normalize((before ?? {})[key]);
    const b = normalize((after ?? {})[key]);
    if (JSON.stringify(a) !== JSON.stringify(b)) out[key] = { from: a, to: b };
  }
  return out;
}

export function recordAccountingAudit(
  ctx: AccountingCtx,
  input: {
    action: string;
    entityType: ActivityEntityType;
    entityId: string | null;
    description: string;
    before?: Plain;
    after?: Plain;
    reason?: string | null;
    metadata?: Record<string, unknown>;
  }
): void {
  void logActivityEntryAsync({
    actorSub: ctx.actorId,
    orgId: ctx.orgId,
    action: `accounting.${input.action}`,
    entityType: input.entityType,
    entityId: input.entityId,
    description: input.description,
    metadata: {
      module: "accounting",
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.before !== undefined || input.after !== undefined
        ? { diff: diffSnapshots(input.before, input.after) }
        : {}),
      ...(input.metadata ?? {}),
      system: ctx.system,
    },
  });
}
