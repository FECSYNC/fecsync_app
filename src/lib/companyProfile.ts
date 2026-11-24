/**
 * Tenant Company Profile — legal/brand identity for invoices, receipts, emails, print.
 * Always stamp orgId from the actor (requireActorOrgId); never trust body.orgId.
 */
import prisma from "@/lib/prisma";
import { asIdString } from "@/lib/ids";
import { assertOrganizationActive } from "@/lib/org";
import { requireActorOrgId } from "@/lib/staffOrg";
import {
  bankAccountLast4,
  encryptBankAccount,
  encryptBankRoutingOrIban,
} from "@/lib/companyProfileCrypto";
import {
  PLATFORM_BRAND_NAME,
  PLATFORM_SITE_URL,
  PLATFORM_SUPPORT_EMAIL,
  platformEmailAssetBaseUrl,
} from "@/lib/platformBrand";
import type { CompanyProfile, Prisma } from "@prisma/client";
import { assertNotDemoPlanLocked } from "@/lib/demoPlanAssert";
import { parseEmbedOriginList } from "@/lib/publicCategory/origins";
import { invalidateCompanyBranding } from "@/lib/companyBranding";

type ActorOrg = { sub: string; orgId: string | null };

export class CompanyProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyProfileValidationError";
  }
}

