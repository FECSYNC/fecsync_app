/**
 * Guest signature capture. One WaiverRecord per covered person, shared waiverGroupId.
 * Public callers pass a token; orgId comes from that token, never from the body.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import type { Prisma, WaiverDocumentKind, WaiverSignChannel } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ForbiddenError } from "@/lib/auth/http-error";
import { isValidId } from "@/lib/ids";
import { logActivityEntryAsync } from "@/lib/audit/activityLog";
import { incrementRateLimit, isRateLimitExceeded } from "@/lib/rateLimit";
import { sendWaiverGuestEmail } from "@/lib/mailer";
import { assertWaiversEnabled } from "@/lib/waivers/assert";
import { canShareFieldRow, cleanFieldRowKey, fieldLabelLimit, normalizeSharedRows, sliderBounds } from "@/lib/waivers/presentation";
import {
  DOCUMENT_KINDS,
  FORM_KINDS,
  assertWaiversStaff,
  waiverStampedLocationWhere,
  type WaiversActor,
} from "@/lib/waivers/common";
import { waiverRecordDisplayStatus } from "@/lib/waivers/records";
import {
  computeWaiverExpiresAt,
  endOfVenueYear,
  isSignedWaiverCurrentlyValid,
  zonedParts,
  type WaiverExpiryRuleName,
} from "@/lib/waivers/expiry";
import { sanitizeWaiverHtml } from "@/lib/waivers/sanitizeHtml";
import {
  namesMatch,
  readAcceptedClauses,
  resolveEffectiveSignature,
  type AcceptedClauseRow,
} from "@/lib/waivers/guestCaptureRules";
import {
  WaiverLinkError,
  hashWaiverToken,
  signageTokenValue,
} from "@/lib/waivers/signToken";
import { createWalkinPasses, healMissingWalkinPass, readActiveWalkinPass, readReplayWalkinPass, type WalkinPassView } from "@/lib/waivers/walkinPass";

const UNAVAILABLE = "This waiver link is not available.";
const NOT_FOUND = "This waiver link was not found.";
const EXPIRED = "This link has expired.";

type FieldDef = {
  id: string;
  type: string;
  label: string;
  required: boolean;
  options: string[];
  help: string;
  mapsTo: string;
  section: string;
  row: string;
};

type PersonIn = {
  firstName: string;
  lastName: string;
  fullName: string;
  dob: Date | null;
  email: string | null;
  phone: string | null;
  adultConfirmed: boolean;
  minor: boolean;
};

type GuardianIn = {
  firstName: string;
  lastName: string;
  fullName: string;
  dob: Date;
  relationship: string;
  email: string | null;
  phone: string | null;
};

export type SignReceipt = {
  state: "receipt";
  status: "signed" | "declined";
  publicRefs: string[];
  recordIds: string[];
  waiverGroupId: string;
  signedAt: string;
  expiresAt: string | null;
  confirmationEmail: "sent" | "failed" | "skipped";
  replay: boolean;
  walkinPass?: WalkinPassView | null;
};

export type SignFormPayload = {
  state: "form";
  channel: WaiverSignChannel;
  brand: { name: string; logoUrl: string | null };
  venueName: string;
  timeZone: string;
  locale: string;
  locales: { locale: string; title: string }[];
  template: {
    id: string;
    kind: WaiverDocumentKind;
    name: string;
    versionId: string;
    contentSha256: string;
    title: string;
    bodyHtml: string;
    fields: FieldDef[];
    layoutId: string;
    displayMode: string;
    allowDocumentExtract: boolean;
    /** Null inherits WaiverSettings. Step 1 does not apply this on POST. */
    allowTypedSignature: boolean | null;
    allowDrawnSignature: boolean | null;
    signatureRequired: boolean;
  };
  extraForms: {
    templateId: string;
    name: string;
    versionId: string;
    fields: FieldDef[];
    layoutId: string;
    displayMode: string;
    allowDocumentExtract: boolean;
    allowTypedSignature: boolean | null;
    allowDrawnSignature: boolean | null;
  }[];
  settings: {
    ageOfMajorityYears: number;
    allowAdultSelfSign: boolean;
    allowGroupSigning: boolean;
    maxMinorsPerGuardianSession: number;
    requireGuardianForMinors: boolean;
    requireIntentCheckbox: boolean;
    allowTypedSignature: boolean;
    allowDrawnSignature: boolean;
    optionalWitness: boolean;
  };
    signingContext: {
      lockedEmail: string | null;
      bookingLabel: string | null;
      productLabel: string | null;
    };
    walkinPass?: WalkinPassView | null;
  };

const OPEN_WAIVER_LINK = ["queued", "sent", "failed", "opened"] as const;

/** After one link is signed, other open links for that same target stop working. */
async function retireSiblingWaiverLinks(
  tx: Prisma.TransactionClient,
  bound: Extract<Bound, { source: "request" }>
) {
  if (!bound.partyGuestId && !bound.bookingId && !bound.guestProfileId) return;
  const where: Prisma.WaiverRequestWhereInput = {
    orgId: bound.orgId,
    locationId: bound.locationId,
    templateId: bound.templateId,
    id: { not: bound.requestId },
    status: { in: [...OPEN_WAIVER_LINK] },
  };
  if (bound.partyGuestId) {
    where.partyGuestId = bound.partyGuestId;
  } else if (bound.bookingId) {
    where.bookingId = bound.bookingId;
    where.partyGuestId = null;
    where.guestProfileId = bound.guestProfileId;
    if (!bound.guestProfileId) {
      where.createdById = bound.createdById ? { not: null } : null;
    }
  } else {
    where.guestProfileId = bound.guestProfileId;
    where.partyGuestId = null;
  }
  await tx.waiverRequest.updateMany({ where, data: { status: "cancelled" } });
}

type Bound =
  | {
      source: "request";
      requestId: string;
      orgId: string;
      locationId: string;
      templateId: string;
      channel: WaiverSignChannel;
      createdById: string | null;
      guestProfileId: string | null;
      bookingId: string | null;
      partyGuestId: string | null;
    }
  | {
      source: "signage";
      orgId: string;
      locationId: string;
      templateId: string;
      channel: WaiverSignChannel;
    };

function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  const pepper =
    process.env.WAIVER_IP_PEPPER?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    "fecsync-waiver";
  return createHash("sha256").update(`${pepper}:${ip}`).digest("hex");
}

function safeZone(timeZone: string | null | undefined): string {
  const zone = timeZone?.trim() || "UTC";
  try {
    Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    return "UTC";
  }
}

function ageYears(dob: Date, now: Date, timeZone: string): number {
  const today = zonedParts(now, timeZone);
  let age = today.year - dob.getUTCFullYear();
  const month = dob.getUTCMonth() + 1;
  const day = dob.getUTCDate();
  if (today.month < month || (today.month === month && today.day < day)) age -= 1;
  return age;
}

function parseDob(value: unknown, label: string): Date | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    throw new Error(`${label} is invalid`);
  }
  if (dt.getTime() > Date.now() + 86_400_000) {
    throw new Error(`${label} cannot be in the future`);
  }
  return dt;
}

function cleanName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.split(" ").filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function personName(raw: Record<string, unknown>): { firstName: string; lastName: string; fullName: string } {
  const full = cleanName(raw.fullName ?? raw.name);
  const first = cleanName(raw.firstName) || splitName(full).firstName;
  const last = cleanName(raw.lastName) || splitName(full).lastName;
  const fullName = full || `${first} ${last}`.trim();
  return { firstName: first, lastName: last, fullName };
}

function normEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.includes("@") && email.length <= 200 ? email : null;
}

/** Wizard picture steps collect email in the guest chrome, not only in a mapped field. */
function pictureFormRequiresEmail(
  layoutId: string,
  displayMode: string,
  fields: { type: string }[]
): boolean {
  return (
    layoutId === "wizard" &&
    displayMode === "multi_step" &&
    fields.some((field) => field.type === "page_break")
  );
}

/** Picture steps mark street, city, state, and postal code required on one address field. */
function assertPictureAddressComplete(
  layoutId: string,
  displayMode: string,
  fields: { id: string; type: string; label: string; required: boolean }[],
  answers: Record<string, string>
) {
  if (!pictureFormRequiresEmail(layoutId, displayMode, fields)) return;
  for (const field of fields) {
    if (field.type !== "address" || !field.required) continue;
    const raw = answers[field.id];
    if (!raw) continue;
    let record: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        record = parsed as Record<string, unknown>;
      }
    } catch {
      record = null;
    }
    const text = (key: string) => {
      const value = record?.[key];
      return typeof value === "string" ? value.trim() : "";
    };
    if (!record || !text("line1") || !text("city") || !text("state") || !text("postal")) {
      throw new Error(`${field.label} needs a street, city, state, and postal code`);
    }
  }
}

function normPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const phone = value.replace(/[^\d+]/g, "");
  return phone.length >= 7 && phone.length <= 20 ? phone : null;
}

function readFields(value: unknown): FieldDef[] {
  if (!Array.isArray(value)) return [];
  const out: FieldDef[] = [];
  for (const field of value) {
    if (!field || typeof field !== "object" || Array.isArray(field)) continue;
    const f = field as Record<string, unknown>;
    const id = typeof f.id === "string" ? f.id.trim().slice(0, 80) : "";
    if (!id) continue;
    const type = typeof f.type === "string" ? f.type.slice(0, 40) : "text";
    out.push({
      id,
      type,
      label: typeof f.label === "string" ? f.label.slice(0, fieldLabelLimit(type)) : id,
      required: f.required === true,
      options: Array.isArray(f.options)
        ? f.options.filter((option): option is string => typeof option === "string").slice(0, 40)
        : [],
      help: typeof f.help === "string" ? f.help.slice(0, 300) : "",
      mapsTo: typeof f.mapsTo === "string" ? f.mapsTo : "",
      section: typeof f.section === "string" ? f.section.slice(0, 80) : "",
      row: canShareFieldRow(type) ? cleanFieldRowKey(f.row) : "",
    });
  }
  return normalizeSharedRows(out);
}

