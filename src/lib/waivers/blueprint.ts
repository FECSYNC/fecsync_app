/**
 * Spreadsheet blueprint for a draft waiver form.
 * This is not the historical signed-guest importer.
 */
import {
  FIELD_TYPES,
  LAYOUT_DEFAULT_DISPLAY,
  MAPS_TO_KEYS,
  MAX_FIELD_HELP,
  MAX_WAIVER_FIELDS,
  isDisplayMode,
  fieldLabelLimit,
  fieldMapsToGuest,
  isFieldType,
  isLayoutId,
  isMapsTo,
  normalizeFieldOptions,
  storedFieldRequired,
  type WaiverDisplayMode,
  type WaiverLayoutId,
} from "@/lib/waivers/presentation";
import { readXlsx, writeXlsx } from "@/lib/waivers/xlsxLite";

export const BLUEPRINT_HEADERS = [
  "section",
  "key",
  "label",
  "type",
  "required",
  "options",
  "help",
  "maps_to",
] as const;

export const BLUEPRINT_MAX_BYTES = 2 * 1024 * 1024;

export type BlueprintField = {
  id: string;
  type: string;
  label: string;
  required: boolean;
  options: string[];
  section: string;
  help?: string;
  mapsTo?: string;
};

export type BlueprintRowError = {
  row: number;
  column: string;
  message: string;
};

export type ParsedBlueprint = {
  fields: BlueprintField[];
  layoutId: WaiverLayoutId;
  displayMode: WaiverDisplayMode;
  presentationIncluded: boolean;
  errors: BlueprintRowError[];
};

const SAMPLE_ROWS: string[][] = [
  [
    "guest",
    "first_name",
    "First name",
    "text",
    "yes",
    "",
    "The name you go by",
    "first_name",
  ],
  [
    "guest",
    "last_name",
    "Last name",
    "text",
    "yes",
    "",
    "Your family name",
    "last_name",
  ],
  ["guest", "email", "Email", "email", "yes", "", "Where we send the copy", "email"],
  ["guest", "phone", "Phone", "phone", "no", "", "", "phone"],
  ["guest", "birth_date", "Date of birth", "date", "yes", "", "", "dob"],
  [
    "guest",
    "home_address",
    "Home address",
    "address",
    "no",
    "",
    "Street, city, and postal code",
    "address",
  ],
  ["guest", "minors", "Minors in your group", "minor_repeater", "no", "", "", ""],
  [
    "agreement",
    "safety_rules",
    "Write your safety-rules clause here",
    "clause",
    "yes",
    "",
    "Replace this sentence with your own rules",
    "",
  ],
  [
    "agreement",
    "assumption_of_risk",
    "Write your assumption-of-risk clause here",
    "clause",
    "yes",
    "",
    "Replace this sentence with your own wording",
    "",
  ],
];

const INSTRUCTIONS = [
  "Waiver form blueprint",
  "Fill the Fields sheet. Each row is one guest question or one agreement clause.",
  "section is guest, agreement, or a short heading of your own.",
  `type is one of: ${FIELD_TYPES.join(", ")}.`,
  "required is yes or no. options are separated by a pipe character.",
  `maps_to is empty or one of: ${MAPS_TO_KEYS.join(", ")}.`,
  "A clause row is an agreement checkbox. Replace the sample sentences with your own wording.",
  "The Presentation sheet may set layout_id and display_mode. When you leave it out, the form uses classic and single_page.",
  "This file defines the form. It does not import signed guests.",
];

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function blueprintSampleCsv(): string {
  const lines = [
    BLUEPRINT_HEADERS.join(","),
    ...SAMPLE_ROWS.map((row) => row.map(csvCell).join(",")),
    "layout_id,display_mode",
    "classic,single_page",
  ];
  return `${lines.join("\r\n")}\r\n`;
}

export function blueprintSampleXlsx(): Buffer {
  return writeXlsx([
    { name: "Instructions", rows: INSTRUCTIONS.map((line) => [line]) },
    { name: "Fields", rows: [[...BLUEPRINT_HEADERS], ...SAMPLE_ROWS] },
    {
      name: "Presentation",
      rows: [
        ["layout_id", "display_mode"],
        ["classic", "single_page"],
      ],
    },
  ]);
}

