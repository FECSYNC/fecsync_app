/**
 * Shared waiver validity helper.
 * Booking confirmation and staff booking detail call evaluateBookingWaivers, which
 * uses this helper. Cart checkout and the check-in scanner do not call it. It treats a past
 * expiresAt, a decline, and a missing guardian the same way the signed list does.
 * Status vocabulary: valid | missing | expired | declined | voided | pending | minor_unsigned.
 */
import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import {
  computeWaiverExpiresAt,
  isSignedWaiverCurrentlyValid,
  type WaiverExpiryRuleName,
} from "@/lib/waivers/expiry";

export type WaiverValidityStatus =
  | "valid"
  | "missing"
  | "expired"
  | "declined"
  | "voided"
  | "pending"
  | "minor_unsigned";

const STATUS_RANK: Record<WaiverValidityStatus, number> = {
  valid: 0,
  pending: 1,
  minor_unsigned: 2,
  missing: 3,
  expired: 4,
  voided: 5,
  declined: 6,
};

export type WaiverEvalRecord = {
  id: string;
  templateId: string;
  templateVersionId: string;
  status: string;
  signedAt: string | null;
  expiresAt: string | null;
  publicRef: string;
  validity: WaiverValidityStatus;
  staleVersion?: boolean;
};

export type WaiverMissingRequirement = {
  requirementId: string | null;
  templateId: string | null;
  targetType: string;
  targetId: string | null;
  enforcement: "warn" | "block";
  reason: string;
};

export type EvaluateGuestWaiversResult = {
  status: WaiverValidityStatus;
  records: WaiverEvalRecord[];
  missingRequirements: WaiverMissingRequirement[];
  expiresAt: string | null;
};

export type ProductTarget = {
  targetType: string;
  targetId?: string | null;
};

function venueTimeZone(raw: string | null | undefined): string {
  const tz = raw?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format();
    return tz;
  } catch {
    return "UTC";
  }
}

function worst(statuses: WaiverValidityStatus[]): WaiverValidityStatus {
  if (!statuses.length) return "missing";
  return statuses.reduce((a, b) => (STATUS_RANK[b] > STATUS_RANK[a] ? b : a));
}

function ruleOf(
  templateRule: string | null | undefined,
  settingsRule: string | null | undefined
): WaiverExpiryRuleName {
  const rule = templateRule || settingsRule || "calendar_year";
  if (
    rule === "never" ||
    rule === "days" ||
    rule === "calendar_year" ||
    rule === "visit" ||
    rule === "until_date"
  ) {
    return rule;
  }
  return "calendar_year";
}

export function classifySignedRecord(input: {
  recordStatus: string;
  signedAt: Date | null;
  expiresAt: Date | null;
  rule: WaiverExpiryRuleName;
  expiryDays: number | null;
  timeZone: string;
  now: Date;
  hasMinor: boolean;
  hasGuardian: boolean;
}): WaiverValidityStatus {
  if (input.recordStatus === "declined") return "declined";
  if (input.recordStatus === "voided" || input.recordStatus === "revoked") {
    return "voided";
  }
  if (input.recordStatus === "pending") return "pending";
  if (input.recordStatus === "expired") return "expired";
  if (input.recordStatus !== "signed" || !input.signedAt) return "pending";
  if (input.hasMinor && !input.hasGuardian) return "minor_unsigned";

  const expiresAt =
    input.expiresAt ??
    computeWaiverExpiresAt({
      rule: input.rule,
      signedAt: input.signedAt,
      expiryDays: input.expiryDays,
      untilDate: input.expiresAt,
      timeZone: input.timeZone,
    });
  const ok = isSignedWaiverCurrentlyValid({
    rule: input.rule,
    signedAt: input.signedAt,
    expiresAt,
    now: input.now,
    timeZone: input.timeZone,
  });
  return ok ? "valid" : "expired";
}