const ANSWER_SKIP_TYPES = new Set([
  "clause",
  "minor_repeater",
  "signature",
  "photo_reader",
  "page_break",
  "section",
  "html",
  "currency",
  "calculation",
]);
const CHOICE_TYPES = new Set(["select", "radio", "checkbox"]);

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map((part) => Number(part));
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

function readAddressAnswer(raw: unknown): string {
  let record: Record<string, unknown> | null = null;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return "";
    if (!text.startsWith("{")) return text.slice(0, 2000);
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
      record = parsed as Record<string, unknown>;
    } catch {
      return text.slice(0, 2000);
    }
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    record = raw as Record<string, unknown>;
  }
  if (!record) return "";
  const source = record;
  const text = (key: string) => {
    const value = source[key];
    return typeof value === "string" ? value.trim() : "";
  };
  const line1 = text("line1") || text("street") || text("address");
  const line2 = text("line2");
  const city = text("city");
  const state = text("state");
  const postal = text("postal") || text("postal_code");
  if (![line1, line2, city, state, postal].some(Boolean)) return "";
  return JSON.stringify({
    line1: line1.slice(0, 200),
    line2: line2.slice(0, 200),
    city: city.slice(0, 80),
    state: state.slice(0, 80),
    postal: postal.slice(0, 20),
  }).slice(0, 2000);
}

function readAnswers(fields: FieldDef[], raw: unknown): Record<string, string> {
  const bag =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const payload: Record<string, string> = {};
  for (const field of fields) {
    if (ANSWER_SKIP_TYPES.has(field.type)) continue;
    let value = "";
    if (field.type === "hidden") {
      value = field.help.slice(0, 2000);
    } else if (field.type === "address") {
      value = readAddressAnswer(bag[field.id]);
    } else if (typeof bag[field.id] === "string") {
      value = bag[field.id].trim().slice(0, 2000);
    } else if (bag[field.id] != null && typeof bag[field.id] === "object") {
      value = JSON.stringify(bag[field.id]).slice(0, 4000);
    }
    if (/^data:/i.test(value) || value.includes(";base64,")) value = "";
    if (field.type === "date" && value && !isIsoDate(value)) {
      throw new Error(`${field.label} is not a valid date`);
    }
    if (field.type === "time" && value) {
      const match = /^(\d{2}:\d{2})(?::\d{2})?$/.exec(value);
      const hours = match ? Number(match[1].slice(0, 2)) : NaN;
      const minutes = match ? Number(match[1].slice(3, 5)) : NaN;
      if (!match || hours > 23 || minutes > 59) {
        throw new Error(`${field.label} is not a valid time`);
      }
      value = match[1];
    }
    if (field.type === "website" && value) {
      if (/\s/.test(value)) throw new Error(`${field.label} is not a valid website`);
      value = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    }
    if (field.type === "slider") {
      const bounds = sliderBounds(field.options);
      if (!value) value = String(bounds.min);
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount < bounds.min || amount > bounds.max) {
        throw new Error(`${field.label} is out of range`);
      }
      value = String(amount);
    }
    if (
      (field.type === "number") &&
      value &&
      !Number.isFinite(Number(value))
    ) {
      throw new Error(`${field.label} must be a number`);
    }
    if (field.type === "rating" && value) {
      const max = Math.min(10, Math.max(1, Number(field.options[0]) || 5));
      const score = Number(value);
      if (!Number.isInteger(score) || score < 1 || score > max) {
        throw new Error(`${field.label} is not a valid rating`);
      }
    }
    if (field.type === "consent" && field.required && value !== "yes") {
      throw new Error(`${field.label} is required`);
    }
    if (field.type === "checkbox" && field.options.length === 0 && value && value !== "yes") {
      throw new Error(`${field.label} is not a valid choice`);
    }
    if (field.required && !value) {
      throw new Error(`${field.label} is required`);
    }
    if (value && CHOICE_TYPES.has(field.type) && field.options.length && !field.options.includes(value)) {
      throw new Error(`${field.label} is not a valid choice`);
    }
    if (value) payload[field.id] = value.replace(/[<>]/g, "");
  }
  return payload;
}

function sanitizeDrawn(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") throw new Error("A drawn signature is required");
  const text = raw.trim();
  if (text.length > 100_000) throw new Error("Signature is too large");
  if (!/^<svg\b/i.test(text) || !/<\/svg>\s*$/i.test(text)) {
    throw new Error("A drawn signature is required");
  }
  if (/script|foreignObject|onload|onerror|javascript:|href|xlink/i.test(text)) {
    throw new Error("Signature image is not allowed");
  }
  const paths = [...text.matchAll(/<path\b[^>]*\bd="([^"]+)"[^>]*\/?>/gi)].map(
    (match) => match[1]
  );
  if (!paths.length) throw new Error("A drawn signature is required");
  for (const d of paths) {
    if (!/^[MmLlHhVvCcSsQqTtAaZz0-9\s,.\-]+$/.test(d)) {
      throw new Error("Signature image is not allowed");
    }
  }
  if (!paths.some((d) => /[LlHhVvCcSsQqTtAa]/.test(d))) {
    throw new Error("A drawn signature is required");
  }
  const body = paths
    .map(
      (d) =>
        `<path d="${d}" fill="none" stroke="#1c1917" stroke-width="2"/>`
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 180">${body}</svg>`;
}

function pickLocale(
  requested: string | null | undefined,
  locales: { locale: string }[],
  fallback: string
): string {
  const codes = locales.map((row) => row.locale);
  const want = (requested ?? "").trim().toLowerCase();
  const exact = codes.find((code) => code.toLowerCase() === want);
  if (exact) return exact;
  const prefix = want.split("-")[0];
  if (prefix) {
    const hit = codes.find((code) => code.toLowerCase().startsWith(prefix));
    if (hit) return hit;
  }
  if (codes.includes(fallback)) return fallback;
  return codes[0] || "en";
}

type PublishedLocaleRow = {
  locale: string;
  title?: string;
  bodyHtml?: string;
  fieldsJson: unknown;
  layoutId: string;
  displayMode: string;
  allowDocumentExtract: boolean;
};

type PublishedVersionView = {
  localeDefault: string;
  layoutId: string;
  displayMode: string;
  allowDocumentExtract: boolean;
  allowTypedSignature: boolean | null;
  allowDrawnSignature: boolean | null;
  fieldsJson: unknown;
  locales: PublishedLocaleRow[];
};

/** Same locale, field, and presentation resolution for public sign, kiosk GET, and kiosk session. */
function resolvePublishedLocaleContent(
  version: PublishedVersionView,
  localeHint: string | null | undefined,
  settingsDefaultLocale: string
) {
  const locale = pickLocale(
    localeHint ?? settingsDefaultLocale,
    version.locales,
    version.localeDefault || "en"
  );
  const localeRow = version.locales.find((row) => row.locale === locale);
  return {
    locale,
    localeRow,
    fields: readFields(localeRow?.fieldsJson ?? version.fieldsJson),
    layoutId: localeRow?.layoutId || version.layoutId || "classic",
    displayMode: localeRow?.displayMode || version.displayMode || "single_page",
    allowDocumentExtract:
      (localeRow?.allowDocumentExtract ?? version.allowDocumentExtract) === true,
    allowTypedSignature: version.allowTypedSignature ?? null,
    allowDrawnSignature: version.allowDrawnSignature ?? null,
  };
}

async function assertPublicOrg(orgId: string): Promise<void> {
  try {
    await assertWaiversEnabled(orgId);
  } catch (err) {
    if (err instanceof ForbiddenError || (err instanceof Error && err.name === "AuthHttpError")) {
      throw new WaiverLinkError(UNAVAILABLE, 403);
    }
    throw new WaiverLinkError(UNAVAILABLE, 403);
  }
}

async function loadBundle(orgId: string, locationId: string, templateId: string) {
  const [org, venue, template, settings] = await Promise.all([
    prisma.organization.findFirst({
      where: { id: orgId },
      select: { id: true, name: true, slug: true, status: true },
    }),
    prisma.venueLocation.findFirst({
      where: { id: locationId, orgId },
    }),
    prisma.waiverTemplate.findFirst({
      where: { id: templateId, orgId },
      include: {
        currentPublishedVersion: { include: { locales: true } },
      },
    }),
    prisma.waiverSettings.findFirst({
      where: { orgId, locationId },
    }).then(async (row) => row ?? prisma.waiverSettings.findFirst({
      where: { orgId, locationId: null },
    })),
  ]);
  if (!org || !venue) throw new WaiverLinkError(NOT_FOUND, 404);
  if (venue.status !== "active") throw new WaiverLinkError(UNAVAILABLE, 403);
  if (
    !template ||
    template.status !== "published" ||
    template.archivedAt ||
    !template.currentPublishedVersion
  ) {
    throw new WaiverLinkError(NOT_FOUND, 404);
  }
  if (template.locationId && template.locationId !== locationId) {
    throw new WaiverLinkError(NOT_FOUND, 404);
  }
  const version = template.currentPublishedVersion;
  const locales = await prisma.waiverTemplateLocale.findMany({
    where: { versionId: version.id },
  });
  return {
    org,
    venue,
    template,
    version: { ...version, locales },
    settings,
  };
}

