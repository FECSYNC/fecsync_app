# Guest Marketing Automation — one Cursor prompt

This pack covers the client FECSYNC ask: newsletter lead capture without a waiver, welcome emails for first-time visitors, birthday campaigns that drive party bookings, failed-payment and membership renewal reminders, waiver expiration reminders, post-visit surveys and promotions, and re-engagement emails for inactive guests.

Paste **Prompt 1** into Cursor and let it run from start to finish. After that run finishes, paste **Prompt 2**. Do not split Prompt 1 into smaller steps. Do not skip the follow-up.

Related SSOT you must obey while implementing: `.cursor/rules/saas-venue-platform.mdc`, `.cursor/rules/customer-vs-tailor-sections.mdc`, `docs/saas-module-extension.md`, `docs/enterprise-hq-controls.md`, `docs/guest-crm-complete-spec.md` (GuestProfile hub and consent vocabulary — extend, do not fork), `docs/memberships-complete-spec.md`, `docs/digital-waivers-complete-spec.md`, `docs/fec-os-cursor-feature-catalog.md` Features 09, 24, 25, and 27, `src/lib/subscriptionPlans.ts`, and `README.md` honesty.

---

## Prompt 1

```
You are implementing one complete feature in this multi-tenant venue SaaS: Guest Marketing Automation for FECSYNC company parks. Do the whole feature in this single run. Do not stop after a foundation slice. Do not leave newsletter capture, welcome emails, birthday campaigns, membership payment reminders, waiver expiry reminders, post-visit surveys, re-engagement emails, admin settings, cron jobs, permissions, smokes, or cross-module sync for a later step.

Before you change anything, scan and analyze this project. Read the real files. Write down what already exists versus what you must add, fix, reconnect, or extend. Prove each finding with file paths. Match the code style, permission checks, org stamping, demo lock, park scope, mailer patterns, cron Bearer CRON_SECRET patterns, and module entitlement patterns already here. Do not invent a second Organization, a second GuestProfile table, a second Membership model for park guests, a second waiver engine, a second Stripe SaaS customer, a second /venue admin app, or a parallel email directory. Do not reopen /signup or POST /api/auth/signup. Do not put operator marketing tools on fashion /profile or on /tailor/*. Do not fake-complete live Campaign Monitor, T2 Connect, Salesforce, ROLLER Connect, or Patch Retention sync — those stay honest not_configured stubs if settings mention them. Do not claim Access Control, Loyalty, Dynamic Pricing, full Reporting UI, check-in scanner product, or ticket-purchase kiosk are complete because marketing automation was added.

Product rules you must obey for this whole run:

Organization is the paying company workspace. VenueLocation is a park under that company. Staff Membership is an org seat, never a park guest. GuestProfile is the single park guest identity hub. DEFAULT_ORG / isDefault is the public Harewa storefront and never gets park marketing operator tools and is never locked by tenant expiry for storefront catalog. Demo plan locks company apps except dashboard, company profile, and billing — Guest Marketing Automation stays Demo-locked. Public self-registration stays /register-company only. Stamp actor.orgId from the session. Never trust client orgId, locationId, userId, guestProfileId, or membershipId as authority. When locationId is used, assert the venue belongs to actor.orgId. Park-locked seats use MembershipVenueAssignment and actorLocationScope. Enterprise HQ cross-venue marketing rollups require assertEnterpriseHqEnabled and must not leak to non-Enterprise. Marketing promotional sends require explicit marketing email opt-in. Transactional operational emails already used by memberships dunning and waiver expiry may continue under their existing rules, but every new promotional automation must respect consent. Postgres RLS stays deferred.

Client outcomes that must all work when you finish:

Brand awareness newsletter signup that gathers contacts without requiring a waiver signature.
Welcome emails that automate outreach to first-time visitors so they can visit the company website or catalog for other products.
Birthday campaigns that drive more party bookings.
Failed payment and membership renewal reminders that reduce churn.
Waiver expiration reminders that keep guests visit-ready.
Post-visit surveys and promotions that boost repeat visits.
Re-engagement emails that bring inactive guests back.

Start the scan with these files and follow every import they use. Also search the repo for every reader and writer of GuestProfile, GuestMembership, WaiverRecord, Booking, PosSale, mailer sends, CRON_SECRET crons, moduleEntitlement, adminNav, companyExport, and hqOverview so call sites stay in sync.

docs/guest-crm-complete-spec.md
docs/memberships-complete-spec.md
docs/digital-waivers-complete-spec.md
docs/saas-module-extension.md
docs/enterprise-hq-controls.md
docs/fec-os-cursor-feature-catalog.md Features 09, 24, 25, 27
.cursor/rules/saas-venue-platform.mdc
.cursor/rules/customer-vs-tailor-sections.mdc
README.md module entitlement and residual backlog honesty
package.json smoke script section
prisma/schema.prisma models Organization, VenueLocation, Membership, MembershipVenueAssignment, GuestProfile, GuestBan, GuestMembership, MembershipPlan, MembershipPaymentAttempt, MembershipSettings, WaiverTemplate, WaiverRecord, WaiverSettings, WaiverReminderWatermark, Booking, BookingPayment, AdmissionProduct, BookingPackage, PosSale, CheckInEvent if present, FormResponse if present, Notification, ActivityLog enums
src/lib/subscriptionPlans.ts including SHIPPED_MODULE_HINT_IDS, moduleHints, FuturePlanModules.guestSurveys
src/lib/moduleEntitlement.ts and assertModuleEnabled
src/lib/demoPlanLock.ts
src/lib/demoPlanAssert.ts
src/lib/parkAdminScope.ts
src/lib/actorLocationScope.ts
src/lib/staffOrg.ts
src/lib/auth/permissions.ts including API_PERMISSIONS and ADMIN_ROUTE_PERMISSIONS or ADMIN_PAGES patterns
src/lib/adminNav.ts
src/lib/companyExport.ts
src/lib/hqOverview.ts
src/lib/mailer.ts especially sendWelcomeEmail, sendWaiverGuestEmail, wrapEmailHtml, brand helpers
src/lib/sms.ts
src/lib/publicAppBaseUrl.ts
src/lib/rateLimit.ts
src/lib/memberships/dunning.ts
src/lib/memberships/mail.ts
src/lib/memberships/billingEngine.ts
src/lib/waivers/remindExpiring.ts
src/lib/waivers/expiry.ts
src/lib/waivers/common.ts
src/app/api/cron/memberships-dunning/route.ts
src/app/api/cron/waivers-remind/route.ts
src/app/api/cron/remind-company-subscriptions/route.ts
src/app/api/auth/verify/route.ts
src/components/Public_C/venueflow/VenueFlowLandingBelow.tsx newsletter form
src/components/Public_C/venueflow/VenueFlowHeader.tsx surveys roadmap links
src/app/(public)/privacy/page.tsx marketing consent copy
any existing src/lib/guests/** if present
any existing /admin/guests* pages or /api/admin/guests* routes if present
src/lib/publicCategory/ and company category pages for party booking CTAs
src/utils/invalidateMembershipsQueries.ts
src/utils/invalidateTicketingQueries.ts
src/utils/invalidateOrgSaasQueries.ts

After the scan, implement everything below in this same run. Prefer extend over duplicate. If GuestProfile already exists, extend it. If memberships dunning and waiver reminders already work, keep them as the SSOT for those two client bullets, harden templates and settings so operators can configure them from the new Marketing admin surface when useful, and do not rebuild a second dunning or second waiver remind engine. If Guest CRM admin shells from docs/guest-crm-complete-spec.md are incomplete, build the minimum GuestProfile upsert, consent, and segment query substrate this marketing epic needs under src/lib/guests/** and admin marketing screens — still one GuestProfile hub, never a second ParkContact table.

================================================================================
MODULE ENTITLEMENT, PLANS, PERMISSIONS, NAV
================================================================================

Create or extend assertModuleEnabled so marketing automation is enforced. Use module id "marketing" for the Automated Email / SMS + surveys ops surface, and keep sibling module gates for "memberships" and "waivers" on the existing reminder engines. Add "marketing" to Growth moduleHints and keep Enterprise "all". Add "marketing" to SHIPPED_MODULE_HINT_IDS when the feature is live. Starter and Demo fail closed for marketing admin apps and promotional sends. Storefront DEFAULT_ORG fails closed. Unpaid, pending, and suspended orgs fail closed through existing billing entitlement checks before module checks.

Add and wire Fresh permission bits consistent with repo style, for example:
marketing:read
marketing:write
marketing:send
marketing:surveys
marketing:export

Map Owner / GM / Manager presets to broader access. Front desk may get read only if that matches existing preset patterns. Register every new API path in API_PERMISSIONS. Register every new admin page in ADMIN_ROUTE_PERMISSIONS or the repo’s ADMIN_PAGES pattern.

Add a Marketing group to src/lib/adminNav.ts filtered by these permissions, with leaves at least:
Marketing overview or Automations at /admin/marketing
Newsletter / leads at /admin/marketing/newsletter
Automations / templates at /admin/marketing/automations
Surveys at /admin/marketing/surveys
Settings at /admin/marketing/settings

Do not link Marketing primary nav to fashion /profile, /tailors, or /trending-fashion. Header Store may still open /home for shopping. Keep customer vs tailor vs company admin surfaces separate.

================================================================================
DATA MODEL — PRISMA MIGRATION REQUIRED
================================================================================

Add a Prisma migration. Every new park business row needs orgId required and indexed, FK Organization. Park-scoped rows use optional or required locationId FK VenueLocation with venue.orgId === orgId enforced in libs. Extend ActivityEntityType and NotificationType as needed for marketing_send, marketing_lead, survey_response, automation_run, and similar.

Extend GuestProfile if columns are missing:
marketingEmailOptIn Boolean default false
marketingSmsOptIn Boolean default false
marketingOptInAt DateTime?
marketingOptInSource String?
newsletterSubscribedAt DateTime?
firstVisitAt DateTime?
lastVisitAt DateTime?
lastMarketingEmailAt DateTime?
welcomeEmailSentAt DateTime?
dateOfBirth already exists — keep and index orgId + dateOfBirth if missing
mergedIntoId / erasedAt only if Guest CRM already introduced them; do not invent a conflicting merge system in this epic unless needed for send safety

Optional but preferred consent table if you do not want only columns:
GuestMarketingConsent with orgId, guestProfileId, channel email or sms, optedIn, source, capturedAt, updatedAt, unique orgId + guestProfileId + channel

Create MarketingAutomationSettings one row per org optional location override:
orgId, locationId nullable for org default
newsletterEnabled
welcomeEnabled
birthdayEnabled
reengagementEnabled
postVisitSurveyEnabled
membershipReminderUiNote or link-only to memberships settings — do not duplicate dunning schedule SSOT
waiverReminderUiNote or link-only to waiver settings — do not duplicate waiver remind windows SSOT
welcomeDelayHours
birthdayDaysAhead
reengagementInactiveDays
postVisitDelayHours
fromName, replyToEmail optional
partyBookingCtaPath or category slug fields for birthday CTA
websiteCtaUrl for welcome CTA
promoCodeOrUrl for survey thank-you promo optional
unsubscribeFooterRequired always true for promotional templates

Create MarketingAutomationTemplate rows or JSON templates keyed by kind:
newsletter_confirm optional
welcome
birthday
reengagement
post_visit_survey_invite
survey_thank_you
failed_payment_reminder display override optional — prefer calling memberships mail templates
waiver_expiry display override optional — prefer calling waiver mailer

Create MarketingLeadCapture or reuse GuestProfile only:
Public newsletter creates or upserts GuestProfile with marketingEmailOptIn true and source newsletter. Never create a fashion shop User. Never require a WaiverRecord.

Create MarketingSendLog:
orgId, locationId?, guestProfileId?, toEmail, kind, automationKey, providerMessageId?, status sent or skipped or failed, skipReason?, templateKey?, metadata Json, createdAt
Indexes orgId + kind + createdAt, orgId + guestProfileId + kind

Create MarketingAutomationRun watermark table if needed so cron is idempotent per guest per kind per window:
orgId, guestProfileId, kind, windowKey, sentAt unique orgId + guestProfileId + kind + windowKey

Create GuestSurvey:
orgId, locationId?, name, slug, status draft or published or archived, questions Json, thankYouMessage, promoUrl?, createdById, createdAt, updatedAt

Create GuestSurveyInvite:
orgId, surveyId, guestProfileId, bookingId?, visitRef?, token unique, sentAt?, openedAt?, completedAt?, expiresAt?

Create GuestSurveyResponse:
orgId, surveyId, inviteId?, guestProfileId?, answers Json, rating?, comment?, createdAt
Indexes orgId + surveyId + createdAt

Do not reuse fashion shop Order as park visit. Do not reuse TailorClient or CampaignParticipant as park leads. Do not reuse UserBlacklist as marketing suppression — use consent + erased/banned guest rules.

================================================================================
LIBRARIES UNDER src/lib/marketing/** AND src/lib/guests/**
================================================================================

Create src/lib/marketing/assert.ts with assertMarketingEnabled wrapping assertModuleEnabled("marketing").
Create src/lib/marketing/types.ts with automation kinds and DTOs.
Create src/lib/marketing/consent.ts — read/write opt-in; default unset is not opted-in for promotional sends.
Create src/lib/marketing/upsertLead.ts — upsert GuestProfile by org email then phone; set marketing opt-in; never require waiver.
Create src/lib/marketing/templates.ts — render branded HTML via existing wrapEmailHtml / mailer brand helpers; escape all guest and org fields.
Create src/lib/marketing/send.ts — single send helper: check entitlement, consent for promotional kinds, banned/erased skip, rate limits, write MarketingSendLog, call mailer, optional SMS only when sms configured and SMS opted in.
Create src/lib/marketing/automations/welcome.ts — first-time visitor welcome.
Create src/lib/marketing/automations/birthday.ts — upcoming birthday → party booking CTA.
Create src/lib/marketing/automations/reengagement.ts — inactive guests.
Create src/lib/marketing/automations/postVisitSurvey.ts — schedule survey invite after visit.
Create src/lib/marketing/automations/runAll.ts — cron orchestrator calling each automation with caps.
Create src/lib/marketing/surveys.ts — CRUD surveys, create invite tokens, submit responses, list responses for admin.
Create src/lib/marketing/segments.ts — query helpers for birthday window, lapsed since lastVisitAt or last sale/booking/check-in, opted-in only, not banned, not erased.
Create src/lib/marketing/membershipBridge.ts — read-only bridge into memberships dunning status for Marketing overview honesty; do not fork dunning.
Create src/lib/marketing/waiverBridge.ts — read-only bridge into waiver remind settings and recent watermark counts; do not fork waiver remind.
Create src/lib/guests/upsertFromChannel.ts if missing — channel newsletter | booking | waiver | pos | survey | manual shared by siblings.
Create src/lib/guests/visitTouch.ts if missing — update firstVisitAt / lastVisitAt when booking completes, POS sale completes, check-in exists, or waiver signed for a visit — wire into existing completion paths discovered in the scan without breaking those modules.

Mailer: extend src/lib/mailer.ts with sendMarketingGuestEmail and any survey invite helpers that reuse wrapEmailHtml and org brand tokens. Do not confuse sendWelcomeEmail used by auth/verify fashion account verify with park marketing welcome — keep both names honest. Park marketing welcome must be a distinct function or clearly parameterized so auth verify behavior does not change.

================================================================================
PUBLIC NEWSLETTER / LEAD CAPTURE WITHOUT WAIVER
================================================================================

Build a real public newsletter subscribe path for registered companies, not the fake FECSYNC landing form alone.

Required public API:
POST /api/public/marketing/newsletter
Body: orgSlug or venueSlug, email, optional firstName, lastName, phone, dateOfBirth, locationId when multi-park, consent true required
Rate-limit heavily. Resolve org from slug. Reject DEFAULT_ORG storefront, Demo, pending, suspended, marketing module disabled. Require explicit consent true. Upsert GuestProfile with marketingEmailOptIn true, newsletterSubscribedAt now, source newsletter. Do not create WaiverRecord. Do not create shop User. Do not send password links. Optionally send a double-opt-in or simple thank-you email if settings require it; if double opt-in is too heavy, document single opt-in with consent checkbox and privacy link.

Public UI surfaces to wire:
Company-facing embeddable or page snippet staff can copy from /admin/marketing/newsletter, for example /{orgSlug}/newsletter or a fragment used on company category pages / company site.
If VenueFlowLandingBelow newsletter remains platform marketing for FECSYNC itself, either leave it platform-only and clearly not park CRM, or stop claiming it saves contacts — do not pretend the platform landing form writes GuestProfile for tenant parks.

Privacy: ensure privacy copy remains accurate that marketing needs consent. Do not weaken GDPR expectations.

================================================================================
WELCOME EMAILS — FIRST-TIME VISITORS
================================================================================

Define first-time visitor SSOT as the first time firstVisitAt is set for a GuestProfile in that org, from the earliest of: first completed Booking payment for that guest, first completed PosSale when guestProfileId present, first CheckInEvent when present, or first newsletter subscribe if settings allow welcome-from-newsletter. Document the chosen order in code comments and settings help text.

Automation welcome:
Eligible when welcomeEnabled, marketingEmailOptIn true for promotional welcome, welcomeEmailSentAt null, email present, not banned, not erased.
Send branded welcome with CTA to company website from CompanyProfile.website or MarketingAutomationSettings.websiteCtaUrl, and optional links to public category pages for other products.
Set welcomeEmailSentAt and write MarketingSendLog and automation watermark.
Idempotent forever per guest for kind welcome unless operator resets from admin with marketing:send.

Cron must pick these up. Also allow a safe immediate send path after visitTouch sets firstVisitAt when delayHours is 0.

Do not change src/app/api/auth/verify/route.ts fashion sendWelcomeEmail behavior except to keep it clearly separate.

================================================================================
BIRTHDAY CAMPAIGNS → PARTY BOOKINGS
================================================================================

Automation birthday:
Eligible opted-in guests with dateOfBirth whose next birthday falls within birthdayDaysAhead.
Use calendar month/day in venue timezone when location exists, else org default timezone if present, else UTC documented.
CTA must drive party bookings: prefer company category page URL for a birthday or party BookingCategory when PublicCategoryPage exists, else /book/{venueSlug} party product path discovered in ticketing, else settings partyBookingCtaPath.
Idempotent per guest per year windowKey YYYY.
Write MarketingSendLog. Cap daily sends per org.

Admin UI must let staff preview upcoming birthday audience counts without exporting raw PII beyond permissioned views.

================================================================================
FAILED PAYMENT AND MEMBERSHIP RENEWAL REMINDERS
================================================================================

Do not rebuild memberships dunning. Extend and connect:

Confirm src/lib/memberships/dunning.ts, src/lib/memberships/mail.ts, src/app/api/cron/memberships-dunning/route.ts, and piggyback on remind-company-subscriptions still run.
On Marketing overview, show honest status: dunning enabled from MembershipSettings, past_due counts from existing memberships reporting helpers if available, link to /admin/memberships and dunning queue routes that already exist.
If membership reminder email copy is hard-coded only, allow Marketing settings to optionally override subject/intro lines by calling into memberships mail helpers with override params — but schedule, retries, Enterprise escalation, and Stripe recovery remain owned by memberships.
Ensure failed payment reminders still send for entitled Growth+ memberships orgs even when marketing module is off, because they are transactional lifecycle emails. Document that split in settings help text.
Wire visit/CRM guest detail links if membership admin already opens GuestProfile — keep one hub.

Sync every memberships API and UI that shows payment health so Marketing overview numbers cannot disagree with Memberships → Reports.

================================================================================
WAIVER EXPIRATION REMINDERS
================================================================================

Do not rebuild waiver expiry. Extend and connect:

Confirm src/lib/waivers/remindExpiring.ts, src/app/api/cron/waivers-remind/route.ts, WaiverSettings.remindBeforeDays, WaiverReminderWatermark.
On Marketing overview, show honest waiver remind windows and recent sent counts from watermarks, with deep link to /admin/waivers settings.
Optional marketing template override for guest-facing copy only if it still goes through sendWaiverGuestEmail or a thin wrapper that preserves watermark idempotency.
Waiver expiry reminders remain available whenever waivers module is entitled, even if marketing module is off.
Never require newsletter opt-in to send waiver expiry transactional reminders.
Keep booking confirmation waiver links and party waiver list behavior intact.

================================================================================
POST-VISIT SURVEYS AND PROMOTIONS
================================================================================

Ship Guest Surveys as a real Growth+ marketing submodule under assertMarketingEnabled or a nested assert that still requires marketing entitlement in this epic. README FuturePlanModules.guestSurveys may be marked live for Growth when this ships, or map surveys under marketing moduleHints — pick one coherent gate and use it everywhere.

Staff can create and publish GuestSurvey with rating and comment questions minimum, optional multiple questions Json.
After a visit is detected and postVisitDelayHours pass, create GuestSurveyInvite with secure token and email the guest a link to /survey/[token] or /{orgSlug}/survey/[token] outside fashion PublicLayout chrome when on company survey path.
Public submit POST /api/public/marketing/surveys/[token]/submit stores GuestSurveyResponse, marks invite completed, optionally sends thank-you with promoUrl.
Admin /admin/marketing/surveys lists surveys, response counts, average rating, and CSV export under marketing:export with formula-injection escape.
Park scope: locationId on survey and invite when park-specific.
Do not fake responses. Empty states stay honest.
Promotions V1 may be a thank-you URL or static promo code string — do not fake a full Discounts & Promotions engine. If Discount models already exist from another epic, link optionally; otherwise keep promo as URL/code fields only and say so in UI.

================================================================================
RE-ENGAGEMENT EMAILS FOR INACTIVE GUESTS
================================================================================

Automation reengagement:
Eligible opted-in guests whose lastVisitAt or last completed park commerce activity is older than reengagementInactiveDays, not banned, not erased, email present, and who have not received a reengagement send inside a cooldown window stored as watermark.
CTA to book again via company category page or public book path and optional promo URL from settings.
Idempotent per cooldown windowKey.
Respect actorLocationScope for admin previews when a park is selected.
Enterprise HQ may preview org-wide inactive counts only under assertEnterpriseHqEnabled.

================================================================================
CRON, QUEUES, IDEMPOTENCY
================================================================================

Add src/app/api/cron/marketing-automations/route.ts with GET and POST Bearer CRON_SECRET, same style as memberships-dunning and waivers-remind.
runAll automations with per-org entitlement checks, per-kind enable flags, send caps, and skip logging.
Optionally piggyback a thin call from an existing daily cron only if that pattern is already used and documented — prefer a dedicated cron route registered in permissions docs and README env notes.
Never send duplicate welcome, duplicate birthday for same year, duplicate reengagement inside cooldown, or duplicate survey invite for same visitRef.
Write MarketingSendLog for sent and skipped.

================================================================================
ADMIN UI PAGES AND COMPONENTS
================================================================================

Build under src/components/Protected/admin/pages/marketing/ using existing admin layout, Harewa gold #D4AF37, and existing table/form patterns from memberships or waivers admin pages.

Required pages:
src/app/admin/marketing/page.tsx — overview cards: newsletter leads count, welcome sent, birthdays upcoming, reengagement queue size, survey response rate, plus honest memberships dunning and waiver remind bridge cards with links
src/app/admin/marketing/newsletter/page.tsx — enable toggle, copy public subscribe link or embed snippet, recent leads list permissioned
src/app/admin/marketing/automations/page.tsx — toggles and timing for welcome, birthday, reengagement, post-visit survey; template subject/body editors; CTA URLs; test send to staff email with marketing:send
src/app/admin/marketing/surveys/page.tsx — survey list/create/edit/publish
src/app/admin/marketing/surveys/[id]/page.tsx — responses
src/app/admin/marketing/settings/page.tsx — reply-to, from name, integration stubs not_configured for Campaign Monitor / T2 / Salesforce / Patch Retention, links to Memberships settings and Waivers settings

Client services under src/services/marketing.ts and hooks under src/hooks/useMarketing.ts following existing React Query patterns. Invalidate marketing query keys on mutations. Broadcast or invalidate related membership/waiver query keys only when bridging actions change shared settings.

================================================================================
API ROUTES YOU MUST IMPLEMENT OR EXTEND
================================================================================

Staff APIs all require requirePermissionFresh, requireActorOrgId, assertMarketingEnabled, Demo lock, never trust client orgId:

GET /api/admin/marketing/overview
GET and PATCH /api/admin/marketing/settings
GET and PATCH /api/admin/marketing/automations
POST /api/admin/marketing/automations/test-send
GET /api/admin/marketing/leads
GET /api/admin/marketing/sends
GET /api/admin/marketing/surveys
POST /api/admin/marketing/surveys
GET /api/admin/marketing/surveys/[id]
PATCH /api/admin/marketing/surveys/[id]
GET /api/admin/marketing/surveys/[id]/responses
POST /api/admin/marketing/surveys/[id]/export
GET /api/admin/marketing/bridges/memberships
GET /api/admin/marketing/bridges/waivers

Public APIs rate-limited:

POST /api/public/marketing/newsletter
GET /api/public/marketing/surveys/[token]
POST /api/public/marketing/surveys/[token]/submit
POST /api/public/marketing/unsubscribe optional tokenized unsubscribe that sets marketingEmailOptIn false

Cron:

GET and POST /api/cron/marketing-automations

If Guest CRM guest APIs already exist, do not duplicate consent editors — deep-link or reuse. If they do not exist, marketing admin must still edit consent on a lead detail drawer or patch endpoint PATCH /api/admin/marketing/leads/[guestProfileId]/consent.

Register every path in src/lib/auth/permissions.ts.

================================================================================
CROSS-FEATURE SYNCHRONIZATION — MANDATORY
================================================================================

Search and update every call site that must stay in sync:

Booking payment success / confirm paths — call visitTouch and optionally enqueue welcome or post-visit survey when guestProfileId known; upsert guest from booking contact email.
POS sale completion when guestProfileId present — visitTouch.
Waiver sign completion — upsert guest; do not set marketing opt-in true unless guest checked a marketing box on the waiver form. If waiver forms support a marketing consent checkbox, wire it to consent.ts; if not, leave opt-in unchanged.
Memberships sell / past_due / dunning — unchanged ownership; Marketing overview reads the same tables.
Waiver remind cron — unchanged ownership; Marketing overview reads watermarks/settings.
Company export src/lib/companyExport.ts — include marketing settings flags, survey counts, send log counts redacted, lead counts; do not dump raw email lists into workspace export unless the existing export pattern already dumps similar PII — prefer counts + metadata.
HQ overview src/lib/hqOverview.ts — honest marketing module status; no fake open/click rates.
README.md — document Guest Marketing Automation as shipped for Growth+ with explicit residual non-goals for live ESP sync and full discounts engine if not built.
docs/saas-module-extension.md — note marketing module orgId + optional locationId.
Admin how-to guides if memberships/waivers guides mention surveys roadmap — update honesty.
VenueFlowHeader surveys roadmap link — point to real product or remove false roadmap claim for entitled docs surfaces.
Prefetch admin route map if the repo prefetches admin pages — add marketing routes.
Smoke scripts package.json entries.

Banned guests: promotional automations skip. Survey invites skip. Newsletter subscribe may still upsert but should not email promos while banned.
Erased guests if erasedAt exists: skip all marketing.

Real-time sync: after settings or automation patches, invalidate React Query marketing keys and any shared org SaaS invalidation helpers already used by admin settings pages. Prefer existing invalidateOrgSaasQueries patterns. Do not invent websockets.

================================================================================
SECURITY, ERRORS, EDGES
================================================================================

No client-trusted orgId/locationId.
No PAN storage.
Do not log raw email bodies with full PII in verbose production logs.
Promotional emails must include unsubscribe or manage-preferences link.
Transactional membership and waiver emails keep existing legal posture.
Rate-limit public newsletter and survey submit.
Cap cron batch sizes like waiver remind take limits.
Cross-tenant guestProfileId always 404.
Demo/Starter/storefront/unpaid deny marketing admin and promotional cron sends.
Test-send must only send to the acting staff email or a validated allowlisted address on the org, never arbitrary mass send from test button.
SMS only when src/lib/sms.ts configured and SMS opted in; otherwise email-only honesty in UI.

================================================================================
TESTING AND SMOKES
================================================================================

Add scripts/smoke-marketing-automations.mts in the style of existing smoke scripts. It must:

Create or use two orgs and prove cross-tenant isolation on admin marketing APIs.
Prove Demo and storefront deny.
Prove Growth entitled allow overview and settings patch.
Prove newsletter subscribe upserts GuestProfile with marketingEmailOptIn true and creates no WaiverRecord and no shop User.
Prove welcome automation is idempotent.
Prove birthday window selection uses dateOfBirth.
Prove reengagement skips recently active guests.
Prove survey publish, invite token submit, and response storage.
Prove memberships dunning bridge read does not require rebuilding dunning and still sees MembershipSettings.
Prove waiver bridge read sees remind settings.
Prove promotional send skipped when marketingEmailOptIn false.
Prove cron route rejects missing CRON_SECRET.

Add package.json script yarn smoke:marketing or yarn smoke:marketing-automations.
Run the new smoke. Fix failures and re-run. Also run related smokes that already exist for memberships dunning and waivers remind if available, or at least unit/assert the bridges against live code paths.

If the dev server is running, manually verify: open /admin/marketing, toggle welcome, submit a public newsletter for a test org slug, confirm the lead appears, run or invoke the automation function for that guest, open a survey token link, submit a response, confirm memberships and waivers overview cards link to the real admin screens.

================================================================================
COMPLETION RULES FOR THIS SINGLE RUN
================================================================================

When the scan shows an existing function already does part of this, connect to it. When something is missing, implement it in this same run. Do not leave a TODO, a stub page that claims complete, a fake Campaign Monitor success, a second guest table, or a duplicate dunning/waiver engine. Do not finish while newsletter is still a client-only reset form for park leads, while welcome still only means fashion auth verify, while birthday has DOB but no send path, while surveys are only a roadmap anchor, or while reengagement has no cron. Do not finish while Marketing overview disagrees with Memberships reports or Waiver settings. Keep fashion shop, tailor studio, staff seats, Online Ticketing, POS, Memberships, and Digital Waivers working.

When everything above is implemented, synced, smoked, and honest in README, stop and summarize what existed versus what you added, with file paths.
```

