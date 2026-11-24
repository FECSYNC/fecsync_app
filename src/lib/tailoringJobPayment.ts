/**
 * Tailoring job Stripe checkout initiation.
 */

import prisma from "@/lib/prisma";
import { idWhere, isValidId } from "@/lib/ids";
import { createCheckoutSession, getCheckoutSession } from "@/lib/stripe";
import { getUserFromUuid } from "@/lib/utils";
import { getOrCreateTaxSettings } from "@/lib/taxSettings";
import { calculateTaxBreakdown, roundMoney } from "@/utils/tax";
import type { TailoringJobStatus } from "@/lib/tailoringJobs.shared";

export type InitiateTailoringPaymentResult = {
  sessionId: string;
  url: string | null;
  amount: number;
  taxAmount: number;
  currency: string;
  jobId: string;
};

type StatusHistoryEntry = {
  status: TailoringJobStatus;
  note?: string;
  updatedAt: string;
  updatedBy?: string | null;
};

function appendStatusHistory(
  raw: unknown,
  entry: StatusHistoryEntry
): StatusHistoryEntry[] {
  const existing = Array.isArray(raw)
    ? (raw as StatusHistoryEntry[])
    : [];
  return [...existing, entry];
}

export async function initiateTailoringStripePayment(input: {
  jobId: string;
  customerId: string;
  email: string;
  uuid: string;
}): Promise<InitiateTailoringPaymentResult> {
  if (!isValidId(input.jobId)) {
    throw new Error("Job not found");
  }

  const job = await prisma.tailoringJob.findFirst({
    where: idWhere(input.jobId),
  });
  if (!job) throw new Error("Job not found");
  if (job.customerId !== input.customerId) {
    throw new Error("Forbidden");
  }

  const status = job.status as TailoringJobStatus;
  if (status !== "quoted" && status !== "payment_pending") {
    throw new Error(
      `Job cannot be paid from status "${status}". Quote must be open.`
    );
  }

  if (job.paymentReference && job.paidAt) {
    throw new Error("Job is already paid");
  }

  const quoted =
    typeof job.quotedPrice === "number" ? job.quotedPrice : Number(job.quotedPrice);
  if (!Number.isFinite(quoted) || quoted <= 0) {
    throw new Error("quotedPrice must be greater than 0");
  }

  const currency = String(job.currency || "NGN").toUpperCase();
  let taxAmount: number;
  let amount: number;
  let taxRate: number | null = null;
  let taxLabel: string | null = null;

  const lockedAmount =
    status === "payment_pending" &&
    typeof job.amount === "number" &&
    job.amount > 0;

  if (lockedAmount) {
    taxAmount =
      typeof job.taxAmount === "number" ? roundMoney(job.taxAmount) : 0;
    amount = roundMoney(job.amount!);
    taxRate = typeof job.taxRate === "number" ? job.taxRate : null;
    taxLabel = job.taxLabel ?? null;
  } else {
    const taxSettings = await getOrCreateTaxSettings(job.orgId);
    const breakdown = calculateTaxBreakdown(
      [{ subtotal: quoted }],
      {
        enabled: Boolean(taxSettings.enabled),
        rate: taxSettings.rate,
        label: taxSettings.label,
      },
      0
    );

    taxAmount = roundMoney(breakdown.taxAmount);
    amount = roundMoney(breakdown.total);
    taxRate = breakdown.effectiveRate;
    taxLabel = breakdown.label || taxSettings.label || "Tax";

    const updateData: Parameters<typeof prisma.tailoringJob.update>[0]["data"] =
      {
        taxAmount,
        taxRate,
        taxLabel,
        amount,
      };

    if (status === "quoted") {
      updateData.status = "payment_pending";
      updateData.statusHistory = appendStatusHistory(job.statusHistory, {
        status: "payment_pending",
        note: "Payment initiated",
        updatedAt: new Date().toISOString(),
        updatedBy: input.customerId,
      });
    }

    await prisma.tailoringJob.update({
      where: { id: job.id },
      data: updateData,
    });
  }

  const base =
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") ||
    "http://localhost:3000";

  const session = await createCheckoutSession({
    amount,
    currency: currency.toLowerCase(),
    email: input.email,
    successUrl: `${base}/payment/tailoring/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}/payment/tailoring/cancel?session_id={CHECKOUT_SESSION_ID}&jobId=${encodeURIComponent(job.id)}`,
    productName: "Tailoring service",
    productDescription: job.title
      ? `${job.title} (#${job.id.slice(-8)})`
      : `Tailoring job #${job.id.slice(-8)}`,
    metadata: {
      type: "tailoring",
      amount,
      uuid: input.uuid,
      jobId: job.id,
    },
  });

  return {
    sessionId: session.id,
    url: session.url,
    amount,
    taxAmount,
    currency,
    jobId: job.id,
  };
}

