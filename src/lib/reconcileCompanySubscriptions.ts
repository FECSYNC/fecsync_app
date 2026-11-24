/**
 * Company SaaS subscription expiry reconcile (Step 2–3 control plane).
 *
 * Shared by `yarn reconcile:subscriptions` and
 * `GET /api/cron/reconcile-company-subscriptions` (Bearer CRON_SECRET).
 * Finds registered companies that are still `active` but past
 * `subscriptionEndsAt` (or past_due with null endsAt), optionally verifies
 * Stripe before demoting unpaid tenants to Demo (all records kept), otherwise
 * calls `markOrganizationSubscriptionExpired`.
 *
 * Never touches the storefront / isDefault org. Never deletes tenant data.
 */
import prisma from "@/lib/prisma";
import {
  markOrganizationSubscriptionExpired,
  periodEndUnixFromSubscription,
  applyStripeSubscriptionToOrg,
  isLiveStripeSubscriptionStatus,
  resolvePlanForSubscriptionApply,
  retrieveStripeSubscriptionForApply,
  bestEffortCancelLiveStripeSubscriptionsForOrg,
} from "@/lib/companyBilling";
import { CompanyBillingConfigError } from "@/lib/stripe";

export type ReconcileCompanySubscriptionsSummary = {
  candidates: number;
  refreshed: number;
  expired: number;
  clearedBindings: number;
  skipped: number;
  errors: number;
};

export type ReconcileCompanySubscriptionsOptions = {
  /** Override "now" for tests. */
  now?: Date;
  /** Max suspended orgs to scrub for leftover Stripe bindings per run. */
  stuckBindingLimit?: number;
  log?: (message: string) => void;
  warn?: (message: string, detail?: unknown) => void;
  error?: (message: string, detail?: unknown) => void;
};

function defaultLog(message: string) {
  console.log(message);
}
function defaultWarn(message: string, detail?: unknown) {
  if (detail !== undefined) console.warn(message, detail);
  else console.warn(message);
}
function defaultError(message: string, detail?: unknown) {
  if (detail !== undefined) console.error(message, detail);
  else console.error(message);
}

/**
 * Run one reconcile pass. Idempotent. Safe to call from cron or CLI.
 */