function settingsView(row: Awaited<ReturnType<typeof loadBundle>>["settings"]) {
  return {
    ageOfMajorityYears: row?.ageOfMajorityYears ?? 18,
    allowAdultSelfSign: row?.allowAdultSelfSign ?? true,
    allowGroupSigning: row?.allowGroupSigning ?? true,
    maxMinorsPerGuardianSession: row?.maxMinorsPerGuardianSession ?? 8,
    requireGuardianForMinors: row?.requireGuardianForMinors ?? true,
    requireIntentCheckbox: row?.requireIntentCheckbox ?? true,
    allowTypedSignature: row?.allowTypedSignature ?? true,
    allowDrawnSignature: row?.allowDrawnSignature ?? true,
    optionalWitness: row?.optionalWitness ?? false,
    expiryRule: (row?.expiryRule ?? "calendar_year") as WaiverExpiryRuleName,
    expiryDays: row?.expiryDays ?? null,
    kioskRequireStaffPin: row?.kioskRequireStaffPin ?? true,
    kioskSessionMinutes: row?.kioskSessionMinutes ?? 5,
    defaultLocale: row?.defaultLocale ?? "en",
  };
}

function signatureRequired(kind: WaiverDocumentKind): boolean {
  if (kind === "inquiry") return false;
  return true;
}

async function brandFor(orgId: string, orgName: string) {
  try {
    const { resolveBrandForOrg } = await import("@/lib/companyProfile");
    const brand = await resolveBrandForOrg(orgId);
    return {
      name: brand.displayName?.trim() || orgName,
      logoUrl: brand.logoUrl?.trim() || null,
    };
  } catch {
    return { name: orgName, logoUrl: null };
  }
}

async function extraForms(
  orgId: string,
  locationId: string,
  templateId: string,
  locale: string
) {
  const mine = await prisma.waiverRequirement.findMany({
    where: {
      orgId,
      templateId,
      OR: [{ locationId }, { locationId: null }],
    },
    select: { targetType: true, targetId: true },
  });
  const keyed = mine.filter((row) => row.targetId);
  const broadTypes = [
    ...new Set(
      mine
        .filter((row) => !row.targetId && row.targetType === "all_admissions")
        .map((row) => row.targetType)
    ),
  ];
  if (!keyed.length && !broadTypes.length) return [];
  const targetMatch: Prisma.WaiverRequirementWhereInput[] = [
    ...keyed.map((row) => ({
      targetType: row.targetType,
      targetId: row.targetId,
    })),
    ...broadTypes.map((targetType) => ({ targetType, targetId: null })),
  ];
  const siblings = await prisma.waiverRequirement.findMany({
    where: {
      orgId,
      templateId: { not: templateId },
      AND: [
        {
          OR: targetMatch,
        },
        { OR: [{ locationId }, { locationId: null }] },
      ],
      template: {
        status: "published",
        archivedAt: null,
        kind: { in: [...FORM_KINDS] },
        OR: [{ locationId: null }, { locationId }],
      },
    },
    include: {
      template: {
        include: { currentPublishedVersion: true },
      },
    },
  });
  const versionIds = siblings
    .map((row) => row.template.currentPublishedVersion?.id)
    .filter((id): id is string => Boolean(id));
  const localeRows = versionIds.length
    ? await prisma.waiverTemplateLocale.findMany({
        where: { versionId: { in: versionIds }, locale },
      })
    : [];
  const localeByVersion = new Map(localeRows.map((row) => [row.versionId, row]));
  const seen = new Set<string>();
  const forms: SignFormPayload["extraForms"] = [];
  for (const row of siblings) {
    const version = row.template.currentPublishedVersion;
    if (!version || seen.has(row.templateId)) continue;
    seen.add(row.templateId);
    const localeRow = localeByVersion.get(version.id);
    forms.push({
      templateId: row.templateId,
      name: row.template.name,
      versionId: version.id,
      fields: readFields(localeRow?.fieldsJson ?? version.fieldsJson),
      layoutId: localeRow?.layoutId || version.layoutId || "classic",
      displayMode: localeRow?.displayMode || version.displayMode || "single_page",
      allowDocumentExtract:
        (localeRow?.allowDocumentExtract ?? version.allowDocumentExtract) === true,
      allowTypedSignature: version.allowTypedSignature ?? null,
      allowDrawnSignature: version.allowDrawnSignature ?? null,
    });
  }
  return forms;
}

async function resolveBound(
  token: string,
  slugs?: { orgSlug?: string | null; venueSlug?: string | null }
): Promise<Bound> {
  const raw = token.trim().toLowerCase();
  if (!/^[a-f0-9]{32,128}$/.test(raw)) throw new WaiverLinkError(NOT_FOUND, 404);
  const tokenHash = hashWaiverToken(raw);
  const request = await prisma.waiverRequest.findFirst({
    where: { publicTokenHash: tokenHash },
  });
  let bound: Bound;
  if (request) {
    if (request.status === "cancelled") throw new WaiverLinkError(NOT_FOUND, 404);
    if (request.expiresAt.getTime() <= Date.now() || request.status === "expired") {
      if (request.status !== "expired" && request.status !== "completed") {
        await prisma.waiverRequest.update({
          where: { id: request.id },
          data: { status: "expired" },
        });
      }
      if (request.status !== "completed") throw new WaiverLinkError(EXPIRED, 410);
    }
    bound = {
      source: "request",
      requestId: request.id,
      orgId: request.orgId,
      locationId: request.locationId,
      templateId: request.templateId,
      channel: request.channel,
      createdById: request.createdById,
      guestProfileId: request.guestProfileId,
      bookingId: request.bookingId,
      partyGuestId: request.partyGuestId,
    };
  } else {
    const signage = await prisma.waiverSignageToken.findFirst({
      where: { tokenHash, revokedAt: null },
    });
    if (!signage) throw new WaiverLinkError(NOT_FOUND, 404);
    const expected = signageTokenValue(
      signage.orgId,
      signage.locationId,
      signage.templateId,
      signage.nonce
    );
    if (expected !== raw) throw new WaiverLinkError(NOT_FOUND, 404);
    bound = {
      source: "signage",
      orgId: signage.orgId,
      locationId: signage.locationId,
      templateId: signage.templateId,
      channel: "qr",
    };
  }

  await assertPublicOrg(bound.orgId);
  if (slugs?.orgSlug || slugs?.venueSlug) {
    const [org, venue] = await Promise.all([
      prisma.organization.findFirst({
        where: { id: bound.orgId },
        select: { slug: true },
      }),
      prisma.venueLocation.findFirst({
        where: { id: bound.locationId, orgId: bound.orgId },
        select: { slug: true },
      }),
    ]);
    const orgOk =
      !slugs.orgSlug || org?.slug.toLowerCase() === slugs.orgSlug.trim().toLowerCase();
    const venueOk =
      !slugs.venueSlug ||
      venue?.slug.toLowerCase() === slugs.venueSlug.trim().toLowerCase();
    if (!orgOk || !venueOk) throw new WaiverLinkError(NOT_FOUND, 404);
  }
  return bound;
}

function expiryFor(
  template: { defaultExpiryRule: string | null; defaultExpiryDays: number | null },
  settings: ReturnType<typeof settingsView>,
  signedAt: Date,
  timeZone: string,
  untilDate: Date | null
): Date | null {
  const templateRule = template.defaultExpiryRule;
  const rule = (templateRule || settings.expiryRule || "calendar_year") as WaiverExpiryRuleName;
  const expiryDays =
    rule !== "days"
      ? null
      : templateRule === "days"
        ? (template.defaultExpiryDays ?? settings.expiryDays)
        : settings.expiryDays;
  return computeWaiverExpiresAt({
    rule,
    signedAt,
    expiryDays,
    untilDate:
      rule === "until_date" ? untilDate ?? endOfVenueYear(signedAt, timeZone) : null,
    timeZone,
  });
}

function stillValid(
  row: {
    status: string;
    signedAt: Date | null;
    expiresAt: Date | null;
    voidedAt: Date | null;
  },
  template: { defaultExpiryRule: string | null; defaultExpiryDays: number | null },
  settings: ReturnType<typeof settingsView>,
  timeZone: string,
  now: Date
): boolean {
  if (row.status === "declined") return true;
  if (row.voidedAt || row.status === "voided" || row.status === "revoked") return false;
  if (row.status !== "signed" || !row.signedAt) return false;
  const templateRule = template.defaultExpiryRule;
  const rule = (templateRule || settings.expiryRule || "calendar_year") as WaiverExpiryRuleName;
  const expiryDays =
    rule !== "days"
      ? null
      : templateRule === "days"
        ? (template.defaultExpiryDays ?? settings.expiryDays)
        : settings.expiryDays;
  try {
    return isSignedWaiverCurrentlyValid({
      rule,
      signedAt: row.signedAt,
      expiresAt: row.expiresAt,
      now,
      timeZone,
    });
  } catch {
    return false;
  }
}

async function receiptForGroup(
  orgId: string,
  waiverGroupId: string,
  replay: boolean
): Promise<SignReceipt | null> {
  const rows = await prisma.waiverRecord.findMany({
    where: { orgId, waiverGroupId },
    orderBy: { createdAt: "asc" },
  });
  if (!rows.length) return null;
  const signedAt = rows.find((row) => row.signedAt)?.signedAt ?? rows[0].createdAt;
  const expires = rows.find((row) => row.expiresAt)?.expiresAt ?? null;
  const status = rows.every((row) => row.status === "declined") ? "declined" : "signed";
  const channel = rows[0].channel;
  const walkinPass =
    status === "signed" && (channel === "kiosk" || channel === "onsite")
      ? await readReplayWalkinPass({
          orgId,
          locationId: rows[0].locationId,
          guestProfileIds: rows.map((row) => row.guestProfileId),
        })
      : null;
  return {
    state: "receipt",
    status,
    publicRefs: rows.map((row) => row.publicRef),
    recordIds: rows.map((row) => row.id),
    waiverGroupId,
    signedAt: signedAt.toISOString(),
    expiresAt: expires ? expires.toISOString() : null,
    confirmationEmail: "skipped",
    replay,
    walkinPass,
  };
}

