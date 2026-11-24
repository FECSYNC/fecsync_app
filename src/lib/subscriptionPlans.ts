/**
 * Company SaaS subscription plan SSOT (venue / attraction operator packages).
 *
 * Charge via Stripe Price IDs from env (`STRIPE_PRICE_*_MONTHLY` for 1 month,
 * optional `STRIPE_PRICE_*_{N}M` for multi-month). When a duration-specific
 * Price is missing, Checkout uses inline `price_data` from
 * `displayPriceMonthly × durationMonths`.
 *
 * `displayPriceMonthly` is UI SSOT for quotes; term total =
 * `computePlanTermTotalMajor(plan, months)`.
 *
 * ── Sync contract for Steps 2–4 ───────────────────────────────────────────
 * - Step 2: billing/approve/expire MUST use these plan ids (demo|starter|
 *   growth|enterprise); must not invent parallel plans; must clear/set
 *   Organization subscription fields. VenueLocation is never billed separately.
 *   Reconcile SSOT: src/lib/reconcileCompanySubscriptions.ts
 * - Step 3: notices/cron use Organization.subscriptionEndsAt; must not email
 *   /signup (client) users as tenants; cron calls runReconcileCompanySubscriptions.
 * - Step 4: isolation/export includes VenueLocation; ticketing tables already
 *   use orgId + optional locationId; future POS/Waivers tables MUST match.
 * - This file path remains the plan SSOT. Do not rename paid plan ids.
 * - `demo` is a free, self-serve trial package (limited caps; modules locked).
 *
 * Module access: **ticketing**, **memberships**, **waivers**, and **pos** are live
 * (assertModuleEnabled). POS terminal screens arrive in Step 2. Other
 * `moduleHints` (loyalty, …) remain story until those epics ship.
 * See README Module entitlement contract.
 */

/** moduleHints that are enforced / live today (not “coming soon”). */
export const SHIPPED_MODULE_HINT_IDS = [
  "ticketing",
  "memberships",
  "waivers",
  "pos",
  "marketing",
  "accounting",
] as const;

export type PlanLimits = {
  /** Parks / venues / sites under the company (VenueLocation). */
  venues: number | null;
  members: number | null;
  /** Custom RoleTemplate rows per org. */
  roleTemplates: number | null;
  /** Legacy workspace catalog tools (not “online store” marketing). */
  products: number | null;
  fabrics: number | null;
  categories: number | null;
  tailorSeats: number | null;
  campaigns: number | null;
  tailorClients: number | null;
  /**
   * Confirmed ticket heads per venue-timezone calendar month (live meter).
   * Enforced on CONFIRM (not draft). Party bookings count kidCount + adultCount
   * once (Party Management rides the ticketing module). Null = unlimited.
   */
  ticketsPerMonth: number | null;
  /** Marketplace BookingPackage catalog rows (Connect payouts epic). */
  bookingPackages: number | null;
  /** Active PosDevice rows (archivedAt null). Enforced on device create only. */
  posTerminals: number | null;
};

/**
 * Documented extension hooks for future product modules.
 * Do NOT enforce these in planLimits until the module ships.
 * `ticketsPerMonth` is NOT listed here: it is a live PlanLimits meter
 * (Online Ticketing + Party Management confirm).
 */
export type FuturePlanModules = {
  /**
   * Digital Waivers (Feature 05) — enforced via moduleHints +
   * assertModuleEnabled("waivers"), not a PlanLimits meter.
   * Growth includes "waivers"; Enterprise "all"; Starter does not.
   */
  digitalWaivers?: boolean;
  accessControl?: boolean;
  guestSurveys?: boolean;
  loyalty?: boolean;
  dynamicPricing?: boolean;
  /**
   * Guest park Memberships (Feature 08) — enforced via moduleHints +
   * assertModuleEnabled("memberships"), not a PlanLimits meter in v1.
   */
  memberships?: boolean;
};

export type SubscriptionPlanId = "demo" | "starter" | "growth" | "enterprise";

export type SubscriptionPlanCta = "checkout" | "contact" | "demo";

