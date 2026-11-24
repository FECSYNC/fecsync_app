/**
 * Smart dunning for guest memberships (Feature 08 Phase 2 + Phase 4 advanced).
 *
 * Growth (baseline): retry offsets day 0/3/5/7 capped by settings.graceDays.
 * Enterprise (advanced): denser schedule 0/2/4/6/9/12/14, longer grace floor (14d),
 * finance escalation emails, and admin work-queue listing.
 *
 * SMS: only if a provider is already configured — otherwise email-only.
 */
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  loadEffectiveMembershipSettingsRow,
  MEMBERSHIP_GRACE_DAYS_WHEN_UNSET,
} from "@/lib/memberships/settings";
import { assertMembershipTransition } from "@/lib/memberships/statusMachine";
import {
  sendGuestMembershipDunningEmail,
  sendMembershipFinanceEscalationEmail,
} from "@/lib/memberships/mail";
import {
  enqueueSource,
  flushAccountingQueueSoon,
} from "@/lib/accounting/enqueueHooks";

/** Growth / default Phase 2 smart dunning. */
export const DEFAULT_DUNNING_RETRY_DAYS = [0, 3, 5, 7] as const;
/** Enterprise advanced dunning — more steps + longer window. */
export const ENTERPRISE_DUNNING_RETRY_DAYS = [
  0, 2, 4, 6, 9, 12, 14,
] as const;

export function isEnterpriseDunningPlan(
  subscriptionPlan: string | null | undefined
): boolean {
  return (subscriptionPlan ?? "").trim().toLowerCase() === "enterprise";
}

function dunningSchedule(
  graceDays: number,
  subscriptionPlan?: string | null
): number[] {
  const enterprise = isEnterpriseDunningPlan(subscriptionPlan);
  const base = enterprise
    ? [...ENTERPRISE_DUNNING_RETRY_DAYS]
    : [...DEFAULT_DUNNING_RETRY_DAYS];
  const effectiveGrace = enterprise
    ? Math.max(graceDays, 14)
    : Math.max(1, graceDays);
  return base.filter((d) => d <= effectiveGrace);
}

/** Days from now until the next retry after `failCount` failures recorded. */
export function gapDaysUntilNextRetry(
  failCount: number,
  graceDays: number,
  subscriptionPlan?: string | null
): number | null {
  const schedule = dunningSchedule(graceDays, subscriptionPlan);
  if (failCount >= schedule.length) return null;
  const prev = schedule[failCount - 1] ?? 0;
  const next = schedule[failCount]!;
  return Math.max(0, next - prev);
}

/** Absolute next retry from firstPastDue using failCount as next attempt index. */
export function scheduleNextRetry(
  firstPastDueAt: Date,
  nextFailCount: number,
  graceDays: number,
  subscriptionPlan?: string | null
): Date | null {
  const schedule = dunningSchedule(graceDays, subscriptionPlan);
  if (nextFailCount >= schedule.length) return null;
  const days = schedule[nextFailCount]!;
  const d = new Date(firstPastDueAt.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function dunningExhausted(
  failCount: number,
  graceDays: number,
  subscriptionPlan?: string | null
): boolean {
  return failCount >= dunningSchedule(graceDays, subscriptionPlan).length;
}

/** Expose schedule for smokes / admin honesty. */
export function dunningRetryDaysForPlan(
  subscriptionPlan: string | null | undefined
): readonly number[] {
  return isEnterpriseDunningPlan(subscriptionPlan)
    ? ENTERPRISE_DUNNING_RETRY_DAYS
    : DEFAULT_DUNNING_RETRY_DAYS;
}

/** @deprecated Prefer gapDaysUntilNextRetry / scheduleNextRetry */
export function nextDunningAt(
  failCount: number,
  graceDays: number,
  from: Date = new Date()
): Date | null {
  const gap = gapDaysUntilNextRetry(failCount + 1, graceDays);
  if (gap == null) return null;
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + gap);
  return d;
}

async function resolveGraceDays(orgId: string, locationId: string): Promise<{
  enabled: boolean;
  graceDays: number;
}> {
  const row = await loadEffectiveMembershipSettingsRow(orgId, locationId);
  return {
    enabled: row?.dunningEnabled ?? true,
    graceDays: row?.graceDays ?? MEMBERSHIP_GRACE_DAYS_WHEN_UNSET,
  };
}

async function resolveOrgSubscriptionPlan(
  orgId: string
): Promise<string | null> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { subscriptionPlan: true },
  });
  return org?.subscriptionPlan ?? null;
}