async function replayReceipt(
  orgId: string,
  waiverGroupId: string
): Promise<SignReceipt | null> {
  const receipt = await receiptForGroup(orgId, waiverGroupId, true);
  if (!receipt || receipt.status !== "signed" || receipt.walkinPass) return receipt;
  const records = await prisma.waiverRecord.findMany({
    where: { orgId, waiverGroupId },
    select: { channel: true, locationId: true, guestProfileId: true, signedAt: true },
  });
  const channel = records[0]?.channel;
  const signedAt = records.find((row) => row.signedAt)?.signedAt;
  if (!signedAt || (channel !== "kiosk" && channel !== "onsite") || !records[0]) return receipt;
  try {
    const healed = await healMissingWalkinPass({
      orgId,
      locationId: records[0].locationId,
      guestProfileIds: records.map((row) => row.guestProfileId),
      signedAt,
    });
    return healed ? { ...receipt, walkinPass: healed } : receipt;
  } catch (err) {
    console.error(
      "Walk-in pass was not saved:",
      err instanceof Error ? err.message : "error"
    );
    return receipt;
  }
}

async function requestLockedEmail(bound: Bound, declined: boolean): Promise<string | null> {
  if (declined || bound.source !== "request") return null;
  const invited = await prisma.waiverRequest.findFirst({
    where: { id: bound.requestId },
    select: { toEmail: true },
  });
  return invited?.toEmail?.trim().toLowerCase() || null;
}

async function loadSigningContext(bound: Bound): Promise<SignFormPayload["signingContext"]> {
  const empty = { lockedEmail: null, bookingLabel: null, productLabel: null };
  if (bound.source !== "request") return empty;
  const request = await prisma.waiverRequest.findFirst({
    where: { id: bound.requestId },
    select: { toEmail: true, bookingId: true },
  });
  if (!request) return empty;
  let lockedEmail = request.toEmail?.trim().toLowerCase() || null;
  let bookingLabel: string | null = null;
  let productLabel: string | null = null;
  if (request.bookingId) {
    const booking = await prisma.booking.findFirst({
      where: { id: request.bookingId, orgId: bound.orgId },
      select: {
        publicId: true,
        lines: { take: 1, orderBy: { createdAt: "asc" }, select: { productName: true } },
      },
    });
    if (booking) {
      bookingLabel = booking.publicId || "Your booking";
      productLabel = booking.lines[0]?.productName ?? null;
    }
  }
  return { lockedEmail, bookingLabel, productLabel };
}

async function buildForm(
  bound: Bound,
  localeHint: string | null
): Promise<SignFormPayload> {
  const bundle = await loadBundle(bound.orgId, bound.locationId, bound.templateId);
  const view = settingsView(bundle.settings);
  const version = bundle.version;
  const resolved = resolvePublishedLocaleContent(
    version,
    localeHint,
    view.defaultLocale
  );
  const { locale, localeRow, fields } = resolved;
  const brand = await brandFor(bound.orgId, bundle.org.name);
  const forms = await extraForms(bound.orgId, bound.locationId, bound.templateId, locale);
  const signingContext = await loadSigningContext(bound);
  return {
    state: "form",
    channel: bound.channel,
    brand,
    venueName: bundle.venue.name,
    timeZone: safeZone(bundle.venue.timezone),
    locale,
    locales: version.locales.map((row) => ({ locale: row.locale, title: row.title })),
    template: {
      id: bundle.template.id,
      kind: bundle.template.kind,
      name: bundle.template.name,
      versionId: version.id,
      contentSha256: version.contentSha256,
      title: localeRow?.title || version.title,
      bodyHtml: sanitizeWaiverHtml(localeRow?.bodyHtml || version.bodyHtml),
      fields,
      layoutId: resolved.layoutId,
      displayMode: resolved.displayMode,
      allowDocumentExtract: resolved.allowDocumentExtract,
      allowTypedSignature: resolved.allowTypedSignature,
      allowDrawnSignature: resolved.allowDrawnSignature,
      signatureRequired: signatureRequired(bundle.template.kind),
    },
    extraForms: forms,
    settings: {
      ageOfMajorityYears: view.ageOfMajorityYears,
      allowAdultSelfSign: view.allowAdultSelfSign,
      allowGroupSigning: view.allowGroupSigning,
      maxMinorsPerGuardianSession: view.maxMinorsPerGuardianSession,
      requireGuardianForMinors: view.requireGuardianForMinors,
      requireIntentCheckbox: view.requireIntentCheckbox,
      allowTypedSignature: view.allowTypedSignature,
      allowDrawnSignature: view.allowDrawnSignature,
      optionalWitness: view.optionalWitness,
    },
    signingContext,
    walkinPass: null,
  };
}

export async function loadPublicSign(
  token: string,
  opts?: {
    orgSlug?: string | null;
    venueSlug?: string | null;
    locale?: string | null;
  }
): Promise<SignReceipt | SignFormPayload> {
  const bound = await resolveBound(token, opts);
  if (bound.source === "request") {
    const request = await prisma.waiverRequest.findFirst({
      where: { id: bound.requestId },
    });
    if (!request) throw new WaiverLinkError(NOT_FOUND, 404);
    if (
      request.waiverGroupId &&
      (request.status === "completed" || request.status === "opened")
    ) {
      const bundle = await loadBundle(bound.orgId, bound.locationId, bound.templateId);
      const view = settingsView(bundle.settings);
      const zone = safeZone(bundle.venue.timezone);
      const rows = await prisma.waiverRecord.findMany({
        where: { orgId: bound.orgId, waiverGroupId: request.waiverGroupId },
      });
      const now = new Date();
      if (
        rows.length &&
        rows.every((row) => stillValid(row, bundle.template, view, zone, now))
      ) {
        const receipt = await receiptForGroup(bound.orgId, request.waiverGroupId, true);
        if (receipt) return receipt;
      }
    }
    if (request.status === "completed" && !request.waiverGroupId) {
      return completedInquiryReceipt(true);
    }
    if (request.status === "queued" || request.status === "sent" || request.status === "failed") {
      await prisma.waiverRequest.update({
        where: { id: request.id },
        data: { status: "opened" },
      });
    }
  }
  return buildForm(bound, opts?.locale ?? null);
}

function completedInquiryReceipt(replay: boolean): SignReceipt {
  return {
    state: "receipt",
    status: "signed",
    publicRefs: [],
    recordIds: [],
    waiverGroupId: "",
    signedAt: new Date().toISOString(),
    expiresAt: null,
    confirmationEmail: "skipped",
    replay,
  };
}

function parsePeople(
  body: Record<string, unknown>,
  view: ReturnType<typeof settingsView>,
  timeZone: string,
  now: Date,
  declined: boolean
): { people: PersonIn[]; guardian: GuardianIn | null } {
  const rawList = Array.isArray(body.people) ? body.people : body.person ? [body.person] : [];
  if (!rawList.length) throw new Error("Add the person covered by this waiver");
  if (rawList.length > 20) throw new Error("Too many people on this waiver");
  const people: PersonIn[] = rawList.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Each person needs a name");
    }
    const raw = entry as Record<string, unknown>;
    const names = personName(raw);
    if (!names.firstName || !names.lastName) throw new Error("Each person needs a name");
    const dob = parseDob(raw.dateOfBirth ?? raw.dob, "Date of birth");
    const adultConfirmed = raw.adultConfirmed === true || raw.adultConfirmed === "true";
    let minor = false;
    if (dob) {
      minor = ageYears(dob, now, timeZone) < view.ageOfMajorityYears;
    } else if (adultConfirmed && view.allowAdultSelfSign) {
      minor = false;
    } else {
      throw new Error("Date of birth is required");
    }
    return {
      ...names,
      dob,
      email: normEmail(raw.email),
      phone: normPhone(raw.phone),
      adultConfirmed,
      minor,
    };
  });

  const minors = people.filter((person) => person.minor);
  const adults = people.filter((person) => !person.minor);
  if (minors.length && adults.length) {
    throw new Error("Adults sign separately from a guardian session");
  }
  if (minors.length > view.maxMinorsPerGuardianSession) {
    throw new Error(
      `A guardian can cover up to ${view.maxMinorsPerGuardianSession} minors in one session`
    );
  }
  if (minors.length > 1 && !view.allowGroupSigning) {
    throw new Error("Group signing is turned off");
  }
  if (adults.length > 1) throw new Error("Sign one adult at a time");
  if (adults.length === 1 && !view.allowAdultSelfSign && !declined) {
    throw new Error("Adult self-signing is turned off");
  }

  let guardian: GuardianIn | null = null;
  if (minors.length && !view.requireGuardianForMinors) {
    throw new Error("A minor cannot sign this agreement");
  }
  if (minors.length) {
    const raw =
      body.guardian && typeof body.guardian === "object" && !Array.isArray(body.guardian)
        ? (body.guardian as Record<string, unknown>)
        : null;
    if (!raw) throw new Error("A parent or guardian must sign for a minor");
    const names = personName(raw);
    if (!names.firstName) throw new Error("Guardian name is required");
    const dob = parseDob(raw.dateOfBirth ?? raw.dob, "Guardian date of birth");
    if (!dob) throw new Error("Guardian date of birth is required");
    if (ageYears(dob, now, timeZone) < view.ageOfMajorityYears) {
      throw new Error("The guardian must be an adult");
    }
    const relationship = cleanName(raw.relationship);
    if (!relationship) throw new Error("Guardian relationship is required");
    guardian = {
      ...names,
      dob,
      relationship,
      email: normEmail(raw.email),
      phone: normPhone(raw.phone),
    };
  }
  return { people, guardian };
}

