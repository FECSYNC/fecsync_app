'use client';

import {
  BILLING_DURATION_OPTIONS,
  billingDurationLabel,
  computePlanTermTotalMajor,
  normalizeBillingDurationMonths,
  type BillingDurationMonths,
} from '@/lib/subscriptionPlans';

/**
 * Shared subscription-length picker for register, waiting room, renew, billing.
 */
export default function BillingDurationSelect({
  planId,
  value,
  onChange,
  disabled,
  id = 'billing-duration',
  hideWhenDemo = true,
}: {
  planId?: string | null;
  value: BillingDurationMonths | number;
  onChange: (months: BillingDurationMonths) => void;
  disabled?: boolean;
  id?: string;
  /** Demo packages ignore duration — hide the control. */
  hideWhenDemo?: boolean;
}) {
  const plan = (planId || '').trim().toLowerCase();
  if (hideWhenDemo && plan === 'demo') return null;

  return (
    <div className="w-full max-w-sm text-left">
      <label
        htmlFor={id}
        className="mb-1.5 block text-xs font-medium text-stone-600"
      >
        Subscription length
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) =>
          onChange(normalizeBillingDurationMonths(Number(e.target.value)))
        }
        className="w-full cursor-pointer rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] disabled:opacity-50"
      >
        {BILLING_DURATION_OPTIONS.map((d) => {
          const total =
            plan && plan !== 'demo'
              ? computePlanTermTotalMajor(plan, d.months)
              : null;
          return (
            <option key={d.months} value={d.months}>
              {d.label}
              {total != null ? ` — $${total}` : ''}
            </option>
          );
        })}
      </select>
      {plan && plan !== 'demo' ? (
        <p className="mt-1 text-xs text-stone-500">
          {(() => {
            const total = computePlanTermTotalMajor(plan, value);
            return total != null
              ? `Checkout will charge $${total} for ${billingDurationLabel(Number(value))} (monthly rate × months), then renew on that term.`
              : 'Contact sales for Enterprise pricing.';
          })()}
        </p>
      ) : (
        <p className="mt-1 text-xs text-stone-500">
          Choose how long to subscribe. The total is monthly rate × months.
        </p>
      )}
    </div>
  );
}
