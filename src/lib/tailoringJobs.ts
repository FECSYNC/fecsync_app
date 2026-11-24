import { after } from "next/server";
import dbConnect from "@/lib/db";
import prisma from "@/lib/prisma";
import { idWhere, isValidId } from "@/lib/ids";
import { auditCreateToPrisma, auditUpdateToPrisma, whereOrgAndCatalogId } from "@/lib/catalogWrite";
import type { AuditCreateStamp, AuditUpdateStamp } from "@/lib/audit/recordAudit";
import { ForbiddenError } from "@/lib/auth/http-error";
import { resolveProviderTailorProfileIdForJobs } from "@/lib/tailors";
import { storefrontOrgFilter } from "@/lib/org";
import { paginatedMeta, type PaginationOpts } from "@/lib/pagination";
import {
  measurementsRecord,
  assertNonEmptyMeasurements,
  sanitizeMeasurementValues,
} from "@/lib/measurements";
import type { MeasurementGender, MeasurementUnit } from "@/lib/measurements.shared";
import { Prisma } from "@prisma/client";
import {
  canTransition,
  createTailoringJobSchema,
  isTailoringJobStatus,
  patchTailoringJobSchema,
  type CreateTailoringJobInput,
  type PatchTailoringJobInput,
  type TailoringJobDto,
  type TailoringJobMeasurementSnapshot,
  type TailoringJobStatus,
  type TransitionActorRole,
} from "@/lib/tailoringJobs.shared";

export * from "@/lib/tailoringJobs.shared";

function auditFieldsForCreate(
  audit?: Record<string, unknown>
): Record<string, string> {
  if (audit && "createdBy" in audit) {
    return auditCreateToPrisma(audit as AuditCreateStamp);
  }
  if (audit && "updatedBy" in audit) {
    return auditUpdateToPrisma(audit as AuditUpdateStamp);
  }
  return {};
}

async function dtoForCreatedJob(jobId: string): Promise<TailoringJobDto> {
  const dto = await getTailoringJobById(jobId);
  if (dto) return dto;
  // Rare read-after-write miss — one more direct load before failing.
  const row = await loadJobRow(jobId);
  if (row) return toTailoringJobDto(row);
  throw new Error(
    "Job was submitted but details could not be loaded. Check My jobs before trying again."
  );
}

/** Notify/email must not block the booking HTTP response (SMTP is often multi-second). */
function scheduleNotifyBookingSubmitted(
  input: Parameters<typeof notifyBookingSubmitted>[0]
): void {
  after(() => {
    void notifyBookingSubmitted(input);
  });
}

function rethrowCreateJobError(err: unknown): never {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err.code === "P2003" || err.code === "P2025")
  ) {
    throw new Error("Tailor not found or not available");
  }
  throw err;
}

const jobInclude = {
  customer: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      username: true,
    },
  },
  tailorProfile: {
    select: {
      id: true,
      slug: true,
      displayName: true,
      userId: true,
    },
  },
  measurementProfile: {
    select: {
      id: true,
      label: true,
      measurements: true,
      unit: true,
      gender: true,
    },
  },
} as const;

type JobRow = {
  id: string;
  customerId: string;
  tailorProfileId: string;
  measurementProfileId?: string | null;
  orgId: string;
  title: string;
  description?: string | null;
  style?: string | null;
  eventType?: string | null;
  referenceImages?: string[];
  quotedPrice?: number | null;
  currency?: string;
  taxAmount?: number | null;
  taxRate?: number | null;
  taxLabel?: string | null;
  amount?: number | null;
  status: TailoringJobStatus;
  statusHistory?: unknown;
  paymentReference?: string | null;
  paymentProvider?: string | null;
  paidAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  customer?: {
    id: string;
    email?: string;
    firstName?: string | null;
    lastName?: string | null;
    username?: string | null;
  } | null;
  tailorProfile?: {
    id: string;
    slug?: string;
    displayName?: string;
    userId?: string;
  } | null;
  measurementProfile?: {
    id: string;
    label?: string;
    measurements?: unknown;
    unit?: string;
    gender?: string | null;
  } | null;
};

