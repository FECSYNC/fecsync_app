/**
 * On-device guest document reading. No image bytes are returned for storage.
 * Cloud backup is a separate server route and is not called from here.
 */

export type ExtractedMinor = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
};

export type ExtractedGuest = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  postal: string;
  emergencyName: string;
  emergencyPhone: string;
  minors: ExtractedMinor[];
  labels: string[];
  strong: boolean;
};

const EMPTY: ExtractedGuest = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  state: "",
  postal: "",
  emergencyName: "",
  emergencyPhone: "",
  minors: [],
  labels: [],
  strong: false,
};

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export function checklistLabels(minorCap: number): string[] {
  const cap = Math.min(20, Math.max(1, minorCap));
  const rows = [
    "First name:",
    "Last name:",
    "Date of birth:",
    "Phone:",
    "Street:",
    "City:",
    "State:",
    "Postal code:",
    "Emergency contact:",
    "Emergency phone:",
  ];
  for (let n = 1; n <= cap; n += 1) {
    rows.push(`Minor ${n} first name:`, `Minor ${n} last name:`, `Minor ${n} date of birth:`);
  }
  return rows;
}

export function normalizeOcrText(raw: string): string {
  return raw
    .replace(/\u0000/g, " ")
    .replace(/[|]/g, "I")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "")
    .trim();
}

export function parseDobToIso(raw: string, preferDayFirst = false): string {
  const text = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return validIso(text) ? text : "";
  const digits = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (!digits) {
    const compact = text.match(/^(\d{2})(\d{2})(\d{4})$/);
    if (!compact) return "";
    return validIso(`${compact[3]}-${compact[1]}-${compact[2]}`)
      ? `${compact[3]}-${compact[1]}-${compact[2]}`
      : "";
  }
  let month = Number(digits[1]);
  let day = Number(digits[2]);
  let year = Number(digits[3]);
  if (year < 100) year += year >= 30 ? 1900 : 2000;
  if (preferDayFirst && month > 12 && day <= 12) {
    const swap = month;
    month = day;
    day = swap;
  }
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return validIso(iso) ? iso : "";
}

