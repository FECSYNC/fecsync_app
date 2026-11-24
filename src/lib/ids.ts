/**
 * ID helpers for Postgres (cuid / uuid / legacy 24-char hex).
 * Replaces mongoose ObjectId checks across the app.
 */

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;
const CUID_RE = /^c[a-z0-9]{20,}$/i;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text || text === "undefined" || text === "null") return false;
  return OBJECT_ID_RE.test(text) || CUID_RE.test(text) || UUID_RE.test(text);
}

export function asIdString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const text = value.trim();
    return isValidId(text) ? text : null;
  }
  if (typeof value === "object" && value !== null) {
    if ("id" in value && typeof (value as { id: unknown }).id === "string") {
      return asIdString((value as { id: string }).id);
    }
    if ("_id" in value) {
      return asIdString((value as { _id: unknown })._id);
    }
  }
  const text = String(value).trim();
  return isValidId(text) ? text : null;
}

export function requireId(value: unknown, label = "id"): string {
  const id = asIdString(value);
  if (!id) throw new Error(`Invalid ${label}`);
  return id;
}

/**
 * Pick the database id from catalog API rows.
 * Category responses use `_id` (cuid) and `id` (slug); fabric/product rows use cuid in both.
 */
export function catalogRefId(
  row: { _id?: string; id?: string } | null | undefined
): string {
  const primary = String(row?._id ?? "").trim();
  const secondary = String(row?.id ?? "").trim();
  if (isValidId(primary)) return primary;
  if (isValidId(secondary)) return secondary;
  return primary || secondary;
}

/** Attach `_id` alias for API responses that still expect Mongo-style docs. */
export function withMongoIdAlias<T extends { id: string }>(
  row: T
): T & { _id: string } {
  return { ...row, _id: row.id };
}

export function withMongoIdAliasMany<T extends { id: string }>(
  rows: T[]
): Array<T & { _id: string }> {
  return rows.map(withMongoIdAlias);
}

/** Prisma where clause matching primary id or legacy Mongo hex. */
export function idWhere(id: string): { OR: [{ id: string }, { legacyId: string }] } {
  return { OR: [{ id }, { legacyId: id }] };
}
