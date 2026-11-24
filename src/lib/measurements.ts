import dbConnect from "@/lib/db";
import prisma from "@/lib/prisma";
import { idWhere, isValidId } from "@/lib/ids";
import { auditUpdateToPrisma } from "@/lib/catalogWrite";
import type { AuditUpdateStamp } from "@/lib/audit/recordAudit";
import {
  measurementProfileInputSchema,
  measurementProfileUpdateSchema,
  measurementCategoryPatchSchema,
  mergeCategoryMeasurements,
  sanitizeMeasurementValues,
  assertNonEmptyMeasurements,
  countSetMeasurements,
  type MeasurementProfileDto,
  type MeasurementProfileInput,
  type MeasurementProfileUpdateInput,
  type MeasurementCategoryPatchInput,
  type MeasurementGender,
  type MeasurementUnit,
} from "@/lib/measurements.shared";
import { paginatedMeta, type PaginationOpts } from "@/lib/pagination";

export * from "@/lib/measurements.shared";

type LeanProfile = {
  id: string;
  userId: string;
  label?: string;
  gender?: MeasurementGender | null;
  measurements?: unknown;
  unit?: MeasurementUnit;
  isDefault?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

export function measurementsRecord(raw: unknown): Record<string, number> {
  const parsed: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return parsed;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      parsed[key] = value;
    }
  }
  return sanitizeMeasurementValues(parsed);
}

export function toMeasurementProfileDto(
  doc: LeanProfile
): MeasurementProfileDto {
  return {
    _id: doc.id,
    user: doc.userId,
    label: String(doc.label ?? "").trim(),
    gender: doc.gender ?? undefined,
    measurements: measurementsRecord(doc.measurements),
    unit: (doc.unit ?? "cm") as MeasurementUnit,
    isDefault: Boolean(doc.isDefault),
    createdAt: doc.createdAt
      ? new Date(doc.createdAt).toISOString()
      : undefined,
    updatedAt: doc.updatedAt
      ? new Date(doc.updatedAt).toISOString()
      : undefined,
  };
}

function parseInput(raw: unknown): MeasurementProfileInput {
  const parsed = measurementProfileInputSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Invalid measurement data";
    throw new Error(msg);
  }
  return parsed.data;
}

function parseCategoryPatch(raw: unknown): MeasurementCategoryPatchInput {
  const parsed = measurementCategoryPatchSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Invalid category data";
    throw new Error(msg);
  }
  return parsed.data;
}

function parseUpdate(raw: unknown): MeasurementProfileUpdateInput {
  const parsed = measurementProfileUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Invalid measurement data";
    throw new Error(msg);
  }
  return parsed.data;
}