export type SubscriptionPlanDefinition = {
  id: SubscriptionPlanId;
  name: string;
  tagline: string;
  /** Full feature list (register / billing). */
  features: string[];
  /**
   * Short bullets for the public landing pricing cards only.
   * Keep ≤5 concise lines so the four cards stay equal height.
   */
  landingHighlights: readonly string[];
  limits: PlanLimits;
  /**
   * Marketing / access hints for future venue modules (ticketing, POS, …).
   * NOT enforced by planLimits until those modules ship — see README
   * “Module entitlement contract”. Empty = modules locked for this package.
   */
  moduleHints: readonly string[];
  /** Env key holding the Stripe Price id (price_…). Unused when cta is demo. */
  stripePriceEnvKey: string;
  /** Monthly display amount in major units (UI only). Null = contact sales. 0 = free. */
  displayPriceMonthly: number | null;
  currency: string;
  highlighted: boolean;
  cta: SubscriptionPlanCta;
};

/** Single source of truth for plan ids + catalog. */
export const SUBSCRIPTION_PLANS: readonly SubscriptionPlanDefinition[] = [
  {
    id: "demo",
    name: "Demo",
    tagline:
      "Free one-month trial via Checkout — no charge and no card — with locked apps until you upgrade.",
    features: [
      "Free Checkout — no charge, no credit or debit card",
      "One-month Demo window (then suspends until ops reactivates)",
      "Company dashboard + company profile only",
      "All other admin apps locked until you upgrade",
      "Upgrade anytime to Starter, Growth, or Enterprise in Billing",
    ],
    landingHighlights: [
      "Free Checkout — no card required",
      "Company dashboard + profile",
      "Other admin apps locked",
      "Upgrade anytime in Billing",
    ],
    limits: {
      venues: 0,
      members: 1,
      roleTemplates: 0,
      products: 0,
      fabrics: 0,
      categories: 0,
      tailorSeats: 0,
      campaigns: 0,
      tailorClients: 0,
      ticketsPerMonth: 0,
      bookingPackages: 0,
      posTerminals: 0,
    },
    moduleHints: [],
    stripePriceEnvKey: "STRIPE_PRICE_DEMO_MONTHLY",
    displayPriceMonthly: 0,
    currency: "USD",
    highlighted: false,
    cta: "demo",
  },
  {
    id: "starter",
    name: "Starter",
    tagline: "Single venue or park getting started on FECSYNC.",
    features: [
      "1 venue / park location",
      "Park-lock team seats to your venue (Users → park venues)",
      "Up to 3 team members",
      "5 role templates",
      "Workspace catalog tools (50 products · 50 fabrics · 20 categories)",
      "1 tailor seat · 2 campaigns · 25 tailor clients",
      "Online ticketing: staff catalog, public/admin booking wizards, HQ search & bookings export (POS and digital waivers are Growth+)",
      "Company category pages: white-label links and a website embed for booking and menu categories, with embedded card checkout for bookings",
      "Up to 5 marketplace booking packages (Connect payouts)",
    ],
    landingHighlights: [
      "1 venue / park",
      "Park-lock team seats",
      "Online ticketing (staff + public)",
      "White-label category pages",
      "Up to 5 marketplace packages",
    ],
    limits: {
      venues: 1,
      members: 3,
      roleTemplates: 5,
      products: 50,
      fabrics: 50,
      categories: 20,
      tailorSeats: 1,
      campaigns: 2,
      tailorClients: 25,
      ticketsPerMonth: 2000,
      bookingPackages: 5,
      posTerminals: 0,
    },
    moduleHints: ["ticketing"],
    stripePriceEnvKey: "STRIPE_PRICE_STARTER_MONTHLY",
    displayPriceMonthly: 199,
    currency: "USD",
    highlighted: false,
    cta: "checkout",
  },
  {
    id: "growth",
    name: "Growth",
    tagline: "Multi-venue operators (up to 5) with room to scale.",
    features: [
      "Up to 5 venues / parks",
      "Park filter in admin chrome + MembershipVenueAssignment park-lock (no Enterprise required)",
      "Up to 15 team members · 25 role templates",
      "Workspace catalog tools (500 products · 500 fabrics · 100 categories)",
      "5 tailor seats · 20 campaigns · 100 tailor clients",
      "Online ticketing: staff catalog, public/admin booking wizards, HQ search & bookings export",
      "Company category pages: white-label links and a website embed for booking, membership, and menu categories, with embedded card checkout for bookings",
      "Guest park Memberships: plans, eligibility, CRM, sell/billing lifecycle, redeem/verify desk, guest self-serve, reports & multi-venue entitlements",
      "Up to 25 marketplace booking packages (Connect payouts)",
      "Digital waivers: guest signing, desk verify, import/export, expiry reminders, and a booking confirmation link when a ticket requires a waiver (check-in scanner later)",
      "POS terminal: sell pad (cash, in-browser card, payment link), check-in, tills, tabs, and capacity (Growth+). Up to 5 POS devices. Check-in scanner product and ticket-purchase kiosk remain separate",
      "Guest marketing automation: newsletter capture, welcome/birthday/re-engagement emails, post-visit surveys (Growth+; ESP/CRM sync not live)",
      "Accounting: double-entry general ledger auto-posted from bookings, POS, memberships, shop and marketplace sales; customers, suppliers, bills, expenses, banking and reconciliation, inventory costing, financial reports, tax, approvals, audit trail and period close",
      "Priority support email",
    ],
    landingHighlights: [
      "Up to 5 venues",
      "Park filter + park-lock seats",
      "Memberships, waivers & POS",
      "Guest marketing & surveys",
      "White-label category embeds",
      "Up to 25 marketplace packages",
    ],
    limits: {
      venues: 5,
      members: 15,
      roleTemplates: 25,
      products: 500,
      fabrics: 500,
      categories: 100,
      tailorSeats: 5,
      campaigns: 20,
      tailorClients: 100,
      ticketsPerMonth: 10000,
      bookingPackages: 25,
      posTerminals: 5,
    },
    moduleHints: [
      "ticketing",
      "pos",
      "waivers",
      "loyalty",
      "memberships",
      "marketing",
      "accounting",
    ],
    stripePriceEnvKey: "STRIPE_PRICE_GROWTH_MONTHLY",
    displayPriceMonthly: 449,
    currency: "USD",
    highlighted: true,
    cta: "checkout",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline:
      "Unlimited venues by agreement, Enterprise HQ multi-venue control plane, and dedicated success.",
    features: [
      "Unlimited venues / parks (by agreement)",
      "Unlimited team, role templates, and workspace catalog tools",
      "Unlimited tailor seats, campaigns, and clients (by agreement)",
      "Enterprise HQ control plane: venue switcher, cross-park HQ dashboard, location scope on venues + park-stamped modules (members roster + meters stay company-wide)",
      "Dedicated success contact",
      "Custom invoicing options",
      "Online ticketing: staff catalog, public/admin booking wizards, HQ search & bookings export",
      "Company category pages: white-label links and a website embed for booking, membership, and menu categories, with embedded card checkout for bookings",
      "Digital waivers: guest signing, desk verify, import/export, expiry reminders, and a booking confirmation link when a ticket requires a waiver (check-in scanner later)",
      "POS terminal: sell pad (cash, in-browser card, payment link), check-in, tills, tabs, and capacity with unlimited devices. Check-in scanner product and ticket-purchase kiosk remain separate",
      "Guest park Memberships (multi-venue HQ eligibility + redeem/verify; admin sell & lifecycle billing; guest self-serve, reports & advanced dunning)",
      "Unlimited marketplace booking packages (Connect payouts)",
      "Accounting: double-entry general ledger auto-posted from bookings, POS, memberships, shop and marketplace sales; customers, suppliers, bills, expenses, banking and reconciliation, inventory costing, financial reports, tax, approvals, audit trail and period close",
    ],
    landingHighlights: [
      "Unlimited venues (by agreement)",
      "Enterprise HQ control plane",
      "Memberships, waivers & POS",
      "Unlimited marketplace packages",
      "Dedicated success contact",
    ],
    limits: {
      venues: null,
      members: null,
      roleTemplates: null,
      products: null,
      fabrics: null,
      categories: null,
      tailorSeats: null,
      campaigns: null,
      tailorClients: null,
      ticketsPerMonth: null,
      bookingPackages: null,
      posTerminals: null,
    },
    moduleHints: ["all"],
    stripePriceEnvKey: "STRIPE_PRICE_ENTERPRISE_MONTHLY",
    displayPriceMonthly: null,
    currency: "USD",
    highlighted: false,
    cta: "contact",
  },
] as const;

