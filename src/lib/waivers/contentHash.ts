import { createHash } from "crypto";

export type WaiverHashLocale = {
  locale: string;
  title: string;
  bodyHtml: string;
  fieldsJson: unknown;
  layoutId?: string;
  displayMode?: string;
  allowDocumentExtract?: boolean;
};

/** Stable field-object key order so a Postgres jsonb round-trip does not change the hash. */
export function canonicalFields(value: unknown): unknown {
  if (value == null) return null;
  if (!Array.isArray(value)) return value;
  return value.map((field) => {
    if (!field || typeof field !== "object" || Array.isArray(field)) return field;
    const f = field as Record<string, unknown>;
    const options = Array.isArray(f.options)
      ? f.options.filter((option) => typeof option === "string")
      : [];
    const canonical: Record<string, unknown> = {
      id: typeof f.id === "string" ? f.id : "",
      type: typeof f.type === "string" ? f.type : "",
      label: typeof f.label === "string" ? f.label : "",
      required: f.required === true,
      options,
    };
    if (typeof f.section === "string" && f.section.trim()) {
      canonical.section = f.section;
    }
    if (typeof f.help === "string" && f.help) {
      canonical.help = f.help;
    }
    if (typeof f.mapsTo === "string" && f.mapsTo) {
      canonical.mapsTo = f.mapsTo;
    }
    if (typeof f.row === "string" && f.row.trim()) {
      canonical.row = f.row.trim();
    }
    return canonical;
  });
}

function layoutOf(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "classic";
}

function displayOf(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "single_page";
}

function overrideOf(value: unknown): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

/**
 * Canonical sha256 of kind, body, fields, presentation, and locales.
 * Omitted presentation uses classic / single_page / document extract off / inherit signatures,
 * so a draft saved with those defaults still matches a recompute that only passes body and fields.
 */
export function waiverContentSha256(input: {
  kind: string;
  bodyHtml: string;
  fieldsJson: unknown;
  locales: WaiverHashLocale[];
  layoutId?: string;
  displayMode?: string;
  allowDocumentExtract?: boolean;
  allowTypedSignature?: boolean | null;
  allowDrawnSignature?: boolean | null;
}): string {
  const layoutId = layoutOf(input.layoutId);
  const displayMode = displayOf(input.displayMode);
  const allowDocumentExtract = input.allowDocumentExtract === true;
  const locales = [...input.locales]
    .map((row) => ({
      locale: row.locale,
      title: row.title,
      bodyHtml: row.bodyHtml,
      fieldsJson: canonicalFields(row.fieldsJson ?? null),
      layoutId: layoutOf(row.layoutId ?? layoutId),
      displayMode: displayOf(row.displayMode ?? displayMode),
      allowDocumentExtract:
        row.allowDocumentExtract == null
          ? allowDocumentExtract
          : row.allowDocumentExtract === true,
    }))
    .sort((a, b) => a.locale.localeCompare(b.locale));

  const canonical = JSON.stringify({
    kind: input.kind,
    bodyHtml: input.bodyHtml,
    fieldsJson: canonicalFields(input.fieldsJson ?? null),
    layoutId,
    displayMode,
    allowDocumentExtract,
    allowTypedSignature: overrideOf(input.allowTypedSignature),
    allowDrawnSignature: overrideOf(input.allowDrawnSignature),
    locales,
  });
  return createHash("sha256").update(canonical).digest("hex");
}
