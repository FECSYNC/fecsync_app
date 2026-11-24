/**
 * Guest park Memberships how-to steps — kept out of AdminHowToGuideModal so
 * memberships page chunks do not pull every other admin tutorial (~146KB).
 */
export type MembershipsGuideStep = {
  title: string;
  body: string;
  href?: string;
  hrefLabel?: string;
};

export const MEMBERSHIPS_PLANS_GUIDE_STEPS: MembershipsGuideStep[] = [
  {
    title: 'What Memberships Plans is for',
    body: 'This is the guest park membership plan catalog — season passes, recurring memberships, and fixed-term plans for visitors. It is NOT staff Users & permissions (company seats).\n\nWho can use it: Growth or Enterprise entitled companies with memberships:read (view) / memberships:write (create/edit/archive). Demo and Starter stay locked; storefront FECSYNC host never sells park memberships.\n\nPhases 1–5 are live: sell / renew / lifecycle billing under Members; Redeem / verify under Redeem desk (memberships:redeem required to open and operate); guests under Profile → Memberships; staff reports + dunning under Memberships → Reports. Apple/Google Wallet signed passes are not shipped (API always not_configured — on-screen QR / print card still work).',
    href: '/admin/billing',
    hrefLabel: 'Open Billing (upgrade)',
  },
  {
    title: 'Create or edit a plan',
    body: 'Name — guest-facing title.\n\nMembership category — optional folder from Memberships → Membership categories (separate from shop Catalog categories).\n\nBilling — recurring (interval count + unit) or fixed (one period).\n\nPrice + currency — catalog amount charged at sell (Stripe when configured; collected/pending honesty without it).\n\nEntitlements — optional entries/visits, discount %, guest count, perk flags, free product refs (JSON-backed; enforced by entitlementEngine at redeem).\n\nFamily / upgrade group / agreement / pause — used by sell & lifecycle (upgradeGroupKey gates pro-rata; pauseAllowed for pause).\n\nSave creates or updates under your company org only. Archive soft-hides from active sell pickers (no hard-delete while history may reference later).',
    href: '/admin/memberships/categories',
    hrefLabel: 'Open Membership categories',
  },
  {
    title: 'Recommended first-time path',
    body: '1) Confirm Growth+ in Billing (or ops Set plan).\n2) Create at least one Venue under Venues.\n3) Create a recurring monthly plan with a clear name + price (set upgradeGroupKey if you plan upgrades).\n4) Open Eligibility — mark parks eligible and save.\n5) Open Settings — set org defaults (photo/agreement/dunning/pause/wallet; past_due redeem policy; click-to-cancel / cancel alternatives).\n6) Open Members — create a GuestProfile (needs memberships:write), then Sell with memberships:sell.\n7) Open Redeem desk — verify benefits and redeem visits (memberships:redeem).\n8) Tell guests to link via Profile → Memberships; check Reports for sold/active/churn.',
    href: '/admin/memberships/redeem',
    hrefLabel: 'Open Redeem desk',
  },
];

export const MEMBERSHIPS_ELIGIBILITY_GUIDE_STEPS: MembershipsGuideStep[] = [
  {
    title: 'What Eligibility is for',
    body: 'Plan × park matrix: which venues a membership plan may redeem at, plus optional local perk add/remove overrides.\n\nSoft-archived parks are omitted — archive clears eligibility for that park so redeem cannot point at a closed venue.\n\nEnterprise HQ may manage cross-park eligibility; Growth still configures rows. Redeem enforces CURRENT / VISITING / INELIGIBLE from these rows. HQ rollup KPIs stay Enterprise-only.',
    href: '/admin/memberships/plans',
    hrefLabel: 'Open Plans',
  },
  {
    title: 'How to edit the matrix',
    body: '1) Pick a plan.\n2) Check Eligible for each active park that should honor the plan.\n3) When eligible, optionally add comma-separated local perk flags to add or remove vs the plan base.\n4) Save — replaces the matrix for that plan (active parks only).\n\nRedeem at an eligible non-home park shows VISITING and applies local perk overrides. Missing or ineligible rows → INELIGIBLE (fail-closed).',
  },
];

export const MEMBERSHIPS_SETTINGS_GUIDE_STEPS: MembershipsGuideStep[] = [
  {
    title: 'What Memberships Settings is for',
    body: 'Org-default or per-venue overrides for guest membership policy: photo on redeem, agreement before active, dunning/click-to-cancel/pause toggles, cancel alternatives (beta), grace days, wallet pass flag, allow past_due redeem, default home venue.\n\nLive now: smart + Enterprise advanced dunning, pause (beta), agreement gate before active, click-to-cancel guest UX (Profile → Memberships), cancel alternatives config panel, wallet honesty (signed passes not shipped — API always not_configured), past_due redeem policy. Venue scope uses the park filter / venue picker (active parks only).',
    href: '/admin/memberships/redeem',
    hrefLabel: 'Open Redeem desk',
  },
  {
    title: 'Org default vs per-venue',
    body: 'Venue scope = Org default applies company-wide until a park override exists. Opening a park with no saved row shows that company default (inherited). Saving stores a park copy.\n\nDefault home venue prefills Home venue on Create member until you change it, and POS product upgrades use it when no home park is passed.\n\nGrace days left blank uses 7 — the same fallback billing, dunning, and guest cancel use.\n\nWallet pass enabled only advertises intent — Apple/Google Wallet signed-pass issuance (.pkpass / Google JWT) is not implemented yet, so the API always returns not_configured. Env cert keys alone never report ready. On-screen QR / print card still work.\n\nArchiving a venue clears its override settings and home-venue pointers.',
  },
];

