/**
 * Shared tailoring-job DTOs / status machine — safe for client and server.
 */
import { z } from "zod";
import {
  MEASUREMENT_GENDERS,
  MEASUREMENT_UNITS,
  sanitizeMeasurementValues,
} from "@/lib/measurements.shared";

export const TAILORING_JOB_STATUSES = [
  "draft",
  "submitted",
  "quoted",
  "accepted",
  "payment_pending",
  "paid",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type TailoringJobStatus = (typeof TAILORING_JOB_STATUSES)[number];

/** In-flight org jobs (excludes draft, completed, cancelled) — analytics + ops dashboards. */
export const ACTIVE_TAILORING_JOB_STATUSES = [
  "submitted",
  "accepted",
  "quoted",
  "payment_pending",
  "paid",
  "in_progress",
] as const satisfies readonly TailoringJobStatus[];

export function isTailoringJobStatus(
  value: string
): value is TailoringJobStatus {
  return (TAILORING_JOB_STATUSES as readonly string[]).includes(value);
}

/**
 * Phase 4 status machine (payment + work).
 *
 * Customer:
 *   create → submitted
 *   submitted → cancelled
 *   quoted → payment_pending (via payment initiate; cancel reverts)
 *
 * Tailor:
 *   submitted → accepted | cancelled
 *   accepted → quoted
 *   paid | in_progress → completed
 *
 * Payment settlement (system):
 *   quoted → payment_pending → paid → in_progress
 *   payment_pending → quoted (cancel / failure)
 *
 * Admin (tailoring_jobs:manage): ops overrides including cancel with note.
 */
export const CUSTOMER_TRANSITIONS: Record<
  TailoringJobStatus,
  readonly TailoringJobStatus[]
> = {
  draft: ["submitted", "cancelled"],
  submitted: ["cancelled"],
  // payment_pending is set only by POST /api/payment/tailoring; revert via POST /api/payment/tailoring/cancel
  quoted: [],
  accepted: [],
  payment_pending: [],
  paid: [],
  in_progress: [],
  completed: [],
  cancelled: [],
};

export const TAILOR_TRANSITIONS: Record<
  TailoringJobStatus,
  readonly TailoringJobStatus[]
> = {
  draft: [],
  submitted: ["accepted", "cancelled"],
  quoted: [],
  accepted: ["quoted"],
  payment_pending: [],
  paid: ["in_progress", "completed"],
  in_progress: ["completed"],
  completed: [],
  cancelled: [],
};

/** Ops overrides for support. */
export const ADMIN_TRANSITIONS: Record<
  TailoringJobStatus,
  readonly TailoringJobStatus[]
> = {
  draft: ["submitted", "cancelled"],
  submitted: ["accepted", "quoted", "cancelled"],
  quoted: ["accepted", "payment_pending", "cancelled"],
  accepted: ["quoted", "cancelled"],
  payment_pending: ["quoted", "paid", "cancelled"],
  paid: ["in_progress", "completed", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export type TransitionActorRole = "customer" | "tailor" | "admin";

export function allowedTransitions(
  role: TransitionActorRole,
  from: TailoringJobStatus
): readonly TailoringJobStatus[] {
  if (role === "customer") return CUSTOMER_TRANSITIONS[from] ?? [];
  if (role === "tailor") return TAILOR_TRANSITIONS[from] ?? [];
  return ADMIN_TRANSITIONS[from] ?? [];
}

export function canTransition(
  role: TransitionActorRole,
  from: TailoringJobStatus,
  to: TailoringJobStatus
): boolean {
  return allowedTransitions(role, from).includes(to);
}

export const createTailoringJobSchema = z
  .object({
    tailorSlug: z.string().trim().min(1).max(80).optional(),
    tailorProfileId: z.string().trim().optional(),
    /** Existing owned profile (smoke scripts / legacy clients). */
    measurementProfileId: z.string().trim().min(1).optional(),
    /**
     * Inline body measurements — server creates a booking profile + job in one
     * transaction (preferred booking path; avoids orphan profiles).
     */
    measurements: z
      .record(z.string().min(1).max(40), z.number().finite().positive().max(500))
      .optional(),
    measurementUnit: z.enum(MEASUREMENT_UNITS).optional().default("cm"),
    measurementGender: z.enum(MEASUREMENT_GENDERS).optional(),
    measurementLabel: z.string().trim().min(1).max(80).optional(),
    title: z.string().trim().min(1, "Title is required").max(160),
    description: z.string().trim().max(4000).optional().default(""),
    style: z.string().trim().max(120).optional().default(""),
    eventType: z.string().trim().max(120).optional().default(""),
    referenceImages: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(500)
          .refine((value) => {
            try {
              return new URL(value).protocol === "https:";
            } catch {
              return false;
            }
          }, "Reference images must be HTTPS URLs")
      )
      .max(8)
      .optional()
      .default([]),
  })
  .superRefine((data, ctx) => {
    const inline = data.measurements
      ? sanitizeMeasurementValues(data.measurements)
      : {};
    const hasInline = Object.keys(inline).length > 0;
    const hasProfile = Boolean(data.measurementProfileId?.trim());
    if (!hasInline && !hasProfile) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Measurements are required for this booking",
        path: ["measurements"],
      });
    }
  });

export type CreateTailoringJobInput = z.infer<typeof createTailoringJobSchema>;

export const patchTailoringJobSchema = z
  .object({
    status: z.enum(TAILORING_JOB_STATUSES).optional(),
    note: z.string().trim().max(500).optional(),
    quotedPrice: z.number().finite().nonnegative().nullable().optional(),
    currency: z.string().trim().max(8).optional(),
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.quotedPrice !== undefined ||
      v.note !== undefined,
    "Provide status, quotedPrice, and/or note"
  );

export type PatchTailoringJobInput = z.infer<typeof patchTailoringJobSchema>;

export type TailoringJobStatusHistoryDto = {
  status: TailoringJobStatus;
  note?: string;
  updatedAt: string;
  updatedBy?: string | null;
};

export type TailoringJobMeasurementSnapshot = {
  label: string;
  unit: string;
  gender?: string;
  measurements: Record<string, number>;
};

export type TailoringJobDto = {
  _id: string;
  customer: string;
  customerName?: string;
  customerEmail?: string;
  tailorProfile: string;
  tailorSlug?: string;
  tailorDisplayName?: string;
  measurementProfile?: string | null;
  measurementLabel?: string | null;
  measurementSnapshot?: TailoringJobMeasurementSnapshot | null;
  orgId: string;
  title: string;
  description: string;
  style: string;
  eventType: string;
  referenceImages: string[];
  quotedPrice?: number | null;
  currency: string;
  taxAmount?: number | null;
  taxRate?: number | null;
  taxLabel?: string | null;
  amount?: number | null;
  status: TailoringJobStatus;
  statusHistory: TailoringJobStatusHistoryDto[];
  paymentReference?: string | null;
  paymentProvider?: string | null;
  paidAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  /** Customer-only: true when job is completed and not yet reviewed. */
  canReview?: boolean;
  /** Customer-only: true when this job already has a tailor review. */
  hasReview?: boolean;
};