/** A covered minor is a different guest from the guardian. Sharing the guardian contact would upsert one profile and overwrite the adult. */
function detachMinorGuardianContact(
  people: PersonIn[],
  guardian: GuardianIn | null,
  lockedEmail: string | null
) {
  const emails = new Set<string>();
  if (guardian?.email) emails.add(guardian.email);
  if (lockedEmail) emails.add(lockedEmail);
  const phones = new Set<string>();
  if (guardian?.phone) phones.add(guardian.phone);
  for (const person of people) {
    if (!person.minor) continue;
    if (person.email && emails.has(person.email)) person.email = null;
    if (person.phone && phones.has(person.phone)) person.phone = null;
  }
}

function readSignature(
  body: Record<string, unknown>,
  view: ReturnType<typeof settingsView>,
  sig: ReturnType<typeof resolveEffectiveSignature>,
  declined: boolean,
  hasRequiredClauses: boolean,
  adult: { firstName: string; lastName: string } | null,
  optional = false
) {
  if (declined) {
    return {
      intentAccepted: false,
      typedName: null as string | null,
      drawn: null as string | null,
      witnessName: null as string | null,
    };
  }
  const intentAccepted = body.intentAccepted === true;
  if (!hasRequiredClauses && view.requireIntentCheckbox && !intentAccepted) {
    throw new Error("Confirm that you intend to sign this agreement");
  }
  const needSig = sig.allowTypedSignature || sig.allowDrawnSignature;
  const typed =
    typeof body.typedName === "string" ? cleanName(body.typedName) : "";
  let drawn: string | null = null;
  if (body.drawnSignatureSvg) {
    drawn = sanitizeDrawn(body.drawnSignatureSvg);
  }
  if (!needSig) {
    const witness =
      typeof body.witnessName === "string" ? cleanName(body.witnessName) : "";
    return {
      intentAccepted: hasRequiredClauses ? true : intentAccepted,
      typedName: null,
      drawn: null,
      witnessName: witness || null,
    };
  }
  const typedOk = sig.allowTypedSignature && Boolean(typed);
  const drawnOk = sig.allowDrawnSignature && Boolean(drawn);
  if (optional) {
    if (sig.allowTypedSignature && typedOk && adult && !namesMatch(typed, adult.firstName, adult.lastName)) {
      throw new Error("Typed name must match the adult first and last name");
    }
    const witness =
      typeof body.witnessName === "string" ? cleanName(body.witnessName) : "";
    return {
      intentAccepted: hasRequiredClauses ? true : intentAccepted,
      typedName: typedOk ? typed : null,
      drawn: drawnOk ? drawn : null,
      witnessName: witness || null,
    };
  }
  if (sig.allowTypedSignature && !typedOk) {
    throw new Error("A typed signature is required");
  }
  if (sig.allowDrawnSignature && !drawnOk) {
    throw new Error("A drawn signature is required");
  }
  if (sig.allowTypedSignature && typedOk && adult) {
    if (!namesMatch(typed, adult.firstName, adult.lastName)) {
      throw new Error("Typed name must match the adult first and last name");
    }
  }
  const witness =
    typeof body.witnessName === "string" ? cleanName(body.witnessName) : "";
  return {
    intentAccepted: hasRequiredClauses ? true : intentAccepted,
    typedName: typedOk ? typed : null,
    drawn: drawnOk ? drawn : null,
    witnessName: witness || null,
  };
}

async function upsertGuest(
  tx: Prisma.TransactionClient,
  orgId: string,
  locationId: string,
  person: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    dob: Date | null;
  },
  preferredId: string | null
) {
  let existing: { id: string; bannedAt: Date | null; locationId: string | null } | null = null;
  if (person.email) {
    existing = await tx.guestProfile.findFirst({
      where: { orgId, email: { equals: person.email, mode: "insensitive" } },
      select: { id: true, bannedAt: true, locationId: true },
    });
  }
  if (!existing && person.phone) {
    existing = await tx.guestProfile.findFirst({
      where: { orgId, phone: person.phone },
      select: { id: true, bannedAt: true, locationId: true },
    });
  }
  if (!existing && preferredId) {
    existing = await tx.guestProfile.findFirst({
      where: { id: preferredId, orgId },
      select: { id: true, bannedAt: true, locationId: true },
    });
  }
  if (existing?.bannedAt) {
    throw new Error("This guest cannot complete a waiver online. Please see staff.");
  }
  if (existing) {
    await tx.guestProfile.update({
      where: { id: existing.id },
      data: {
        firstName: person.firstName,
        lastName: person.lastName,
        email: person.email ?? undefined,
        phone: person.phone ?? undefined,
        dateOfBirth: person.dob ?? undefined,
        locationId: existing.locationId ? undefined : locationId,
      },
    });
    return existing.id;
  }
  const created = await tx.guestProfile.create({
    data: {
      orgId,
      locationId,
      firstName: person.firstName,
      lastName: person.lastName,
      email: person.email,
      phone: person.phone,
      dateOfBirth: person.dob,
    },
    select: { id: true },
  });
  return created.id;
}

function newPublicRef(): string {
  return `WR${randomBytes(4).toString("hex").toUpperCase()}`;
}

async function ownedBookingId(orgId: string, raw: string | null): Promise<string | null> {
  if (!raw || !isValidId(raw)) return null;
  const row = await prisma.booking.findFirst({
    where: { id: raw, orgId },
    select: { id: true },
  });
  return row?.id ?? null;
}

async function ownedPartyGuestId(orgId: string, raw: string | null): Promise<string | null> {
  if (!raw || !isValidId(raw)) return null;
  const row = await prisma.partyGuest.findFirst({
    where: { id: raw, partyDetail: { orgId } },
    select: { id: true },
  });
  return row?.id ?? null;
}

async function sendConfirmation(input: {
  orgId: string;
  to: string | null;
  venueName: string;
  templateName: string;
  publicRefs: string[];
  status: "signed" | "declined";
  clauseLabels?: string[];
  fillMethod?: string | null;
}): Promise<"sent" | "failed" | "skipped"> {
  if (!input.to) return "skipped";
  const refs = input.publicRefs.map((ref) => escapeRef(ref)).join(", ");
  const clauses =
    input.clauseLabels?.length && input.status === "signed"
      ? `<p>Accepted: ${input.clauseLabels.map((label) => escapeRef(label)).join("; ")}</p>`
      : "";
  const html =
    input.status === "declined"
      ? `<p>You declined <strong>${escapeRef(input.templateName)}</strong> at ${escapeRef(input.venueName)}.</p><p>Reference: ${refs}</p>`
      : `<p>You signed <strong>${escapeRef(input.templateName)}</strong> at ${escapeRef(input.venueName)}.</p><p>Reference: ${refs}</p>${clauses}${
          input.fillMethod ? `<p>Fill method: ${escapeRef(input.fillMethod)}</p>` : ""
        }`;
  const ok = await sendWaiverGuestEmail({
    orgId: input.orgId,
    to: input.to,
    subject: `${input.venueName} — waiver ${input.publicRefs[0] ?? ""}`.trim(),
    htmlBody: html,
  });
  return ok ? "sent" : "failed";
}

async function sendStaffWaiverNotice(input: {
  orgId: string;
  locationId: string;
  venueName: string;
  signerName: string;
  minorNames: string[];
  clauseLabels: string[];
  fillMethod: string | null;
  publicRef: string;
  status: "signed" | "declined";
}): Promise<void> {
  if (input.status !== "signed") return;
  const locationRow = await prisma.waiverSettings.findFirst({
    where: { orgId: input.orgId, locationId: input.locationId },
    select: { notifyEmail: true },
  });
  const orgRow = locationRow?.notifyEmail
    ? null
    : await prisma.waiverSettings.findFirst({
        where: { orgId: input.orgId, locationId: null },
        select: { notifyEmail: true },
      });
  const to = (locationRow?.notifyEmail || orgRow?.notifyEmail || "").trim();
  if (!to) return;
  const minors = input.minorNames.length
    ? `<p>Minors: ${input.minorNames.map((name) => escapeRef(name)).join(", ")}</p>`
    : "";
  const clauses = input.clauseLabels.length
    ? `<p>Accepted: ${input.clauseLabels.map((label) => escapeRef(label)).join("; ")}</p>`
    : "";
  await sendWaiverGuestEmail({
    orgId: input.orgId,
    to,
    subject: `${input.venueName} — waiver signed ${input.publicRef}`.trim(),
    htmlBody: `<p><strong>${escapeRef(input.signerName)}</strong> signed a waiver at ${escapeRef(input.venueName)}.</p><p>Reference: ${escapeRef(input.publicRef)}</p><p>Fill method: ${escapeRef(input.fillMethod || "manual")}</p>${minors}${clauses}`,
  });
}

