'use client';

/**
 * Landing pricing grid — compact highlights from SUBSCRIPTION_PLANS.
 * Full feature lists stay on /register-company (same SSOT).
 */
import {
  SUBSCRIPTION_PLANS,
  formatPlanMonthlyDisplayPrice,
  planRegisterCtaLabel,
  type SubscriptionPlanDefinition,
} from '@/lib/subscriptionPlans';

function PriceHeading({ plan }: { plan: SubscriptionPlanDefinition }) {
  const price = formatPlanMonthlyDisplayPrice(plan);
  if (price.kind === 'monthly' && price.amount != null) {
    return (
      <p className="price">
        <span>$</span>
        {price.amount}
        <span>/mo</span>
      </p>
    );
  }
  return <p className="price">{price.label}</p>;
}

export default function VenueFlowPricingSection() {
  return (
    <section className="pricing" id="pricing">
      <div className="section-head">
        <h2>Simple plans that scale with you</h2>
        <p>
          Packages for venue operators. Demo is a free limited trial. Full
          feature lists open when you choose a package to register.
        </p>
      </div>
      <div className="pricing-grid">
        {SUBSCRIPTION_PLANS.map((plan) => {
          const ctaLabel = planRegisterCtaLabel(plan);
          const href = `/register-company?plan=${encodeURIComponent(plan.id)}`;
          const featured = plan.highlighted;
          const moreCount = Math.max(
            0,
            plan.features.length - plan.landingHighlights.length
          );
          return (
            <article
              key={plan.id}
              className={
                featured
                  ? 'price-card featured vf-reveal'
                  : 'price-card vf-reveal'
              }
              id={plan.id === 'enterprise' ? 'pricing-enterprise' : undefined}
            >
              <div className="price-card-badge-slot" aria-hidden={!featured}>
                {featured ? <p className="badge">Most popular</p> : null}
              </div>
              <div className="price-card-top">
                <h3>{plan.name}</h3>
                <PriceHeading plan={plan} />
              </div>
              <ul>
                {plan.landingHighlights.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <div className="price-card-footer">
                {moreCount > 0 ? (
                  <a className="price-more" href={href}>
                    +{moreCount} more on register
                  </a>
                ) : (
                  <span className="price-more price-more-spacer" aria-hidden>
                    &nbsp;
                  </span>
                )}
                <a
                  className={
                    featured ? 'btn btn-primary' : 'btn btn-outline-dark'
                  }
                  href={href}
                >
                  {ctaLabel}
                </a>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
