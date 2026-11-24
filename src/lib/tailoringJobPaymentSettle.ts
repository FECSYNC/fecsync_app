/**
 * Idempotent Stripe settlement for tailoring jobs.
 */

import type { NextResponse } from "next/server";
import type { TailoringJob } from "@prisma/client";
import prisma from "@/lib/prisma";
import { idWhere, isValidId } from "@/lib/ids";
import {
  addFunds,
  deductFunds,
  ensureOwnedWallet,
  getTransactionByReference,
  isWalletHelperResponse,
} from "@/lib/wallet";
import { amountsMatch } from "@/lib/orderPaymentSettle";
import { getOrCreateTaxSettings } from "@/lib/taxSettings";
import { calculateTaxBreakdown, roundMoney } from "@/utils/tax";
import {
  notifyTailoringJobPaid,
  sendTailoringJobStatusEmail,
} from "@/lib/mailer";
import { createNotification } from "@/services/notificationService";
import type { TailoringJobStatus } from "@/lib/tailoringJobs.shared";
import { queueAccountingSync } from "@/lib/accounting/postingQueue";

export type SettleTailoringCustomer = {
  _id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  username?: string;
};

export type SettleTailoringJobInput = {
  jobId: string;
  user: SettleTailoringCustomer;
  chargedAmount: number;
  paymentReference: string;
  provider: "stripe" | "paystack" | "ops";
};