function escapeRef(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function capture(
  bound: Bound,
  body: Record<string, unknown>,
  meta: { ip?: string; userAgent?: string; locale?: string | null } = {}
): Promise<SignReceipt> {
  const bundle = await loadBundle(bound.orgId, bound.locationId, bound.templateId);
  const view = settingsView(bundle.settings);
  const version = bundle.version;
  const zone = safeZone(bundle.venue.timezone);
  const now = new Date();

  if (
    typeof body.templateVersionId === "string" &&
    body.templateVersionId !== version.id
  ) {
    throw new Error("This agreement version is no longer current");
  }
  if (
    typeof body.contentSha256 === "string" &&
    body.contentSha256.trim() &&
    body.contentSha256.trim() !== version.contentSha256
  ) {
    throw new Error("This agreement has changed. Reload and sign the current version.");
  }

  const localeHint =
    typeof body.locale === "string" && body.locale.trim()
      ? body.locale.trim()
      : typeof meta.locale === "string" && meta.locale.trim()
        ? meta.locale.trim()
        : null;
  const resolved = resolvePublishedLocaleContent(version, localeHint, view.defaultLocale);
  const { locale, fields } = resolved;
  const declined = body.declined === true;
  const inquiry = bundle.template.kind === "inquiry";
  const effectiveSig = resolveEffectiveSignature({
    settingsAllowTyped: view.allowTypedSignature,
    settingsAllowDrawn: view.allowDrawnSignature,
    settingsRequireIntent: view.requireIntentCheckbox,
    versionAllowTyped: resolved.allowTypedSignature,
    versionAllowDrawn: resolved.allowDrawnSignature,
  });
  const requiredClauseFields = fields.filter((field) => field.type === "clause" && field.required);
  const { accepted: acceptedClauses } = declined
    ? { accepted: [] as { id: string; label: string }[] }
    : readAcceptedClauses(fields, body);
  const hasRequiredClauses = requiredClauseFields.length > 0;
  const lockedEmail = await requestLockedEmail(bound, declined);
  const answerBag =
    body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)
      ? { ...(body.answers as Record<string, unknown>) }
      : {};
  if (lockedEmail) {
    for (const field of fields) {
      if (field.mapsTo === "email") answerBag[field.id] = lockedEmail;
    }
  }
  const answers = {
    ...readAnswers(fields, answerBag),
    ...Object.fromEntries(acceptedClauses.map((row) => [row.id, row.label])),
  };
  if (!declined) assertPictureAddressComplete(resolved.layoutId, resolved.displayMode, fields, answers);
  const requestedFill = body.fillMethod;
  const fillMethod =
    !declined && (requestedFill === "scan" || requestedFill === "document")
      ? requestedFill
      : "manual";
  const forms = await extraForms(bound.orgId, bound.locationId, bound.templateId, locale);
  const extraPayloads = forms.map((form) => {
    const bag =
      body.forms && typeof body.forms === "object" && !Array.isArray(body.forms)
        ? (body.forms as Record<string, unknown>)[form.templateId]
        : {};
    return { form, payload: readAnswers(form.fields, bag) };
  });

  if (inquiry) {
    if (declined) throw new Error("This form cannot be declined");
    if (bound.source === "request") {
      const existing = await prisma.waiverRequest.findFirst({
        where: { id: bound.requestId },
        select: { status: true },
      });
      if (existing?.status === "completed") return completedInquiryReceipt(true);
    }
    const raw =
      body.person && typeof body.person === "object"
        ? (body.person as Record<string, unknown>)
        : Array.isArray(body.people) && body.people[0] && typeof body.people[0] === "object"
          ? (body.people[0] as Record<string, unknown>)
          : {};
    const names = personName(raw);
    if (!names.firstName) throw new Error("A name is required");
    const email = lockedEmail || normEmail(raw.email);
    if (pictureFormRequiresEmail(resolved.layoutId, resolved.displayMode, fields) && !email) {
      throw new Error("Enter an email address to continue");
    }
    const phone = normPhone(raw.phone);
    const savedInquiry = await prisma.$transaction(async (tx) => {
      if (bound.source === "request") {
        await tx.$queryRaw`SELECT "id" FROM "waiver_requests" WHERE "id" = ${bound.requestId} FOR UPDATE`;
        const locked = await tx.waiverRequest.findFirst({
          where: { id: bound.requestId },
          select: { status: true },
        });
        if (locked?.status === "completed") return { replay: true as const };
      }
      const id = await upsertGuest(
        tx,
        bound.orgId,
        bound.locationId,
        {
          firstName: names.firstName,
          lastName: names.lastName || names.firstName,
          email,
          phone,
          dob: parseDob(raw.dateOfBirth ?? raw.dob, "Date of birth"),
        },
        bound.source === "request" ? bound.guestProfileId : null
      );
      await tx.formResponse.create({
        data: {
          orgId: bound.orgId,
          locationId: bound.locationId,
          templateId: bundle.template.id,
          templateVersionId: version.id,
          guestProfileId: id,
          status: "submitted",
          payloadJson: answers,
          submittedAt: now,
          locale,
          source: bound.channel,
        },
      });
      if (bound.source === "request") {
        await tx.waiverRequest.update({
          where: { id: bound.requestId },
          data: { status: "completed" },
        });
        await retireSiblingWaiverLinks(tx, bound);
      }
      return { replay: false as const, guestId: id };
    });
    if (savedInquiry.replay) return completedInquiryReceipt(true);
    return {
      ...completedInquiryReceipt(false),
      waiverGroupId: savedInquiry.guestId,
      signedAt: now.toISOString(),
    };
  }

  const { people, guardian } = parsePeople(body, view, zone, now, declined);
  if (lockedEmail) {
    for (const person of people) {
      if (!person.minor) person.email = lockedEmail;
    }
    if (guardian) guardian.email = lockedEmail;
  }
  detachMinorGuardianContact(people, guardian, lockedEmail);
  if (!declined && pictureFormRequiresEmail(resolved.layoutId, resolved.displayMode, fields)) {
    const contact = guardian?.email || people.find((person) => !person.minor)?.email || null;
    if (!contact) throw new Error("Enter an email address to continue");
  }
  const adultPerson = people.find((p) => !p.minor) ?? null;
  const adultForSig = adultPerson
    ? { firstName: adultPerson.firstName, lastName: adultPerson.lastName }
    : guardian
      ? { firstName: guardian.firstName, lastName: guardian.lastName }
      : null;
  const signatureFields = fields.filter((field) => field.type === "signature");
  const signatureOptional =
    signatureFields.length > 0 && !signatureFields.some((field) => field.required);
  const signature = signatureRequired(bundle.template.kind)
    ? readSignature(
        body,
        view,
        effectiveSig,
        declined,
        hasRequiredClauses,
        adultForSig,
        signatureOptional
      )
    : readSignature(body, view, effectiveSig, true, hasRequiredClauses, null, true);
  const acceptedClausesJson = acceptedClauses.length
    ? (acceptedClauses as unknown as Prisma.InputJsonValue)
    : null;

  if (bound.source === "request") {
    const existing = await prisma.waiverRequest.findFirst({
      where: { id: bound.requestId },
    });
    if (existing?.waiverGroupId && existing.status === "completed") {
      const rows = await prisma.waiverRecord.findMany({
        where: { orgId: bound.orgId, waiverGroupId: existing.waiverGroupId },
      });
      if (rows.length && rows.every((row) => stillValid(row, bundle.template, view, zone, now))) {
        const receipt = await replayReceipt(bound.orgId, existing.waiverGroupId);
        if (receipt) return receipt;
      }
    }
  }

  const untilDate = parseDob(body.untilDate, "Until date");
  const expiresAt = declined
    ? null
    : expiryFor(bundle.template, view, now, zone, untilDate);
  const waiverGroupId = `wg_${randomBytes(12).toString("hex")}`;
  const bookingId = await ownedBookingId(
    bound.orgId,
    bound.source === "request" ? bound.bookingId : null
  );
  const partyGuestId = await ownedPartyGuestId(
    bound.orgId,
    bound.source === "request" ? bound.partyGuestId : null
  );
  const linkedPartyGuestId = people.length === 1 ? partyGuestId : null;
  const preferredGuest =
    bound.source === "request" ? bound.guestProfileId : null;
  const ipHash = hashIp(meta.ip);
  const userAgent =
    typeof meta.userAgent === "string"
      ? meta.userAgent.replace(/[^\x20-\x7E]/g, "").slice(0, 400)
      : null;

  const created = await prisma.$transaction(async (tx) => {
    if (bound.source === "request") {
      await tx.$queryRaw`SELECT "id" FROM "waiver_requests" WHERE "id" = ${bound.requestId} FOR UPDATE`;
      const locked = await tx.waiverRequest.findFirst({ where: { id: bound.requestId } });
      if (locked?.waiverGroupId && locked.status === "completed") {
        const rows = await tx.waiverRecord.findMany({
          where: { orgId: bound.orgId, waiverGroupId: locked.waiverGroupId },
        });
        if (
          rows.length &&
          rows.every((row) => stillValid(row, bundle.template, view, zone, now))
        ) {
          return { replayGroupId: locked.waiverGroupId };
        }
      }
    }
    const guardianId = guardian
      ? await upsertGuest(
          tx,
          bound.orgId,
          bound.locationId,
          {
            firstName: guardian.firstName,
            lastName: guardian.lastName,
            email: guardian.email,
            phone: guardian.phone,
            dob: guardian.dob,
          },
          null
        )
      : null;

    const recordIds: string[] = [];
    const publicRefs: string[] = [];
    const covered: { recordId: string; guestId: string }[] = [];
    let confirmEmail: string | null = guardian?.email ?? people[0]?.email ?? null;

    for (const person of people) {
      const guestId = await upsertGuest(
        tx,
        bound.orgId,
        bound.locationId,
        person,
        !person.minor ? preferredGuest : null
      );
      if (!confirmEmail && person.email) confirmEmail = person.email;
      let publicRef = newPublicRef();
      let recordId = "";
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          const record = await tx.waiverRecord.create({
            data: {
              orgId: bound.orgId,
              locationId: bound.locationId,
              guestProfileId: guestId,
              templateId: bundle.template.id,
              templateVersionId: version.id,
              status: declined ? "declined" : "signed",
              signerRole: person.minor ? "guardian" : "adult_self",
              channel: bound.channel,
              locale,
              signedAt: declined ? null : now,
              expiresAt,
              declinedAt: declined ? now : null,
              guardianGuestProfileId: person.minor ? guardianId : null,
              guardianRelationship: person.minor ? guardian?.relationship ?? null : null,
              bookingId,
              partyGuestId: linkedPartyGuestId,
              waiverGroupId,
              publicRef,
              fillMethod: declined ? null : fillMethod,
            },
          });
          recordId = record.id;
          break;
        } catch (err) {
          const code =
            err && typeof err === "object" && "code" in err
              ? String((err as { code?: string }).code)
              : "";
          if (code !== "P2002" || attempt === 3) throw err;
          publicRef = newPublicRef();
        }
      }
      if (!recordId) throw new Error("Could not save this waiver");
      covered.push({ recordId, guestId });
      recordIds.push(recordId);
      publicRefs.push(publicRef);
      await tx.waiverSigner.create({
        data: {
          orgId: bound.orgId,
          waiverRecordId: recordId,
          guestProfileId: guestId,
          fullName: person.fullName,
          dateOfBirth: person.dob,
          isMinor: person.minor,
          role: person.minor ? "minor" : "adult_self",
        },
      });
      if (person.minor && guardian && guardianId) {
        await tx.waiverSigner.create({
          data: {
            orgId: bound.orgId,
            waiverRecordId: recordId,
            guestProfileId: guardianId,
            fullName: guardian.fullName,
            dateOfBirth: guardian.dob,
            isMinor: false,
            role: "guardian",
          },
        });
      }
      if (!declined || signature.intentAccepted === false) {
        await tx.waiverSignature.create({
          data: {
            orgId: bound.orgId,
            waiverRecordId: recordId,
            signedAt: now,
            timezone: zone,
            intentAccepted: signature.intentAccepted,
            typedName: signature.typedName,
            drawnSignatureSvg: signature.drawn,
            witnessName: signature.witnessName,
            ipHash,
            userAgent,
            locale,
            templateVersionId: version.id,
            contentSha256: version.contentSha256,
            acceptedClauses: acceptedClausesJson,
          },
        });
      }
    }

    const formKind = (FORM_KINDS as readonly string[]).includes(bundle.template.kind);
    if (formKind || fields.length > 0 || Object.keys(answers).length > 0) {
      for (const row of covered) {
        await tx.formResponse.create({
          data: {
            orgId: bound.orgId,
            locationId: bound.locationId,
            templateId: bundle.template.id,
            templateVersionId: version.id,
            waiverRecordId: row.recordId,
            guestProfileId: row.guestId,
            status: "submitted",
            payloadJson: answers,
            submittedAt: now,
            locale,
            source: bound.channel,
          },
        });
      }
    }
    for (const extra of extraPayloads) {
      for (const row of covered) {
        await tx.formResponse.create({
          data: {
            orgId: bound.orgId,
            locationId: bound.locationId,
            templateId: extra.form.templateId,
            templateVersionId: extra.form.versionId,
            waiverRecordId: row.recordId,
            guestProfileId: row.guestId,
            status: "submitted",
            payloadJson: extra.payload,
            submittedAt: now,
            locale,
            source: bound.channel,
          },
        });
      }
    }
    if (bound.source === "request") {
      await tx.waiverRequest.update({
        where: { id: bound.requestId },
        data: { status: "completed", waiverGroupId },
      });
      await retireSiblingWaiverLinks(tx, bound);
    }
    return {
      recordIds,
      publicRefs,
      confirmEmail,
      guestIds: covered.map((row) => row.guestId),
      replayGroupId: null as string | null,
    };
  });

  if (created.replayGroupId) {
    const receipt = await replayReceipt(bound.orgId, created.replayGroupId);
    if (receipt) return receipt;
    throw new WaiverLinkError("This waiver link was already used.", 409);
  }

  const saved = created as {
    recordIds: string[];
    publicRefs: string[];
    confirmEmail: string | null;
    guestIds: string[];
  };
  const status = declined ? "declined" : "signed";
  const clauseLabels = acceptedClauses.map((row: AcceptedClauseRow) => row.label);
  const minorNames = people.filter((person) => person.minor).map((person) => person.fullName);
  const signerName =
    guardian?.fullName ||
    people.find((person) => !person.minor)?.fullName ||
    people[0]?.fullName ||
    "Guest";
  const passInput = {
    orgId: bound.orgId,
    locationId: bound.locationId,
    guestProfileIds: saved.guestIds,
    now,
  };
  const [confirmationEmail, walkinPass] = await Promise.all([
    sendConfirmation({
      orgId: bound.orgId,
      to: saved.confirmEmail,
      venueName: bundle.venue.name,
      templateName: bundle.template.name,
      publicRefs: saved.publicRefs,
      status,
      clauseLabels,
      fillMethod: declined ? null : fillMethod,
    }).catch(() => "failed" as const),
    status === "signed" && (bound.channel === "kiosk" || bound.channel === "onsite")
      ? createWalkinPasses(passInput).catch(() => createWalkinPasses(passInput)).catch((err: unknown) => {
          console.error(
            "Walk-in pass was not saved:",
            err instanceof Error ? err.message : "error"
          );
          return null;
        })
      : Promise.resolve(null),
    sendStaffWaiverNotice({
      orgId: bound.orgId,
      locationId: bound.locationId,
      venueName: bundle.venue.name,
      signerName,
      minorNames,
      clauseLabels,
      fillMethod: declined ? null : fillMethod,
      publicRef: saved.publicRefs[0] ?? "",
      status,
    }).catch((err: unknown) => {
      console.error(
        "Waiver staff notice was not sent:",
        err instanceof Error ? err.message : "error"
      );
    }),
  ]);

  await logActivityEntryAsync({
    actorSub: bound.source === "request" ? bound.createdById : null,
    orgId: bound.orgId,
    action: bound.channel === "kiosk" ? "waiver.kiosk.submit" : "waiver.sign.complete",
    entityType: "WaiverRecord",
    entityId: saved.recordIds[0],
    description:
      status === "declined"
        ? `Waiver declined (${saved.publicRefs[0] ?? ""})`
        : `Waiver signed (${saved.publicRefs[0] ?? ""})`,
    metadata: {
      channel: bound.channel,
      publicRefs: saved.publicRefs,
      templateId: bundle.template.id,
      locationId: bound.locationId,
      waiverGroupId,
      staffUserId:
        bound.channel === "onsite" && bound.source === "request"
          ? bound.createdById
          : null,
      status,
    },
  });
  if (bookingId || partyGuestId) {
    const { notifyPartyWaiverChange } = await import("@/lib/waivers/desk");
    await notifyPartyWaiverChange({ partyGuestId, bookingId });
  }

  return {
    state: "receipt",
    status,
    publicRefs: saved.publicRefs,
    recordIds: saved.recordIds,
    waiverGroupId,
    signedAt: now.toISOString(),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    confirmationEmail,
    replay: false,
    walkinPass,
  };
}