export const ORG_SUBSCRIPTION_PLANS = SUBSCRIPTION_PLANS.map((p) => p.id);

export type OrgSubscriptionPlan = (typeof ORG_SUBSCRIPTION_PLANS)[number];

export function isSubscriptionPlanId(value: unknown): value is SubscriptionPlanId {
  return (
    typeof value === "string" &&
    ORG_SUBSCRIPTION_PLANS.includes(value as SubscriptionPlanId)
  );
}

export function getSubscriptionPlan(
  id: string | null | undefined
): SubscriptionPlanDefinition | null {
  if (!id) return null;
  const key = id.trim().toLowerCase();
  return SUBSCRIPTION_PLANS.find((p) => p.id === key) ?? null;
}

/**
 * Client-safe moduleHints check (Growth+ Memberships, Starter+ Ticketing, …).
 * Server fail-closed path remains assertModuleEnabled (active + entitled + Demo + storefront).
 */
export function planAllowsModule(
  planId: string | null | undefined,
  moduleId: string
): boolean {
  const plan = getSubscriptionPlan(planId);
  if (!plan) return false;
  return (
    (plan.moduleHints as readonly string[]).includes(moduleId) ||
    plan.moduleHints.includes("all")
  );
}

export function listSubscriptionPlansForUi(): SubscriptionPlanDefinition[] {
  return SUBSCRIPTION_PLANS.map((p) => ({
    ...p,
    limits: { ...p.limits },
    moduleHints: [...p.moduleHints],
  }));
}