/**
 * Mark membership past_due after a failed payment (webhook or sell).
 * Idempotent for the same stripeInvoiceId.
 */
export async function markMembershipPastDue(input: {
  guestMembershipId: string;
  orgId: string;
  amountMajor: number;
  currency: string;
  stripeInvoiceId?: string | null;
  errorMessage?: string | null;
  eventId?: string | null;
  /**
   * When true, caller already wrote the failed payment attempt — only apply
   * past_due + dunning schedule (Phase 2 C8). Avoids duplicate ledger rows.
   */
  skipPaymentAttempt?: boolean;
  /**
   * When false with skipPaymentAttempt (Stripe subscription.updated observe),
   * mark past_due without counting a fail or scheduling cron — wait for
   * invoice.payment_failed. Default true so sell/renew ledgered failures still
   * get failCount=1 + dunningNextAt.
   */
  countFailure?: boolean;
}): Promise<{ updated: boolean }> {
  const member = await prisma.guestMembership.findFirst({
    where: { id: input.guestMembershipId, orgId: input.orgId },
    include: {
      guestProfile: { select: { email: true, firstName: true } },
      plan: { select: { name: true } },
    },
  });
  if (!member) return { updated: false };

  const countFailure = input.countFailure !== false;

  // Prefer invoice id so Smart Retry re-deliveries of the same invoice do not
  // inflate dunningFailCount. Fall back to event id only when invoice is absent.
  const idem = input.stripeInvoiceId?.trim()
    ? `inv_fail:${input.stripeInvoiceId.trim()}`
    : input.eventId?.trim() || undefined;
  if (!input.skipPaymentAttempt && idem) {
    const existing = await prisma.membershipPaymentAttempt.findFirst({
      where: { orgId: input.orgId, idempotencyKey: idem },
    });
    if (existing) return { updated: false };
  }
  // Already past_due — do not bump fail count when caller only needed
  // schedule fields. Heal stalled rows that already counted a fail but lost
  // dunningNextAt. Observation-only rows (failCount 0, waiting for invoice)
  // stay untouched.
  if (input.skipPaymentAttempt && member.status === "past_due") {
    if (member.dunningNextAt == null && member.dunningFailCount > 0) {
      const settings = await resolveGraceDays(input.orgId, member.locationId);
      const orgPlan = await resolveOrgSubscriptionPlan(input.orgId);
      if (!settings.enabled) {
        return { updated: false };
      }
      const failCount = member.dunningFailCount;
      const gap = gapDaysUntilNextRetry(failCount, settings.graceDays, orgPlan);
      if (gap == null) return { updated: false };
      await prisma.guestMembership.update({
        where: { id: member.id },
        data: {
          dunningFailCount: failCount,
          dunningNextAt: new Date(Date.now() + gap * 86_400_000),
        },
      });
      return { updated: true };
    }
    return { updated: false };
  }

  // Cancelled/expired members must not throw on late invoice.payment_failed
  // (webhook would 500/retry). Ledger is skipped — status stays terminal.
  if (member.status === "cancelled" || member.status === "expired") {
    return { updated: false };
  }

  const settings = await resolveGraceDays(input.orgId, member.locationId);
  const orgPlan = await resolveOrgSubscriptionPlan(input.orgId);

  // Stripe subscription.updated observe: past_due without counting a fail
  // (invoice.payment_failed is authoritative). Sell/renew keep countFailure.
  if (
    input.skipPaymentAttempt &&
    !countFailure &&
    member.status !== "past_due"
  ) {
    assertMembershipTransition(member.status, "past_due");
    await prisma.guestMembership.update({
      where: { id: member.id },
      data: {
        status: "past_due",
        dunningFailCount: 0,
        dunningNextAt: null,
      },
    });
    return { updated: true };
  }

  const failCount = member.status === "past_due" ? member.dunningFailCount + 1 : 1;
  const gap = settings.enabled
    ? gapDaysUntilNextRetry(failCount, settings.graceDays, orgPlan)
    : null;
  const nextAt =
    gap == null
      ? null
      : new Date(Date.now() + gap * 86_400_000);

  if (member.status !== "past_due") {
    assertMembershipTransition(member.status, "past_due");
  }

  let cancelAtPeriodEnd = member.cancelAtPeriodEnd;
  if (
    settings.enabled &&
    dunningExhausted(failCount, settings.graceDays, orgPlan)
  ) {
    cancelAtPeriodEnd = true;
  }

  const memberUpdate = {
    status: "past_due" as const,
    dunningFailCount: failCount,
    dunningNextAt: nextAt,
    cancelAtPeriodEnd,
  };

  try {
    if (input.skipPaymentAttempt) {
      await prisma.guestMembership.update({
        where: { id: member.id },
        data: memberUpdate,
      });
    } else {
      await prisma.$transaction([
        prisma.membershipPaymentAttempt.create({
          data: {
            orgId: input.orgId,
            guestMembershipId: member.id,
            amount: input.amountMajor,
            currency: input.currency,
            status: "failed",
            attemptNumber: failCount,
            stripeInvoiceId: input.stripeInvoiceId ?? null,
            errorCode: "PAYMENT_FAILED",
            errorMessage: input.errorMessage?.slice(0, 500) ?? null,
            idempotencyKey: idem ?? null,
          },
        }),
        prisma.guestMembership.update({
          where: { id: member.id },
          data: memberUpdate,
        }),
      ]);
    }
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return { updated: false };
    }
    throw err;
  }

  if (member.guestProfile.email) {
    void sendGuestMembershipDunningEmail({
      to: member.guestProfile.email,
      guestName: member.guestProfile.firstName,
      planName: member.plan.name,
      kind: "failed",
      failCount,
    }).catch((err) => console.warn("[memberships] dunning email failed", err));
  }

  return { updated: true };
}

