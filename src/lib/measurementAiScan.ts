import dbConnect from "@/lib/db";
import prisma from "@/lib/prisma";
import type { AuditUpdateStamp } from "@/lib/audit/recordAudit";
import {
  countSetMeasurements,
  measurementAiScanInputSchema,
  sanitizeMeasurementValues,
  type MeasurementAiScanInput,
  type MeasurementAiScanResult,
  type MeasurementGender,
  type MeasurementUnit,
} from "@/lib/measurements.shared";
import {
  getMeasurementProfileForUser,
  toMeasurementProfileDto,
} from "@/lib/measurements";
import { auditUpdateToPrisma } from "@/lib/catalogWrite";
import { isValidId } from "@/lib/ids";
import {
  assertSponsoredAiScanAvailable,
  consumeSponsoredAiScan,
  resolveCampaignActorAccount,
} from "@/lib/measurementCampaigns";

/** Stub body measurements (cm) — replaced when a vision provider is wired. */
const STUB_MEASUREMENTS_CM: Record<string, number> = {
  height: 168,
  weight: 62,
  neck: 37,
  shoulder: 42,
  chest: 94,
  bust: 92,
  back_width: 38,
  sleeve: 58,
  arm_length: 58,
  bicep: 30,
  wrist: 16,
  front_length: 42,
  across_back: 36,
  upper_chest: 88,
  waist: 76,
  hip: 96,
  inseam: 76,
  outseam: 102,
  thigh: 54,
  knee: 36,
  calf: 34,
  rise: 26,
  seat: 98,
};

function cmToInches(cm: number): number {
  return Math.round((cm / 2.54) * 10) / 10;
}

function stubMeasurementsForUnit(unit: MeasurementUnit): Record<string, number> {
  if (unit === "cm") return { ...STUB_MEASUREMENTS_CM };
  const out: Record<string, number> = {};
  for (const [key, cm] of Object.entries(STUB_MEASUREMENTS_CM)) {
    out[key] = cmToInches(cm);
  }
  return out;
}

export type AiScanImages = {
  front: string;
  back: string;
  side: string;
};

/**
 * Analyze pose photos into flat measurement fields.
 * v1: deterministic stub. Set MEASUREMENT_AI_SCAN_MODE=provider to plug in vision later.
 */
export async function analyzeMeasurementPhotos(opts: {
  images: AiScanImages;
  unit: MeasurementUnit;
  gender?: MeasurementGender;
}): Promise<{ measurements: Record<string, number>; stub: boolean }> {
  void opts.images;
  void opts.gender;

  const mode = process.env.MEASUREMENT_AI_SCAN_MODE?.trim().toLowerCase();
  if (mode === "provider") {
    // Hook for future vision provider integration (OpenRouter / custom).
    // Fall back to stub until implemented.
  }

  return {
    measurements: sanitizeMeasurementValues(stubMeasurementsForUnit(opts.unit)),
    stub: true,
  };
}

function auditData(audit?: Record<string, unknown> | AuditUpdateStamp) {
  if (!audit) return {};
  if ("updatedBy" in audit && typeof audit.updatedBy === "string") {
    return auditUpdateToPrisma(audit as AuditUpdateStamp);
  }
  return {};
}

function countUpdatedFields(
  before: Record<string, number>,
  after: Record<string, number>
): number {
  let n = 0;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[key] !== after[key] && after[key] != null) n += 1;
  }
  return n;
}

async function resolveCampaignIdBySlug(slug: string): Promise<string | null> {
  const row = await prisma.measurementCampaign.findFirst({
    where: {
      slug: slug.trim(),
      status: "active",
      tailorProfile: { status: "approved" },
    },
    select: { id: true },
  });
  return row?.id ?? null;
}

export async function runMeasurementAiScanForUser(opts: {
  userId: string;
  profileId: string;
  rawInput: unknown;
  audit?: Record<string, unknown> | AuditUpdateStamp;
}): Promise<MeasurementAiScanResult> {
  await dbConnect();
  if (!isValidId(opts.userId) || !isValidId(opts.profileId)) {
    throw new Error("Invalid measurement profile");
  }

  const parsed = measurementAiScanInputSchema.safeParse(opts.rawInput);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Invalid scan request";
    throw new Error(msg);
  }
  const input: MeasurementAiScanInput = parsed.data;

  const existing = await getMeasurementProfileForUser(opts.userId, opts.profileId);
  if (!existing) {
    throw new Error("Measurement profile not found");
  }

  let campaignId: string | undefined;
  if (input.campaignSlug) {
    await resolveCampaignActorAccount(opts.userId);
    const id = await resolveCampaignIdBySlug(input.campaignSlug);
    if (!id) throw new Error("Campaign not found");
    campaignId = id;
    await assertSponsoredAiScanAvailable(campaignId, opts.userId, {
      inviteToken: input.inviteToken,
    });
  }

  const { measurements: scanned, stub } = await analyzeMeasurementPhotos({
    images: {
      front: input.frontImage,
      back: input.backImage,
      side: input.sideImage,
    },
    unit: existing.unit,
    gender: existing.gender,
  });

  if (countSetMeasurements(scanned) === 0) {
    throw new Error("Could not extract measurements from these photos");
  }

  const before = existing.measurements;
  const merged = sanitizeMeasurementValues({
    ...before,
    ...scanned,
  });

  let scansRemaining: number | undefined;
  let sponsoredScanConsumed = false;

  const profile = await prisma.$transaction(
    async (tx) => {
      const row = await tx.measurementProfile.findFirst({
        where: { userId: opts.userId, id: opts.profileId },
      });
      if (!row) throw new Error("Measurement profile not found");

      const updated = await tx.measurementProfile.update({
        where: { id: row.id },
        data: {
          measurements: merged,
          ...auditData(opts.audit),
        },
      });

      if (campaignId) {
        const consume = await consumeSponsoredAiScan(campaignId, opts.userId, {
          inviteToken: input.inviteToken,
          tx,
        });
        scansRemaining = consume.scansRemaining;
        sponsoredScanConsumed = true;
      }

      return toMeasurementProfileDto(updated);
    },
    { maxWait: 15000, timeout: 30000 }
  );

  return {
    profile,
    fieldsUpdated: countUpdatedFields(before, merged),
    stub,
    ...(sponsoredScanConsumed ? { sponsoredScanConsumed: true } : {}),
    ...(scansRemaining != null ? { scansRemaining } : {}),
  };
}
