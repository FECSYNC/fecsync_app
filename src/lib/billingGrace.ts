/**
 * Post-period billing grace before Demo demotion.
 * Period ends at Organization.subscriptionEndsAt → soft-hold + countdown →
 * after COMPANY_BILLING_GRACE_DAYS → demote to Demo (records intact).
 */

export function companyBillingGraceDays(): number {
  const raw = Number(process.env.COMPANY_BILLING_GRACE_DAYS || "7");
  if (!Number.isFinite(raw) || raw < 0) return 7;
  return Math.min(Math.floor(raw), 30);
}

/** Instant when Demo demotion becomes eligible (period end + grace days). */
export function billingGraceEndsAt(periodEndsAt: Date): Date {
  return new Date(
    periodEndsAt.getTime() + companyBillingGraceDays() * 24 * 60 * 60 * 1000
  );
}

/** Cutoff for Prisma `subscriptionEndsAt: { lt: cutoff }` demotion queries. */
export function billingGraceDemoteCutoff(now: Date = new Date()): Date {
  return new Date(
    now.getTime() - companyBillingGraceDays() * 24 * 60 * 60 * 1000
  );
}

export function isPastBillingGracePeriod(
  periodEndsAt: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  if (periodEndsAt == null) return false;
  const ends =
    periodEndsAt instanceof Date ? periodEndsAt : new Date(periodEndsAt);
  if (Number.isNaN(ends.getTime())) return false;
  return now.getTime() >= billingGraceEndsAt(ends).getTime();
}

/**
 * Active company whose paid period ended but grace has not finished.
 * Soft-hold still applies; Demo demotion waits until grace ends.
 * Demo trials never use this window (they suspend at endsAt).
 */
export function isInBillingGracePeriod(row: {
  status: string;
  subscriptionStatus: string | null | undefined;
  subscriptionEndsAt: Date | string | null | undefined;
  subscriptionPlan?: string | null;
  now?: Date;
}): boolean {
  if (row.status !== "active") return false;
  if (row.subscriptionPlan?.trim().toLowerCase() === "demo") return false;
  const live =
    row.subscriptionStatus === "active" ||
    row.subscriptionStatus === "trialing" ||
    row.subscriptionStatus === "past_due";
  if (!live || row.subscriptionEndsAt == null) return false;
  const now = row.now ?? new Date();
  const ends =
    row.subscriptionEndsAt instanceof Date
      ? row.subscriptionEndsAt
      : new Date(row.subscriptionEndsAt);
  if (Number.isNaN(ends.getTime())) return false;
  if (ends.getTime() >= now.getTime()) return false;
  return !isPastBillingGracePeriod(ends, now);
}

export function msRemainingInBillingGrace(
  periodEndsAt: Date | string | null | undefined,
  now: Date = new Date()
): number | null {
  if (periodEndsAt == null) return null;
  const ends =
    periodEndsAt instanceof Date ? periodEndsAt : new Date(periodEndsAt);
  if (Number.isNaN(ends.getTime())) return null;
  if (ends.getTime() >= now.getTime()) return null;
  const graceEnd = billingGraceEndsAt(ends);
  const ms = graceEnd.getTime() - now.getTime();
  return ms > 0 ? ms : 0;
}