function parseMeasurementSnapshot(
  raw: unknown
): TailoringJobMeasurementSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const label = typeof entry.label === "string" ? entry.label.trim() : "";
  const unit = typeof entry.unit === "string" ? entry.unit : "cm";
  const measurements = measurementsRecord(entry.measurements);
  if (!label && Object.keys(measurements).length === 0) return null;
  return {
    label: label || "Measurements",
    unit,
    gender: typeof entry.gender === "string" ? entry.gender : undefined,
    measurements,
  };
}

function snapshotFromProfile(
  profile: JobRow["measurementProfile"]
): TailoringJobMeasurementSnapshot | null {
  if (!profile) return null;
  const measurements = measurementsRecord(profile.measurements);
  if (Object.keys(measurements).length === 0) return null;
  return {
    label: String(profile.label ?? "").trim() || "Measurements",
    unit: String(profile.unit ?? "cm"),
    gender: profile.gender ? String(profile.gender) : undefined,
    measurements,
  };
}

function resolveMeasurementSnapshot(
  doc: JobRow
): TailoringJobMeasurementSnapshot | null {
  const fromHistory =
    parseStatusHistory(doc.statusHistory)
      .map((entry) => entry.measurementSnapshot)
      .find((snapshot) => snapshot != null) ?? null;

  if (fromHistory && Object.keys(fromHistory.measurements).length > 0) {
    return fromHistory;
  }

  // Legacy jobs, corrupt/empty history snapshots, or label-only history —
  // fall back to the linked live profile when it still has values.
  const fromProfile = snapshotFromProfile(doc.measurementProfile);
  if (fromProfile) return fromProfile;

  return fromHistory;
}

type StatusHistoryEntry = {
  status: TailoringJobStatus;
  note?: string;
  updatedAt: string;
  updatedBy?: string | null;
  measurementSnapshot?: TailoringJobMeasurementSnapshot;
};

function parseStatusHistory(raw: unknown): StatusHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((h) => {
    const entry =
      h && typeof h === "object" ? (h as Record<string, unknown>) : {};
    const snapshot = parseMeasurementSnapshot(entry.measurementSnapshot);
    return {
      status: (entry.status ?? "draft") as TailoringJobStatus,
      note: typeof entry.note === "string" ? entry.note : undefined,
      updatedAt: entry.updatedAt
        ? new Date(String(entry.updatedAt)).toISOString()
        : new Date().toISOString(),
      updatedBy: entry.updatedBy ? String(entry.updatedBy) : null,
      measurementSnapshot: snapshot ?? undefined,
    };
  });
}

function appendStatusHistory(
  raw: unknown,
  entry: {
    status: TailoringJobStatus;
    note?: string;
    updatedBy?: string | null;
    updatedAt?: Date;
    measurementSnapshot?: TailoringJobMeasurementSnapshot;
  }
): StatusHistoryEntry[] {
  return [
    ...parseStatusHistory(raw),
    {
      status: entry.status,
      note: entry.note,
      updatedAt: (entry.updatedAt ?? new Date()).toISOString(),
      updatedBy: entry.updatedBy ?? null,
      measurementSnapshot: entry.measurementSnapshot,
    },
  ];
}

async function notifyUser(
  userId: string,
  title: string,
  message: string,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    await dbConnect();
    const { createNotification } = await import(
      "@/services/notificationService"
    );
    await createNotification(userId, title, message, "tailoring", metadata);
  } catch (err) {
    console.warn("[tailoring-jobs] notification skipped:", err);
  }
}