async function clearOtherDefaults(
  userId: string,
  exceptId?: string
): Promise<void> {
  await prisma.measurementProfile.updateMany({
    where: {
      userId,
      isDefault: true,
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    data: { isDefault: false },
  });
}

function auditData(audit?: Record<string, unknown> | AuditUpdateStamp) {
  if (!audit) return {};
  if ("updatedBy" in audit && typeof audit.updatedBy === "string") {
    return auditUpdateToPrisma(audit as AuditUpdateStamp);
  }
  return {};
}

export async function listMeasurementProfilesForUser(
  userId: string,
  opts?: PaginationOpts
): Promise<{
  profiles: MeasurementProfileDto[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}> {
  await dbConnect();
  const page = Math.max(1, opts?.page ?? 1);
  const limit = Math.min(50, Math.max(1, opts?.limit ?? 20));
  const skip = (page - 1) * limit;
  if (!isValidId(userId)) {
    return { profiles: [], ...paginatedMeta(page, limit, 0) };
  }
  const where = { userId };
  const [total, rows] = await Promise.all([
    prisma.measurementProfile.count({ where }),
    prisma.measurementProfile.findMany({
      where,
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
      skip,
      take: limit,
    }),
  ]);
  return {
    profiles: rows.map((row) => toMeasurementProfileDto(row)),
    ...paginatedMeta(page, limit, total),
  };
}

export async function getMeasurementProfileForUser(
  userId: string,
  id: string
): Promise<MeasurementProfileDto | null> {
  await dbConnect();
  if (!isValidId(userId) || !isValidId(id)) return null;
  const row = await prisma.measurementProfile.findFirst({
    where: { userId, ...idWhere(id) },
  });
  return row ? toMeasurementProfileDto(row) : null;
}

export async function createMeasurementProfile(
  userId: string,
  raw: unknown,
  audit?: Record<string, unknown>
): Promise<MeasurementProfileDto> {
  await dbConnect();
  if (!isValidId(userId)) throw new Error("Invalid user");
  const input = parseInput(raw);
  const count = await prisma.measurementProfile.count({ where: { userId } });
  const makeDefault = input.isDefault === true || count === 0;
  if (makeDefault) await clearOtherDefaults(userId);

  const created = await prisma.measurementProfile.create({
    data: {
      userId,
      label: input.label,
      gender: input.gender,
      unit: input.unit,
      measurements: sanitizeMeasurementValues(input.measurements),
      isDefault: makeDefault,
      ...auditData(audit),
    },
  });
  return toMeasurementProfileDto(created);
}

export async function updateMeasurementProfile(
  userId: string,
  id: string,
  raw: unknown,
  audit?: Record<string, unknown>
): Promise<MeasurementProfileDto | null> {
  await dbConnect();
  if (!isValidId(userId) || !isValidId(id)) return null;
  const existing = await prisma.measurementProfile.findFirst({
    where: { userId, ...idWhere(id) },
  });
  if (!existing) return null;

  const input = parseUpdate(raw);
  const genderProvided =
    raw != null && typeof raw === "object" && "gender" in (raw as object);
  const unitProvided =
    raw != null && typeof raw === "object" && "unit" in (raw as object);
  let isDefault = existing.isDefault;
  if (input.isDefault === true) {
    await clearOtherDefaults(userId, existing.id);
    isDefault = true;
  } else if (input.isDefault === false) {
    isDefault = false;
    if (existing.isDefault) {
      const nextDefault = await prisma.measurementProfile.findFirst({
        where: { userId, NOT: { id: existing.id } },
        orderBy: { updatedAt: "desc" },
      });
      if (nextDefault) {
        await clearOtherDefaults(userId, nextDefault.id);
        await prisma.measurementProfile.update({
          where: { id: nextDefault.id },
          data: { isDefault: true },
        });
      }
    }
  }

  const existingMeasurements = measurementsRecord(existing.measurements);
  // When measurements are sent, replace the stored map (do not merge). Cleared
  // fields must become unset so booking / profile UIs stay in sync.
  const measurements =
    input.measurements != null
      ? sanitizeMeasurementValues(input.measurements)
      : existingMeasurements;
  if (input.measurements != null) {
    assertNonEmptyMeasurements(
      measurements,
      "Add at least one measurement to this profile"
    );
  }

  const label =
    input.label ?? (String(existing.label ?? "").trim() || "Measurements");

  const updated = await prisma.measurementProfile.update({
    where: { id: existing.id },
    data: {
      label,
      ...(genderProvided ? { gender: input.gender ?? null } : {}),
      ...(unitProvided ? { unit: input.unit } : {}),
      measurements,
      isDefault,
      ...auditData(audit),
    },
  });
  return toMeasurementProfileDto(updated);
}

export async function deleteMeasurementProfile(
  userId: string,
  id: string
): Promise<boolean> {
  await dbConnect();
  if (!isValidId(userId) || !isValidId(id)) return false;
  const existing = await prisma.measurementProfile.findFirst({
    where: { userId, ...idWhere(id) },
  });
  if (!existing) return false;

  const linkedJobs = await prisma.tailoringJob.count({
    where: { measurementProfileId: existing.id },
  });
  if (linkedJobs > 0) {
    throw new Error(
      "This measurement profile is linked to tailoring jobs and cannot be deleted"
    );
  }

  const linkedCampaigns = await prisma.campaignParticipant.count({
    where: { measurementProfileId: existing.id },
  });
  if (linkedCampaigns > 0) {
    throw new Error(
      "This measurement profile was submitted to a measurement campaign and cannot be deleted"
    );
  }

  await prisma.measurementProfile.delete({ where: { id: existing.id } });
  if (existing.isDefault) {
    const next = await prisma.measurementProfile.findFirst({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });
    if (next) {
      await clearOtherDefaults(userId, next.id);
      await prisma.measurementProfile.update({
        where: { id: next.id },
        data: { isDefault: true },
      });
    }
  }
  return true;
}

export async function updateMeasurementProfileCategory(
  userId: string,
  id: string,
  raw: unknown,
  audit?: Record<string, unknown>
): Promise<MeasurementProfileDto | null> {
  await dbConnect();
  if (!isValidId(userId) || !isValidId(id)) return null;

  const input = parseCategoryPatch(raw);
  const unitProvided =
    raw != null && typeof raw === "object" && "unit" in (raw as object);

  const run = () =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.measurementProfile.findFirst({
        where: { userId, ...idWhere(id) },
      });
      if (!existing) return null;

      const merged = mergeCategoryMeasurements(
        measurementsRecord(existing.measurements),
        input.categoryId,
        input.measurements
      );
      assertNonEmptyMeasurements(
        merged,
        "Profile must include at least one measurement after this update"
      );

      const updated = await tx.measurementProfile.update({
        where: { id: existing.id },
        data: {
          measurements: sanitizeMeasurementValues(merged),
          ...(unitProvided && input.unit ? { unit: input.unit } : {}),
          ...auditData(audit),
        },
      });
      return toMeasurementProfileDto(updated);
    });

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await run();
    } catch (err) {
      lastErr = err;
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : "";
      if (code !== "P2034" || attempt === 2) throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Failed to update category");
}

export async function setDefaultMeasurementProfile(
  userId: string,
  id: string,
  audit?: Record<string, unknown>
): Promise<MeasurementProfileDto | null> {
  await dbConnect();
  if (!isValidId(userId) || !isValidId(id)) return null;
  const existing = await prisma.measurementProfile.findFirst({
    where: { userId, ...idWhere(id) },
  });
  if (!existing) return null;
  await clearOtherDefaults(userId, existing.id);
  const updated = await prisma.measurementProfile.update({
    where: { id: existing.id },
    data: {
      isDefault: true,
      ...auditData(audit),
    },
  });
  return toMeasurementProfileDto(updated);
}