/** One validity result for a stored record, including a stale published version. */
export function storedRecordValidity(input: {
  recordStatus: string;
  signedAt: Date | null;
  expiresAt: Date | null;
  templateVersionId: string;
  templateRule: string | null | undefined;
  templateExpiryDays: number | null | undefined;
  settingsRule: string | null | undefined;
  settingsExpiryDays: number | null | undefined;
  requireResignOnPublish: boolean;
  currentPublishedVersionId: string | null;
  timeZone: string;
  signers: { isMinor: boolean; role: string }[];
  now: Date;
}): WaiverValidityStatus {
  const rule = ruleOf(input.templateRule, input.settingsRule);
  const expiryDays =
    rule !== "days"
      ? null
      : input.templateRule === "days"
        ? (input.templateExpiryDays ?? input.settingsExpiryDays ?? null)
        : (input.settingsExpiryDays ?? null);
  let validity: WaiverValidityStatus;
  try {
    validity = classifySignedRecord({
      recordStatus: input.recordStatus,
      signedAt: input.signedAt,
      expiresAt: input.expiresAt,
      rule,
      expiryDays,
      timeZone: input.timeZone,
      now: input.now,
      hasMinor: input.signers.some((signer) => signer.isMinor || signer.role === "minor"),
      hasGuardian: input.signers.some((signer) => signer.role === "guardian"),
    });
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes("expiryDays")) throw err;
    validity = "expired";
  }
  if (
    validity === "valid" &&
    input.requireResignOnPublish &&
    input.currentPublishedVersionId &&
    input.templateVersionId !== input.currentPublishedVersionId
  ) {
    return "missing";
  }
  return validity;
}

