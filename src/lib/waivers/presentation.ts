/** Company-side waiver form presentation. Guest chrome uses guestFlowLayout.ts. */

export const LAYOUT_IDS = [
  "classic",
  "two_column",
  "cards",
  "wizard",
  "kiosk_compact",
  "agreement_focus",
  "numbered_rail",
  "accordion",
  "split",
  "checklist",
] as const;

export type WaiverLayoutId = (typeof LAYOUT_IDS)[number];

export const DISPLAY_MODES = ["multi_step", "single_page", "grid", "accordion"] as const;

export type WaiverDisplayMode = (typeof DISPLAY_MODES)[number];

export const LAYOUT_DEFAULT_DISPLAY: Record<WaiverLayoutId, WaiverDisplayMode> = {
  classic: "single_page",
  two_column: "grid",
  cards: "single_page",
  wizard: "multi_step",
  kiosk_compact: "multi_step",
  agreement_focus: "single_page",
  numbered_rail: "multi_step",
  accordion: "accordion",
  split: "grid",
  checklist: "single_page",
};

export const LAYOUT_LABELS: Record<WaiverLayoutId, string> = {
  classic: "Classic",
  two_column: "Two column",
  cards: "Cards",
  wizard: "Wizard",
  kiosk_compact: "Kiosk compact",
  agreement_focus: "Agreement focus",
  numbered_rail: "Numbered rail",
  accordion: "Accordion",
  split: "Split",
  checklist: "Checklist",
};

export const DISPLAY_LABELS: Record<WaiverDisplayMode, string> = {
  multi_step: "Step by step",
  single_page: "One page",
  grid: "Grid",
  accordion: "Accordion",
};

export const FIELD_TYPES = [
  "photo_reader",
  "signature",
  "page_break",
  "text",
  "textarea",
  "checkbox",
  "select",
  "date",
  "email",
  "phone",
  "clause",
  "minor_repeater",
  "address",
  "name",
  "website",
  "number",
  "radio",
  "time",
  "section",
  "html",
  "hidden",
  "consent",
  "slider",
  "rating",
] as const;

export type WaiverFieldType = (typeof FIELD_TYPES)[number];

export const MAPS_TO_KEYS = [
  "first_name",
  "last_name",
  "email",
  "phone",
  "dob",
  "emergency_name",
  "emergency_phone",
  "address",
  "city",
  "state",
  "postal_code",
] as const;

export type WaiverMapsTo = (typeof MAPS_TO_KEYS)[number];

export const MAX_WAIVER_FIELDS = 60;
export const MAX_FIELD_HELP = 300;
/** Agreement statements are a full sentence, often with a short title. */
export const CLAUSE_LABEL_MAX = 800;

export function fieldLabelLimit(type: string): number {
  return type === "clause" ? CLAUSE_LABEL_MAX : 200;
}

/** Title before the first colon, when that title is short. The rest is the sentence. */
export function splitClauseLabel(label: string): { title: string; body: string } {
  const text = label.trim();
  const colon = text.indexOf(":");
  if (colon > 0 && colon <= 40 && text.slice(colon + 1).trim()) {
    return { title: text.slice(0, colon).trim(), body: text.slice(colon + 1).trim() };
  }
  return { title: "", body: text };
}