export function getPlanLimits(id: string | null | undefined): PlanLimits {
  const plan = getSubscriptionPlan(id) ?? getSubscriptionPlan("starter")!;
  return { ...plan.limits };
}

/** UI helper: API may send MAX_SAFE_INTEGER for unlimited caps.
 * Missing/undefined is NOT unlimited — treat as unknown until the API responds.
 */
export function isUnlimitedPlanCap(n: number | null | undefined): boolean {
  return typeof n === "number" && Number.isFinite(n) && n >= 1e12;
}

/**
 * Selectable Checkout / Billing term lengths (months).
 * Term total = displayPriceMonthly × months (SSOT quote).
 */
export const BILLING_DURATION_OPTIONS = [
  { months: 1, label: "1 month", shortLabel: "1 mo" },
  { months: 2, label: "2 months", shortLabel: "2 mo" },
  { months: 3, label: "3 months", shortLabel: "3 mo" },
  { months: 6, label: "6 months", shortLabel: "6 mo" },
  { months: 12, label: "1 year", shortLabel: "1 yr" },
  { months: 24, label: "2 years", shortLabel: "2 yr" },
  { months: 60, label: "5 years", shortLabel: "5 yr" },
] as const;

export type BillingDurationMonths =
  (typeof BILLING_DURATION_OPTIONS)[number]["months"];

const BILLING_DURATION_MONTHS = new Set<number>(
  BILLING_DURATION_OPTIONS.map((d) => d.months)
);

/** Default / fallback term when client omits duration. */
export const DEFAULT_BILLING_DURATION_MONTHS: BillingDurationMonths = 1;

export function isBillingDurationMonths(
  value: unknown
): value is BillingDurationMonths {
  const n =
    typeof value === "number"
      ? value
      : Number(String(value ?? "").trim());
  return BILLING_DURATION_MONTHS.has(n);
}

export function normalizeBillingDurationMonths(
  raw: unknown
): BillingDurationMonths {
  if (isBillingDurationMonths(raw)) {
    return (typeof raw === "number"
      ? raw
      : Number(String(raw).trim())) as BillingDurationMonths;
  }
  return DEFAULT_BILLING_DURATION_MONTHS;
}

export function billingDurationLabel(months: number): string {
  const hit = BILLING_DURATION_OPTIONS.find((d) => d.months === months);
  return hit?.label ?? `${months} months`;
}

/**
 * Parse Organization.subscriptionInterval (`month` | `year` | `N_month` | `N_year`)
 * back to months. Null if unknown.
 */