export type CompanyProfileRedacted = {
  orgId: string;
  /** legalName || tradingName || org.name — same SSOT as documents/emails */
  displayName: string;
  /** Organization.slug — unique public workspace key; editable by company admins */
  organizationSlug: string | null;
  legalName: string | null;
  tradingName: string | null;
  logoUrl: string | null;
  logoPublicId: string | null;
  /** Staff sign-in page (`/signin/{slug}`) left-panel photo. */
  signinBackgroundUrl: string | null;
  signinBackgroundPublicId: string | null;
  supportEmail: string | null;
  billingEmail: string | null;
  replyToEmail: string | null;
  phone: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  taxId: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountLast4: string | null;
  /** Never returned in GET/DTO — write-only; use hasBankRoutingOrIban. */
  bankRoutingOrIban: string | null;
  bankCurrency: string | null;
  hasBankAccount: boolean;
  /** True when routing/IBAN is stored (value itself is never revealed). */
  hasBankRoutingOrIban: boolean;
  invoiceFooterNote: string | null;
  receiptFooterNote: string | null;
  letterheadColor: string | null;
  /** Trading name stays visible and has no switch. */
  publicLogo: boolean;
  publicPhone: boolean;
  publicSupportEmail: boolean;
  publicWebsite: boolean;
  publicAddress: boolean;
  embedOrigins: string[];
  completeness: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CompanyBrandForDocuments = {
  displayName: string;
  legalName: string | null;
  tradingName: string | null;
  logoUrl: string;
  supportEmail: string | null;
  replyToEmail: string | null;
  phone: string | null;
  website: string | null;
  addressLines: string[];
  taxId: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountLast4: string | null;
  bankCurrency: string | null;
  invoiceFooterNote: string | null;
  receiptFooterNote: string | null;
  letterheadColor: string;
  isPlatformFallback: boolean;
};

export type UpsertCompanyProfileInput = {
  legalName?: string | null;
  tradingName?: string | null;
  logoUrl?: string | null;
  logoPublicId?: string | null;
  signinBackgroundUrl?: string | null;
  signinBackgroundPublicId?: string | null;
  supportEmail?: string | null;
  billingEmail?: string | null;
  replyToEmail?: string | null;
  phone?: string | null;
  website?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  taxId?: string | null;
  bankName?: string | null;
  bankAccountName?: string | null;
  /** Full account number — encrypted at rest; never logged. */
  bankAccountNumber?: string | null;
  bankRoutingOrIban?: string | null;
  bankCurrency?: string | null;
  clearBank?: boolean;
  invoiceFooterNote?: string | null;
  receiptFooterNote?: string | null;
  letterheadColor?: string | null;
  publicLogo?: boolean;
  publicPhone?: boolean;
  publicSupportEmail?: boolean;
  publicWebsite?: boolean;
  publicAddress?: boolean;
  /** Full replacement list. Stamped to actor.orgId. Client orgId is ignored. */
  embedOrigins?: unknown;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL = 254;
const MAX_TEXT = 200;
const MAX_FOOTER = 1000;
const MAX_PHONE = 40;
const MAX_URL = 500;
const BRAND_GOLD = "#D4AF37";

/** Shared display label for header, print, emails, invoices. */
export function computeCompanyDisplayName(input: {
  legalName?: string | null;
  tradingName?: string | null;
  organizationName?: string | null;
  fallback?: string;
}): string {
  return (
    input.legalName?.trim() ||
    input.tradingName?.trim() ||
    input.organizationName?.trim() ||
    input.fallback?.trim() ||
    "FECSYNC"
  );
}

function assertBankRoutingOrIban(value: string): void {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  if (!compact) {
    throw new CompanyProfileValidationError("Bank routing or IBAN is required");
  }
  // IBAN: country + check digits + BBAN (15–34 alphanumeric after normalize).
  if (/^[A-Z]{2}\d{2}[0-9A-Z]{11,30}$/.test(compact)) return;
  // Domestic routing / sort code style (digits only).
  if (/^\d{6,17}$/.test(compact)) return;
  throw new CompanyProfileValidationError(
    "Enter a valid IBAN or numeric bank routing / sort code"
  );
}

function trimOrNull(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new CompanyProfileValidationError("Expected a string value");
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    throw new CompanyProfileValidationError(`Value exceeds ${max} characters`);
  }
  return trimmed;
}

function stripHtml(value: string): string {
  // Repeat until stable so nested tags like <scr<script>ipt> cannot survive one pass.
  let cleaned = value;
  let prev = "";
  while (cleaned !== prev) {
    prev = cleaned;
    cleaned = cleaned.replace(/<[^>]*>/g, "");
  }
  return cleaned.replace(/[<>]/g, "").trim();
}

function optionalEmail(value: unknown): string | null | undefined {
  const v = trimOrNull(value, MAX_EMAIL);
  if (v === undefined || v === null) return v;
  if (!EMAIL_RE.test(v)) {
    throw new CompanyProfileValidationError("Invalid email address");
  }
  return v.toLowerCase();
}

function optionalWebsite(value: unknown): string | null | undefined {
  const v = trimOrNull(value, MAX_URL);
  if (v === undefined || v === null) return v;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    throw new CompanyProfileValidationError("Website must be an http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CompanyProfileValidationError("Website must be an http(s) URL");
  }
  return url.toString();
}

/** Strict Cloudinary CDN URL — hostname only, no quotes/whitespace injection. */
function optionalLogoUrl(
  value: unknown,
  label = "Logo"
): string | null | undefined {
  const v = trimOrNull(value, MAX_URL);
  if (v === undefined || v === null) return v;
  if (v.startsWith("data:")) {
    throw new CompanyProfileValidationError(
      `${label} must be a Cloudinary CDN URL (not base64)`
    );
  }
  if (v.startsWith("/")) {
    if (v.includes("..") || /[\s"'<>]/.test(v)) {
      throw new CompanyProfileValidationError(
        `Invalid ${label.toLowerCase()} path`
      );
    }
    return v;
  }
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    throw new CompanyProfileValidationError(
      `${label} URL must be a Cloudinary https URL`
    );
  }
  if (url.protocol !== "https:") {
    throw new CompanyProfileValidationError(`${label} URL must use https`);
  }
  const host = url.hostname.toLowerCase();
  if (
    host !== "res.cloudinary.com" &&
    !host.endsWith(".res.cloudinary.com") &&
    host !== "cloudinary.com" &&
    !host.endsWith(".cloudinary.com")
  ) {
    throw new CompanyProfileValidationError(
      `${label} URL must be a Cloudinary host`
    );
  }
  if (/[\s"'<>]/.test(v)) {
    throw new CompanyProfileValidationError(
      `Invalid ${label.toLowerCase()} URL characters`
    );
  }
  return url.toString();
}

function optionalColor(value: unknown): string | null | undefined {
  const v = trimOrNull(value, 32);
  if (v === undefined || v === null) return v;
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
    throw new CompanyProfileValidationError(
      "letterheadColor must be a hex color like #D4AF37"
    );
  }
  return v.toUpperCase();
}

function optionalFooter(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new CompanyProfileValidationError("Footer note must be a string");
  }
  const cleaned = stripHtml(value);
  if (!cleaned) return null;
  if (cleaned.length > MAX_FOOTER) {
    throw new CompanyProfileValidationError(
      `Footer note exceeds ${MAX_FOOTER} characters`
    );
  }
  return cleaned;
}