/** Restore active after successful invoice payment. */
export async function recoverMembershipFromPastDue(input: {
  guestMembershipId: string;
  orgId: string;
  amountMajor: number;
  currency: string;
  stripeInvoiceId?: string | null;
  eventId?: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
}): Promise<{ updated: boolean }> {
  const member = await prisma.guestMembership.findFirst({
    where: { id: input.guestMembershipId, orgId: input.orgId },
    include: {
      guestProfile: { select: { email: true, firstName: true } },
      plan: { select: { name: true } },
    },
  });
  if (!member) return { updated: false };

  // Prefer invoice id so duplicate invoice.paid events (retries) do not
  // double-ledger. Fall back to event id only when invoice is absent.
  const idem = input.stripeInvoiceId?.trim()
    ? `inv_paid:${input.stripeInvoiceId.trim()}`
    : input.eventId?.trim() || undefined;
  if (idem) {
    const existing = await prisma.membershipPaymentAttempt.findFirst({
      where: { orgId: input.orgId, idempotencyKey: idem },
    });
    if (existing) return { updated: false };
  }

  const attemptBase = {
    orgId: input.orgId,
    guestMembershipId: member.id,
    amount: new Prisma.Decimal(input.amountMajor.toFixed(2)),
    currency: input.currency,
    status: "succeeded" as const,
    attemptNumber: Math.max(1, member.dunningFailCount),
    stripeInvoiceId: input.stripeInvoiceId ?? null,
    idempotencyKey: idem ?? null,
    locationId: member.locationId,
  };

  // Only recover past_due / pending → active. Do not revive cancelled/expired
  // or flip paused via invoice webhooks (use staff reactivate / resume).
  // Agreement gate: unpaid-or-unagreed pending stays pending after payment ledger.
  try {
    await prisma.$transaction(async (tx) => {
      if (member.status === "past_due" || member.status === "pending") {
        const { membershipAgreementBlocksActivation } = await import(
          "@/lib/memberships/activationGates"
        );
        const blocked = await membershipAgreementBlocksActivation(member);
        const nextStatus = blocked ? ("pending" as const) : ("active" as const);
        if (nextStatus === "active") {
          assertMembershipTransition(member.status, "active");
        } else if (member.status !== "pending") {
          assertMembershipTransition(member.status, "pending");
        }
        const attempt = await tx.membershipPaymentAttempt.create({
          data: attemptBase,
        });
        await tx.guestMembership.update({
          where: { id: member.id },
          data: {
            status: nextStatus,
            dunningFailCount: 0,
            dunningNextAt: null,
            ...(member.status === "past_due"
              ? { cancelAtPeriodEnd: false, cancelReason: null }
              : {}),
            ...(input.periodStart
              ? { currentPeriodStart: input.periodStart }
              : {}),
            ...(input.periodEnd ? { currentPeriodEnd: input.periodEnd } : {}),
          },
        });
        await enqueueSource(tx, {
          orgId: input.orgId,
          locationId: member.locationId,
          sourceType: "membership_payment",
          sourceId: attempt.id,
          sourceEvent: "succeeded",
          eventAt: attempt.createdAt,
        });
      } else if (member.status === "active") {
        const attempt = await tx.membershipPaymentAttempt.create({
          data: attemptBase,
        });
        await tx.guestMembership.update({
          where: { id: member.id },
          data: {
            dunningFailCount: 0,
            dunningNextAt: null,
            ...(input.periodStart
              ? { currentPeriodStart: input.periodStart }
              : {}),
            ...(input.periodEnd ? { currentPeriodEnd: input.periodEnd } : {}),
          },
        });
        await enqueueSource(tx, {
          orgId: input.orgId,
          locationId: member.locationId,
          sourceType: "membership_payment",
          sourceId: attempt.id,
          sourceEvent: "succeeded",
          eventAt: attempt.createdAt,
        });
      } else {
        const attempt = await tx.membershipPaymentAttempt.create({
          data: attemptBase,
        });
        await enqueueSource(tx, {
          orgId: input.orgId,
          locationId: member.locationId,
          sourceType: "membership_payment",
          sourceId: attempt.id,
          sourceEvent: "succeeded",
          eventAt: attempt.createdAt,
        });
      }
    });
    flushAccountingQueueSoon(input.orgId);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return { updated: false };
    }
    throw err;
  }

  if (member.guestProfile.email && member.status === "past_due") {
    const after = await prisma.guestMembership.findUnique({
      where: { id: member.id },
      select: { status: true },
    });
    if (after?.status === "active") {
      void sendGuestMembershipDunningEmail({
        to: member.guestProfile.email,
        guestName: member.guestProfile.firstName,
        planName: member.plan.name,
        kind: "recovered",
        failCount: 0,
      }).catch((err) => console.warn("[memberships] recover email failed", err));
    }
  }

  return { updated: true };
}