export async function cancelTailoringPayment(input: {
  jobId: string;
  customerId: string;
}): Promise<{ reverted: boolean; status: TailoringJobStatus }> {
  if (!isValidId(input.jobId)) {
    throw new Error("Job not found");
  }

  const job = await prisma.tailoringJob.findFirst({
    where: idWhere(input.jobId),
  });
  if (!job) throw new Error("Job not found");
  if (job.customerId !== input.customerId) {
    throw new Error("Forbidden");
  }

  if (job.status !== "payment_pending") {
    return { reverted: false, status: job.status as TailoringJobStatus };
  }

  if (job.paymentReference || job.paidAt) {
    return { reverted: false, status: job.status as TailoringJobStatus };
  }

  const reverted = await prisma.tailoringJob.updateMany({
    where: {
      id: job.id,
      customerId: input.customerId,
      status: "payment_pending",
      paymentReference: null,
      paidAt: null,
    },
    data: {
      status: "quoted",
      statusHistory: appendStatusHistory(job.statusHistory, {
        status: "quoted",
        note: "Payment cancelled — quote still open",
        updatedAt: new Date().toISOString(),
        updatedBy: input.customerId,
      }),
    },
  });

  return {
    reverted: reverted.count > 0,
    status: reverted.count > 0 ? "quoted" : (job.status as TailoringJobStatus),
  };
}

/** Revert checkout using Stripe session metadata (no JWT — browser return from cancel URL). */
export async function cancelTailoringPaymentBySession(
  sessionId: string
): Promise<{ reverted: boolean; status: TailoringJobStatus; jobId?: string }> {
  const trimmed = sessionId.trim();
  if (!trimmed) {
    throw new Error("sessionId is required");
  }

  const session = await getCheckoutSession(trimmed);
  const metadata = (session.metadata || {}) as Record<string, string | undefined>;

  if (metadata.type !== "tailoring") {
    throw new Error("Not a tailoring checkout session");
  }
  if (session.payment_status === "paid") {
    const jobId = metadata.jobId ? String(metadata.jobId) : undefined;
    if (jobId && isValidId(jobId)) {
      const job = await prisma.tailoringJob.findFirst({
        where: idWhere(jobId),
        select: { status: true },
      });
      return {
        reverted: false,
        status: (job?.status as TailoringJobStatus) ?? "paid",
        jobId,
      };
    }
    return {
      reverted: false,
      status: "paid",
      jobId,
    };
  }

  const jobId = metadata.jobId ? String(metadata.jobId) : "";
  const uuid = metadata.uuid ? String(metadata.uuid) : "";
  if (!jobId || !uuid) {
    throw new Error("Invalid checkout session metadata");
  }

  const user = await getUserFromUuid(uuid);
  if (!user?.id) {
    throw new Error("Checkout session user not found");
  }

  const result = await cancelTailoringPayment({
    jobId,
    customerId: String(user.id),
  });
  return { ...result, jobId };
}