function isoDate(value?: Date | null): string | null {
  if (!value) return null;
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

export function computeProfileCompleteness(
  profile: Pick<
    CompanyProfileRedacted,
    | "legalName"
    | "tradingName"
    | "logoUrl"
    | "supportEmail"
    | "addressLine1"
    | "city"
    | "country"
    | "hasBankAccount"
    | "hasBankRoutingOrIban"
  >
): number {
  let score = 0;
  // Match brand identity: legal OR trading name counts as the name pillar.
  if (profile.legalName?.trim() || profile.tradingName?.trim()) score += 20;
  if (profile.logoUrl?.trim()) score += 20;
  if (profile.supportEmail?.trim()) score += 20;
  const hasAddress =
    Boolean(profile.addressLine1?.trim()) &&
    Boolean(profile.city?.trim()) &&
    Boolean(profile.country?.trim());
  if (hasAddress) score += 25;
  // Bank pillar: account last4/ciphertext OR routing/IBAN on file (write-only).
  if (profile.hasBankAccount || profile.hasBankRoutingOrIban) score += 15;
  return Math.min(100, score);
}

export function toRedactedCompanyProfile(
  row: CompanyProfile | null,
  orgId: string,
  organizationName?: string | null,
  organizationSlug?: string | null,
  embedOrigins: string[] = []
): CompanyProfileRedacted {
  const base: CompanyProfileRedacted = {
    orgId,
    displayName: computeCompanyDisplayName({
      legalName: row?.legalName,
      tradingName: row?.tradingName,
      organizationName,
    }),
    organizationSlug: organizationSlug?.trim() || null,
    legalName: row?.legalName ?? null,
    tradingName: row?.tradingName ?? null,
    logoUrl: row?.logoUrl ?? null,
    logoPublicId: row?.logoPublicId ?? null,
    signinBackgroundUrl: row?.signinBackgroundUrl ?? null,
    signinBackgroundPublicId: row?.signinBackgroundPublicId ?? null,
    supportEmail: row?.supportEmail ?? null,
    billingEmail: row?.billingEmail ?? null,
    replyToEmail: row?.replyToEmail ?? null,
    phone: row?.phone ?? null,
    website: row?.website ?? null,
    addressLine1: row?.addressLine1 ?? null,
    addressLine2: row?.addressLine2 ?? null,
    city: row?.city ?? null,
    state: row?.state ?? null,
    country: row?.country ?? null,
    postalCode: row?.postalCode ?? null,
    taxId: row?.taxId ?? null,
    bankName: row?.bankName ?? null,
    bankAccountName: row?.bankAccountName ?? null,
    bankAccountLast4: row?.bankAccountLast4 ?? null,
    // Prefer never reveal (prompt §1.2) — editors replace via write-only field.
    bankRoutingOrIban: null,
    bankCurrency: row?.bankCurrency ?? null,
    hasBankAccount: Boolean(row?.bankAccountCiphertext || row?.bankAccountLast4),
    hasBankRoutingOrIban: Boolean(row?.bankRoutingOrIban?.trim()),
    invoiceFooterNote: row?.invoiceFooterNote ?? null,
    receiptFooterNote: row?.receiptFooterNote ?? null,
    letterheadColor: row?.letterheadColor ?? null,
    publicLogo: row?.publicLogo ?? true,
    publicPhone: row?.publicPhone ?? false,
    publicSupportEmail: row?.publicSupportEmail ?? false,
    publicWebsite: row?.publicWebsite ?? false,
    publicAddress: row?.publicAddress ?? false,
    embedOrigins: [...embedOrigins],
    completeness: 0,
    createdAt: isoDate(row?.createdAt ?? null),
    updatedAt: isoDate(row?.updatedAt ?? null),
  };
  base.completeness = computeProfileCompleteness(base);
  return base;
}

/**
 * Print/invoice-safe view for orders staff — no routing/IBAN, billing inbox,
 * or Cloudinary public ids (those stay settings:manage only).
 */
export function toPrintSafeCompanyProfile(
  profile: CompanyProfileRedacted
): CompanyProfileRedacted {
  return {
    ...profile,
    billingEmail: null,
    bankRoutingOrIban: null,
    logoPublicId: null,
    signinBackgroundPublicId: null,
    embedOrigins: [],
  };
}

/** True when a Cloudinary public_id belongs to this org's logo folder. */
export function isOwnedCompanyLogoPublicId(
  orgId: string,
  publicId: string | null | undefined
): boolean {
  const id = asIdString(orgId) ?? String(orgId ?? "").trim();
  const pid = typeof publicId === "string" ? publicId.trim() : "";
  if (!id || !pid) return false;
  // Reject traversal / odd encodings before prefix match.
  if (
    pid.includes("..") ||
    pid.includes("\\") ||
    pid.includes("%2e") ||
    pid.includes("%2E") ||
    pid.includes("%2f") ||
    pid.includes("%2F") ||
    pid.startsWith("/")
  ) {
    return false;
  }
  const folder = `company-profiles/${id}`;
  const prefix = `${folder}/`;
  if (pid === folder) return true;
  if (!pid.startsWith(prefix)) return false;
  const rest = pid.slice(prefix.length);
  // Only a single path segment under the org folder (e.g. logo, logo_1).
  return Boolean(rest) && !rest.includes("/") && !rest.includes("\\");
}

export async function getCompanyProfile(
  orgId: string
): Promise<CompanyProfile | null> {
  const id = asIdString(orgId) ?? String(orgId ?? "").trim();
  if (!id) return null;
  return prisma.companyProfile.findUnique({ where: { orgId: id } });
}

async function organizationMetaFor(
  orgId: string
): Promise<{ name: string | null; slug: string | null }> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true, slug: true },
  });
  return {
    name: org?.name?.trim() || null,
    slug: org?.slug?.trim() || null,
  };
}