function personLabel(
  customer: JobRow["customer"],
  customerId: string
): { id: string; name?: string; email?: string } {
  if (!customer) return { id: customerId };
  const parts = [customer.firstName, customer.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return {
    id: customer.id,
    email: customer.email,
    name: parts || customer.username || undefined,
  };
}

export function toTailoringJobDto(doc: JobRow): TailoringJobDto {
  const customer = personLabel(doc.customer ?? null, doc.customerId);
  const tailorProfileId = doc.tailorProfile?.id ?? doc.tailorProfileId;
  return {
    _id: doc.id,
    customer: customer.id,
    customerName: customer.name,
    customerEmail: customer.email,
    tailorProfile: tailorProfileId,
    tailorSlug: doc.tailorProfile?.slug,
    tailorDisplayName: doc.tailorProfile?.displayName,
    measurementProfile: doc.measurementProfile?.id ?? doc.measurementProfileId ?? null,
    measurementLabel: doc.measurementProfile?.label ?? null,
    measurementSnapshot: resolveMeasurementSnapshot(doc),
    orgId: doc.orgId,
    title: String(doc.title ?? "").trim(),
    description: String(doc.description ?? ""),
    style: String(doc.style ?? ""),
    eventType: String(doc.eventType ?? ""),
    referenceImages: Array.isArray(doc.referenceImages)
      ? doc.referenceImages
      : [],
    quotedPrice:
      typeof doc.quotedPrice === "number" ? doc.quotedPrice : doc.quotedPrice ?? null,
    currency: String(doc.currency ?? "NGN"),
    taxAmount:
      typeof doc.taxAmount === "number" ? doc.taxAmount : doc.taxAmount ?? null,
    taxRate:
      typeof doc.taxRate === "number" ? doc.taxRate : doc.taxRate ?? null,
    taxLabel:
      typeof doc.taxLabel === "string" ? doc.taxLabel : doc.taxLabel ?? null,
    amount: typeof doc.amount === "number" ? doc.amount : doc.amount ?? null,
    status: doc.status ?? "draft",
    statusHistory: parseStatusHistory(doc.statusHistory),
    paymentReference: doc.paymentReference ? String(doc.paymentReference) : null,
    paymentProvider: doc.paymentProvider ? String(doc.paymentProvider) : null,
    paidAt: doc.paidAt ? new Date(doc.paidAt).toISOString() : null,
    createdAt: doc.createdAt
      ? new Date(doc.createdAt).toISOString()
      : undefined,
    updatedAt: doc.updatedAt
      ? new Date(doc.updatedAt).toISOString()
      : undefined,
  };
}

async function loadJobRow(id: string): Promise<JobRow | null> {
  if (!isValidId(id)) return null;
  return prisma.tailoringJob.findFirst({
    where: idWhere(id),
    include: jobInclude,
  });
}

export async function getTailoringJobById(
  id: string
): Promise<TailoringJobDto | null> {
  await dbConnect();
  const row = await loadJobRow(id);
  return row ? toTailoringJobDto(row) : null;
}

export type TailoringJobListResult = {
  jobs: TailoringJobDto[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export async function listJobsForCustomer(
  customerId: string,
  opts?: { status?: TailoringJobStatus } & PaginationOpts
): Promise<TailoringJobListResult> {
  await dbConnect();
  const page = Math.max(1, opts?.page ?? 1);
  const limit = Math.min(50, Math.max(1, opts?.limit ?? 20));
  const skip = (page - 1) * limit;
  if (!isValidId(customerId)) {
    return { jobs: [], ...paginatedMeta(page, limit, 0) };
  }
  const where = {
    customerId,
    ...(opts?.status ? { status: opts.status } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.tailoringJob.count({ where }),
    prisma.tailoringJob.findMany({
      where,
      include: jobInclude,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);
  return {
    jobs: await enrichCustomerJobsWithReviewFlags(
      customerId,
      rows.map((row) => toTailoringJobDto(row))
    ),
    ...paginatedMeta(page, limit, total),
  };
}

/** Batch review flags for customer list (matches detail GET enrichment). */
async function enrichCustomerJobsWithReviewFlags(
  customerId: string,
  jobs: TailoringJobDto[]
): Promise<TailoringJobDto[]> {
  const completed = jobs.filter((j) => j.status === "completed");
  if (completed.length === 0) return jobs;

  const jobIds = completed.map((j) => j._id);
  const [reviews, approvedTailors] = await Promise.all([
    prisma.tailorReview.findMany({
      where: { jobId: { in: jobIds } },
      select: { jobId: true },
    }),
    prisma.tailorProfile.findMany({
      where: {
        id: { in: [...new Set(completed.map((j) => j.tailorProfile))] },
        status: "approved",
      },
      select: { id: true },
    }),
  ]);

  const reviewed = new Set(reviews.map((r) => r.jobId));
  const approved = new Set(approvedTailors.map((t) => t.id));

  return jobs.map((job) => {
    if (job.status !== "completed") return job;
    const hasReview = reviewed.has(job._id);
    const canReview =
      !hasReview && approved.has(job.tailorProfile);
    return { ...job, hasReview, canReview };
  });
}

export async function listJobsForTailorProfile(
  tailorProfileId: string,
  opts?: { status?: TailoringJobStatus } & PaginationOpts
): Promise<TailoringJobListResult> {
  await dbConnect();
  const page = Math.max(1, opts?.page ?? 1);
  const limit = Math.min(50, Math.max(1, opts?.limit ?? 20));
  const skip = (page - 1) * limit;
  if (!isValidId(tailorProfileId)) {
    return { jobs: [], ...paginatedMeta(page, limit, 0) };
  }
  const where = {
    tailorProfileId,
    ...(opts?.status ? { status: opts.status } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.tailoringJob.count({ where }),
    prisma.tailoringJob.findMany({
      where,
      include: jobInclude,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);
  return {
    jobs: rows.map((row) => toTailoringJobDto(row)),
    ...paginatedMeta(page, limit, total),
  };
}

export async function listJobsForOrg(
  orgId: string,
  opts?: { status?: TailoringJobStatus; q?: string } & PaginationOpts
): Promise<TailoringJobListResult> {
  await dbConnect();
  const page = Math.max(1, opts?.page ?? 1);
  const limit = Math.min(50, Math.max(1, opts?.limit ?? 20));
  const skip = (page - 1) * limit;

  const qRaw = opts?.q?.trim();
  const qLower = qRaw?.toLowerCase();
  const statusMatch =
    qLower && isTailoringJobStatus(qLower) ? (qLower as TailoringJobStatus) : null;

  const where: Prisma.TailoringJobWhereInput = {
    orgId,
    ...(opts?.status ? { status: opts.status } : {}),
    ...(qRaw
      ? {
          OR: [
            { title: { contains: qRaw, mode: "insensitive" } },
            ...(statusMatch ? [{ status: statusMatch }] : []),
            { customer: { email: { contains: qRaw, mode: "insensitive" } } },
            {
              customer: { firstName: { contains: qRaw, mode: "insensitive" } },
            },
            {
              customer: { lastName: { contains: qRaw, mode: "insensitive" } },
            },
            {
              customer: { username: { contains: qRaw, mode: "insensitive" } },
            },
            {
              tailorProfile: {
                displayName: { contains: qRaw, mode: "insensitive" },
              },
            },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.tailoringJob.count({ where }),
    prisma.tailoringJob.findMany({
      where,
      include: jobInclude,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);
  return {
    jobs: rows.map((row) => toTailoringJobDto(row)),
    ...paginatedMeta(page, limit, total),
  };
}

export async function resolveTailorProfileForBooking(input: {
  tailorSlug?: string;
  tailorProfileId?: string;
}): Promise<{
  id: string;
  userId: string;
  orgId: string;
  slug: string;
  displayName: string;
  status: string;
} | null> {
  await dbConnect();
  const { orgId } = await storefrontOrgFilter();
  let profile = null;
  if (input.tailorProfileId && isValidId(input.tailorProfileId)) {
    profile = await prisma.tailorProfile.findFirst({
      where: { ...idWhere(input.tailorProfileId), orgId },
      select: {
        id: true,
        userId: true,
        orgId: true,
        slug: true,
        displayName: true,
        status: true,
      },
    });
  } else if (input.tailorSlug?.trim()) {
    profile = await prisma.tailorProfile.findFirst({
      where: {
        orgId,
        slug: input.tailorSlug.trim().toLowerCase(),
      },
      select: {
        id: true,
        userId: true,
        orgId: true,
        slug: true,
        displayName: true,
        status: true,
      },
    });
  }
  if (!profile || profile.status !== "approved") return null;
  return profile;
}

async function notifyBookingSubmitted(input: {
  customerId: string;
  tailorUserId: string;
  tailorDisplayName: string;
  tailorProfileId: string;
  jobId: string;
  title: string;
  orgId: string;
}): Promise<void> {
  try {
    const base =
      process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") ||
      "http://localhost:3000";

    const [customerUser, tailorUser] = await Promise.all([
      prisma.user.findFirst({
        where: idWhere(input.customerId),
        select: {
          email: true,
          firstName: true,
          lastName: true,
          username: true,
        },
      }),
      prisma.user.findFirst({
        where: idWhere(input.tailorUserId),
        select: { email: true },
      }),
    ]);

    const { displayNameFromUser } = await import("@/lib/audit/recordAudit");
    const customerName = displayNameFromUser(customerUser);

    await Promise.all([
      notifyUser(
        input.tailorUserId,
        "New tailoring request",
        `${input.title} was submitted for ${input.tailorDisplayName}.`,
        {
          kind: "tailoring_job_submitted",
          jobId: input.jobId,
          tailorProfileId: input.tailorProfileId,
        }
      ),
      notifyUser(
        input.customerId,
        "Request submitted",
        `Your request "${input.title}" was sent to ${input.tailorDisplayName}.`,
        {
          kind: "tailoring_job_submitted",
          jobId: input.jobId,
        }
      ),
    ]);

    const { sendTailoringJobSubmittedEmail, sendTailoringJobStatusEmail } =
      await import("@/lib/mailer");

    const emailTasks: Promise<unknown>[] = [];
    if (tailorUser?.email) {
      emailTasks.push(
        sendTailoringJobSubmittedEmail({
          to: String(tailorUser.email),
          tailorName: input.tailorDisplayName,
          customerName,
          jobId: input.jobId,
          title: input.title,
          jobsUrl: `${base}/tailor/jobs/${input.jobId}`,
          orgId: input.orgId,
        })
      );
    }
    if (customerUser?.email) {
      emailTasks.push(
        sendTailoringJobStatusEmail({
          to: String(customerUser.email),
          customerName,
          jobId: input.jobId,
          title: input.title,
          status: "submitted",
          note: `Sent to ${input.tailorDisplayName}. Track it anytime from your profile.`,
          orgId: input.orgId,
        })
      );
    }
    if (emailTasks.length > 0) {
      await Promise.allSettled(emailTasks);
    }
  } catch (err) {
    console.warn("[tailoring-jobs] notify booking parties failed:", err);
  }
}

export async function createSubmittedJob(
  customerId: string,
  raw: unknown,
  audit?: Record<string, unknown>
): Promise<TailoringJobDto> {
  await dbConnect();
  if (!isValidId(customerId)) throw new Error("Invalid user");
  const parsed = createTailoringJobSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid job data: ${parsed.error.issues[0]?.message ?? "check your input"}`
    );
  }
  const input: CreateTailoringJobInput = parsed.data;
  if (!input.tailorSlug && !input.tailorProfileId) {
    throw new Error("tailorSlug or tailorProfileId is required");
  }

  const tailor = await resolveTailorProfileForBooking({
    tailorSlug: input.tailorSlug,
    tailorProfileId: input.tailorProfileId,
  });
  if (!tailor) throw new Error("Tailor not found or not available");

  const auditFields = auditFieldsForCreate(audit);

  const inlineMeasurements = input.measurements
    ? sanitizeMeasurementValues(input.measurements)
    : {};
  const hasInline = Object.keys(inlineMeasurements).length > 0;
  const hasProfileId = Boolean(input.measurementProfileId?.trim());

  // Prefer an explicit owned profile id (smoke/API). Use inline measurements
  // only when no profile id is provided — avoids dual-path ambiguity.
  if (hasProfileId) {
    if (!isValidId(input.measurementProfileId!)) {
      throw new Error("Invalid measurement profile");
    }
    const measurement = await prisma.measurementProfile.findFirst({
      where: {
        ...idWhere(input.measurementProfileId!),
        userId: customerId,
      },
      select: {
        id: true,
        label: true,
        measurements: true,
        unit: true,
        gender: true,
      },
    });
    if (!measurement) throw new Error("Measurement profile not found");

    const profileMeasurements = measurementsRecord(measurement.measurements);
    assertNonEmptyMeasurements(
      profileMeasurements,
      "Measurement profile has no usable values for this booking"
    );

    const measurementSnapshot: TailoringJobMeasurementSnapshot = {
      label: String(measurement.label ?? "").trim() || "Measurements",
      unit: String(measurement.unit ?? "cm"),
      gender: measurement.gender ? String(measurement.gender) : undefined,
      measurements: profileMeasurements,
    };

    const statusHistory = appendStatusHistory(null, {
      status: "submitted",
      note: "Job submitted",
      updatedBy: customerId,
      measurementSnapshot,
    });

    let created;
    try {
      created = await prisma.tailoringJob.create({
        data: {
          customerId,
          tailorProfileId: tailor.id,
          measurementProfileId: measurement.id,
          orgId: tailor.orgId,
          title: input.title,
          description: input.description ?? "",
          style: input.style ?? "",
          eventType: input.eventType ?? "",
          referenceImages: input.referenceImages ?? [],
          status: "submitted",
          statusHistory,
          currency: "NGN",
          ...auditFields,
        },
      });
    } catch (err) {
      rethrowCreateJobError(err);
    }

    scheduleNotifyBookingSubmitted({
      customerId,
      tailorUserId: tailor.userId,
      tailorDisplayName: tailor.displayName,
      tailorProfileId: tailor.id,
      jobId: created.id,
      title: input.title,
      orgId: tailor.orgId,
    });

    return dtoForCreatedJob(created.id);
  }

  if (!hasInline) {
    throw new Error("Measurements are required for this booking");
  }

  assertNonEmptyMeasurements(
    inlineMeasurements,
    "Measurements are required for this booking"
  );
  const label =
    (input.measurementLabel ?? "").trim() ||
    `Booking · ${input.title}`.slice(0, 80);
  const unit = (input.measurementUnit ?? "cm") as MeasurementUnit;
  const gender = input.measurementGender as MeasurementGender | undefined;

  const measurementSnapshot: TailoringJobMeasurementSnapshot = {
    label,
    unit,
    gender: gender ? String(gender) : undefined,
    measurements: inlineMeasurements,
  };

  const statusHistory = appendStatusHistory(null, {
    status: "submitted",
    note: "Job submitted",
    updatedBy: customerId,
    measurementSnapshot,
  });

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const existingCount = await tx.measurementProfile.count({
        where: { userId: customerId },
      });
      const makeDefault = existingCount === 0;
      if (makeDefault) {
        await tx.measurementProfile.updateMany({
          where: { userId: customerId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const profile = await tx.measurementProfile.create({
        data: {
          userId: customerId,
          label,
          gender: gender ?? null,
          unit,
          measurements: inlineMeasurements,
          isDefault: makeDefault,
          ...auditFields,
        },
      });
      // Keep a single default if concurrent first-bookings raced.
      if (makeDefault) {
        await tx.measurementProfile.updateMany({
          where: {
            userId: customerId,
            isDefault: true,
            NOT: { id: profile.id },
          },
          data: { isDefault: false },
        });
      }
      return tx.tailoringJob.create({
        data: {
          customerId,
          tailorProfileId: tailor.id,
          measurementProfileId: profile.id,
          orgId: tailor.orgId,
          title: input.title,
          description: input.description ?? "",
          style: input.style ?? "",
          eventType: input.eventType ?? "",
          referenceImages: input.referenceImages ?? [],
          status: "submitted",
          statusHistory,
          currency: "NGN",
          ...auditFields,
        },
      });
    });
  } catch (err) {
    rethrowCreateJobError(err);
  }

  scheduleNotifyBookingSubmitted({
    customerId,
    tailorUserId: tailor.userId,
    tailorDisplayName: tailor.displayName,
    tailorProfileId: tailor.id,
    jobId: created.id,
    title: input.title,
    orgId: tailor.orgId,
  });

  return dtoForCreatedJob(created.id);
}

export type JobAccessRole = TransitionActorRole;

export async function resolveJobAccessRole(input: {
  job: TailoringJobDto;
  actorSub: string;
  isStaff: boolean;
}): Promise<JobAccessRole | null> {
  // Customer ownership wins over staff preset so dual-role company members
  // can still track their own bookings when the company Membership is locked.
  if (input.job.customer === input.actorSub) return "customer";
  if (input.isStaff) return "admin";

  await dbConnect();
  const profile = await prisma.tailorProfile.findFirst({
    where: idWhere(input.job.tailorProfile),
    select: { id: true, userId: true, status: true },
  });
  if (profile && profile.userId === input.actorSub) {
    const providerId = await resolveProviderTailorProfileIdForJobs(input.actorSub);
    if (providerId && providerId === profile.id) return "tailor";
  }
  return null;
}

export async function patchTailoringJob(
  jobId: string,
  actor: {
    sub: string;
    role: JobAccessRole;
  },
  raw: unknown,
  audit?: Record<string, unknown>
): Promise<TailoringJobDto> {
  await dbConnect();
  if (!isValidId(jobId)) throw new Error("Job not found");

  const parsed = patchTailoringJobSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid update");
  }
  const input: PatchTailoringJobInput = parsed.data;

  const job = await prisma.tailoringJob.findFirst({ where: idWhere(jobId) });
  if (!job) throw new Error("Job not found");

  const from = job.status as TailoringJobStatus;
  let nextStatus = from;

  if (input.status) {
    if (!isTailoringJobStatus(input.status)) {
      throw new Error("Invalid status");
    }
    if (!canTransition(actor.role, from, input.status)) {
      throw new ForbiddenError(
        `Cannot transition from ${from} to ${input.status}`
      );
    }
    nextStatus = input.status;
  }

  if (actor.role === "admin" && nextStatus === "paid") {
    throw new ForbiddenError(
      "Admin paid status must use ops settlement (not a direct status patch)"
    );
  }

  if (
    input.quotedPrice !== undefined &&
    input.quotedPrice !== null &&
    actor.role === "tailor" &&
    from === "accepted" &&
    !input.status
  ) {
    if (!canTransition("tailor", "accepted", "quoted")) {
      throw new ForbiddenError("Cannot set quote in current status");
    }
    nextStatus = "quoted";
  }

  if (
    nextStatus === "quoted" &&
    (input.quotedPrice === undefined || input.quotedPrice === null) &&
    (job.quotedPrice == null)
  ) {
    throw new Error("quotedPrice is required to move to quoted");
  }

  const updateData: Parameters<typeof prisma.tailoringJob.update>[0]["data"] =
    {};
  if (input.quotedPrice !== undefined) {
    if (actor.role === "customer") {
      throw new ForbiddenError("Customers cannot set quotes");
    }
    updateData.quotedPrice = input.quotedPrice;
  }
  if (input.currency) updateData.currency = input.currency;

  let statusHistory = parseStatusHistory(job.statusHistory);
  if (nextStatus !== from) {
    updateData.status = nextStatus;
    statusHistory = appendStatusHistory(statusHistory, {
      status: nextStatus,
      note:
        input.note ||
        (nextStatus === "cancelled" && actor.role === "tailor"
          ? "Declined by tailor"
          : nextStatus === "cancelled"
            ? "Cancelled"
            : undefined),
      updatedBy: actor.sub,
    });
  } else if (input.note) {
    statusHistory = appendStatusHistory(statusHistory, {
      status: from,
      note: input.note,
      updatedBy: actor.sub,
    });
  }
  updateData.statusHistory = statusHistory;

  if (audit && "updatedBy" in audit) {
    Object.assign(updateData, auditUpdateToPrisma(audit as AuditUpdateStamp));
  }

  await prisma.tailoringJob.update({
    where: { id: job.id },
    data: updateData,
  });

  const dto = await getTailoringJobById(jobId);
  if (!dto) throw new Error("Failed to load job");

  if (
    actor.role === "tailor" &&
    nextStatus !== from &&
    (nextStatus === "accepted" ||
      nextStatus === "cancelled" ||
      nextStatus === "quoted" ||
      nextStatus === "completed")
  ) {
    try {
      if (nextStatus === "completed" || nextStatus === "cancelled") {
        const { notifyTailoringStatusChange } = await import(
          "@/lib/tailoringJobPaymentSettle"
        );
        await notifyTailoringStatusChange({
          job: {
            _id: dto._id,
            title: dto.title,
            customer: dto.customer,
            customerEmail: dto.customerEmail,
            customerName: dto.customerName,
            tailorProfile: dto.tailorProfile,
            status: dto.status,
            orgId: dto.orgId,
          },
          status: nextStatus,
          note: input.note,
        });
      } else {
        const titles: Record<string, string> = {
          accepted: "Tailor accepted your request",
          quoted: "You received a quote",
        };
        const messages: Record<string, string> = {
          accepted: `${dto.title} was accepted.`,
          quoted: `${dto.title} was quoted at ${dto.currency} ${dto.quotedPrice ?? ""}.`,
        };
        await notifyUser(
          dto.customer,
          titles[nextStatus] ?? "Tailoring job update",
          messages[nextStatus] ?? `Status is now ${nextStatus}.`,
          {
            kind: `tailoring_job_${nextStatus}`,
            jobId: dto._id,
          }
        );

        if (dto.customerEmail) {
          if (
            nextStatus === "quoted" &&
            dto.quotedPrice != null
          ) {
            const { sendTailoringQuoteEmail } = await import("@/lib/mailer");
            const { getOrCreateTaxSettings } = await import("@/lib/taxSettings");
            const { calculateTaxBreakdown, roundMoney } = await import(
              "@/utils/tax"
            );
            const base =
              process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") ||
              "http://localhost:3000";
            const taxSettings = await getOrCreateTaxSettings(dto.orgId);
            const breakdown = calculateTaxBreakdown(
              [{ subtotal: dto.quotedPrice }],
              {
                enabled: Boolean(taxSettings.enabled),
                rate: taxSettings.rate,
                label: taxSettings.label,
              },
              0
            );
            const taxAmount = roundMoney(breakdown.taxAmount);
            const amount = roundMoney(breakdown.total);
            await sendTailoringQuoteEmail({
              to: dto.customerEmail,
              customerName: dto.customerName,
              jobId: dto._id,
              title: dto.title,
              quotedPrice: dto.quotedPrice,
              taxAmount,
              amount,
              currency: dto.currency,
              tailorName: dto.tailorDisplayName,
              payUrl: `${base}/profile/tailoring-jobs/${dto._id}`,
              orgId: dto.orgId,
            });
          } else if (nextStatus === "accepted") {
            const { sendTailoringJobStatusEmail } = await import("@/lib/mailer");
            await sendTailoringJobStatusEmail({
              to: dto.customerEmail,
              customerName: dto.customerName,
              jobId: dto._id,
              title: dto.title,
              status: "accepted",
              note: dto.tailorDisplayName
                ? `Accepted by ${dto.tailorDisplayName}`
                : undefined,
              orgId: dto.orgId,
            });
          }
        }
      }
    } catch (err) {
      console.warn("[tailoring-jobs] notify customer failed:", err);
    }
  }

  if (
    actor.role === "customer" &&
    nextStatus === "cancelled" &&
    nextStatus !== from &&
    from === "submitted"
  ) {
    try {
      const tailorProfile = await prisma.tailorProfile.findFirst({
        where: idWhere(dto.tailorProfile),
        select: { userId: true, displayName: true },
      });
      if (tailorProfile?.userId) {
        await notifyUser(
          tailorProfile.userId,
          "Tailoring request cancelled",
          `${dto.title} was cancelled by the customer${
            input.note ? `: ${input.note}` : "."
          }`,
          {
            kind: "tailoring_job_cancelled",
            jobId: dto._id,
          }
        );

        const tailorUser = await prisma.user.findFirst({
          where: idWhere(tailorProfile.userId),
          select: { email: true },
        });
        if (tailorUser?.email) {
          const { sendTailoringJobStatusEmail } = await import("@/lib/mailer");
          await sendTailoringJobStatusEmail({
            to: String(tailorUser.email),
            customerName: tailorProfile.displayName ?? undefined,
            jobId: dto._id,
            title: dto.title,
            status: "cancelled",
            note: input.note
              ? `Cancelled by customer: ${input.note}`
              : "Cancelled by the customer.",
            orgId: dto.orgId,
          });
        }
      }
    } catch (err) {
      console.warn("[tailoring-jobs] notify tailor on cancel failed:", err);
    }
  }

  if (
    actor.role === "admin" &&
    nextStatus === "cancelled" &&
    nextStatus !== from
  ) {
    try {
      const { notifyTailoringStatusChange } = await import(
        "@/lib/tailoringJobPaymentSettle"
      );
      await notifyTailoringStatusChange({
        job: {
          _id: dto._id,
          title: dto.title,
          customer: dto.customer,
          customerEmail: dto.customerEmail,
          customerName: dto.customerName,
          tailorProfile: dto.tailorProfile,
          status: dto.status,
          orgId: dto.orgId,
        },
        status: "cancelled",
        note: input.note,
      });
    } catch (err) {
      console.warn("[tailoring-jobs] admin cancel notify failed:", err);
    }
  }

  return dto;
}

export async function getTailorProfileIdForUser(
  userId: string
): Promise<string | null> {
  return resolveProviderTailorProfileIdForJobs(userId);
}

export async function assertUserExists(userId: string): Promise<boolean> {
  await dbConnect();
  if (!isValidId(userId)) return false;
  const user = await prisma.user.findFirst({
    where: idWhere(userId),
    select: { id: true },
  });
  return Boolean(user);
}