function validIso(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (year < 1900 || year > new Date().getFullYear()) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

function titleName(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z'\- ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function cleanPhone(raw: string): string {
  const phone = raw.replace(/[^\d+]/g, "");
  return phone.length >= 7 && phone.length <= 20 ? phone : "";
}

function withLabels(fields: Omit<ExtractedGuest, "labels" | "strong">): ExtractedGuest {
  const labels: string[] = [];
  if (fields.firstName) labels.push("First name");
  if (fields.lastName) labels.push("Last name");
  if (fields.dateOfBirth) labels.push("Date of birth");
  if (fields.phone) labels.push("Phone");
  if (fields.address) labels.push("Street");
  if (fields.city) labels.push("City");
  if (fields.state) labels.push("State");
  if (fields.postal) labels.push("Postal code");
  if (fields.emergencyName) labels.push("Emergency contact");
  if (fields.emergencyPhone) labels.push("Emergency phone");
  fields.minors.forEach((minor, index) => {
    if (minor.firstName || minor.lastName) labels.push(`Minor ${index + 1} name`);
    if (minor.dateOfBirth) labels.push(`Minor ${index + 1} date of birth`);
  });
  const strong = Boolean(
    fields.firstName &&
      fields.lastName &&
      fields.dateOfBirth &&
      (fields.address || fields.phone)
  );
  return { ...fields, labels, strong };
}

export function parseAamva(raw: string): ExtractedGuest | null {
  const text = String(raw || "");
  if (!text || (text.indexOf("ANSI ") === -1 && text.indexOf("AAMVA") === -1 && !/\bD[A-Z]{2}/.test(text))) {
    return null;
  }
  const bag: Record<string, string> = {};
  for (const line of text.split(/\r\n|\r|\n/)) {
    const match = line.match(/^([A-Z]{3})(.*)$/);
    if (!match) continue;
    bag[match[1]] = match[2].trim();
  }
  let first = titleName(bag.DAC || bag.DCT || "");
  const middle = titleName(bag.DAD || "");
  if (middle && first && !first.includes(middle)) first = `${first} ${middle}`.trim();
  let last = titleName(bag.DCS || "");
  if (!first && !last && bag.DAA) {
    const parts = bag.DAA.split(/[, ]+/).filter(Boolean);
    if (bag.DAA.includes(",") && parts.length >= 2) {
      last = titleName(parts[0]);
      first = titleName(parts[1]);
    } else if (parts.length >= 2) {
      first = titleName(parts[0]);
      last = titleName(parts[parts.length - 1]);
    }
  }
  const dob = bag.DBB ? parseDobToIso(bag.DBB) : "";
  const parsed = withLabels({
    firstName: first,
    lastName: last,
    dateOfBirth: dob,
    phone: "",
    email: "",
    address: (bag.DAG || "").trim().slice(0, 200),
    city: titleName(bag.DAI || ""),
    state: (bag.DAJ || "").trim().slice(0, 20).toUpperCase(),
    postal: (bag.DAK || "").replace(/\D/g, "").slice(0, 9),
    emergencyName: "",
    emergencyPhone: "",
    minors: [],
  });
  if (!parsed.firstName && !parsed.lastName && !parsed.dateOfBirth) return null;
  return parsed;
}

export function parseLabeledGuestText(raw: string): ExtractedGuest {
  const cleaned = normalizeOcrText(raw);
  const found: Record<string, string> = {};
  const take = (key: string, value: string) => {
    const next = value.trim();
    if (next && !found[key]) found[key] = next;
  };
  for (const line of cleaned.split("\n")) {
    const labeled = line.match(/^([A-Za-z][A-Za-z0-9 .'/-]{0,40})\s*[:\-]\s*(.+)$/);
    if (!labeled) continue;
    const key = labeled[1].toLowerCase();
    const value = labeled[2].trim();
    if (/first name/.test(key) && !/minor/.test(key)) take("firstName", titleName(value));
    else if (/last name/.test(key) && !/minor/.test(key)) take("lastName", titleName(value));
    else if (/date of birth|dob|birth/.test(key) && !/minor/.test(key)) take("dateOfBirth", parseDobToIso(value));
    else if (/phone|mobile|cell/.test(key) && !/emergency/.test(key)) take("phone", cleanPhone(value));
    else if (/^e-?mail/.test(key)) take("email", value.slice(0, 200));
    else if (/street|address/.test(key)) take("address", value.slice(0, 200));
    else if (/^city/.test(key)) take("city", titleName(value));
    else if (/^state/.test(key)) take("state", value.slice(0, 20));
    else if (/postal|zip/.test(key)) take("postal", value.replace(/[^\dA-Za-z -]/g, "").slice(0, 12));
    else if (/emergency contact|emergency name/.test(key)) take("emergencyName", titleName(value));
    else if (/emergency phone/.test(key)) take("emergencyPhone", cleanPhone(value));
  }
  const minors = parseMinors(cleaned);
  return withLabels({
    firstName: found.firstName || "",
    lastName: found.lastName || "",
    dateOfBirth: found.dateOfBirth || "",
    phone: found.phone || "",
    email: found.email || "",
    address: found.address || "",
    city: found.city || "",
    state: found.state || "",
    postal: found.postal || "",
    emergencyName: found.emergencyName || "",
    emergencyPhone: found.emergencyPhone || "",
    minors,
  });
}

export function parseMinors(raw: string): ExtractedMinor[] {
  const cleaned = normalizeOcrText(raw);
  const byNum = new Map<number, ExtractedMinor>();
  const ensure = (n: number) => {
    const current = byNum.get(n) ?? { firstName: "", lastName: "", dateOfBirth: "" };
    byNum.set(n, current);
    return current;
  };
  const re =
    /minor\s*(\d{1,2})\s*(first name|last name|date of birth|dob)\s*[:\-]\s*([^\n]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(cleaned))) {
    const n = Number(match[1]);
    if (!n || n > 20) continue;
    const row = ensure(n);
    const kind = match[2].toLowerCase();
    const value = match[3].trim();
    if (kind.startsWith("first")) row.firstName = titleName(value);
    else if (kind.startsWith("last")) row.lastName = titleName(value);
    else row.dateOfBirth = parseDobToIso(value);
  }
  return [...byNum.entries()]
    .sort((a, b) => a[0] - b[0])
    .map((entry) => entry[1])
    .filter((row) => row.firstName || row.lastName || row.dateOfBirth);
}

export function mergeExtracted(a: ExtractedGuest | null, b: ExtractedGuest | null): ExtractedGuest {
  if (!a) return b ?? { ...EMPTY };
  if (!b) return a;
  const minors = [...a.minors];
  for (const minor of b.minors) {
    const key = `${minor.firstName}|${minor.lastName}|${minor.dateOfBirth}`.toLowerCase();
    const exists = minors.some(
      (row) => `${row.firstName}|${row.lastName}|${row.dateOfBirth}`.toLowerCase() === key
    );
    if (!exists) minors.push(minor);
  }
  return withLabels({
    firstName: a.firstName || b.firstName,
    lastName: a.lastName || b.lastName,
    dateOfBirth: a.dateOfBirth || b.dateOfBirth,
    phone: a.phone || b.phone,
    email: a.email || b.email,
    address: a.address || b.address,
    city: a.city || b.city,
    state: a.state || b.state,
    postal: a.postal || b.postal,
    emergencyName: a.emergencyName || b.emergencyName,
    emergencyPhone: a.emergencyPhone || b.emergencyPhone,
    minors,
  });
}

function textFrom(bag: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = bag[key];
    if (typeof value === "string" && value.trim()) return value.slice(0, 300);
  }
  return "";
}

function minorsFromExtract(bag: Record<string, unknown>): ExtractedMinor[] {
  const listed = Array.isArray(bag.minors)
    ? bag.minors.flatMap((row) => {
        if (!row || typeof row !== "object") return [];
        const minor = row as Record<string, unknown>;
        return [
          {
            firstName: titleName(textFrom(minor, ["firstName", "first_name"])),
            lastName: titleName(textFrom(minor, ["lastName", "last_name"])),
            dateOfBirth: parseDobToIso(textFrom(minor, ["dateOfBirth", "date_of_birth", "dob"])),
          },
        ];
      })
    : [];
  if (listed.length) return listed.filter((row) => row.firstName || row.lastName || row.dateOfBirth);
  const byNum = new Map<number, ExtractedMinor>();
  for (const [key, value] of Object.entries(bag)) {
    if (typeof value !== "string" || !value.trim()) continue;
    const match = key
      .toLowerCase()
      .match(/^minor[_ -]?(\d{1,2})[_ -]?(first[_ -]?name|last[_ -]?name|date[_ -]?of[_ -]?birth|dob)$/);
    if (!match) continue;
    const n = Number(match[1]);
    if (!n || n > 20) continue;
    const row = byNum.get(n) ?? { firstName: "", lastName: "", dateOfBirth: "" };
    const kind = match[2];
    if (kind.startsWith("first")) row.firstName = titleName(value);
    else if (kind.startsWith("last")) row.lastName = titleName(value);
    else row.dateOfBirth = parseDobToIso(value);
    byNum.set(n, row);
  }
  return [...byNum.entries()]
    .sort((a, b) => a[0] - b[0])
    .map((entry) => entry[1])
    .filter((row) => row.firstName || row.lastName || row.dateOfBirth);
}

export function coerceExtracted(raw: unknown): ExtractedGuest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const bag = raw as Record<string, unknown>;
  const parsed = withLabels({
    firstName: titleName(textFrom(bag, ["firstName", "first_name"])),
    lastName: titleName(textFrom(bag, ["lastName", "last_name"])),
    dateOfBirth: parseDobToIso(textFrom(bag, ["dateOfBirth", "date_of_birth", "dob"])),
    phone: cleanPhone(textFrom(bag, ["phone"])),
    email: textFrom(bag, ["email"]),
    address: textFrom(bag, ["address", "street"]),
    city: titleName(textFrom(bag, ["city"])),
    state: textFrom(bag, ["state"]).slice(0, 20),
    postal: textFrom(bag, ["postal", "postal_code", "zip"]).slice(0, 12),
    emergencyName: titleName(textFrom(bag, ["emergencyName", "emergency_name"])),
    emergencyPhone: cleanPhone(textFrom(bag, ["emergencyPhone", "emergency_phone"])),
    minors: minorsFromExtract(bag),
  });
  if (!parsed.firstName && !parsed.lastName && !parsed.dateOfBirth) return null;
  return parsed;
}

export function parseGuestDocumentText(raw: string): ExtractedGuest {
  const aamva = parseAamva(raw);
  const labeled = parseLabeledGuestText(raw);
  return aamva ? mergeExtracted(aamva, labeled) : labeled;
}

export function assertGuestImage(file: File): void {
  const type = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  const jpeg = type === "image/jpeg" || type === "image/jpg" || name.endsWith(".jpg") || name.endsWith(".jpeg");
  const png = type === "image/png" || name.endsWith(".png");
  if (!jpeg && !png) throw new Error("Use a JPEG or PNG photo.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("That photo is larger than 6 MB.");
}

async function fileToJpegDataUrl(file: File, rotation: 0 | 90 | 180 | 270, grayscale: boolean): Promise<string> {
  assertGuestImage(file);
  const bitmap = await createImageBitmap(file);
  const swap = rotation === 90 || rotation === 270;
  const canvas = document.createElement("canvas");
  canvas.width = swap ? bitmap.height : bitmap.width;
  canvas.height = swap ? bitmap.width : bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot read that photo.");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  if (grayscale) {
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < frame.data.length; i += 4) {
      const tone = frame.data[i] * 0.3 + frame.data[i + 1] * 0.59 + frame.data[i + 2] * 0.11;
      frame.data[i] = tone;
      frame.data[i + 1] = tone;
      frame.data[i + 2] = tone;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(frame, 0, 0);
  }
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

async function readBarcode(dataUrl: string): Promise<string> {
  const Detector = (globalThis as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect: (source: ImageBitmap) => Promise<{ rawValue?: string }[]> } }).BarcodeDetector;
  if (!Detector) return "";
  try {
    const detector = new Detector({ formats: ["pdf417"] });
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const codes = await detector.detect(bitmap);
    bitmap.close();
    return codes.map((code) => code.rawValue || "").join("\n");
  } catch {
    return "";
  }
}