export type SettleTailoringJobResult =
  | {
      ok: true;
      job: TailoringJob;
      alreadyProcessed: boolean;
    }
  | {
      ok: false;
      code:
        | "not_found"
        | "amount_mismatch"
        | "invalid_status"
        | "wallet_error"
        | "missing_reference"
        | "forbidden";
      message: string;
      response?: NextResponse;
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

function walletCreditRef(provider: string, paymentReference: string) {
  return `gw:${provider}:${paymentReference}:tailor:in`;
}

function walletDebitRef(provider: string, paymentReference: string) {
  return `gw:${provider}:${paymentReference}:tailor:out`;
}

async function ensureWalletCredit(params: {
  userId: string;
  amount: number;
  reference: string;
  description: string;
}): Promise<NextResponse | null> {
  const existing = await getTransactionByReference({
    reference: params.reference,
    userId: params.userId,
  });
  if (existing) return null;

  const credited = await addFunds({
    amount: params.amount,
    userId: params.userId,
    reference: params.reference,
    description: params.description,
  });
  if (!isWalletHelperResponse(credited)) return null;

  const again = await getTransactionByReference({
    reference: params.reference,
    userId: params.userId,
  });
  if (again) return null;
  return credited;
}

async function ensureWalletDebit(params: {
  userId: string;
  amount: number;
  reference: string;
  description: string;
}): Promise<NextResponse | null> {
  const existing = await getTransactionByReference({
    reference: params.reference,
    userId: params.userId,
  });
  if (existing) return null;

  const deducted = await deductFunds({
    amount: params.amount,
    userId: params.userId,
    reference: params.reference,
    description: params.description,
  });
  if (!isWalletHelperResponse(deducted)) return null;

  const again = await getTransactionByReference({
    reference: params.reference,
    userId: params.userId,
  });
  if (again) return null;
  return deducted;
}

async function ensureTailoringPaidNotifications(
  job: TailoringJob,
  user: SettleTailoringCustomer
): Promise<void> {
  const claimed = await prisma.tailoringJob.updateMany({
    where: {
      id: job.id,
      customerId: user._id,
      paidNotifiedAt: null,
    },
    data: { paidNotifiedAt: new Date() },
  });
  if (claimed.count === 0) return;

  const fullName =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.username ||
    undefined;

  try {
    const profile = await prisma.tailorProfile.findFirst({
      where: idWhere(job.tailorProfileId),
      select: { userId: true, displayName: true, slug: true },
    });
    const tailorUser = profile?.userId
      ? await prisma.user.findFirst({
          where: idWhere(profile.userId),
          select: { email: true, firstName: true, lastName: true, username: true },
        })
      : null;

    const tailorEmail =
      tailorUser && typeof tailorUser.email === "string"
        ? tailorUser.email
        : undefined;
    const tailorName = profile?.displayName
      ? String(profile.displayName)
      : undefined;

    await notifyTailoringJobPaid({
      customerEmail: user.email,
      customerName: fullName,
      tailorEmail,
      tailorName,
      jobId: job.id,
      title: job.title,
      amount: job.amount ?? undefined,
      subtotal: job.quotedPrice ?? undefined,
      taxAmount: job.taxAmount ?? undefined,
      taxLabel: job.taxLabel ?? undefined,
      currency: job.currency,
      orgId: job.orgId,
    });

    await createNotification(
      user._id,
      "Tailoring job paid",
      `Payment received for ${job.title}. Work is now in progress.`,
      "tailoring",
      { kind: "tailoring_job_paid", jobId: job.id }
    );

    if (profile?.userId) {
      await createNotification(
        profile.userId,
        "Customer paid for a job",
        `${job.title} is paid and ready to start.`,
        "tailoring",
        { kind: "tailoring_job_paid", jobId: job.id }
      );
    }
  } catch (err) {
    console.error("[tailoring settle] paid notification failed:", err);
    await prisma.tailoringJob.updateMany({
      where: { id: job.id, customerId: user._id },
      data: { paidNotifiedAt: null },
    });
  }
}

/** Wallet credit/debit + advance paid → in_progress (idempotent retry path). */
async function finishPaidJobSettlement(input: {
  job: TailoringJob;
  user: SettleTailoringCustomer;
  chargedAmount: number;
  paymentReference: string;
  provider: "stripe" | "paystack" | "ops";
}): Promise<SettleTailoringJobResult> {
  const { job, user, chargedAmount, paymentReference, provider } = input;
  const userId = String(user._id);

  if (job.status === "in_progress" || job.status === "completed") {
    // Crash between status flip and enqueue: re-queue idempotently on retry.
    if (job.orgId) {
      await queueAccountingSync({
        orgId: job.orgId,
        locationId: null,
        sourceType: "tailoring_payment",
        sourceId: job.id,
        sourceEvent: "paid",
        eventAt: job.paidAt ?? new Date(),
      });
    }
    await ensureTailoringPaidNotifications(job, user);
    return { ok: true, job, alreadyProcessed: true };
  }

  if (job.status !== "paid") {
    return {
      ok: false,
      code: "invalid_status",
      message: `Cannot finish settlement from status "${job.status}"`,
    };
  }

  if (job.paymentReference && job.paymentReference !== paymentReference) {
    return {
      ok: false,
      code: "invalid_status",
      message: "Job already paid with a different reference",
    };
  }

  try {
    await ensureOwnedWallet(userId);
  } catch (err) {
    console.error("[tailoring settle] ensure wallet failed:", err);
    return {
      ok: false,
      code: "wallet_error",
      message: "Could not ensure customer wallet",
    };
  }

  const creditErr = await ensureWalletCredit({
    userId,
    amount: chargedAmount,
    reference: walletCreditRef(provider, paymentReference),
    description: `Tailoring payment in (${provider})`,
  });
  if (creditErr) {
    return {
      ok: false,
      code: "wallet_error",
      message: "Wallet credit failed",
      response: creditErr,
    };
  }

  const debitErr = await ensureWalletDebit({
    userId,
    amount: chargedAmount,
    reference: walletDebitRef(provider, paymentReference),
    description: `Tailoring job ${job.id.slice(-8)}`,
  });
  if (debitErr) {
    return {
      ok: false,
      code: "wallet_error",
      message: "Wallet debit failed",
      response: debitErr,
    };
  }

  const advanced = await prisma.tailoringJob.updateMany({
    where: {
      id: job.id,
      customerId: userId,
      status: "paid",
    },
    data: {
      status: "in_progress",
      statusHistory: appendStatusHistory(job.statusHistory, {
        status: "in_progress",
        note: "Work started after payment",
        updatedAt: new Date().toISOString(),
        updatedBy: userId,
      }),
    },
  });

  const finalJob =
    advanced.count > 0
      ? await prisma.tailoringJob.findUnique({ where: { id: job.id } })
      : await prisma.tailoringJob.findUnique({ where: { id: job.id } });
  if (!finalJob) {
    return { ok: false, code: "not_found", message: "Job not found" };
  }

  if (finalJob.orgId) {
    await queueAccountingSync({
      orgId: finalJob.orgId,
      locationId: null,
      sourceType: "tailoring_payment",
      sourceId: finalJob.id,
      sourceEvent: "paid",
      eventAt: finalJob.paidAt ?? new Date(),
    });
  }
  await ensureTailoringPaidNotifications(finalJob, user);
  return { ok: true, job: finalJob, alreadyProcessed: true };
}

export async function settleTailoringJobGatewayPayment(
  input: SettleTailoringJobInput
): Promise<SettleTailoringJobResult> {
  const { jobId, user, chargedAmount, paymentReference, provider } = input;
  const userId = String(user._id);

  if (!paymentReference) {
    return {
      ok: false,
      code: "missing_reference",
      message: "Missing payment reference",
    };
  }

  const job = await prisma.tailoringJob.findFirst({
    where: { ...idWhere(jobId), customerId: userId },
  });
  if (!job) {
    return { ok: false, code: "not_found", message: "Job not found" };
  }

  const alreadyPaid =
    job.status === "paid" ||
    job.status === "in_progress" ||
    job.status === "completed";

  if (alreadyPaid && job.paymentReference) {
    if (job.paymentReference !== paymentReference) {
      return {
        ok: false,
        code: "invalid_status",
        message: "Job already paid with a different reference",
      };
    }
    return finishPaidJobSettlement({
      job,
      user,
      chargedAmount,
      paymentReference,
      provider,
    });
  }

  if (job.status !== "payment_pending" && job.status !== "quoted") {
    return {
      ok: false,
      code: "invalid_status",
      message: `Job cannot be settled from status "${job.status}"`,
    };
  }

  const expected =
    typeof job.amount === "number" && job.amount > 0
      ? job.amount
      : typeof job.quotedPrice === "number"
        ? job.quotedPrice
        : 0;

  if (!amountsMatch(chargedAmount, expected)) {
    console.error(
      `[settleTailoringJob] amount mismatch job=${jobId} charged=${chargedAmount} expected=${expected} provider=${provider}`
    );
    return {
      ok: false,
      code: "amount_mismatch",
      message: `Charged amount (${chargedAmount}) does not match job total (${expected})`,
    };
  }

  const claimed = await prisma.tailoringJob.updateMany({
    where: {
      id: job.id,
      customerId: userId,
      status: { in: ["payment_pending", "quoted"] },
      OR: [{ paymentReference: null }, { paymentReference }],
    },
    data: {
      paymentReference,
      paymentProvider: provider,
      status: "paid",
      paidAt: new Date(),
      statusHistory: appendStatusHistory(job.statusHistory, {
        status: "paid",
        note: `Paid via ${provider}`,
        updatedAt: new Date().toISOString(),
        updatedBy: userId,
      }),
    },
  });

  if (claimed.count === 0) {
    const again = await prisma.tailoringJob.findFirst({
      where: { ...idWhere(jobId), customerId: userId },
    });
    if (
      again &&
      (again.status === "paid" ||
        again.status === "in_progress" ||
        again.status === "completed") &&
      again.paymentReference === paymentReference
    ) {
      return finishPaidJobSettlement({
        job: again,
        user,
        chargedAmount,
        paymentReference,
        provider,
      });
    }
    return {
      ok: false,
      code: "invalid_status",
      message: "Could not claim payment for this job",
    };
  }

  const claimedJob = await prisma.tailoringJob.findUnique({
    where: { id: job.id },
  });
  if (!claimedJob) {
    return { ok: false, code: "not_found", message: "Job not found" };
  }

  const finished = await finishPaidJobSettlement({
    job: claimedJob,
    user,
    chargedAmount,
    paymentReference,
    provider,
  });
  if (!finished.ok) return finished;
  return { ...finished, alreadyProcessed: false };
}

async function loadSettleCustomer(
  customerId: string
): Promise<SettleTailoringCustomer | null> {
  const user = await prisma.user.findFirst({
    where: idWhere(customerId),
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      username: true,
    },
  });
  if (!user?.email) return null;
  return {
    _id: String(user.id),
    email: String(user.email),
    firstName:
      typeof user.firstName === "string" ? user.firstName : undefined,
    lastName: typeof user.lastName === "string" ? user.lastName : undefined,
    username:
      typeof user.username === "string" ? user.username : undefined,
  };
}

