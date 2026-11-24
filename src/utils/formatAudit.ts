/** Compact admin audit date (tables). Missing/invalid → em dash. */
export function formatAuditDate(
  value?: string | Date | null,
  style: "date" | "datetime" = "date"
): string {
  if (value == null || value === "") return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  if (style === "datetime") return d.toLocaleString();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Display audit actor name; empty/missing → em dash. */
export function formatAuditName(value?: string | null): string {
  if (typeof value !== "string") return "—";
  const trimmed = value.trim();
  return trimmed || "—";
}