export const MEMBERSHIPS_MEMBERS_GUIDE_STEPS: MembershipsGuideStep[] = [
  {
    title: 'What Members is for',
    body: 'Guest park memberships lifecycle (Feature 08):\n• Members page shows a roster table of all memberships (desk / POS / online). Click Create member to open the modal (guest profile + sell/assign plan).\n• Optional dashboard password on create — staff can set a temporary password and email login details; leave blank to use set-password invite after sell / Invite dashboard.\n• Guest CRM appears when a membership is opened — invite dashboard access, status, visits.\n• Member detail — renew, pro-rata upgrade/downgrade, pause/resume, cancel, reactivate, apply credit, update card, photo/custom ID, family links (beta), in-person agreement sign.\n\nNeeds memberships:write to create guests, memberships:sell to sell/renew, memberships:billing for money ops, memberships:cancel for cancel. Guests self-serve under Profile → Memberships.',
    href: '/admin/memberships/redeem',
    hrefLabel: 'Open Redeem desk',
  },
  {
    title: 'Past due & honesty',
    body: 'Failed recurring invoices mark past_due and run smart dunning (retries via daily cron; Enterprise uses a longer schedule + finance escalation). Without STRIPE_SECRET_KEY, use collected/pending — never a fake silent recurring success.\n\nGuests can update card / renew / cancel online when linked. Staff reports (sold/active/churn/past_due/failed payments) are under Memberships → Reports.',
  },
];

export const MEMBERSHIPS_REDEEM_GUIDE_STEPS: MembershipsGuideStep[] = [
  {
    title: 'What the Redeem desk is for',
    body: 'Verify member benefits and redeem visits/perks at the acting venue.\n\nNeeds memberships:redeem (or admin). Search by custom membership ID / barcode / id, pick the acting park, Verify — then redeem. Family/group partial redeem is labeled beta.\n\nStatus labels: CURRENT (home), VISITING (eligible non-home), INELIGIBLE (blocked). Visit exhaustion does not remove discounts/perks.',
    href: '/admin/memberships/eligibility',
    hrefLabel: 'Open Eligibility',
  },
  {
    title: 'Redeem workflow',
    body: '1) Enter custom ID or code + acting venue → Verify.\n2) Confirm photo, remaining visits, visit label, and perks.\n3) For family plans, select which guests consume (shared pool).\n4) Redeem visit — writes MembershipUsageEvent via entitlementEngine (same math POS/Check-In adapters call).\n5) Undo last redeem when needed. Print card / on-screen QR always available. Digital wallet button returns honest not_configured until signed-pass issuance ships.',
  },
];

export const MEMBERSHIPS_REPORTS_GUIDE_STEPS: MembershipsGuideStep[] = [
  {
    title: 'Pick a range and park',
    body: 'Choose From / To dates (max 366 days) and optionally a park. Park-locked seats only see their assigned parks. Enterprise companies can tick HQ rollup to count every park.',
  },
  {
    title: 'Read the KPIs',
    body: 'Sold and Cancelled count memberships created / cancelled inside the range. Active and Past due are current snapshots. Failed payments sums failed payment attempts in the range. All numbers come straight from membership records.',
  },
  {
    title: 'Work the dunning queue',
    body: 'Past-due members are listed with failure count and next retry. Standard dunning retries on days 0/3/5/7; Enterprise uses the extended schedule and emails finance seats from the 4th failure. Open Members to collect payment or renew.',
    href: '/admin/memberships/members',
    hrefLabel: 'Open Members',
  },
];

export const MEMBERSHIPS_CATEGORIES_GUIDE_STEPS: MembershipsGuideStep[] = [
  {
    title: 'What this is',
    body: 'Membership categories are folders for guest park membership plans only. They are separate from Catalog product categories (Food sales) and Online Booking → Booking category (ticket products).',
    href: '/admin/memberships/plans',
    hrefLabel: 'Open Create plan',
  },
  {
    title: 'Create a category',
    body: 'Add a short name (and optional description). A public link is created once from that name. Renaming later does not change the link. The Copy button in the Actions column copies either the public link or the iframe embed, for anyone who can read membership categories. Writers use the Public link button in the Actions column to change the public slug, layout, and embed flag. Then assign the category when creating or editing a plan under Create plan.',
  },
  {
    title: 'Archive safely',
    body: 'Archiving unlinks the category from plans so those plans stay sellable. The public page for that category becomes inactive in the same step. Recreate with the same name to restore the folder and turn that same public link back on.',
  },
];