export async function submitPublicSign(
  token: string,
  body: unknown,
  meta: {
    ip?: string;
    userAgent?: string;
    locale?: string | null;
    orgSlug?: string | null;
    venueSlug?: string | null;
  } = {}
): Promise<SignReceipt> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("A signing form is required");
  }
  const bound = await resolveBound(token, meta);
  return capture(bound, body as Record<string, unknown>, meta);
}

function verifyPin(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const next = scryptSync(pin, salt, 32);
  const prev = Buffer.from(hash, "hex");
  if (prev.length !== next.length) return false;
  return timingSafeEqual(prev, next);
}

export async function loadKiosk(deviceToken: string) {
  const raw = deviceToken.trim().toLowerCase();
  if (!/^[a-f0-9]{32,128}$/.test(raw)) throw new WaiverLinkError(NOT_FOUND, 404);
  const device = await prisma.waiverKioskDevice.findFirst({
    where: { deviceTokenHash: hashWaiverToken(raw) },
  });
  if (!device || device.status !== "active") throw new WaiverLinkError(NOT_FOUND, 404);
  await assertPublicOrg(device.orgId);
  const venue = await prisma.venueLocation.findFirst({
    where: { id: device.locationId, orgId: device.orgId },
  });
  if (!venue || venue.status !== "active") throw new WaiverLinkError(UNAVAILABLE, 403);
  const settingsRow = await prisma.waiverSettings.findFirst({
    where: { orgId: device.orgId, locationId: device.locationId },
  }).then(
    async (row) =>
      row ??
      prisma.waiverSettings.findFirst({
        where: { orgId: device.orgId, locationId: null },
      })
  );
  const view = settingsView(settingsRow);
  const ids = Array.isArray(device.templateIds)
    ? device.templateIds.filter((id): id is string => typeof id === "string")
    : [];
  const templates = ids.length
    ? await prisma.waiverTemplate.findMany({
        where: {
          orgId: device.orgId,
          id: { in: ids },
          status: "published",
          archivedAt: null,
          OR: [{ locationId: null }, { locationId: device.locationId }],
        },
        select: {
          id: true,
          name: true,
          kind: true,
          currentPublishedVersion: {
            select: {
              localeDefault: true,
              layoutId: true,
              displayMode: true,
              allowDocumentExtract: true,
              allowTypedSignature: true,
              allowDrawnSignature: true,
              fieldsJson: true,
              locales: {
                select: {
                  locale: true,
                  fieldsJson: true,
                  layoutId: true,
                  displayMode: true,
                  allowDocumentExtract: true,
                },
              },
            },
          },
        },
      })
    : [];
  const brand = await brandFor(device.orgId, venue.name);
  return {
    deviceName: device.name,
    venueName: venue.name,
    brand,
    pinRequired: view.kioskRequireStaffPin,
    sessionMinutes: view.kioskSessionMinutes,
    walkinPass: null,
    templates: templates.map((template) => {
      const version = template.currentPublishedVersion;
      if (!version) {
        return {
          id: template.id,
          name: template.name,
          kind: template.kind,
          layoutId: "classic",
          displayMode: "single_page",
          allowDocumentExtract: false,
          allowTypedSignature: null,
          allowDrawnSignature: null,
          fields: [] as FieldDef[],
        };
      }
      const resolved = resolvePublishedLocaleContent(
        version,
        null,
        view.defaultLocale
      );
      return {
        id: template.id,
        name: template.name,
        kind: template.kind,
        layoutId: resolved.layoutId,
        displayMode: resolved.displayMode,
        allowDocumentExtract: resolved.allowDocumentExtract,
        allowTypedSignature: resolved.allowTypedSignature,
        allowDrawnSignature: resolved.allowDrawnSignature,
        fields: resolved.fields,
      };
    }),
  };
}

