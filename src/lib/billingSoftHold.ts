/**
 * Soft billing hold — DB may stay `active` while Fresh soft-denies
 * (overdue live period or past_due + null endsAt). Soft-hold starts when
 * subscriptionEndsAt passes; Demo demotion waits for billing grace
 * (@/lib/billingGrace). Pure helpers (no Prisma).
 *
 * Demo trials are NOT soft-held: when Demo endsAt passes, expire suspends the
 * org (ops must Approve → Demo again). Paid overdue uses soft-hold + grace.
 */

export function isSoftBillingHoldRow(row: {
  status: string;
  subscriptionStatus: string | null;
  subscriptionEndsAt: Date | string | null;
  /** Demo never soft-holds — expires to suspended instead. */
  subscriptionPlan?: string | null;
  now?: Date;
}): boolean {
  if (row.status !== "active") return false;
  if (row.subscriptionPlan?.trim().toLowerCase() === "demo") return false;
  const now = row.now ?? new Date();
  if (
    row.subscriptionStatus === "past_due" &&
    row.subscriptionEndsAt == null
  ) {
    return true;
  }
  const live =
    row.subscriptionStatus === "active" ||
    row.subscriptionStatus === "trialing" ||
    row.subscriptionStatus === "past_due";
  if (!live || row.subscriptionEndsAt == null) return false;
  const endsAt =
    row.subscriptionEndsAt instanceof Date
      ? row.subscriptionEndsAt
      : new Date(row.subscriptionEndsAt);
  if (Number.isNaN(endsAt.getTime())) return false;
  return endsAt.getTime() < now.getTime();
}

/** Prisma `where` fragment for soft-hold orgs (list / metrics / approve). */
export function softBillingHoldWhere(now: Date = new Date()) {
  return {
    status: "active" as const,
    NOT: { subscriptionPlan: "demo" },
    OR: [
      {
        subscriptionStatus: { in: ["active", "trialing", "past_due"] },
        subscriptionEndsAt: { not: null, lt: now },
      },
      {
        subscriptionStatus: "past_due" as const,
        subscriptionEndsAt: null,
      },
    ],
  };
}

/** Demo trial past endsAt — Fresh soft-denies until ops Approve / Set plan. */
export function demoTrialOverdueWhere(now: Date = new Date()) {
  return {
    status: "active" as const,
    subscriptionPlan: "demo" as const,
    subscriptionEndsAt: { not: null, lt: now },
  };
}

/**
 * Projected "suspended" tab: durable suspended OR soft-hold OR demo overdue.
 * Prefer this over collecting soft-skip id sets on list/metrics hot paths.
 */
export function projectedSuspendedOrgWhere(now: Date = new Date()) {
  return {
    OR: [
      { status: "suspended" as const },
      softBillingHoldWhere(now),
      demoTrialOverdueWhere(now),
    ],
  };
}

/**
 * Projected "active" tab: DB active and not soft-held / demo-overdue.
 */
export function projectedActiveOrgWhere(now: Date = new Date()) {
  return {
    status: "active" as const,
    AND: [{ NOT: softBillingHoldWhere(now) }, { NOT: demoTrialOverdueWhere(now) }],
  };
}

/** True when Demo trial endsAt has passed while DB status is still active. */
export function isDemoTrialOverdueRow(row: {
  status: string;
  subscriptionPlan?: string | null;
  subscriptionEndsAt: Date | string | null;
  now?: Date;
}): boolean {
  if (row.status !== "active") return false;
  if (row.subscriptionPlan?.trim().toLowerCase() !== "demo") return false;
  if (row.subscriptionEndsAt == null) return false;
  const now = row.now ?? new Date();
  const endsAt =
    row.subscriptionEndsAt instanceof Date
      ? row.subscriptionEndsAt
      : new Date(row.subscriptionEndsAt);
  if (Number.isNaN(endsAt.getTime())) return false;
  return endsAt.getTime() < now.getTime();
}