export async function listCompanyEmbedOrigins(orgId: string): Promise<string[]> {
  const id = asIdString(orgId) ?? String(orgId ?? "").trim();
  if (!id) return [];
  const rows = await prisma.companyEmbedOrigin.findMany({
    where: { orgId: id },
    select: { origin: true },
    orderBy: { origin: "asc" },
  });
  return rows.map((row) => row.origin);
}

export async function getOrEmptyCompanyProfile(
  orgId: string
): Promise<CompanyProfileRedacted> {
  const id = asIdString(orgId) ?? String(orgId ?? "").trim();
  const [row, meta, origins] = id
    ? await Promise.all([
        getCompanyProfile(id),
        organizationMetaFor(id),
        listCompanyEmbedOrigins(id),
      ])
    : [null, { name: null, slug: null }, [] as string[]];
  return toRedactedCompanyProfile(row, id, meta.name, meta.slug, origins);
}

export async function upsertCompanyProfile(
  actor: ActorOrg,
  input: UpsertCompanyProfileInput
): Promise<{ profile: CompanyProfileRedacted; wrote: boolean }> {
  const orgId = requireActorOrgId(actor);
  await assertOrganizationActive(orgId);

  // Never trust client orgId.
  void (input as { orgId?: unknown }).orgId;

  const legalName = trimOrNull(input.legalName, MAX_TEXT);
  const tradingName = trimOrNull(input.tradingName, MAX_TEXT);
  const logoUrl = optionalLogoUrl(input.logoUrl);
  const logoPublicId = trimOrNull(input.logoPublicId, MAX_TEXT);
  // Defense in depth: never persist a foreign/traversal public_id (HTTP PUT
  // already voids logo fields; logo route validates before upsert).
  if (
    typeof logoPublicId === "string" &&
    logoPublicId.trim() &&
    !isOwnedCompanyLogoPublicId(orgId, logoPublicId)
  ) {
    throw new CompanyProfileValidationError(
      "Logo public id must belong to this organization"
    );
  }
  const signinBackgroundUrl = optionalLogoUrl(
    input.signinBackgroundUrl,
    "Sign-in background"
  );
  const signinBackgroundPublicId = trimOrNull(
    input.signinBackgroundPublicId,
    MAX_TEXT
  );
  if (
    typeof signinBackgroundPublicId === "string" &&
    signinBackgroundPublicId.trim() &&
    !isOwnedCompanyLogoPublicId(orgId, signinBackgroundPublicId)
  ) {
    throw new CompanyProfileValidationError(
      "Sign-in background public id must belong to this organization"
    );
  }
  const supportEmail = optionalEmail(input.supportEmail);
  const billingEmail = optionalEmail(input.billingEmail);
  const replyToEmail = optionalEmail(input.replyToEmail);
  const phone = trimOrNull(input.phone, MAX_PHONE);
  const website = optionalWebsite(input.website);
  const addressLine1 = trimOrNull(input.addressLine1, MAX_TEXT);
  const addressLine2 = trimOrNull(input.addressLine2, MAX_TEXT);
  const city = trimOrNull(input.city, MAX_TEXT);
  const state = trimOrNull(input.state, MAX_TEXT);
  const country = trimOrNull(input.country, MAX_TEXT);
  const postalCode = trimOrNull(input.postalCode, 32);
  const taxId = trimOrNull(input.taxId, 64);
  const bankName = trimOrNull(input.bankName, MAX_TEXT);
  const bankAccountName = trimOrNull(input.bankAccountName, MAX_TEXT);
  const bankRoutingOrIban = trimOrNull(input.bankRoutingOrIban, 64);
  const bankCurrency = trimOrNull(input.bankCurrency, 8);
  const invoiceFooterNote = optionalFooter(input.invoiceFooterNote);
  const receiptFooterNote = optionalFooter(input.receiptFooterNote);
  const letterheadColor = optionalColor(input.letterheadColor);

  const data: Prisma.CompanyProfileUncheckedUpdateInput = {};
  if (legalName !== undefined) data.legalName = legalName;
  if (tradingName !== undefined) data.tradingName = tradingName;
  if (logoUrl !== undefined) data.logoUrl = logoUrl;
  if (logoPublicId !== undefined) data.logoPublicId = logoPublicId;
  if (signinBackgroundUrl !== undefined) {
    data.signinBackgroundUrl = signinBackgroundUrl;
  }
  if (signinBackgroundPublicId !== undefined) {
    data.signinBackgroundPublicId = signinBackgroundPublicId;
  }
  if (supportEmail !== undefined) data.supportEmail = supportEmail;
  if (billingEmail !== undefined) data.billingEmail = billingEmail;
  if (replyToEmail !== undefined) data.replyToEmail = replyToEmail;
  if (phone !== undefined) data.phone = phone;
  if (website !== undefined) data.website = website;
  if (addressLine1 !== undefined) data.addressLine1 = addressLine1;
  if (addressLine2 !== undefined) data.addressLine2 = addressLine2;
  if (city !== undefined) data.city = city;
  if (state !== undefined) data.state = state;
  if (country !== undefined) data.country = country;
  if (postalCode !== undefined) data.postalCode = postalCode;
  if (taxId !== undefined) data.taxId = taxId;
  if (bankName !== undefined) data.bankName = bankName;
  if (bankAccountName !== undefined) data.bankAccountName = bankAccountName;
  if (bankRoutingOrIban !== undefined) {
    if (bankRoutingOrIban == null) {
      data.bankRoutingOrIban = null;
    } else {
      assertBankRoutingOrIban(bankRoutingOrIban);
      data.bankRoutingOrIban = encryptBankRoutingOrIban(bankRoutingOrIban);
    }
  }
  if (bankCurrency !== undefined) {
    data.bankCurrency = bankCurrency
      ? bankCurrency.toUpperCase()
      : null;
  }
  if (invoiceFooterNote !== undefined) data.invoiceFooterNote = invoiceFooterNote;
  if (receiptFooterNote !== undefined) data.receiptFooterNote = receiptFooterNote;
  if (letterheadColor !== undefined) data.letterheadColor = letterheadColor;
  if (input.publicLogo !== undefined) data.publicLogo = input.publicLogo;
  if (input.publicPhone !== undefined) data.publicPhone = input.publicPhone;
  if (input.publicSupportEmail !== undefined) {
    data.publicSupportEmail = input.publicSupportEmail;
  }
  if (input.publicWebsite !== undefined) data.publicWebsite = input.publicWebsite;
  if (input.publicAddress !== undefined) data.publicAddress = input.publicAddress;

  const touchesPublicVisibility =
    input.publicLogo !== undefined ||
    input.publicPhone !== undefined ||
    input.publicSupportEmail !== undefined ||
    input.publicWebsite !== undefined ||
    input.publicAddress !== undefined ||
    input.embedOrigins !== undefined;
  if (touchesPublicVisibility) {
    await assertNotDemoPlanLocked(orgId);
  }
  const parsedOrigins =
    input.embedOrigins !== undefined
      ? parseEmbedOriginList(input.embedOrigins)
      : undefined;

  if (input.clearBank === true) {
    data.bankName = null;
    data.bankAccountName = null;
    data.bankAccountLast4 = null;
    data.bankAccountCiphertext = null;
    data.bankRoutingOrIban = null;
    data.bankCurrency = null;
  } else if (
    typeof input.bankAccountNumber === "string" &&
    input.bankAccountNumber.trim()
  ) {
    const plain = input.bankAccountNumber.replace(/\s+/g, "").trim();
    if (plain.length < 4 || plain.length > 64) {
      throw new CompanyProfileValidationError(
        "Bank account number must be between 4 and 64 characters"
      );
    }
    data.bankAccountCiphertext = encryptBankAccount(plain);
    data.bankAccountLast4 = bankAccountLast4(plain);
  }

  async function replaceEmbedOrigins(
    db: Prisma.TransactionClient
  ): Promise<boolean> {
    if (parsedOrigins === undefined) return false;
    await db.companyEmbedOrigin.deleteMany({ where: { orgId } });
    if (parsedOrigins.length > 0) {
      await db.companyEmbedOrigin.createMany({
        data: parsedOrigins.map((origin) => ({ orgId, origin })),
      });
    }
    return true;
  }
  async function commitOriginsOnly(): Promise<boolean> {
    if (parsedOrigins === undefined) return false;
    await prisma.$transaction((tx) => replaceEmbedOrigins(tx));
    return true;
  }

  async function redacted(
    row: CompanyProfile | null,
    wrote: boolean
  ): Promise<{ profile: CompanyProfileRedacted; wrote: boolean }> {
    const [meta, origins] = await Promise.all([
      organizationMetaFor(orgId),
      listCompanyEmbedOrigins(orgId),
    ]);
    return {
      profile: toRedactedCompanyProfile(
        row,
        orgId,
        meta.name,
        meta.slug,
        origins
      ),
      wrote,
    };
  }

  // Image-clear-only (logo / sign-in background) with no row → empty DTO
  // (do not create blank profile).
  const imageKeys = [
    "logoUrl",
    "logoPublicId",
    "signinBackgroundUrl",
    "signinBackgroundPublicId",
  ] as const;
  const dataKeys = Object.keys(data);
  const isLogoClearOnly =
    dataKeys.length > 0 &&
    dataKeys.every(
      (k) =>
        (imageKeys as readonly string[]).includes(k) &&
        data[k as (typeof imageKeys)[number]] === null
    );
  if (isLogoClearOnly) {
    const existingLogo = await prisma.companyProfile.findUnique({
      where: { orgId },
    });
    if (!existingLogo) {
      return redacted(null, await commitOriginsOnly());
    }
  }

  if (
    input.clearBank === true &&
    Object.keys(data).every((k) =>
      [
        "bankName",
        "bankAccountName",
        "bankAccountLast4",
        "bankAccountCiphertext",
        "bankRoutingOrIban",
        "bankCurrency",
      ].includes(k)
    )
  ) {
    // clearBank-only: if no row yet, do not create an empty profile.
    const existingForClear = await prisma.companyProfile.findUnique({
      where: { orgId },
      select: { orgId: true },
    });
    if (!existingForClear) {
      return redacted(null, await commitOriginsOnly());
    }
  }

  // No-op payload with no existing row → empty DTO (do not create blank rows).
  if (Object.keys(data).length === 0) {
    const existingEmpty = await prisma.companyProfile.findUnique({
      where: { orgId },
    });
    return redacted(existingEmpty, await commitOriginsOnly());
  }

  // Profile row and origin list commit together. A failed profile write
  // must not leave a replaced allowlist behind.
  const row = await prisma.$transaction(async (tx) => {
    await replaceEmbedOrigins(tx);
    return tx.companyProfile.upsert({
      where: { orgId },
      create: {
        ...(data as Prisma.CompanyProfileUncheckedCreateInput),
        orgId,
      },
      update: data,
    });
  });
  invalidateCompanyBranding(orgId);

  return redacted(row, true);
}

