import { NextRequest } from "next/server";
import {
  ok,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { assertOrganizationActive } from "@/lib/org";
import {
  assertRegisteredCompanyBillingOrg,
  getCompanyBillingState,
} from "@/lib/companyBilling";
import {
  BILLING_DURATION_OPTIONS,
  billingDurationQuotesForPlan,
  enterpriseContactHref,
  isPlanCheckoutAvailable,
  listSubscriptionPlansForUi,
} from "@/lib/subscriptionPlans";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/admin/billing/plans
 * Plan catalog + current org billing state (settings:manage, active org).
 */
export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.BillingRead, { allowOnDemo: true });
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/admin/billing/plans", {
          permission: P.BillingRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const orgId = requireActorOrgId(actor);
    const { assertNotParkLockedCompanyHq } = await import(
      "@/lib/assertNotParkLockedCompanyHq"
    );
    await assertNotParkLockedCompanyHq(actor);
    await assertRegisteredCompanyBillingOrg(orgId);
    await assertOrganizationActive(orgId);
    const [billing, plans] = await Promise.all([
      getCompanyBillingState(orgId),
      Promise.resolve(
        listSubscriptionPlansForUi().map((p) => ({
          id: p.id,
          name: p.name,
          tagline: p.tagline,
          features: p.features,
          limits: p.limits,
          moduleHints: [...p.moduleHints],
          displayPriceMonthly: p.displayPriceMonthly,
          currency: p.currency,
          highlighted: p.highlighted,
          cta: p.cta,
          checkoutAvailable: isPlanCheckoutAvailable(p.id),
          contactHref: p.cta === "contact" ? enterpriseContactHref() : null,
          durationQuotes: billingDurationQuotesForPlan(p.id),
        }))
      ),
    ]);
    return ok({
      plans,
      billing,
      durationOptions: BILLING_DURATION_OPTIONS.map((d) => ({
        months: d.months,
        label: d.label,
        shortLabel: d.shortLabel,
      })),
    });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "GET /api/admin/billing/plans", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.BillingRead,
      })
    );
    if (authRes) return authRes;
    console.error("billing plans error:", err);
    return serverError("Failed to load billing plans");
  }
}
