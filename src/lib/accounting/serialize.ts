/**
 * Thin JSON-safe helpers. Prefer module to*Dto functions; use these only for
 * ad-hoc Prisma rows / Decimal / Date values that lack a dedicated DTO.
 */
import { Prisma } from "@prisma/client";
import { toApiString, toApiStringOrNull } from "@/lib/accounting/money";

export function serializeDecimal(value: Prisma.Decimal | string | number | null | undefined): string | null {
  return toApiStringOrNull(value as never);
}

export function serializeDate(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Recursively turn Decimal/Date into JSON-safe primitives (arrays/objects). */
export function serializeJson(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Prisma.Decimal) return toApiString(value);
  if (Array.isArray(value)) return value.map(serializeJson);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeJson(v);
    }
    return out;
  }
  return value;
}