---

## Prompt 2

```
Audit the Guest Marketing Automation feature that was just implemented. Do not trust the previous completion notes. Scan the repository yourself and compare the running code to every requirement below. If anything is missing, partial, wrong, disconnected, duplicated, out of sync, insecure, or only stubbed while claimed complete, fix it, then retest that fix and the workflow it touches. Do not add a new unrelated product area. Do not start a different epic. Do not fake-complete Campaign Monitor, Salesforce, ROLLER Connect, T2, or Patch Retention.

Scan these areas and every file that imports them:

prisma/schema.prisma for GuestProfile marketing fields, GuestMarketingConsent if used, MarketingAutomationSettings, MarketingAutomationTemplate if used, MarketingSendLog, MarketingAutomationRun or watermark model, GuestSurvey, GuestSurveyInvite, GuestSurveyResponse
src/lib/marketing/
src/lib/guests/
src/lib/mailer.ts marketing and welcome helpers
src/lib/memberships/dunning.ts
src/lib/memberships/mail.ts
src/lib/waivers/remindExpiring.ts
src/lib/moduleEntitlement.ts
src/lib/subscriptionPlans.ts moduleHints and SHIPPED_MODULE_HINT_IDS
src/lib/auth/permissions.ts
src/lib/adminNav.ts
src/lib/companyExport.ts
src/lib/hqOverview.ts
src/app/api/admin/marketing/
src/app/api/public/marketing/
src/app/api/cron/marketing-automations/
src/app/api/cron/memberships-dunning/
src/app/api/cron/waivers-remind/
src/app/admin/marketing/
src/components/Protected/admin/pages/marketing/
src/services/marketing.ts
src/hooks/useMarketing.ts
scripts/smoke-marketing-automations.mts or the smoke file that was added
package.json smoke script entries
README.md honesty for this module
booking payment confirm, POS sale complete, waiver sign, and visitTouch call sites
VenueFlowLandingBelow newsletter behavior
privacy page marketing consent accuracy

Confirm all of the following are true. Fix each one that is not, then recheck it.

The project was scanned and existing GuestProfile, memberships dunning, and waiver expiry reminder engines were extended or bridged rather than duplicated. There is no second park contact table and no second dunning engine and no second waiver remind engine.

assertModuleEnabled("marketing") or the chosen coherent gate fails closed for Demo, Starter, storefront DEFAULT_ORG, unpaid, pending, and suspended. Growth includes marketing in moduleHints. Enterprise all covers it. SHIPPED_MODULE_HINT_IDS and README agree that marketing automations are live.

Permissions marketing:read, marketing:write, marketing:send, marketing:surveys, marketing:export are registered. Every new admin and public and cron route is listed in API_PERMISSIONS. Admin nav Marketing group routes to /admin/marketing, newsletter, automations, surveys, and settings. Fashion /profile and /tailor/* do not host operator marketing tools. /signup remains closed.

Public newsletter POST upserts GuestProfile with explicit consent and marketingEmailOptIn true, creates no WaiverRecord, creates no shop User, rejects storefront and Demo and locked orgs, and is rate-limited. Staff can copy a real subscribe link or embed from the newsletter admin page. The platform VenueFlow landing newsletter does not falsely claim to save tenant park leads unless it was intentionally rewired and documented.

Welcome automation uses a documented first-visit SSOT, is idempotent via welcomeEmailSentAt or watermark, sends only when enabled and allowed by consent rules for promotional welcome, uses a park marketing mail helper distinct from auth verify sendWelcomeEmail, and writes MarketingSendLog.

Birthday automation selects opted-in guests by dateOfBirth inside birthdayDaysAhead, is idempotent per year, and CTAs to party or birthday booking using company category pages when present or the documented fallback book path.

Membership failed-payment and renewal reminders still run through src/lib/memberships/dunning.ts and memberships cron. Marketing overview bridge numbers and links match Memberships settings and dunning queue reality. Marketing module off does not disable memberships dunning.

Waiver expiration reminders still run through src/lib/waivers/remindExpiring.ts and waivers-remind cron with watermark idempotency. Marketing overview bridge matches WaiverSettings.remindBeforeDays. Marketing module off does not disable waiver reminds. Newsletter opt-in is not required for waiver expiry transactional mail.

Post-visit surveys can be created, published, invited by token email after visit delay, submitted publicly, stored as GuestSurveyResponse, listed in admin, and exported with formula-injection escape. Thank-you promo is URL or code fields only unless a real discounts engine was already present and correctly linked. No fake survey KPIs.

Re-engagement automation skips recently active guests, requires opt-in, uses inactive day settings, is idempotent per cooldown watermark, and logs sends and skips.

Cron /api/cron/marketing-automations requires Bearer CRON_SECRET, respects per-kind toggles, caps batches, and does not double-send welcome, birthday year, reengagement cooldown, or survey invite for the same visitRef.

visitTouch or equivalent updates firstVisitAt and lastVisitAt from the live booking, POS, check-in, or equivalent paths discovered in the repo. Upsert-from-channel is used for newsletter and sibling hooks without blindly overwriting richer guest fields or forcing marketing opt-in on waiver sign unless a marketing checkbox exists.

Banned and erased guests are skipped for promotional automation. Client orgId and locationId are never trusted. Cross-tenant ids 404. companyExport and hqOverview are honest. Integration settings show not_configured for external ESPs. SMS claims match src/lib/sms.ts reality.

Automations UI can toggle and configure welcome, birthday, reengagement, and post-visit survey. Test send cannot mass-mail arbitrary addresses. Unsubscribe or manage-preferences exists for promotional mail.

yarn smoke for marketing passes. Related memberships and waivers reminder paths still work. Fashion shop, tailor, ticketing, POS, memberships billing, and digital waivers guest signing still work.

When the audit is finished, report only the requirements that failed and what you changed, then state whether the full list above now passes. If any item still fails, do not call the feature complete. When every item passes, reply exactly:

GUEST MARKETING AUTOMATION AUDIT PASSED — PRODUCTION READY

List residual postponed items honestly, including live Campaign Monitor or Salesforce sync, full Discounts and Promotions engine if not built, SMS without Twilio, and any Guest CRM mega-features from docs/guest-crm-complete-spec.md that were intentionally not fully rebuilt beyond what marketing needed.
```

---

## How to use

1. Paste Prompt 1 into a new Cursor agent chat and let it finish the full run.
2. Paste Prompt 2 into the same chat or a fresh chat that can see the branch.
3. Require the exact audit success line before you treat the client marketing pack as done.
4. Do not split Prompt 1 into multiple steps.
`)