async function ocrDataUrl(dataUrl: string): Promise<string> {
  const mod = (await import("tesseract.js")) as {
    recognize?: (image: string, langs?: string) => Promise<{ data: { text?: string } }>;
    default?: { recognize?: (image: string, langs?: string) => Promise<{ data: { text?: string } }> };
  };
  const recognize = mod.recognize ?? mod.default?.recognize;
  if (!recognize) throw new Error("On-device reading is not available in this browser.");
  const result = await recognize(dataUrl, "eng");
  return result.data.text || "";
}

async function readOne(file: File, rotation: 0 | 90 | 180 | 270, grayscale: boolean): Promise<ExtractedGuest> {
  const dataUrl = await fileToJpegDataUrl(file, rotation, grayscale);
  const barcode = await readBarcode(dataUrl);
  const text = `${barcode}\n${await ocrDataUrl(dataUrl)}`;
  return parseGuestDocumentText(text);
}

/** Local read. The JPEG data URL is not returned. Call the cloud route only when `strong` is false. */
export async function readGuestDocumentLocally(front: File, extra?: File | null): Promise<ExtractedGuest> {
  if (typeof document === "undefined") return { ...EMPTY };
  let best = await readOne(front, 0, false);
  if (!best.strong) {
    for (const rotation of [90, 180, 270] as const) {
      const next = await readOne(front, rotation, false);
      best = mergeExtracted(best, next);
      if (best.strong) break;
    }
  }
  if (!best.strong) {
    best = mergeExtracted(best, await readOne(front, 0, true));
  }
  if (extra) {
    best = mergeExtracted(best, await readOne(extra, 0, false));
  }
  return best;
}