const kioskSaveInFlight = new Set<string>();
const recentKioskReceipts = new Map<string, { at: number; receipt: SignReceipt }>();

function kioskRetryKey(deviceId: string, templateId: string, body: Record<string, unknown>): string {
  const people = Array.isArray(body.people) ? body.people : [];
  const names = people
    .map((person) => {
      if (!person || typeof person !== "object") return "";
      const row = person as Record<string, unknown>;
      return `${String(row.fullName ?? "").trim().toLowerCase()}|${String(row.dateOfBirth ?? "").trim()}`;
    })
    .join(";");
  return `${deviceId}|${templateId}|${body.declined === true ? "declined" : "signed"}|${names}`;
}

export async function submitKioskSign(
  deviceToken: string,
  body: unknown,
  meta: { ip?: string; userAgent?: string }
): Promise<SignReceipt | { unlocked: true; session: SignFormPayload }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("A signing form is required");
  }
  const raw = deviceToken.trim().toLowerCase();
  const device = await prisma.waiverKioskDevice.findFirst({
    where: { deviceTokenHash: hashWaiverToken(raw) },
  });
  if (!device || device.status !== "active") throw new WaiverLinkError(NOT_FOUND, 404);
  await assertPublicOrg(device.orgId);
  const rec = body as Record<string, unknown>;
  const settingsRow = await prisma.waiverSettings.findFirst({
    where: { orgId: device.orgId, locationId: device.locationId },
  }).then(
    async (row) =>
      row ??
      prisma.waiverSettings.findFirst({
        where: { orgId: device.orgId, locationId: null },
      })
  );
  const view = settingsView(settingsRow);
  if (view.kioskRequireStaffPin) {
    const pinKey = `waiver-kiosk-pin:${device.id}`;
    const pinWindowMs = 15 * 60 * 1000;
    if (isRateLimitExceeded(pinKey, 8, pinWindowMs)) {
      throw new WaiverLinkError("Too many PIN attempts. Try again shortly.", 429);
    }
    const pin = typeof rec.pin === "string" ? rec.pin.trim() : "";
    if (!device.pinHash || !verifyPin(pin, device.pinHash)) {
      incrementRateLimit(pinKey, pinWindowMs);
      throw new WaiverLinkError("Staff PIN required", 403);
    }
  }
  const templateId = typeof rec.templateId === "string" ? rec.templateId : "";
  const allowed = Array.isArray(device.templateIds)
    ? device.templateIds.filter((id): id is string => typeof id === "string")
    : [];
  if (!allowed.includes(templateId)) {
    throw new Error("That agreement is not on this kiosk");
  }
  if (rec.action === "walkin-continue") {
    const passId = typeof rec.passId === "string" ? rec.passId : "";
    const pass = await readActiveWalkinPass({
      orgId: device.orgId,
      locationId: device.locationId,
      passId,
    });
    if (!pass) throw new WaiverLinkError("This walk-in pass is no longer valid.", 403);
    const session = await buildForm(
      {
        source: "signage",
        orgId: device.orgId,
        locationId: device.locationId,
        templateId,
        channel: "qr",
      },
      typeof rec.locale === "string" ? rec.locale : null
    );
    return { unlocked: true, session: { ...session, channel: "kiosk", walkinPass: pass } };
  }
  if (rec.action === "session") {
    const session = await buildForm(
      {
        source: "signage",
        orgId: device.orgId,
        locationId: device.locationId,
        templateId,
        channel: "qr",
      },
      typeof rec.locale === "string" ? rec.locale : null
    );
    return { unlocked: true, session: { ...session, channel: "kiosk" } };
  }
  if (kioskSaveInFlight.has(device.id)) {
    throw new Error("This kiosk is already saving a waiver. Wait a moment.");
  }
  const retryKey = kioskRetryKey(device.id, templateId, rec);
  const remembered = recentKioskReceipts.get(retryKey);
  if (remembered && Date.now() - remembered.at < 45_000) {
    return { ...remembered.receipt, replay: true, confirmationEmail: "skipped" };
  }
  kioskSaveInFlight.add(device.id);
  try {
    const receipt = await capture(
      {
        source: "signage",
        orgId: device.orgId,
        locationId: device.locationId,
        templateId,
        channel: "kiosk",
      },
      rec,
      meta
    );
    recentKioskReceipts.set(retryKey, { at: Date.now(), receipt });
    if (recentKioskReceipts.size > 100) {
      const cutoff = Date.now() - 45_000;
      for (const [key, row] of recentKioskReceipts) {
        if (row.at < cutoff) recentKioskReceipts.delete(key);
      }
    }
    try {
      await prisma.waiverKioskDevice.update({
        where: { id: device.id },
        data: { lastSeenAt: new Date() },
      });
    } catch (err) {
      console.error(
        "Kiosk last-seen update failed:",
        err instanceof Error ? err.message : "error"
      );
    }
    return receipt;
  } finally {
    kioskSaveInFlight.delete(device.id);
  }
}

export async function searchWaiverGuests(actor: WaiversActor, q: string) {
  const orgId = await assertWaiversStaff(actor);
  const query = q.trim().slice(0, 80);
  if (query.length < 2) return [];
  const scope = await waiverStampedLocationWhere(actor);
  const rows = await prisma.guestProfile.findMany({
    where: {
      orgId,
      bannedAt: null,
      AND: [
        scope.locationId
          ? { OR: [{ locationId: null }, { locationId: scope.locationId }] }
          : {},
        {
          OR: [
            { email: { contains: query, mode: "insensitive" } },
            { phone: { contains: query } },
            { firstName: { contains: query, mode: "insensitive" } },
            { lastName: { contains: query, mode: "insensitive" } },
          ],
        },
      ],
    },
    take: 20,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      dateOfBirth: true,
      locationId: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    dateOfBirth: row.dateOfBirth ? row.dateOfBirth.toISOString().slice(0, 10) : null,
  }));
}

function staffDrawnSvg(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return sanitizeDrawn(raw);
  } catch {
    return null;
  }
}

/** Staff-facing form answers. Drops signature drawings, tokens, and hashes. */
export function redactWaiverFormAnswers(payload: unknown): Record<string, string> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const answers: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (/svg|signature|iphash|token|pinhash|contentsha/i.test(key)) continue;
    if (typeof value === "string") {
      if (value.includes("<svg") || value.length > 8000) continue;
      answers[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      answers[key] = String(value);
    }
  }
  return answers;
}

export async function getWaiverRecordDetail(actor: WaiversActor, recordId: string) {
  const orgId = await assertWaiversStaff(actor);
  if (!isValidId(recordId)) throw new ForbiddenError("Record not found");
  const scope = await waiverStampedLocationWhere(actor);
  const row = await prisma.waiverRecord.findFirst({
    where: {
      id: recordId,
      orgId,
      ...(scope.locationId ? { locationId: scope.locationId } : {}),
    },
    include: {
      guestProfile: {
        select: { id: true, firstName: true, lastName: true, email: true, phone: true },
      },
      template: { select: { id: true, name: true, kind: true } },
      templateVersion: { select: { id: true, version: true, contentSha256: true } },
      signers: true,
      signatures: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          signedAt: true,
          timezone: true,
          intentAccepted: true,
          typedName: true,
          witnessName: true,
          locale: true,
          contentSha256: true,
          templateVersionId: true,
          drawnSignatureSvg: true,
          acceptedClauses: true,
        },
      },
      formResponses: {
        orderBy: { submittedAt: "asc" },
        select: {
          id: true,
          payloadJson: true,
          template: { select: { name: true } },
        },
      },
      location: { select: { id: true, name: true } },
    },
  });
  if (!row) throw new ForbiddenError("Record not found");
  return {
    id: row.id,
    publicRef: row.publicRef,
    status: waiverRecordDisplayStatus(row.status, row.expiresAt),
    channel: row.channel,
    locale: row.locale,
    signerRole: row.signerRole,
    signedAt: row.signedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    declinedAt: row.declinedAt?.toISOString() ?? null,
    fillMethod: row.fillMethod,
    waiverGroupId: row.waiverGroupId,
    guardianRelationship: row.guardianRelationship,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidReason: row.voidReason,
    template: row.template,
    version: row.templateVersion.version,
    contentSha256: row.templateVersion.contentSha256,
    location: row.location,
    guest: row.guestProfile,
    signers: row.signers.map((signer) => ({
      id: signer.id,
      fullName: signer.fullName,
      role: signer.role,
      isMinor: signer.isMinor,
      dateOfBirth: signer.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    })),
    signatures: row.signatures.map((sig) => ({
      id: sig.id,
      signedAt: sig.signedAt.toISOString(),
      timezone: sig.timezone,
      intentAccepted: sig.intentAccepted,
      typedName: sig.typedName,
      witnessName: sig.witnessName,
      locale: sig.locale,
      contentSha256: sig.contentSha256,
      templateVersionId: sig.templateVersionId,
      hasDrawnSignature: Boolean(sig.drawnSignatureSvg),
      drawnSignatureSvg: staffDrawnSvg(sig.drawnSignatureSvg),
      acceptedClauses: sig.acceptedClauses,
    })),
    forms: row.formResponses.map((form) => ({
      id: form.id,
      name: form.template.name,
      answers: redactWaiverFormAnswers(form.payloadJson),
    })),
  };
}