/**
 * Daily dunning tick + fixed-term / cancelAtPeriodEnd expiry.
 * Idempotent — safe to call from piggyback cron and dedicated route.
 */
export async function runMembershipsDunningTick(opts?: {
  now?: Date;
  take?: number;
}): Promise<{
  pastDueTicked: number;
  expired: number;
  cancelFinalized: number;
  escalations: number;
}> {
  const now = opts?.now ?? new Date();
  const take = Math.min(Math.max(opts?.take ?? 100, 1), 500);
  let pastDueTicked = 0;
  let expired = 0;
  let cancelFinalized = 0;
  let escalations = 0;

  // Due dunning retries: bump fail count / schedule or exhaust → cancelAtPeriodEnd
  const due = await prisma.guestMembership.findMany({
    where: {
      status: "past_due",
      dunningNextAt: { lte: now },
    },
    include: {
      guestProfile: { select: { email: true, firstName: true } },
      plan: { select: { name: true } },
    },
    take,
    orderBy: { dunningNextAt: "asc" },
  });

  for (const m of due) {
    const settings = await resolveGraceDays(m.orgId, m.locationId);
    const orgPlan = await resolveOrgSubscriptionPlan(m.orgId);
    if (!settings.enabled) {
      await prisma.guestMembership.update({
        where: { id: m.id },
        data: { dunningNextAt: null },
      });
      continue;
    }
    const failCount = m.dunningFailCount + 1;
    const exhausted = dunningExhausted(
      failCount,
      settings.graceDays,
      orgPlan
    );
    const gap = exhausted
      ? null
      : gapDaysUntilNextRetry(failCount, settings.graceDays, orgPlan);
    const nextAt =
      gap == null ? null : new Date(now.getTime() + gap * 86_400_000);
    await prisma.guestMembership.update({
      where: { id: m.id },
      data: {
        dunningFailCount: failCount,
        dunningNextAt: exhausted ? null : nextAt,
        cancelAtPeriodEnd: exhausted ? true : m.cancelAtPeriodEnd,
      },
    });
    pastDueTicked += 1;

    if (m.guestProfile.email) {
      void sendGuestMembershipDunningEmail({
        to: m.guestProfile.email,
        guestName: m.guestProfile.firstName,
        planName: m.plan.name,
        kind: "reminder",
        failCount,
      }).catch((err) =>
        console.warn("[memberships] dunning reminder email failed", err)
      );
    }

    // Enterprise: escalate to finance contacts when failCount >= 4
    if (isEnterpriseDunningPlan(orgPlan) && failCount >= 4) {
      const org = await prisma.organization.findUnique({
        where: { id: m.orgId },
        select: { name: true },
      });
      const finance = await prisma.membership.findMany({
        where: {
          orgId: m.orgId,
          status: "active",
          rolePreset: "finance",
        },
        include: { user: { select: { email: true } } },
        take: 5,
      });
      for (const seat of finance) {
        if (!seat.user.email) continue;
        void sendMembershipFinanceEscalationEmail({
          to: seat.user.email,
          orgName: org?.name ?? m.orgId,
          memberCustomId: m.customMembershipId,
          planName: m.plan.name,
          failCount,
        }).catch((err) =>
          console.warn("[memberships] finance escalation failed", err)
        );
        escalations += 1;
      }
    }
  }

  // Fixed-term ended
  const fixedExpired = await prisma.guestMembership.findMany({
    where: {
      status: { in: ["active", "past_due", "paused"] },
      endsAt: { lte: now },
    },
    take,
  });
  for (const m of fixedExpired) {
    if (m.status !== "expired") {
      assertMembershipTransition(m.status, "expired");
    }
    await prisma.guestMembership.update({
      where: { id: m.id },
      data: {
        status: "expired",
        dunningNextAt: null,
        cancelAtPeriodEnd: false,
        stripeSubscriptionId: null,
        stripePriceId: null,
      },
    });
    expired += 1;
  }

  // cancelAtPeriodEnd after currentPeriodEnd (or missing period end — finalize)
  const periodEnded = await prisma.guestMembership.findMany({
    where: {
      cancelAtPeriodEnd: true,
      status: { in: ["active", "past_due", "paused"] },
      OR: [
        { currentPeriodEnd: { lte: now } },
        { currentPeriodEnd: null },
      ],
    },
    take,
  });
  for (const m of periodEnded) {
    assertMembershipTransition(m.status, "cancelled");
    await prisma.guestMembership.update({
      where: { id: m.id },
      data: {
        status: "cancelled",
        cancelledAt: now,
        cancelAtPeriodEnd: false,
        dunningNextAt: null,
        stripeSubscriptionId: null,
        stripePriceId: null,
      },
    });
    cancelFinalized += 1;
  }

  return { pastDueTicked, expired, cancelFinalized, escalations };
}