export async function evaluateGuestWaivers(input: {
  orgId: string;
  locationId: string;
  guestProfileId: string;
  productTargets?: ProductTarget[];
  now?: Date;
}): Promise<EvaluateGuestWaiversResult> {
  const orgId = requireId(input.orgId, "orgId");
  const locationId = requireId(input.locationId, "locationId");
  const guestProfileId = requireId(input.guestProfileId, "guestProfileId");
  const now = input.now ?? new Date();

  const venue = await prisma.venueLocation.findFirst({
    where: { id: locationId, orgId },
    select: { timezone: true },
  });
  if (!venue) throw new Error("Venue location not found");
  const guest = await prisma.guestProfile.findFirst({
    where: { id: guestProfileId, orgId },
    select: { id: true },
  });
  if (!guest) throw new Error("Guest not found");
  const timeZone = venueTimeZone(venue.timezone);

  const [settings, records, requirements] = await Promise.all([
    prisma.waiverSettings.findFirst({
      where: { orgId, locationId },
    }).then(async (row) => {
      if (row) return row;
      return prisma.waiverSettings.findFirst({
        where: { orgId, locationId: null },
      });
    }),
    prisma.waiverRecord.findMany({
      where: { orgId, guestProfileId, locationId },
      include: {
        template: {
          select: {
            defaultExpiryRule: true,
            defaultExpiryDays: true,
            kind: true,
            requireResignOnPublish: true,
            currentPublishedVersionId: true,
          },
        },
        signers: { select: { isMinor: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.waiverRequirement.findMany({
      where: {
        orgId,
        required: true,
        OR: [{ locationId }, { locationId: null }],
        template: {
          status: "published",
          archivedAt: null,
          currentPublishedVersionId: { not: null },
        },
      },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  const targets = input.productTargets ?? [];
  const applicable = requirements.filter((req) => {
    if (req.targetType === "all_admissions") {
      if (!targets.length) return true;
      return targets.some(
        (t) => t.targetType === "all_admissions" || t.targetType === "admission_product"
      );
    }
    if (!targets.length) return req.targetType === "guest" || req.targetId == null;
    return targets.some(
      (t) =>
        t.targetType === req.targetType &&
        (req.targetId == null || req.targetId === (t.targetId ?? null))
    );
  });

  const waiverRequiredTargets: WaiverMissingRequirement[] = [];
  for (const target of targets) {
    if (target.targetType !== "admission_product" || !target.targetId) continue;
    const product = await prisma.admissionProduct.findFirst({
      where: { id: target.targetId, orgId },
      select: { id: true, waiverRequired: true },
    });
    if (!product?.waiverRequired) continue;
    const linked = applicable.some(
      (req) =>
        req.targetType === "admission_product" &&
        (req.targetId == null || req.targetId === product.id)
    );
    if (!linked) {
      waiverRequiredTargets.push({
        requirementId: null,
        templateId: null,
        targetType: "admission_product",
        targetId: product.id,
        enforcement: "block",
        reason: "Product requires a waiver and no requirement is configured",
      });
    }
  }

  for (const target of targets) {
    if (target.targetType !== "membership_plan" || !target.targetId) continue;
    const plan = await prisma.membershipPlan.findFirst({
      where: { id: target.targetId, orgId },
      select: { id: true, entitlements: true },
    });
    const entitlements =
      plan?.entitlements &&
      typeof plan.entitlements === "object" &&
      !Array.isArray(plan.entitlements)
        ? (plan.entitlements as Record<string, unknown>)
        : null;
    if (entitlements?.waiverRequired !== true) continue;
    const linked = applicable.some(
      (req) =>
        req.targetType === "membership_plan" &&
        (req.targetId == null || req.targetId === plan!.id)
    );
    if (!linked) {
      waiverRequiredTargets.push({
        requirementId: null,
        templateId: null,
        targetType: "membership_plan",
        targetId: plan!.id,
        enforcement: "block",
        reason: "Membership plan requires a waiver and no requirement is configured",
      });
    }
  }

  const evalRecords: WaiverEvalRecord[] = records.map((row) => {
    const templateRule = row.template.defaultExpiryRule;
    const rule = ruleOf(templateRule, settings?.expiryRule);
    const expiryDays =
      rule !== "days"
        ? null
        : templateRule === "days"
          ? (row.template.defaultExpiryDays ?? settings?.expiryDays ?? null)
          : (settings?.expiryDays ?? null);
    let validity: WaiverValidityStatus;
    try {
      validity = classifySignedRecord({
        recordStatus: row.status,
        signedAt: row.signedAt,
        expiresAt: row.expiresAt,
        rule,
        expiryDays,
        timeZone,
        now,
        hasMinor: row.signers.some((s) => s.isMinor || s.role === "minor"),
        hasGuardian: row.signers.some((s) => s.role === "guardian"),
      });
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes("expiryDays")) throw err;
      validity = "expired";
    }
    const stale =
      validity === "valid" &&
      row.template.requireResignOnPublish &&
      Boolean(row.template.currentPublishedVersionId) &&
      row.templateVersionId !== row.template.currentPublishedVersionId;
    if (stale) validity = "missing";
    return {
      id: row.id,
      templateId: row.templateId,
      templateVersionId: row.templateVersionId,
      status: row.status,
      signedAt: row.signedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      publicRef: row.publicRef,
      validity,
      staleVersion: stale,
    };
  });

  const missing: WaiverMissingRequirement[] = [...waiverRequiredTargets];
  const statuses: WaiverValidityStatus[] = [];

  if (!records.length && !applicable.length && !waiverRequiredTargets.length) {
    return {
      status: "missing",
      records: [],
      missingRequirements: [],
      expiresAt: null,
    };
  }

  for (const req of applicable) {
    const matches = evalRecords.filter((r) => r.templateId === req.templateId);
    const best = matches.find((r) => r.validity === "valid") ?? matches[0];
    if (!best) {
      missing.push({
        requirementId: req.id,
        templateId: req.templateId,
        targetType: req.targetType,
        targetId: req.targetId,
        enforcement: req.enforcement,
        reason: "No signed waiver for this requirement",
      });
      statuses.push("missing");
      continue;
    }
    if (best.validity !== "valid") {
      missing.push({
        requirementId: req.id,
        templateId: req.templateId,
        targetType: req.targetType,
        targetId: req.targetId,
        enforcement: req.enforcement,
        reason: best.staleVersion ? "stale_version" : `Waiver is ${best.validity}`,
      });
      statuses.push(best.validity);
    } else {
      statuses.push("valid");
    }
  }

  if (waiverRequiredTargets.length) {
    statuses.push("missing");
  }

  if (!applicable.length && !waiverRequiredTargets.length) {
    statuses.push(...evalRecords.map((r) => r.validity));
  }

  for (const record of evalRecords) {
    if (!record.staleVersion) continue;
    if (missing.some((row) => row.templateId === record.templateId && row.reason === "stale_version")) {
      continue;
    }
    missing.push({
      requirementId: null,
      templateId: record.templateId,
      targetType: "guest",
      targetId: null,
      enforcement: "block",
      reason: "stale_version",
    });
    statuses.push("missing");
  }

  const validExpires = evalRecords
    .filter((r) => r.validity === "valid" && r.expiresAt)
    .map((r) => r.expiresAt as string)
    .sort();

  return {
    status: worst(statuses),
    records: evalRecords,
    missingRequirements: missing,
    expiresAt: validExpires[0] ?? null,
  };
}