async function resolveJobChargeAmount(job: TailoringJob): Promise<number> {
  if (typeof job.amount === "number" && job.amount > 0) {
    return roundMoney(job.amount);
  }
  const quoted =
    typeof job.quotedPrice === "number"
      ? job.quotedPrice
      : Number(job.quotedPrice);
  if (!Number.isFinite(quoted) || quoted <= 0) {
    throw new Error("Job has no payable amount");
  }
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
  return roundMoney(breakdown.total);
}

/**
 * Ops manual settlement (cash / support) — sets payment fields, wallet, notifications.
 * Requires payment_pending; idempotent when already settled with the same ops reference.
 */
export async function settleTailoringJobOpsPayment(input: {
  jobId: string;
  adminUserId: string;
  note?: string;
}): Promise<SettleTailoringJobResult> {
  if (!isValidId(input.jobId)) {
    return { ok: false, code: "not_found", message: "Job not found" };
  }

  const job = await prisma.tailoringJob.findFirst({
    where: idWhere(input.jobId),
  });
  if (!job) {
    return { ok: false, code: "not_found", message: "Job not found" };
  }

  const customer = await loadSettleCustomer(job.customerId);
  if (!customer) {
    return {
      ok: false,
      code: "not_found",
      message: "Customer not found for job",
    };
  }

  const paymentReference = `ops:${job.id}:${input.adminUserId}`;
  const provider = "ops" as const;

  if (
    job.status === "paid" ||
    job.status === "in_progress" ||
    job.status === "completed"
  ) {
    if (
      job.paymentReference &&
      job.paymentReference !== paymentReference &&
      job.paymentProvider === "ops"
    ) {
      return {
        ok: false,
        code: "invalid_status",
        message: "Job already paid with a different ops reference",
      };
    }
    if (job.paymentReference) {
      const chargedAmount = await resolveJobChargeAmount(job);
      return finishPaidJobSettlement({
        job,
        user: customer,
        chargedAmount,
        paymentReference: job.paymentReference,
        provider:
          job.paymentProvider === "ops"
            ? "ops"
            : (job.paymentProvider as "stripe" | "paystack") ?? "ops",
      });
    }
  }

  if (job.status !== "payment_pending") {
    return {
      ok: false,
      code: "invalid_status",
      message: `Ops settlement requires payment_pending (current: "${job.status}")`,
    };
  }

  let chargedAmount: number;
  try {
    chargedAmount = await resolveJobChargeAmount(job);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, code: "invalid_status", message };
  }

  const claimed = await prisma.tailoringJob.updateMany({
    where: {
      id: job.id,
      status: "payment_pending",
      paymentReference: null,
      paidAt: null,
    },
    data: {
      paymentReference,
      paymentProvider: provider,
      status: "paid",
      paidAt: new Date(),
      statusHistory: appendStatusHistory(job.statusHistory, {
        status: "paid",
        note: input.note?.trim() || "Marked paid by ops",
        updatedAt: new Date().toISOString(),
        updatedBy: input.adminUserId,
      }),
    },
  });

  if (claimed.count === 0) {
    const again = await prisma.tailoringJob.findFirst({
      where: idWhere(input.jobId),
    });
    if (
      again &&
      (again.status === "paid" ||
        again.status === "in_progress" ||
        again.status === "completed") &&
      again.paymentReference
    ) {
      return finishPaidJobSettlement({
        job: again,
        user: customer,
        chargedAmount,
        paymentReference: again.paymentReference,
        provider:
          again.paymentProvider === "ops"
            ? "ops"
            : (again.paymentProvider as "stripe" | "paystack") ?? "ops",
      });
    }
    return {
      ok: false,
      code: "invalid_status",
      message: "Could not claim ops payment for this job",
    };
  }

  const claimedJob = await prisma.tailoringJob.findUnique({
    where: { id: job.id },
  });
  if (!claimedJob) {
    return { ok: false, code: "not_found", message: "Job not found" };
  }

  const finished = await finishPaidJobSettlement({
    job: claimedJob,
    user: customer,
    chargedAmount,
    paymentReference,
    provider,
  });
  if (!finished.ok) return finished;
  return { ...finished, alreadyProcessed: false };
}