/**
 * Enterprise admin dunning work queue — past_due memberships needing attention.
 * Growth orgs get the same list shape but callers should label baseline vs advanced.
 */
export async function listDunningWorkQueue(input: {
  orgId: string;
  take?: number;
}): Promise<{
  advanced: boolean;
  retryDays: readonly number[];
  items: Array<{
    id: string;
    customMembershipId: string;
    status: string;
    dunningFailCount: number;
    dunningNextAt: string | null;
    cancelAtPeriodEnd: boolean;
    planName: string;
    guestEmail: string | null;
    guestName: string;
  }>;
}> {
  const org = await prisma.organization.findUnique({
    where: { id: input.orgId },
    select: { subscriptionPlan: true },
  });
  const advanced = isEnterpriseDunningPlan(org?.subscriptionPlan);
  const take = Math.min(Math.max(input.take ?? 50, 1), 100);
  const rows = await prisma.guestMembership.findMany({
    where: { orgId: input.orgId, status: "past_due" },
    include: {
      plan: { select: { name: true } },
      guestProfile: {
        select: { email: true, firstName: true, lastName: true },
      },
    },
    orderBy: [{ dunningFailCount: "desc" }, { dunningNextAt: "asc" }],
    take,
  });
  return {
    advanced,
    retryDays: dunningRetryDaysForPlan(org?.subscriptionPlan),
    items: rows.map((m) => ({
      id: m.id,
      customMembershipId: m.customMembershipId,
      status: m.status,
      dunningFailCount: m.dunningFailCount,
      dunningNextAt: m.dunningNextAt?.toISOString() ?? null,
      cancelAtPeriodEnd: m.cancelAtPeriodEnd,
      planName: m.plan.name,
      guestEmail: m.guestProfile.email,
      guestName:
        `${m.guestProfile.firstName} ${m.guestProfile.lastName}`.trim(),
    })),
  };
}