function buildAddressLines(
  profile: Pick<
    CompanyProfile,
    | "addressLine1"
    | "addressLine2"
    | "city"
    | "state"
    | "postalCode"
    | "country"
  > | null
): string[] {
  if (!profile) return [];
  const lines: string[] = [];
  if (profile.addressLine1?.trim()) lines.push(profile.addressLine1.trim());
  if (profile.addressLine2?.trim()) lines.push(profile.addressLine2.trim());
  const cityLine = [profile.city, profile.state, profile.postalCode]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(", ");
  if (cityLine) lines.push(cityLine);
  if (profile.country?.trim()) lines.push(profile.country.trim());
  return lines;
}

export function getPlatformBrandFallback(): CompanyBrandForDocuments {
  const siteUrl = platformEmailAssetBaseUrl();
  const logoPath = `${siteUrl}/brand/fecsync-mark.svg`;

  return {
    displayName: PLATFORM_BRAND_NAME,
    legalName: PLATFORM_BRAND_NAME,
    tradingName: PLATFORM_BRAND_NAME,
    logoUrl: logoPath,
    supportEmail: PLATFORM_SUPPORT_EMAIL,
    replyToEmail: PLATFORM_SUPPORT_EMAIL,
    phone: null,
    website: PLATFORM_SITE_URL,
    addressLines: [],
    taxId: null,
    bankName: null,
    bankAccountName: null,
    bankAccountLast4: null,
    bankCurrency: null,
    invoiceFooterNote: null,
    receiptFooterNote: null,
    letterheadColor: BRAND_GOLD,
    isPlatformFallback: true,
  };
}