/** Short name for errors, so a long agreement sentence is not repeated in full. */
export function clausePrompt(label: string): string {
  const { title, body } = splitClauseLabel(label);
  const text = (title || body).replace(/\s+/g, " ").trim();
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

const LAYOUT_SET = new Set<string>(LAYOUT_IDS);
const DISPLAY_SET = new Set<string>(DISPLAY_MODES);
const FIELD_TYPE_SET = new Set<string>(FIELD_TYPES);
const MAPS_TO_SET = new Set<string>(MAPS_TO_KEYS);

export function isLayoutId(value: string): value is WaiverLayoutId {
  return LAYOUT_SET.has(value);
}

export function isDisplayMode(value: string): value is WaiverDisplayMode {
  return DISPLAY_SET.has(value);
}

export function isFieldType(value: string): value is WaiverFieldType {
  return FIELD_TYPE_SET.has(value);
}

export function isMapsTo(value: string): value is WaiverMapsTo {
  return MAPS_TO_SET.has(value);
}

/** These answers stay on the form. They are not the guest's name, email, phone, or address. */
const NO_GUEST_MAP = new Set<string>([
  "clause",
  "signature",
  "photo_reader",
  "page_break",
  "section",
  "html",
  "hidden",
  "consent",
  "radio",
  "slider",
  "rating",
  "name",
  "website",
  "number",
  "time",
]);

export function fieldMapsToGuest(type: string): boolean {
  return !NO_GUEST_MAP.has(type);
}

export function sliderBounds(options: string[]): { min: number; max: number } {
  const min = Number(options[0]);
  const max = Number(options[1]);
  const low = Number.isFinite(min) ? min : 0;
  const high = Number.isFinite(max) ? max : 100;
  return { min: low, max: high > low ? high : low + 100 };
}

/** Stored options the guest control and the save check both use. */
export function normalizeFieldOptions(type: string, options: string[]): string[] {
  if (type === "rating") {
    const max = Math.min(10, Math.max(1, Number(options[0]) || 5));
    return [String(max)];
  }
  if (type === "slider") {
    const bounds = sliderBounds(options);
    return [String(bounds.min), String(bounds.max)];
  }
  return options;
}

export function storedFieldRequired(type: string, required: boolean): boolean {
  if (
    type === "photo_reader" ||
    type === "page_break" ||
    type === "section" ||
    type === "html" ||
    type === "hidden"
  ) {
    return false;
  }
  return required;
}

export function parseLayoutId(value: unknown): WaiverLayoutId {
  const id = typeof value === "string" ? value.trim() : "";
  if (!isLayoutId(id)) {
    throw new Error(
      "layoutId must be classic, two_column, cards, wizard, kiosk_compact, agreement_focus, numbered_rail, accordion, split, or checklist"
    );
  }
  return id;
}

export function parseDisplayMode(value: unknown): WaiverDisplayMode {
  const mode = typeof value === "string" ? value.trim() : "";
  if (!isDisplayMode(mode)) {
    throw new Error("displayMode must be multi_step, single_page, grid, or accordion");
  }
  return mode;
}

/** null means inherit WaiverSettings. */
export function parseSignatureOverride(value: unknown, label: string): boolean | null {
  if (value == null || value === "" || value === "inherit") return null;
  if (value === true || value === "on" || value === "true") return true;
  if (value === false || value === "off" || value === "false") return false;
  throw new Error(`${label} must be inherit, on, or off`);
}

export function parseDocumentExtractFlag(value: unknown): boolean {
  if (value === true || value === false) return value;
  throw new Error("allowDocumentExtract must be true or false");
}

/** Wide or structural questions stay on their own row. */
const FULL_WIDTH_FIELD_TYPES = new Set([
  "page_break",
  "section",
  "html",
  "photo_reader",
  "signature",
  "clause",
  "minor_repeater",
  "address",
  "textarea",
  "hidden",
]);

export const MAX_SHARED_FIELD_ROW = 3;

export function canShareFieldRow(type: string): boolean {
  return !FULL_WIDTH_FIELD_TYPES.has(type);
}

export function cleanFieldRowKey(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, "");
}

/** Consecutive questions that share a row key, capped at three. */
export function groupFieldIndexes(fields: { type: string; row?: string }[]): number[][] {
  const groups: number[][] = [];
  let bucket: number[] = [];
  let key = "";
  const flush = () => {
    if (bucket.length) groups.push(bucket);
    bucket = [];
    key = "";
  };
  fields.forEach((field, index) => {
    const row = canShareFieldRow(field.type) ? cleanFieldRowKey(field.row) : "";
    if (row && row === key && bucket.length < MAX_SHARED_FIELD_ROW) {
      bucket.push(index);
      return;
    }
    flush();
    if (!row) {
      groups.push([index]);
      return;
    }
    bucket = [index];
    key = row;
  });
  flush();
  return groups;
}

/** Keep a row key only when two or three neighboring questions still share it. */
export function normalizeSharedRows<T extends { type: string; row?: string }>(fields: T[]): T[] {
  const groups = groupFieldIndexes(fields);
  const keyByIndex = new Map<number, string>();
  for (const indexes of groups) {
    if (indexes.length < 2) continue;
    const key =
      cleanFieldRowKey(fields[indexes[0]]?.row) || cleanFieldRowKey(fields[indexes[1]]?.row);
    if (!key) continue;
    for (const index of indexes) keyByIndex.set(index, key);
  }
  return fields.map((field, index) => {
    const key = keyByIndex.get(index) ?? "";
    if ((field.row ?? "") === key) return field;
    return { ...field, row: key };
  });
}