export function monthsFromSubscriptionInterval(
  interval: string | null | undefined
): number | null {
  const s = typeof interval === "string" ? interval.trim().toLowerCase() : "";
  if (!s) return null;
  if (s === "month") return 1;
  if (s === "year") return 12;
  const monthMatch = /^(\d+)_month$/.exec(s);
  if (monthMatch) {
    const n = Number(monthMatch[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const yearMatch = /^(\d+)_year$/.exec(s);
  if (yearMatch) {
    const n = Number(yearMatch[1]);
    return Number.isFinite(n) && n > 0 ? n * 12 : null;
  }
  return null;
}

/** Human label for a stored subscriptionInterval (e.g. `12_month` → `1 year`). */
export function formatSubscriptionTermLabel(
  interval: string | null | undefined
): string | null {
  const months = monthsFromSubscriptionInterval(interval);
  if (months != null) return billingDurationLabel(months);
  const raw = typeof interval === "string" ? interval.trim() : "";
  return raw || null;
}

/**
 * Best-effort term months for UI: requested duration, else interval, else 1.
 */
export function resolveBillingDurationMonthsInterest(input: {
  requestedDurationMonths?: number | null;
  subscriptionInterval?: string | null;
}): BillingDurationMonths {
  if (isBillingDurationMonths(input.requestedDurationMonths)) {
    return normalizeBillingDurationMonths(input.requestedDurationMonths);
  }
  const fromInterval = monthsFromSubscriptionInterval(
    input.subscriptionInterval
  );
  if (fromInterval != null && isBillingDurationMonths(fromInterval)) {
    return fromInterval as BillingDurationMonths;
  }
  return DEFAULT_BILLING_DURATION_MONTHS;
}

/**
 * Quote for a plan term in major currency units (UI + Checkout price_data).
 * Null = contact sales / unknown monthly rate.
 */
export function computePlanTermTotalMajor(
  planId: string | null | undefined,
  durationMonths: unknown
): number | null {
  const plan = getSubscriptionPlan(planId);
  if (!plan || plan.displayPriceMonthly == null) return null;
  const months = normalizeBillingDurationMonths(durationMonths);
  return plan.displayPriceMonthly * months;
}

/**
 * Landing / register / billing monthly price label from SSOT.
 * Free (0), Custom (null), or `$199/mo`.
 */
export function formatPlanMonthlyDisplayPrice(
  plan: Pick<SubscriptionPlanDefinition, "displayPriceMonthly" | "cta" | "id">
): { kind: "free" | "custom" | "monthly"; label: string; amount: number | null } {
  if (plan.displayPriceMonthly == null) {
    return { kind: "custom", label: "Custom", amount: null };
  }
  if (plan.displayPriceMonthly === 0 || plan.cta === "demo" || plan.id === "demo") {
    return { kind: "free", label: "Free", amount: 0 };
  }
  return {
    kind: "monthly",
    label: `$${plan.displayPriceMonthly}/mo`,
    amount: plan.displayPriceMonthly,
  };
}

/** Register / landing CTA label for a package. */
export function planRegisterCtaLabel(
  plan: Pick<SubscriptionPlanDefinition, "name" | "cta" | "id">
): string {
  if (plan.cta === "demo" || plan.id === "demo") return "Try Demo";
  if (plan.cta === "contact") return "Contact sales";
  return `Choose ${plan.name}`;
}

/** Stripe recurring shape for a term (year when divisible by 12). */
export function stripeRecurringForDurationMonths(months: number): {
  interval: "month" | "year";
  interval_count: number;
} {
  const m = normalizeBillingDurationMonths(months);
  if (m % 12 === 0) {
    return { interval: "year", interval_count: m / 12 };
  }
  return { interval: "month", interval_count: m };
}

/** Persistable interval label on Organization.subscriptionInterval. */
export function subscriptionIntervalFromDurationMonths(months: number): string {
  const m = normalizeBillingDurationMonths(months);
  if (m === 1) return "month";
  if (m === 12) return "year";
  if (m % 12 === 0) return `${m / 12}_year`;
  return `${m}_month`;
}

export function subscriptionIntervalFromStripeRecurring(
  recurring:
    | { interval?: string | null; interval_count?: number | null }
    | null
    | undefined
): string {
  if (!recurring?.interval) return "month";
  const count =
    typeof recurring.interval_count === "number" &&
    Number.isFinite(recurring.interval_count) &&
    recurring.interval_count > 0
      ? Math.floor(recurring.interval_count)
      : 1;
  if (recurring.interval === "year") {
    return count === 1 ? "year" : `${count}_year`;
  }
  if (recurring.interval === "month") {
    return count === 1 ? "month" : `${count}_month`;
  }
  return String(recurring.interval);
}

/** Optional env Price for a duration: STRIPE_PRICE_STARTER_3M, …; 1m → *_MONTHLY. */
export function stripePriceEnvKeyForDuration(
  planId: string,
  durationMonths: number
): string {
  const id = planId.trim().toUpperCase();
  const months = normalizeBillingDurationMonths(durationMonths);
  if (months === 1) return `STRIPE_PRICE_${id}_MONTHLY`;
  return `STRIPE_PRICE_${id}_${months}M`;
}

export function resolveStripePriceId(
  id: string | null | undefined
): string | null {
  const plan = getSubscriptionPlan(id);
  if (!plan) return null;
  const raw = process.env[plan.stripePriceEnvKey]?.trim();
  return raw || null;
}

/**
 * Prefer duration-specific Price env; fall back to monthly Price only for 1 month.
 * Multi-month without a Price → null (caller uses price_data from term total).
 */
export function resolveStripePriceIdForDuration(
  planId: string | null | undefined,
  durationMonths: unknown
): string | null {
  const plan = getSubscriptionPlan(planId);
  if (!plan) return null;
  const months = normalizeBillingDurationMonths(durationMonths);
  const durationKey = stripePriceEnvKeyForDuration(plan.id, months);
  const durationPrice = process.env[durationKey]?.trim();
  if (durationPrice) return durationPrice;
  if (months === 1) return resolveStripePriceId(plan.id);
  return null;
}

/** Reverse-map a Stripe Price id to a plan using env values (monthly + duration). */
export function mapStripePriceIdToPlan(
  priceId: string | null | undefined
): SubscriptionPlanId | null {
  const id = typeof priceId === "string" ? priceId.trim() : "";
  if (!id) return null;
  for (const plan of SUBSCRIPTION_PLANS) {
    const envPrice = process.env[plan.stripePriceEnvKey]?.trim();
    if (envPrice && envPrice === id) return plan.id;
    for (const d of BILLING_DURATION_OPTIONS) {
      if (d.months === 1) continue;
      const key = stripePriceEnvKeyForDuration(plan.id, d.months);
      const p = process.env[key]?.trim();
      if (p && p === id) return plan.id;
    }
  }
  return null;
}

/** Ops / grant window: calendar months from `from`. */
export function subscriptionEndsAtAfterMonths(
  months: unknown,
  from: Date = new Date()
): Date {
  const m = normalizeBillingDurationMonths(months);
  const ends = new Date(from.getTime());
  ends.setUTCMonth(ends.getUTCMonth() + m);
  return ends;
}

/**
 * Whether self-serve Checkout can start for this package.
 * Demo always; paid plans when a Stripe Price exists or displayPriceMonthly
 * can drive inline price_data; Enterprise contact without either stays sales-only.
 */
export function isPlanCheckoutAvailable(
  planId: string | null | undefined
): boolean {
  const plan = getSubscriptionPlan(planId);
  if (!plan) return false;
  if (isDemoPlanId(plan.id)) return true;
  if (resolveStripePriceId(plan.id)) return true;
  if (plan.displayPriceMonthly != null && plan.displayPriceMonthly >= 0) {
    return plan.cta !== "contact" || Boolean(resolveStripePriceId(plan.id));
  }
  return false;
}

/** Term totals (major units) for UI duration pickers. */
export function billingDurationQuotesForPlan(
  planId: string | null | undefined
): Array<{
  months: BillingDurationMonths;
  label: string;
  shortLabel: string;
  totalMajor: number | null;
}> {
  return BILLING_DURATION_OPTIONS.map((d) => ({
    months: d.months,
    label: d.label,
    shortLabel: d.shortLabel,
    totalMajor: computePlanTermTotalMajor(planId, d.months),
  }));
}

export function enterpriseContactHref(): string {
  const email =
    process.env.PLATFORM_SUPPORT_EMAIL?.trim() ||
    process.env.ADMIN_EMAIL?.trim()?.replace(/^["']|["']$/g, "") ||
    "admin@fecsync.com";
  return `mailto:${email}?subject=${encodeURIComponent("FECSYNC Enterprise plan")}`;
}

/** Valid package ids joined for API / form error copy. */
export function subscriptionPlanIdsLabel(): string {
  return ORG_SUBSCRIPTION_PLANS.join(", ");
}

export function isDemoPlanId(value: unknown): boolean {
  return value === "demo";
}

/** Demo trial window (days). Env `COMPANY_DEMO_DAYS`, default 30 (one month). */
export function demoSubscriptionEndsAt(from: Date = new Date()): Date {
  const raw = Number(process.env.COMPANY_DEMO_DAYS || "30");
  const days =
    Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 90) : 30;
  const ends = new Date(from.getTime());
  ends.setUTCDate(ends.getUTCDate() + days);
  return ends;
}

export function formatPlanDisplayName(id: string | null | undefined): string {
  const plan = getSubscriptionPlan(id);
  if (plan) return plan.name;
  if (!id?.trim()) return "—";
  return id.trim();
}