export function parseCsvTable(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function blankRow(cells: string[]): boolean {
  return cells.every((cell) => !cell.trim());
}

function headerIndex(header: string[]): Map<string, number> | BlueprintRowError {
  const index = new Map<string, number>();
  header.forEach((cell, i) => {
    const key = cell.trim().toLowerCase().replace(/\s+/g, "_");
    if (key) index.set(key, i);
  });
  for (const name of BLUEPRINT_HEADERS) {
    if (!index.has(name)) {
      return { row: 1, column: name, message: `Header column ${name} is required` };
    }
  }
  return index;
}

function cellAt(row: string[], index: Map<string, number>, name: string): string {
  const at = index.get(name);
  if (at == null) return "";
  return (row[at] ?? "").trim();
}

function isPresentationHeader(cells: string[]): boolean {
  const first = (cells[0] ?? "").trim().toLowerCase();
  const second = (cells[1] ?? "").trim().toLowerCase();
  return first === "layout_id" && second === "display_mode";
}

function readPresentation(
  cells: string[],
  rowNumber: number,
  errors: BlueprintRowError[]
): { layoutId: WaiverLayoutId; displayMode: WaiverDisplayMode } | null {
  const layoutRaw = (cells[0] ?? "").trim();
  const displayRaw = (cells[1] ?? "").trim();
  if (!layoutRaw && !displayRaw) {
    errors.push({
      row: rowNumber,
      column: "layout_id",
      message: "Presentation needs layout_id and display_mode",
    });
    return null;
  }
  if (!isLayoutId(layoutRaw)) {
    errors.push({
      row: rowNumber,
      column: "layout_id",
      message: "layout_id is not one of the ten layouts",
    });
    return null;
  }
  const displayMode = displayRaw || LAYOUT_DEFAULT_DISPLAY[layoutRaw];
  if (!isDisplayMode(displayMode)) {
    errors.push({
      row: rowNumber,
      column: "display_mode",
      message: "display_mode must be multi_step, single_page, grid, or accordion",
    });
    return null;
  }
  return { layoutId: layoutRaw, displayMode };
}

function pushField(
  cells: string[],
  rowNumber: number,
  index: Map<string, number>,
  seen: Set<string>,
  fields: BlueprintField[],
  errors: BlueprintRowError[]
) {
  if (fields.length >= MAX_WAIVER_FIELDS) {
    errors.push({
      row: rowNumber,
      column: "key",
      message: `A form can have at most ${MAX_WAIVER_FIELDS} fields`,
    });
    return;
  }
  const section = cellAt(cells, index, "section");
  const key = cellAt(cells, index, "key");
  const label = cellAt(cells, index, "label");
  const type = cellAt(cells, index, "type").toLowerCase();
  if (type === "currency" || type === "calculation") return;
  const requiredRaw = cellAt(cells, index, "required").toLowerCase();
  const optionsRaw = cellAt(cells, index, "options");
  const help = cellAt(cells, index, "help");
  const mapsTo = cellAt(cells, index, "maps_to").toLowerCase();

  if (!section || section.length > 80) {
    errors.push({
      row: rowNumber,
      column: "section",
      message: section ? "section is longer than 80 characters" : "section is required",
    });
  }
  if (!key || key.length > 40) {
    errors.push({
      row: rowNumber,
      column: "key",
      message: key ? "key is longer than 40 characters" : "key is required",
    });
  } else if (seen.has(key)) {
    errors.push({ row: rowNumber, column: "key", message: `Field id ${key} is duplicated` });
  } else {
    seen.add(key);
  }
  const labelLimit = fieldLabelLimit(type);
  if (!label || label.length > labelLimit) {
    errors.push({
      row: rowNumber,
      column: "label",
      message: label ? `label is longer than ${labelLimit} characters` : "label is required",
    });
  }
  if (!isFieldType(type)) {
    errors.push({
      row: rowNumber,
      column: "type",
      message: type ? `Field type ${type} is not supported` : "type is required",
    });
  }
  if (requiredRaw !== "yes" && requiredRaw !== "no") {
    errors.push({
      row: rowNumber,
      column: "required",
      message: "required must be yes or no",
    });
  }
  if (help.length > MAX_FIELD_HELP) {
    errors.push({
      row: rowNumber,
      column: "help",
      message: `help is longer than ${MAX_FIELD_HELP} characters`,
    });
  }
  const options = optionsRaw
    ? optionsRaw
        .split("|")
        .map((option) => option.trim())
        .filter(Boolean)
    : [];
  if (options.length > 30) {
    errors.push({ row: rowNumber, column: "options", message: "A field can have at most 30 options" });
  }
  const longOption = options.find((option) => option.length > 120);
  if (longOption) {
    errors.push({
      row: rowNumber,
      column: "options",
      message: "An option is longer than 120 characters",
    });
  }
  if (mapsTo && !isMapsTo(mapsTo)) {
    errors.push({
      row: rowNumber,
      column: "maps_to",
      message: "maps_to is not a supported guest field",
    });
  }
  if ((type === "select" || type === "radio") && options.length === 0) {
    errors.push({
      row: rowNumber,
      column: "options",
      message: "This field needs at least one choice",
    });
  }
  if (type === "select" || type === "radio" || type === "checkbox") {
    const seenChoices = new Set<string>();
    for (const option of options) {
      const key = option.trim().toLowerCase();
      if (!key) continue;
      if (seenChoices.has(key)) {
        errors.push({ row: rowNumber, column: "options", message: "A choice is repeated" });
        break;
      }
      seenChoices.add(key);
    }
  }
  if (mapsTo && isFieldType(type) && !fieldMapsToGuest(type)) {
    errors.push({
      row: rowNumber,
      column: "maps_to",
      message: "This field cannot map to guest data",
    });
  }
  if (errors.some((error) => error.row === rowNumber)) return;
  const field: BlueprintField = {
    id: key,
    type,
    label,
    required: storedFieldRequired(type, requiredRaw === "yes"),
    options: normalizeFieldOptions(type, options.slice(0, 30)),
    section: section.slice(0, 80),
  };
  if (help) field.help = help;
  if (mapsTo && isMapsTo(mapsTo)) field.mapsTo = mapsTo;
  fields.push(field);
}

export function parseBlueprintRows(rows: string[][]): ParsedBlueprint {
  const errors: BlueprintRowError[] = [];
  const usable = rows
    .map((cells, index) => ({ cells, rowNumber: index + 1 }))
    .filter((entry) => !blankRow(entry.cells));
  if (!usable.length) {
    return {
      fields: [],
      layoutId: "classic",
      displayMode: "single_page",
      presentationIncluded: false,
      errors: [{ row: 1, column: "section", message: "Header row is required" }],
    };
  }
  const header = headerIndex(usable[0].cells.map((cell) => cell.trim()));
  if (!("get" in header)) {
    return {
      fields: [],
      layoutId: "classic",
      displayMode: "single_page",
      presentationIncluded: false,
      errors: [header],
    };
  }
  const fields: BlueprintField[] = [];
  const seen = new Set<string>();
  let layoutId: WaiverLayoutId = "classic";
  let displayMode: WaiverDisplayMode = "single_page";
  let presentationIncluded = false;
  let expectPresentation = false;
  for (let i = 1; i < usable.length; i++) {
    const { cells, rowNumber } = usable[i];
    if (expectPresentation) {
      const presentation = readPresentation(cells, rowNumber, errors);
      if (presentation) {
        layoutId = presentation.layoutId;
        displayMode = presentation.displayMode;
        presentationIncluded = true;
      }
      expectPresentation = false;
      continue;
    }
    if (isPresentationHeader(cells)) {
      expectPresentation = true;
      continue;
    }
    pushField(cells, rowNumber, header, seen, fields, errors);
  }
  if (expectPresentation) {
    errors.push({
      row: usable[usable.length - 1]?.rowNumber ?? 1,
      column: "layout_id",
      message: "Presentation row is missing",
    });
  }
  return { fields, layoutId, displayMode, presentationIncluded, errors };
}

export function parseBlueprintCsv(text: string): ParsedBlueprint {
  return parseBlueprintRows(parseCsvTable(text));
}

export function parseBlueprintXlsx(buffer: Buffer): ParsedBlueprint {
  let sheets: { name: string; rows: string[][] }[];
  try {
    sheets = readXlsx(buffer);
  } catch (err) {
    return {
      fields: [],
      layoutId: "classic",
      displayMode: "single_page",
      presentationIncluded: false,
      errors: [
        {
          row: 0,
          column: "file",
          message: err instanceof Error ? err.message : "File is not an Excel workbook",
        },
      ],
    };
  }
  const fieldsSheet =
    sheets.find((sheet) => sheet.name.trim().toLowerCase() === "fields") ??
    sheets.find((sheet) => {
      const name = sheet.name.trim().toLowerCase();
      return name !== "instructions" && name !== "presentation";
    });
  if (!fieldsSheet) {
    return {
      fields: [],
      layoutId: "classic",
      displayMode: "single_page",
      presentationIncluded: false,
      errors: [{ row: 1, column: "section", message: "Fields sheet is required" }],
    };
  }
  const parsed = parseBlueprintRows(fieldsSheet.rows);
  const presentationSheet = sheets.find(
    (sheet) => sheet.name.trim().toLowerCase() === "presentation"
  );
  if (!presentationSheet) return parsed;
  const presentationRows = presentationSheet.rows.filter((row) => !blankRow(row));
  if (!presentationRows.length) return parsed;
  const header = presentationRows[0].map((cell) => cell.trim().toLowerCase());
  if (header[0] !== "layout_id" || header[1] !== "display_mode") {
    parsed.errors.push({
      row: 1,
      column: "layout_id",
      message: "Presentation sheet header must be layout_id, display_mode",
    });
    return parsed;
  }
  const data = presentationRows[1];
  if (!data) {
    parsed.errors.push({
      row: 2,
      column: "layout_id",
      message: "Presentation row is missing",
    });
    return parsed;
  }
  const errors: BlueprintRowError[] = [];
  const presentation = readPresentation(data, 2, errors);
  parsed.errors.push(...errors);
  if (presentation) {
    parsed.layoutId = presentation.layoutId;
    parsed.displayMode = presentation.displayMode;
    parsed.presentationIncluded = true;
  }
  return parsed;
}

export function assertBlueprintSize(byteLength: number): BlueprintRowError | null {
  if (byteLength > BLUEPRINT_MAX_BYTES) {
    return { row: 0, column: "file", message: "File is larger than 2 MB" };
  }
  return null;
}