export async function notifyTailoringStatusChange(input: {
  job: {
    _id: string;
    title: string;
    customer: string;
    customerEmail?: string;
    customerName?: string;
    tailorProfile: string;
    status: string;
    orgId?: string | null;
  };
  status: "completed" | "cancelled";
  note?: string;
}): Promise<void> {
  try {
    const { job, status, note } = input;
    const customerId = job.customer;
    const customerEmail = job.customerEmail;
    const customerName = job.customerName;

    await createNotification(
      customerId,
      status === "completed"
        ? "Tailoring job completed"
        : "Tailoring job cancelled",
      status === "completed"
        ? `${job.title} is complete. You can leave a review.`
        : `${job.title} was cancelled${note ? `: ${note}` : "."}`,
      "tailoring",
      { kind: `tailoring_job_${status}`, jobId: job._id }
    );

    if (customerEmail) {
      try {
        await sendTailoringJobStatusEmail({
          to: customerEmail,
          customerName,
          jobId: job._id,
          title: job.title,
          status,
          note,
          orgId: job.orgId ?? null,
        });
      } catch (emailErr) {
        console.warn("[tailoring] status email failed:", emailErr);
      }
    }

    if (status === "completed" || status === "cancelled") {
      const profile = await prisma.tailorProfile.findFirst({
        where: idWhere(job.tailorProfile),
        select: { userId: true },
      });
      if (profile?.userId) {
        await createNotification(
          profile.userId,
          status === "completed"
            ? "Job marked completed"
            : "Tailoring job cancelled",
          status === "completed"
            ? `${job.title} was marked completed.`
            : `${job.title} was cancelled${note ? `: ${note}` : "."}`,
          "tailoring",
          { kind: `tailoring_job_${status}`, jobId: job._id }
        );
      }
    }
  } catch (err) {
    console.warn("[tailoring] status email/notify failed:", err);
  }
}