export async function getCompanyBrandForDocuments(
  orgId: string
): Promise<CompanyBrandForDocuments> {
  const id = asIdString(orgId) ?? String(orgId ?? "").trim();
  if (!id) return getPlatformBrandFallback();

  const [org, profile] = await Promise.all([
    prisma.organization.findUnique({
      where: { id },
      select: { name: true },
    }),
    getCompanyProfile(id),
  ]);

  const siteUrl = platformEmailAssetBaseUrl();
  const fallbackLogo = `${siteUrl}/brand/fecsync-mark.svg`;

  const customLogo = profile?.logoUrl?.trim() || "";
  const hasIdentity = Boolean(
    profile?.legalName?.trim() ||
      profile?.tradingName?.trim() ||
      customLogo ||
      profile?.supportEmail?.trim() ||
      buildAddressLines(profile).length > 0
  );

  const displayName = computeCompanyDisplayName({
    legalName: profile?.legalName,
    tradingName: profile?.tradingName,
    organizationName: org?.name,
    fallback: "Company",
  });

  return {
    displayName,
    legalName: profile?.legalName ?? null,
    tradingName: profile?.tradingName ?? null,
    // Never inject FECSYNC chrome onto a tenant that already has profile identity.
    logoUrl: customLogo || (hasIdentity ? "" : fallbackLogo),
    supportEmail: profile?.supportEmail ?? null,
    replyToEmail: profile?.replyToEmail ?? profile?.supportEmail ?? null,
    phone: profile?.phone ?? null,
    website: profile?.website ?? null,
    addressLines: buildAddressLines(profile),
    taxId: profile?.taxId ?? null,
    bankName: profile?.bankName ?? null,
    bankAccountName: profile?.bankAccountName ?? null,
    bankAccountLast4: profile?.bankAccountLast4 ?? null,
    bankCurrency: profile?.bankCurrency ?? null,
    invoiceFooterNote: profile?.invoiceFooterNote ?? null,
    receiptFooterNote: profile?.receiptFooterNote ?? null,
    letterheadColor: profile?.letterheadColor?.trim() || BRAND_GOLD,
    // Completeness score is for the dashboard meter; brand identity is any uploaded field.
    isPlatformFallback: !hasIdentity,
  };
}