export async function runReconcileCompanySubscriptions(
  options?: ReconcileCompanySubscriptionsOptions
): Promise<ReconcileCompanySubscriptionsSummary> {
  const log = options?.log ?? defaultLog;
  const warn = options?.warn ?? defaultWarn;
  const error = options?.error ?? defaultError;
  const now = options?.now ?? new Date();
  const stuckBindingLimit = options?.stuckBindingLimit ?? 50;

  const summary: ReconcileCompanySubscriptionsSummary = {
    candidates: 0,
    refreshed: 0,
    expired: 0,
    clearedBindings: 0,
    skipped: 0,
    errors: 0,
  };

  const candidates = await prisma.organization.findMany({
    where: {
      isDefault: false,
      status: "active",
      subscriptionStatus: { in: ["active", "trialing", "past_due"] },
      OR: [
        { subscriptionEndsAt: { not: null, lt: now } },
        // Past-period refuse can leave past_due with null endsAt — still refresh.
        { subscriptionStatus: "past_due", subscriptionEndsAt: null },
      ],
    },
    select: {
      id: true,
      name: true,
      stripeSubscriptionId: true,
      subscriptionEndsAt: true,
      subscriptionStatus: true,
      subscriptionPlan: true,
    },
    orderBy: { subscriptionEndsAt: "asc" },
  });
  summary.candidates = candidates.length;

  if (candidates.length === 0) {
    log("[reconcile] no expired active company subscriptions");
  }

  for (const org of candidates) {
    const label = `${org.name} (${org.id})`;
    const orgPlan = org.subscriptionPlan?.trim().toLowerCase() || "";
    const isDemoOrg = orgPlan === "demo";
    try {
      const subId = org.stripeSubscriptionId?.trim() || "";
      if (subId) {
        try {
          const sub = await retrieveStripeSubscriptionForApply(subId);
          const live = isLiveStripeSubscriptionStatus(sub.status);
          if (live) {
            const endsAtSec = periodEndUnixFromSubscription(sub);
            const nextEndsAt =
              typeof endsAtSec === "number" && Number.isFinite(endsAtSec)
                ? new Date(endsAtSec * 1000)
                : null;
            // Demo trial already past org endsAt — never Stripe-refresh-extend;
            // fall through to durable suspend.
            const demoTrialPast =
              isDemoOrg &&
              org.subscriptionEndsAt != null &&
              org.subscriptionEndsAt.getTime() < now.getTime();
            if (demoTrialPast) {
              log(
                `[reconcile] Demo trial ended for ${label} — refusing Stripe refresh; expiring`
              );
            } else if (nextEndsAt && nextEndsAt.getTime() > now.getTime()) {
              const mappedPlan = resolvePlanForSubscriptionApply(
                sub,
                "active",
                org.subscriptionPlan,
                true
              );
              // Unmapped: apply retains binding but does not stamp endsAt —
              // fall through to expire so we do not stick on active+past endsAt.
              // price_data Checkouts resolve via subscription metadata.plan.
              if (!mappedPlan) {
                log(
                  `[reconcile] Stripe status=${sub.status} unmapped price for ${label} — expiring`
                );
              } else if (mappedPlan === "demo" || isDemoOrg) {
                // Do not roll Demo into a new Stripe billing period via reconcile.
                log(
                  `[reconcile] Demo Stripe live for ${label} — skip refresh extend; expiring if overdue`
                );
              } else {
                // Unique per period end for idempotency; watermark = now (never
                // period end — that poisons later Stripe event.created ordering).
                await applyStripeSubscriptionToOrg(
                  org.id,
                  sub,
                  `reconcile-refresh:${sub.id}:${endsAtSec}`,
                  Math.floor(Date.now() / 1000)
                );
                const again = await prisma.organization.findUnique({
                  where: { id: org.id },
                  select: {
                    subscriptionEndsAt: true,
                    subscriptionPlan: true,
                  },
                });
                if (
                  again?.subscriptionPlan === mappedPlan &&
                  again.subscriptionEndsAt &&
                  again.subscriptionEndsAt.getTime() > now.getTime()
                ) {
                  summary.refreshed += 1;
                  log(
                    `[reconcile] refreshed ${label} — Stripe status=${sub.status} endsAt=${nextEndsAt.toISOString()}`
                  );
                  continue;
                }
                // Soft-skip (stale watermark) while Stripe still live+future —
                // never expire/cancel; align with tryRefresh → null.
                summary.skipped += 1;
                warn(
                  `[reconcile] skip ${label} — apply did not advance endsAt while Stripe still live`
                );
                continue;
              }
            } else if (!nextEndsAt) {
              if (isDemoOrg) {
                log(
                  `[reconcile] Demo live Stripe missing period end for ${label} — expiring`
                );
              } else {
                // Live Stripe but unparseable period end — never false-expire.
                summary.skipped += 1;
                warn(
                  `[reconcile] skip ${label} — live Stripe status=${sub.status} but period end missing`
                );
                continue;
              }
            } else if (isDemoOrg) {
              // Live + past period end on Demo — durable suspend.
              log(
                `[reconcile] Demo live+past for ${label} — expiring`
              );
            } else {
              // Live + past period end — period-boundary lag; never cancel while
              // Stripe still reports live (align with tryRefresh → null).
              summary.skipped += 1;
              warn(
                `[reconcile] skip ${label} — live Stripe status=${sub.status} but period end ` +
                  `${nextEndsAt.toISOString()} still past`
              );
              continue;
            }
          } else {
            // Stripe not in a live billing state → fall through to expire.
            log(
              `[reconcile] Stripe sub ${subId} status=${sub.status} for ${label} — expiring`
            );
          }
        } catch (stripeErr) {
          if (stripeErr instanceof CompanyBillingConfigError) {
            // Fail closed: never mass-expire when Stripe cannot be consulted.
            summary.skipped += 1;
            warn(
              `[reconcile] Stripe not configured — skipping ${label} (refusing expire without verification)`
            );
            continue;
          }
          const code =
            stripeErr &&
            typeof stripeErr === "object" &&
            "code" in stripeErr
              ? String((stripeErr as { code?: string }).code || "")
              : "";
          const statusCode =
            stripeErr &&
            typeof stripeErr === "object" &&
            "statusCode" in stripeErr
              ? Number((stripeErr as { statusCode?: number }).statusCode)
              : 0;
          if (code === "resource_missing" || statusCode === 404) {
            log(`[reconcile] Stripe sub missing for ${label} — expiring`);
          } else {
            // Transient Stripe failure — skip to avoid false suspend.
            summary.skipped += 1;
            warn(
              `[reconcile] skip ${label} — Stripe retrieve deferred:`,
              stripeErr instanceof Error ? stripeErr.message : stripeErr
            );
            continue;
          }
        }
      }

      const priorPlan = (
        await prisma.organization.findUnique({
          where: { id: org.id },
          select: { subscriptionPlan: true },
        })
      )?.subscriptionPlan
        ?.trim()
        .toLowerCase();

      const billing = await markOrganizationSubscriptionExpired(
        org.id,
        "reconcile:subscriptionEndsAt passed",
        { requireStillOverdue: true }
      );
      // Paid → Demo demotion, or Demo trial → suspend (ops reactivate).
      if (
        priorPlan !== "demo" &&
        billing.orgStatus === "active" &&
        (billing.plan === "demo" || billing.planResolved === "demo")
      ) {
        summary.expired += 1;
        log(`[reconcile] demoted to Demo ${label} (records preserved)`);
      } else if (
        priorPlan === "demo" &&
        billing.orgStatus === "suspended"
      ) {
        summary.expired += 1;
        log(`[reconcile] Demo trial suspended ${label} (ops reactivate)`);
      } else if (billing.orgStatus === "suspended") {
        summary.expired += 1;
        log(`[reconcile] expired/suspended ${label}`);
      } else {
        summary.skipped += 1;
        warn(
          `[reconcile] skip ${label} — expire no-op (grace window or unlocked)`
        );
      }
    } catch (err) {
      summary.errors += 1;
      error(
        `[reconcile] error ${label}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Cleanup: suspended tenants that still hold a Stripe subscription binding
  // or a customer with orphan live subs (apply skipped while unbound).
  const stuck = await prisma.organization.findMany({
    where: {
      isDefault: false,
      status: "suspended",
      OR: [
        { stripeSubscriptionId: { not: null } },
        { stripeCustomerId: { not: null } },
      ],
    },
    select: {
      id: true,
      name: true,
      stripeSubscriptionId: true,
      stripeCustomerId: true,
    },
    take: stuckBindingLimit,
    orderBy: { updatedAt: "asc" },
  });
  for (const org of stuck) {
    const label = `${org.name} (${org.id})`;
    const subId = org.stripeSubscriptionId?.trim() || "";
    const customerId = org.stripeCustomerId?.trim() || "";
    if (!subId && !customerId) continue;
    try {
      const canceled = await bestEffortCancelLiveStripeSubscriptionsForOrg({
        stripeSubscriptionId: subId || null,
        stripeCustomerId: customerId || null,
      });
      if (canceled) {
        if (subId) {
          await prisma.organization.update({
            where: { id: org.id },
            data: { stripeSubscriptionId: null },
          });
          summary.clearedBindings += 1;
          log(`[reconcile] cleared retained Stripe binding for ${label}`);
        } else {
          summary.skipped += 1;
          log(
            `[reconcile] no retained binding for ${label} — live customer subs canceled if any`
          );
        }
      } else {
        summary.skipped += 1;
        warn(
          `[reconcile] retain binding for ${label} — Stripe cancel deferred`
        );
      }
    } catch (err) {
      summary.errors += 1;
      error(
        `[reconcile] binding cleanup error ${label}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return summary;
}
