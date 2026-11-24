'use client';

import type { BillingPlanCard } from '@/services/billing';
import { SHIPPED_MODULE_HINT_IDS } from '@/lib/subscriptionPlans';

const SHIPPED = new Set<string>(SHIPPED_MODULE_HINT_IDS);

function moduleHintCopy(hints: string[] | undefined): {
  live: string | null;
  coming: string | null;
} {
  if (!hints?.length) return { live: null, coming: null };
  if (hints.includes('all')) {
    return {
      live: 'Includes online ticketing + guest memberships (live)',
      coming: 'Other venue modules when shipped — not billed separately',
    };
  }
  const label = (id: string) =>
    id === 'ticketing'
      ? 'online ticketing'
      : id === 'memberships'
        ? 'guest memberships'
        : id;
  const liveHints = hints.filter((h) => SHIPPED.has(h));
  const comingHints = hints.filter((h) => !SHIPPED.has(h));
  return {
    live: liveHints.length
      ? `Includes ${liveHints.map(label).join(', ')} (live)`
      : null,
    coming: comingHints.length
      ? `Coming later: ${comingHints.join(', ')} (access when shipped — not billed separately)`
      : null,
  };
}

export default function BillingPlanCardView({
  plan,
  currentPlan,
  hasSubscription,
  disabled,
  busy,
  preferHighlight,
  durationMonths = 1,
  termTotalMajor,
  onCheckout,
}: {
  plan: BillingPlanCard;
  currentPlan: string | null;
  /** Live Stripe subscription — plan changes go through portal, not new Checkout. */
  hasSubscription?: boolean;
  disabled?: boolean;
  busy?: boolean;
  /** Registration ?plan= hint — visual only; does not entitle. */
  preferHighlight?: boolean;
  /** Selected Checkout term (months). Demo ignores. */
  durationMonths?: number;
  /** Precomputed term total from displayPriceMonthly × months. */
  termTotalMajor?: number | null;
  onCheckout: (planId: string) => void;
}) {
  const isCurrent = currentPlan === plan.id;
  const highlighted = Boolean(plan.highlighted || preferHighlight);
  const isDemoCta = plan.cta === 'demo' || plan.id === 'demo';
  const { live: liveModules, coming: comingModules } = moduleHintCopy(
    plan.moduleHints
  );
  const price =
    plan.displayPriceMonthly == null
      ? 'Contact sales'
      : plan.displayPriceMonthly === 0
        ? 'Free'
        : isDemoCta
          ? 'Free'
          : termTotalMajor != null && durationMonths > 1
            ? `$${termTotalMajor} / ${durationMonths === 12 ? 'year' : `${durationMonths} mo`}`
            : `$${plan.displayPriceMonthly}/mo`;
  // Prompt: enterprise contact unless a Price env is configured (checkoutAvailable).
  const showContact = plan.cta === 'contact' && !plan.checkoutAvailable;
  // Live paid Stripe sub → portal. Live Demo may start paid Checkout (server
  // cancels the free Demo binding first).
  const portalOnly =
    Boolean(hasSubscription) && currentPlan !== 'demo';
  const checkoutBlocked =
    disabled ||
    busy ||
    !plan.checkoutAvailable ||
    isCurrent ||
    portalOnly ||
    (Boolean(hasSubscription) && isDemoCta);

  return (
    <article
      className={`flex flex-col rounded-lg border bg-white p-5 ${
        highlighted
          ? 'border-[#D4AF37] shadow-sm'
          : 'border-stone-200'
      }`}
    >
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-stone-900">{plan.name}</h3>
        <p className="text-sm text-stone-600">{plan.tagline}</p>
        <p className="text-xl font-semibold text-stone-900 pt-2">{price}</p>
        {!isDemoCta &&
        plan.displayPriceMonthly != null &&
        plan.displayPriceMonthly > 0 &&
        durationMonths > 1 ? (
          <p className="text-xs text-stone-500">
            Based on ${plan.displayPriceMonthly}/mo × {durationMonths} months
          </p>
        ) : null}
        {isDemoCta ? (
          <p className="text-xs font-medium text-emerald-800">
            No charge · no credit or debit card required
          </p>
        ) : null}
      </div>
      <ul className="mt-4 space-y-1.5 text-sm text-stone-700 flex-1">
        {plan.features.map((f) => (
          <li key={f} className="flex gap-2">
            <span className="text-[#D4AF37]" aria-hidden>
              •
            </span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      {liveModules || comingModules ? (
        <div className="mt-3 space-y-1 text-xs text-stone-500">
          {liveModules ? <p>{liveModules}</p> : null}
          {comingModules ? <p>{comingModules}</p> : null}
        </div>
      ) : isDemoCta ? (
        <p className="mt-3 text-xs text-stone-500">
          Complete free Checkout to activate Demo (company dashboard + profile
          only). Upgrade later to Starter, Growth, or Enterprise for full apps.
        </p>
      ) : null}
      <div className="mt-5">
        {showContact ? (
          <a
            href={plan.contactHref || 'mailto:admin@fecsync.com'}
            className="inline-flex w-full justify-center rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-800 hover:border-[#D4AF37]"
          >
            Contact sales
          </a>
        ) : (
          <button
            type="button"
            disabled={checkoutBlocked}
            onClick={() => onCheckout(plan.id)}
            className="inline-flex w-full justify-center rounded-md bg-stone-900 px-3 py-2 text-sm text-white hover:bg-stone-800 disabled:opacity-50"
          >
            {busy
              ? 'Redirecting…'
              : isCurrent
                ? isDemoCta
                  ? 'Current demo plan'
                  : 'Current plan'
                : portalOnly
                  ? 'Use Manage billing'
                  : !plan.checkoutAvailable
                    ? 'Price not configured'
                    : isDemoCta
                      ? 'Start free Checkout'
                      : currentPlan === 'demo'
                        ? 'Upgrade plan'
                        : 'Choose plan'}
          </button>
        )}
      </div>
    </article>
  );
}