/**
 * Prefer tenant brand when profile has identity fields.
 * Empty profile still keeps Organization.name (not wiped to FECSYNC) for approved tenants.
 */
export async function resolveBrandForOrg(
  orgId: string | null | undefined
): Promise<CompanyBrandForDocuments> {
  const id = asIdString(orgId) ?? (typeof orgId === "string" ? orgId.trim() : "");
  if (!id) return getPlatformBrandFallback();
  const brand = await getCompanyBrandForDocuments(id);
  if (!brand.isPlatformFallback) {
    return brand;
  }
  const platform = getPlatformBrandFallback();
  // Approved org with empty Company Profile: keep registration name, FECSYNC chrome.
  if (
    brand.displayName &&
    brand.displayName !== "Company" &&
    brand.displayName !== platform.displayName
  ) {
    return {
      ...platform,
      displayName: brand.displayName,
      isPlatformFallback: true,
    };
  }
  return platform;
}

/** Platform auth / marketing emails must never white-label to a tenant. */
export function isPlatformAuthEmail(kind: string): boolean {
  const k = kind.trim().toLowerCase();
  return (
    k === "verification" ||
    k === "otp" ||
    k === "password_reset" ||
    k === "welcome" ||
    k === "admin_verification" ||
    k === "google_link" ||
    k === "platform_marketing"
  );
}
