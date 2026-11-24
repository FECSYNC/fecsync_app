/**
 * Venues how-to steps — kept out of AdminHowToGuideModal so the Venues page
 * chunk does not pull every other admin tutorial (~146KB).
 */
export type VenuesGuideStep = {
  title: string;
  body: string;
  href?: string;
  hrefLabel?: string;
};

export const VENUES_GUIDE_STEPS: VenuesGuideStep[] = [
  {
    title: 'What Venues is for',
    body: 'Venues are parks, sites, and locations under THIS company (VenueLocation). Plan meter resource: venues.\n\nWho uses this page: company admins with venue write permission (sidebar → Venues). Park-locked seats can edit assigned venues but cannot create, archive, or restore.\n\nWhy create them:\n• Stamp ticket products, bookings, sessions, and future modules to a park (orgId + locationId).\n• Park-lock staff seats under Users & permissions.\n• Enterprise HQ / header park switcher filters lists to one venue.\n• Public online booking path /book/{slug} when published.\n\nSoft-archive (Delete) frees the venues quota without deleting history — Restore later via Show archived.',
    href: '/admin/users',
    hrefLabel: 'Users & permissions (park-lock seats)',
  },
  {
    title: 'Plan quota & who can create',
    body: 'Plan usage line under Add venue — used / limit / remaining (or unlimited).\n\nAt limit — Create is blocked until you soft-archive a venue or upgrade in Billing.\n\nNot entitled — subscribe in Billing (or ask FECSYNC for an ops plan stamp) before creates unlock.\n\nPark-locked actors — no Add venue form; ask a company-wide admin.\n\nDemo plan may lock most admin apps; Venues follows demo / entitlement rules like other company apps.',
    href: '/admin/billing',
    hrefLabel: 'Open Billing',
  },
  {
    title: 'Add venue — each field',
    body: 'Venue name * — display name (e.g. Downtown Trampoline Park). Min 2 characters.\n\nURL slug — auto from name until you edit. Public path preview: /book/{slug}. Reset from name undoes a manual slug.\n\nCity — search suggestions (type 2+ letters) or Use my location (GPS if allowed, else network).\n\nTimezone — IANA zone (browser may prefill). Filter box narrows the list; picking a city often sets timezone too.\n\nFranchise park — optional checkbox. Marks this VenueLocation as a franchise unit under THIS company (not a second company or second SaaS subscription). Franchise managers invite park-local staff later under Users.\n\nCreate venue — new Active row appears in Locations immediately; meters refresh.\n\nPreview: table shows name, /slug, /book/… path, status Active, city/timezone, Online booking Off until you Publish, plus Franchise park when marked.',
  },
  {
    title: 'Franchise parks (same company)',
    body: 'A franchise park is still one VenueLocation under your Organization. Company Billing, company profile, and plan meters (venues + members) stay company-wide.\n\nCompany-wide admins: mark Franchise park on create/edit, then under Users assign that park and enable Franchise park manager on a park-locked seat.\n\nFranchise park managers: invite and manage staff only inside their assigned parks; park-local roster; may edit franchise support phone/email/display fields on their franchise parks. They cannot open Billing, company profile, create/archive venues, or grant company-wide authority.\n\nPark payouts: open Park payouts (or /admin/payouts?locationId=…) to complete Stripe Connect for that franchise park. Guest card money settles to the park Connect account when charge-ready. SaaS software billing stays under Billing (company-wide only).',
    href: '/admin/users',
    hrefLabel: 'Users & permissions (franchise managers)',
  },
  {
    title: 'Locations list — reading the preview',
    body: '# — row number in the current filtered list.\n\nVenue — name, mono slug, and book path when available.\n\nStatus — Active (counts toward plan) or Archived (soft-deleted; hidden unless Show archived).\n\nCity / timezone — place fields used for scheduling and display.\n\nOnline booking — Published (public wizard can list this venue) or Off. Franchise park badge when marked.\n\nShow archived — checkbox (company-wide admins) to list soft-deleted venues for Restore.\n\nHeader park filter — when a park is selected, this list narrows to that venue; park-stamped modules follow the same scope. Members roster stays company-wide (franchise managers see a park-local roster on Users).',
  },
  {
    title: 'Actions menu — Edit, Publish, links',
    body: 'Edit — opens modal: Name, Slug, Address line 1 (optional), City & timezone, Publish for online booking, Franchise park flag, and franchise profile fields (display name, support phone/email, code, notes). Save updates the row everywhere.\n\nPublish / Unpublish — toggles publicBookingEnabled. Publish does NOT publish catalog products; those stay separate on Ticket products / sessions.\n\nCopy slug — clipboard for URLs and integrations.\n\nCopy book link / Open booking — only when Published; opens /book/{slug} for guests.\n\nGuest preview after Publish: public booking wizard can list this venue; products must still be published and attached to the venue.',
  },
  {
    title: 'Delete (soft-archive) & Restore',
    body: 'Delete — confirm soft-archive. Venue leaves the Active list, frees one venues quota slot, history kept. Not a hard-delete.\n\nShow archived → Restore — brings it back Active if plan room allows (blocked at venues limit).\n\nPark-locked seats cannot Delete or Restore.\n\nUse archive when a site closes seasonally or you need quota for a new park — not for temporary hide of booking (use Unpublish instead).',
  },
  {
    title: 'Where a venue is used next',
    body: 'Ticket products / sessions / add-ons / passes / resources — attach or stamp locationId so sales and capacity belong to that park.\n\nBookings & calendar — park-scoped when a venue is selected.\n\nUsers & permissions — Park venues checklist to park-lock a seat to one or more locations.\n\nEnterprise HQ (/admin/hq) — cross-park dashboard + header venue switcher (entitled Enterprise). Selecting a park filters venue lists and park-stamped modules; rollups/meters and members stay company-wide.\n\nPublic guests — /book/{slug} when Online booking is Published.',
    href: '/admin/ticketing',
    hrefLabel: 'Open Ticket products',
  },
  {
    title: 'Scope & Enterprise HQ (quick rules)',
    body: 'All locations — full company venue list (default).\n\nOne park selected in header — venues list + park-stamped ticketing/bookings filter to that park.\n\nPark-locked seat — only assigned venues (narrowed further if a park is selected).\n\nMembers roster and plan meters stay company-wide even when a park is selected.\n\nNeed the HQ switcher? Enterprise entitled → /admin/hq, or upgrade in Billing.',
    href: '/admin/hq',
    hrefLabel: 'Open Enterprise HQ',
  },
  {
    title: 'Recommended first-time path',
    body: '1) Confirm Billing entitlement and venues remaining on the plan meter.\n2) Add venue — name, check slug, set city/timezone (or Use my location).\n3) Create venue → confirm Active row in Locations.\n4) Actions → Edit address if needed → Publish when ready for guests.\n5) Create Ticket products stamped to this venue; publish those products.\n6) (Optional) Invite park-locked staff with this venue checked under Users.\n7) Guest check: Open booking from Actions — wizard shows the park when Published.\n8) Later: Unpublish to hide booking, or Delete (archive) to free quota.',
  },
];
