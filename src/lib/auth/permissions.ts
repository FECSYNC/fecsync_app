/**
 * Permission catalog — source of truth for roles and capabilities.
 *
 * Page proxy is wired (`src/proxy.ts` + `src/lib/auth/routePolicy.ts`).
 * API guards live in `src/lib/middleware/requireAuth.ts`.
 * Admin UI nav + page/action gates use store `can()` → `sessionCan` (Steps 2.2 / 6.2 / 6.3).
 * GET|PUT /api/admin/tax-settings uses requirePermissionFresh(tax:manage) on actor.orgId.
 * Order APIs are isolated (Step 3.1).
 * Cart and wishlist APIs are isolated (Step 3.2).
 * Wallet APIs are isolated (Step 3.3).
 * Customization / custom-request APIs are isolated (Step 3.4).
 * Notification, reviews, profile, fashion-chat are isolated (Step 3.5).
 * Product mutating APIs are gated (Step 4.1).
 * Fabric and ProductCategory mutating APIs are gated (Step 4.2).
 * Shop CRUD APIs return 410 Gone (Step 4.3; unused leftover, not a tenant).
 * Analytics, admin tax, AI PUT, and uploads are gated (Step 4.4).
 * Organization is the tenant root; Membership links users (Steps 5.1–5.2).
 * Staff catalog/order queries filter by actor.orgId (Step 5.3).
 *
 * Platform ops vs company admin (same Membership preset name, different org):
 * - Storefront org + platform_admin → FECSYNC ops (registered-companies,
 *   platform-accounts, public catalog/CMS). Never Demo-locked. Does NOT open
 *   other companies' /admin/hq or /admin/venues as those tenants.
 * - Registered company staff → actor.orgId only; never other companies' data.
 * Membership admin APIs (Step 6.1) + /admin/users UI (Step 6.2).
 * Admin UI page/action gates (Step 6.3): sidebar, layout → /403, Edit/Delete,
 * dashboard widgets; API remains source of truth if UI is bypassed.
 * Step 7.1: User.role `seller` archived (→ client preset; not a Membership
 * preset). Dead requireAdmin/requireClient removed. Proxy uses routePolicy.
 * Other APIs still use requireAuth only (or no auth) — see ACCEPTED opens.
 *
 * Inventory mapping (API / surface → permission):
 *   GET /api/product, GET /api/product/[id] → public storefront (DEFAULT_ORG_ID / default org)
 *   GET /api/tailors, GET /api/tailors/[slug] → public Find-a-Tailor discovery (approved only)
 *   GET …?scope=staff                     → staff list/detail for actor.orgId
 *   GET /api/product/category/[id]        → public (storefront org)
 *   POST /api/product, PUT /api/product/[id] → products:write (stamp actor.orgId)
 *   DELETE /api/product/[id]              → products:delete (actor.orgId; cross-tenant 403)
 *   GET /api/product/bulk                 → products:read (actor.orgId)
 *   POST /api/product/bulk                → products:write (stamp actor.orgId)
 *   GET /api/product/shop|seller/[id]     → 410 Gone (retired; use /api/product)
 *   PUT /api/product/shop|seller/[id]     → 410 Gone
 *   DELETE /api/product/shop|seller/[id]  → 410 Gone
 *   /api/fabric GET, GET /[id]            → public storefront; ?scope=staff → actor.orgId
 *   POST /api/fabric, PUT /api/fabric/[id] → fabrics:write (stamp/filter actor.orgId)
 *   DELETE /api/fabric/[id]               → fabrics:delete (actor.orgId)
 *   GET /api/product-category, GET /[id]  → public; ?scope=staff → categories:read (list/detail + publicPage url/snippet; missing pages are created once)
 *   POST /api/product-category, PUT /[id] → categories:write (stamp actor.orgId; public slug once; rename does not change it)
 *   DELETE /api/product-category/[id]     → categories:delete (actor.orgId; deactivates the public page, then deletes the category)
 *   GET|POST|PUT|PATCH|DELETE /api/shop, /api/shop/[id] → 410 Gone (unused; not a tenant)
 *   /api/order GET                        → orders:read (staff list; actor.orgId)
 *   /api/order POST                       → requireAuth, user=sub, own cart; sets Order.orgId
 *   /api/order/me                         → requireAuth, user=sub (own orders only)
 *   /api/order/[id] GET                   → owner or orders:read (staff: actor.orgId; cross-tenant 403)
 *   /api/order/[id] PUT                   → owner or orders:manage (staff: actor.orgId)
 *   /api/order/[id] DELETE                → owner or orders:manage (pending/initiated; staff: actor.orgId)
 *   GET /api/customization                → customizations:read (staff list)
 *   POST /api/customization               → requireAuth, user=sub
 *   GET /api/customization/me             → requireAuth, user=sub
 *   GET /api/customization/[id]           → owner or customizations:read
 *   PUT/DELETE /api/customization/[id]    → owner or customizations:manage
 *   GET /api/customization/user/[userId]  → owner if userId===sub, else customizations:read
 *   POST/GET /api/custom-request          → requireAuth, user=sub (unused by UI)
 *   PATCH /api/custom-request             → customizations:manage
 *   POST /api/reviews                     → requireAuth, user=sub (storefront org product)
 *   GET /api/reviews?productId=           → public (storefront org product; missing productId → 400)
 *   PATCH/DELETE /api/reviews/[id]        → owner or reviews:moderate (staff: product.orgId === actor.orgId)
 *   PATCH /api/reviews/[id] (empty body)  → like-toggle, any authenticated user
 *   GET /api/tax-settings                 → public (checkout; storefront org enabled/rate/label)
 *   /api/admin/tax-settings GET|PUT       → tax:manage (actor.orgId TaxSettings)
 *   /api/admin/company-profile GET         → settings:manage (soft-hold OK) | orders:read|manage Active only (actor.orgId; bank last4 only)
 *   /api/admin/company-profile PUT         → company_profile:write (actor.orgId; allowOnDemo for existing profile fields; public switches and embed origins are demo-locked)
 *   /api/admin/company-profile/logo POST|DELETE → settings:manage (Cloudinary company-profiles/{orgId})
 *   /api/admin/venue-locations GET|POST    → GET: any of settings:manage|products:*|ticketing:*|bookings:*|memberships:read|write|sell|billing|admin|analytics:read + registered company; POST: settings:manage (actor.orgId VenueLocation; plan limit venues; Demo locked via Fresh + lib; not storefront; assertWithinPlanLimit also denies venues on storefront). GET default applies actorLocationScope (HQ preference + MembershipVenueAssignment park lock); ?scope=all skips filter for switchers (park-locked still capped to assigned set). Park-stamped Product/Order/ticketing/memberships filter by scope; members list stays org-wide; plan meters company-wide.
 *   /api/admin/venue-locations/[id] GET|PATCH|DELETE → settings:manage + registered company (update / soft-archive / reactivate; archive frees venues quota + clears MembershipVenueAssignment + hqSelectedLocationId + franchiseParkManager when seat has no parks left; franchise managers may PATCH franchise profile fields on assigned franchise parks; never body.orgId)
 *   /api/admin/hq/overview GET             → settings:manage + Enterprise HQ entitled (assertEnterpriseHqEnabled; VenueLocation rollup + usage meters; locationScope may narrow venue items; meters/counts company-wide; no fake modules)
 *   /api/admin/hq/location-context GET|PUT → settings:manage + Enterprise HQ entitled (Membership.hqSelectedLocationId; null = All locations only when not park-locked; CWV independent of park preference)
 *   /api/admin/park-context GET|PUT       → any of settings:manage|analytics:read|products:*|orders:read|ticketing:*|bookings:*|memberships:*|waivers:*|pos:read|sell|admin|checkin|tabs|till_open (Growth/Starter park filter + park-locked switcher; no Enterprise required; persists hqSelectedLocationId)
 *   PUT /api/admin/members/[id]/venue-assignments → users:park_assign (+ expand from users:manage_roles) + company-wide / platform_admin / software owner, OR franchise park manager scoped to their parks (replace-set MembershipVenueAssignment; empty clears park lock + franchiseParkManager; CWV+assignments still park-locked)
 *   POST /api/admin/members franchise park managers: park-locked invite path (locationIds ⊆ actor parks; CWV false; never platform_admin). Normal park-locked seats still blocked by assertNotParkLockedCompanyHq.
 *   /api/admin/billing/plans GET           → settings:manage (plan catalog + billing state)
 *   /api/admin/billing/state GET           → settings:manage (thin billing state)
 *   /api/admin/billing/usage GET           → settings:manage | analytics:read | users:invite|manage_roles | products|fabrics|categories:write | booking_packages:manage | tailors:manage (plan meters; registered company)
 *   /api/admin/billing/checkout|portal POST → settings:manage + platform_admin (Stripe company_subscription)
 *   GET /api/admin/marketplace/account     → settings:manage | analytics:read | booking_packages:manage | marketplace:refunds (Connect status DTO; actor.orgId; ignore ?orgId)
 *   POST /api/admin/marketplace/connect/onboard|refresh|login-link → payouts:manage + platform_admin + assertNotParkLockedCompanyHq + rate limit (Stripe Connect Express; World B marketplace_booking)
 *   POST /api/admin/marketplace/connect/sync → settings:manage (pull Connect flags; returns chargeReady DTO)
 *   GET|POST /api/admin/booking-packages[/[id]] → booking_packages:manage (registered company; actor.orgId; ignore body.orgId)
 *   GET /api/admin/marketplace/bookings    → marketplace:refunds | settings:manage | booking_packages:manage | analytics:read
 *   POST /api/admin/marketplace/bookings/[id]/refund → marketplace:refunds | (settings:manage + platform_admin)
 *   GET /api/public/booking-packages/[publicOrgKey]/[slug] → public published package
 *   POST …/checkout → public rate-limited (email, name?, idempotencyKey only → Stripe destination Checkout)
 *   GET /api/admin/company-export → settings:manage + platform_admin + rate limit (actor.orgId redacted workspace JSON incl. VenueLocation rows + membership hqSelectedLocationId; UI company-profile + soft-hold company-pending; never client orgId)
 *   POST /api/admin/company-offboard-request → settings:manage + platform_admin + rate limit (soft offboard stamp + notices; UI company-profile + company-pending; registered-companies status=offboard; no hard-delete)
 *   /api/admin/registered-companies/metrics GET → users:manage_roles + storefront platform_admin (UI: CompaniesOverviewCards + isAdminPageAllowed)
 *   /api/admin/shipping-settings GET|PUT|POST → settings:manage (actor.orgId ShippingSettings)
 *   GET /api/homepage-content             → public (published homepage marketing sections)
 *   GET /api/admin/homepage-content       → settings:manage + storefront staff org (list sections)
 *   GET|PUT|DELETE /api/admin/homepage-content/[key] → settings:manage + storefront staff org
 *   GET /api/ad-banners                   → public (active Trending Fashion sidebar ads)
 *   GET|POST /api/admin/ad-banners        → settings:manage + storefront staff org
 *   GET|PUT|DELETE /api/admin/ad-banners/[id] → settings:manage + storefront staff org
 *   GET|PUT|POST /api/admin/ai-settings        → ai:manage (actor.orgId AiSettings)
 *   GET /api/admin/fashion-chats*         → ai:chats_read (actor.orgId FashionChat)
 *   POST …/fashion-chats/[id]/reply      → ai:chats_reply
 *   PATCH /api/admin/fashion-chats/[id]   → ai:chats_reply (status / handoff)
 *   DELETE /api/admin/fashion-chats/[id]  → ai:chats_delete
 *   DELETE /api/admin/fashion-chats       → ai:chats_delete (bulk ids)
 *   GET /api/admin/members                → users:read (actor.orgId)
 *   POST /api/admin/members               → users:invite | users:manage_roles
 *   PATCH /api/admin/members/[id]         → users:manage_roles (no last platform_admin demote)
 *   DELETE /api/admin/members/[id]        → users:manage_roles (revoke; no last platform_admin)
 *   DELETE /api/admin/members/[id]?hard=1 → users:delete + platform_admin (purge User + auto-blacklist)
 *   GET|POST|DELETE /api/admin/user-blacklist* → users:blacklist
 *   GET /api/admin/role-templates         → users:read (actor.orgId)
 *   POST /api/admin/role-templates        → users:manage_roles (plan limit roleTemplates)
 *   GET|PATCH|DELETE .../role-templates/[id]→ users:read | users:manage_roles
 *   POST /api/admin/users                 → users:manage_roles (create account + membership)
 *   POST /api/admin/users/[id]/reset-password → users:reset_password + company-wide view (software owners fail-closed unless actor is owner)
 *   /admin/users                          → users:read; invite/edit/revoke → users:*; delete → users:delete; blacklist → users:blacklist; reset password → users:reset_password
 *   /admin/permissions                    → redirects to /admin/users (alias)
 *   /admin (dashboard shell)              → soft-gated; widgets need analytics:read / domain read
 *   /admin/profile                        → soft-gated for any staff (self-service; not in ADMIN_ROUTE_PERMISSIONS)
 *   /admin/products                       → products:read; Add/Edit → products:write; Delete → products:delete
 *   /admin/categories                     → categories:read; Add/Edit → categories:write; Delete → categories:delete
 *   /admin/fabrics                        → fabrics:read; Add/Edit → fabrics:write; Delete → fabrics:delete
 *   /admin/orders                         → orders:read; Mark shipped/delivered → orders:manage
 *   /admin/customizations                 → customizations:read; Delete request → customizations:manage
 *   /admin/deliveries                     → deliveries:read; Update/Track → deliveries:manage
 *   /admin/reviews                        → reviews:read; moderate API → reviews:moderate (admin queue UI placeholder)
 *   /admin/ai-chats                       → ai:chats_read; reply → ai:chats_reply; delete → ai:chats_delete
 *   /admin/ai-settings                    → ai:manage (AI Chats → Assistant settings)
 *   /admin/tax-settings                   → tax:manage (Store settings → Tax)
 *   /admin/company-profile                → settings:manage (Store settings → Company profile; logo via company-profile/logo)
 *   /admin/venues                         → venues:read (top-level Venues; multi-park VenueLocation)
 *   /admin/hq                             → settings:manage + registered company (Demo locked). Entitled Enterprise sees rollup; others see Billing upsell (no data leak). API assertEnterpriseHqEnabled on /api/admin/hq/*.
 *   /admin/billing                        → settings:manage (Store settings → Billing; Stripe company subscription)
 *   /admin/payouts                        → payouts:read (view) | payouts:manage (Connect CTAs). Company org Connect: platform_admin + company-wide. Franchise park Connect: assigned franchiseParkManager or company-wide. Not SaaS Billing.
 *   /admin/booking-packages               → booking_packages:manage (CRUD) | marketplace:refunds (refund-only UI; finance)
 *   /admin/homepage-content               → settings:manage (Store settings → Homepage; images need uploads:write)
 *   /admin/ad-banners                     → settings:manage (Store settings → Ad banners; images need uploads:write)
 *   /admin/tailors                        → tailors:read (Tailors → Tailor profiles); Create/Edit/Approve/Suspend → tailors:manage
 *   /admin/tailoring-jobs                 → tailoring_jobs:read (Tailors → Tailoring jobs); manage → tailoring_jobs:manage
 *   /tailor/dashboard                     → auth + tailor Membership preset (or staff QA); PUT /api/tailor/me requires approved profile
 *   /tailor/home                          → auth + tailor Membership (studio dashboard + client roster)
 *   /tailor/campaigns|/tailor/notifications → auth + tailor Membership (workspace modules)
 *   /admin/pos                            → pos:sell (cashier terminal)
 *   /admin/pos/admin                      → pos:admin (settings, devices, menus, products)
 *   /admin/pos/sales                      → pos:read (PosSale list + detail)
 *   /admin/pos/check-in                   → pos:checkin
 *   /admin/pos/capacity                   → pos:sell
 *   /admin/pos/tills                      → pos:till_open
 *   /admin/pos/tabs                       → pos:tabs
 *   POS APIs /api/pos/* and /api/admin/pos/* → pos:* bits (assertPosEnabled; no storefront bypass)
 *   /admin/* pages (Step 6.3)             → ADMIN_ROUTE_PERMISSIONS via AdminLayout → /403
 *   unknown /admin/* (not in inventory)   → fail closed → /403 (Step 6.3)
 *   catalog Edit/Delete buttons           → products|fabrics|categories:write|delete
 *   order status / customization delete   → orders:manage / customizations:manage
 *   homepage View/Edit/Publish/Reset      → settings:manage (+ uploads:write for images)
 *   ad banners View/Create/Edit/Delete/Active → settings:manage (+ uploads:write for images)
 *   Edge /admin/*                         → staff vs client only (permissions may be omitted on JWT)
 *   Edge /tailor/*                        → signed-in tailor preset, or staff (QA preview); plain clients → /403
 *   GET /api/ai-settings                  → public botName only (storefront org chatbot)
 *   /api/analytics                        → analytics:read (order totals: actor.orgId)
 *   /api/upload*                          → uploads:write (folders: products | fabrics | homepage | banners)
 *   GET|POST /api/admin/tailors           → tailors:read | tailors:manage (list / create; actor.orgId)
 *   GET|PUT|PATCH /api/admin/tailors/[id] → tailors:read | tailors:manage (view / edit / status)
 *   GET|PUT /api/tailor/me                → requireAuthFresh + active tailor Membership (or staff owner); PUT requires approved
 *   POST /api/tailor/portfolio            → same gate as /me (Cloudinary folder tailors; not uploads:write)
 *   GET|POST /api/tailor/clients          → same gate as /me; list/create TailorClient for actor's TailorProfile (org plan limit via assertWithinPlanLimit(tailorClients))
 *   DELETE /api/tailor/clients/[id]       → same gate as /me; delete own roster client only
 *   GET|POST /api/tailor/campaigns*       → same gate as /me; measurement campaigns owned by tailor (Phase 2+)
 *   GET|POST /api/campaigns/join/[slug]   → public GET; POST MeasurementsWriteOwn (join / submit)
 *   GET /api/campaigns/my                 → MeasurementsReadOwn (customer participations)
 *   GET|POST /api/measurement-profiles           → MeasurementsReadOwn / WriteOwn (requirePermissionFresh)
 *   GET|PUT|DELETE /api/measurement-profiles/[id] → owner + same permissions
 *   PATCH /api/measurement-profiles/[id]/default → MeasurementsWriteOwn
 *   PATCH /api/measurement-profiles/[id]/category → MeasurementsWriteOwn; merge category fields
 *   POST /api/measurement-profiles/[id]/ai-scan → MeasurementsWriteOwn; AI scan merge + optional sponsored quota
 *   GET|POST /api/tailoring-jobs                 → customer/tailor scopes; POST creates submitted
 *   GET|PATCH /api/tailoring-jobs/[id]           → customer | assigned tailor | staff org
 *   GET|PATCH /api/admin/tailoring-jobs[/[id]]   → tailoring_jobs:read | manage (actor.orgId)
 *   POST /api/payment/tailoring                  → requireAuth; job owner; Stripe checkout
 *   GET /api/payment/tailoring/confirm           → Stripe session_id (provider proof)
 *   POST /api/payment/tailoring/cancel           → { jobId } + auth, or { sessionId } from Stripe cancel URL
 *   GET|POST /api/tailors/[slug]/reviews         → public list | auth customer (completed job)
 *   /api/auth/profile*, /api/auth/me      → requireAuth, user=sub (not profile:manage_own live)
 *   POST /api/auth/change-password        → requireAuth, session user (catalog: profile:manage_own)
 *   /admin/profile + /profile             → self-service profile UI (email/role/permissions locked)
 *   GET /api/cart                         → cart:read (staff list)
 *   POST /api/cart                        → requireAuth, user=sub
 *   /api/cart/me, /api/cart/[id]*         → requireAuth, cart.user === sub
 *   /api/wishlist                         → requireAuth, user=sub
 *   /api/wallet/me, fund, withdraw        → requireAuth, user=sub
 *   GET /api/wallet                       → wallet:read (staff list)
 *   GET /api/wallet/[id]                  → requireAuth, wallet.user === sub
 *   PUT/DELETE /api/wallet/[id]           → owner-only; no staff mutate of others
 *   /api/payment/purchase                 → payments:checkout_own
 *   staff payment/order totals            → payments:read
 *   GET/PATCH /api/notification           → requireAuth + owner (not notifications:read_own live)
 *   GET/POST /api/fashion-chat            → authenticated: user=sub; guest: IP+sessionId
 *   POST /api/fashion-chat/stream         → same; contact (name/email/phone) for inbox
 *   POST /api/fashion-chat/start          → guest creates/opens shell with contact
 *   POST /api/fashion-chat/end            → guest ends session; chat marked resolved with contact
 *
 * Isolation: user-scoped (document.user === JWT sub) for Cart/Wishlist/Wallet/etc.
 * Catalog + Order carry Organization.orgId (Step 5.1). Membership (Step 5.2)
 * puts orgId + permissions on the JWT when present; clients without membership
 * keep legacy role expansion. Shop remains unused leftover. Product.seller/shop are not isolation keys.
 * /api/shop CRUD is 410 Gone (Step 4.3) — not a tenant domain.
 * settings:manage gates Store settings → Homepage (/admin/homepage-content) and
 * Ad banners (/admin/ad-banners), not Shop CRUD.
 * Leftover /api/product/shop|seller handlers are staff-gated (Step 4.1).
 * Public `/shop` pages are product listing (GET /api/product), unrelated to Shop CRUD.
 *
 * Intentionally omitted as standalone domains (unused / public / provider callbacks):
 *   stripe webhook, paystack/stripe confirm (provider-verified, not RBAC)
 */

import { isAdminUiHiddenPermissionFeature } from "@/lib/adminUiHidden";

export const P = {
  ProductsRead: "products:read",
  ProductsWrite: "products:write",
  ProductsDelete: "products:delete",
  FabricsRead: "fabrics:read",
  FabricsWrite: "fabrics:write",
  FabricsDelete: "fabrics:delete",
  CategoriesRead: "categories:read",
  CategoriesWrite: "categories:write",
  CategoriesDelete: "categories:delete",
  OrdersRead: "orders:read",
  OrdersManage: "orders:manage",
  OrdersReadOwn: "orders:read_own",
  OrdersCreateOwn: "orders:create_own",
  CustomizationsRead: "customizations:read",
  CustomizationsManage: "customizations:manage",
  CustomizationsManageOwn: "customizations:manage_own",
  ReviewsRead: "reviews:read",
  ReviewsModerate: "reviews:moderate",
  ReviewsCreateOwn: "reviews:create_own",
  TaxManage: "tax:manage",
  AiManage: "ai:manage",
  AiChatsRead: "ai:chats_read",
  AiChatsReply: "ai:chats_reply",
  AiChatsDelete: "ai:chats_delete",
  AnalyticsRead: "analytics:read",
  UploadsWrite: "uploads:write",
  SettingsManage: "settings:manage",
  UsersRead: "users:read",
  UsersInvite: "users:invite",
  UsersManageRoles: "users:manage_roles",
  UsersDelete: "users:delete",
  UsersBlacklist: "users:blacklist",
  /** Desk-assist password reset for other staff (never software owners unless viewer is owner). */
  UsersResetPassword: "users:reset_password",
  DeliveriesRead: "deliveries:read",
  DeliveriesManage: "deliveries:manage",
  ProfileManageOwn: "profile:manage_own",
  CartRead: "cart:read",
  CartManageOwn: "cart:manage_own",
  WalletReadOwn: "wallet:read_own",
  WalletTransactOwn: "wallet:transact_own",
  WalletRead: "wallet:read",
  WalletManage: "wallet:manage",
  PaymentsCheckoutOwn: "payments:checkout_own",
  PaymentsRead: "payments:read",
  NotificationsReadOwn: "notifications:read_own",
  TailorsRead: "tailors:read",
  TailorsWriteOwn: "tailors:write_own",
  TailorsManage: "tailors:manage",
  MeasurementsReadOwn: "measurements:read_own",
  MeasurementsWriteOwn: "measurements:write_own",
  TailoringJobsReadOwn: "tailoring_jobs:read_own",
  TailoringJobsWriteOwn: "tailoring_jobs:write_own",
  TailoringJobsRead: "tailoring_jobs:read",
  TailoringJobsManage: "tailoring_jobs:manage",
  TicketingRead: "ticketing:read",
  TicketingWrite: "ticketing:write",
  TicketingManage: "ticketing:manage",
  BookingsRead: "bookings:read",
  BookingsWrite: "bookings:write",
  BookingsAssign: "bookings:assign",
  BookingsOverbook: "bookings:overbook",
  BookingsTaxExempt: "bookings:tax_exempt",
  BookingsRefund: "bookings:refund",
  BookingsPaymentsRead: "bookings:payments_read",
  BookingsPaymentsTake: "bookings:payments_take",
  BookingsChargeStored: "bookings:charge_stored",
  BookingsExport: "bookings:export",
  BookingInvoicesRead: "booking_invoices:read",
  BookingInvoicesManage: "booking_invoices:manage",
  BookingInvoicesSend: "booking_invoices:send",
  BookingAccountsRead: "booking_accounts:read",
  BookingAccountsWrite: "booking_accounts:write",
  BookingsReadOwn: "bookings:read_own",
  BookingsWriteOwn: "bookings:write_own",
  BookingPackagesManage: "booking_packages:manage",
  MarketplaceRefunds: "marketplace:refunds",
  // ── Fine-grained sidebar leaves (matrix SSOT; umbrellas imply these) ──
  VenuesRead: "venues:read",
  VenuesWrite: "venues:write",
  VenuesArchive: "venues:archive",
  HqRead: "hq:read",
  CompanyProfileRead: "company_profile:read",
  CompanyProfileWrite: "company_profile:write",
  BillingRead: "billing:read",
  BillingManage: "billing:manage",
  PayoutsRead: "payouts:read",
  PayoutsManage: "payouts:manage",
  ShippingRead: "shipping:read",
  ShippingWrite: "shipping:write",
  TicketingProductsRead: "ticketing_products:read",
  TicketingProductsWrite: "ticketing_products:write",
  TicketingProductsDelete: "ticketing_products:delete",
  TicketingSessionsRead: "ticketing_sessions:read",
  TicketingSessionsWrite: "ticketing_sessions:write",
  TicketingAddOnsRead: "ticketing_addons:read",
  TicketingAddOnsWrite: "ticketing_addons:write",
  TicketingPassesRead: "ticketing_passes:read",
  TicketingPassesWrite: "ticketing_passes:write",
  TicketingResourcesRead: "ticketing_resources:read",
  TicketingResourcesWrite: "ticketing_resources:write",
  TicketingSettingsRead: "ticketing_settings:read",
  TicketingSettingsWrite: "ticketing_settings:write",
  PartiesRead: "parties:read",
  PartiesWrite: "parties:write",
  PartiesManage: "parties:manage",
  PartiesInvitations: "parties:invitations",
  PartiesFood: "parties:food",
  // Party host (storefront client) — own party bookings only
  PartiesReadOwn: "parties:read_own",
  PartiesWriteOwn: "parties:write_own",
  BookingsCalendarRead: "bookings:calendar_read",
  BookingsCreate: "bookings:create",
  BookingPackagesRead: "booking_packages:read",
  BookingPackagesWrite: "booking_packages:write",
  BookingPackagesPublish: "booking_packages:publish",
  BookingPackagesDelete: "booking_packages:delete",
  RegisteredCompaniesRead: "registered_companies:read",
  RegisteredCompaniesManage: "registered_companies:manage",
  UsersParkAssign: "users:park_assign",
  // Guest park Memberships (Feature 08) — not staff seat permissions
  MembershipsRead: "memberships:read",
  MembershipsWrite: "memberships:write",
  MembershipsSell: "memberships:sell",
  MembershipsBilling: "memberships:billing",
  MembershipsCancel: "memberships:cancel",
  MembershipsRedeem: "memberships:redeem",
  MembershipsAdmin: "memberships:admin",
  // Guest self-serve (linked GuestProfile.userId) — storefront client only
  MembershipsReadOwn: "memberships:read_own",
  MembershipsWriteOwn: "memberships:write_own",
  // Digital Waivers (Feature 05) — not staff seats, not shop orders
  WaiversRead: "waivers:read",
  WaiversWrite: "waivers:write",
  WaiversVerify: "waivers:verify",
  WaiversVoid: "waivers:void",
  WaiversAdmin: "waivers:admin",
  WaiversExport: "waivers:export",
  // Guest Marketing Automation (Feature 24 / 27)
  MarketingRead: "marketing:read",
  MarketingWrite: "marketing:write",
  MarketingSend: "marketing:send",
  MarketingSurveys: "marketing:surveys",
  MarketingExport: "marketing:export",
  // Park POS (Feature sell). Not shop orders. Not a new MembershipRolePreset.
  PosSell: "pos:sell",
  PosRead: "pos:read",
  PosRefund: "pos:refund",
  PosVoid: "pos:void",
  PosDiscount: "pos:discount",
  PosCash: "pos:cash",
  PosTillOpen: "pos:till_open",
  PosTillClose: "pos:till_close",
  PosTillNoCount: "pos:till_no_count",
  PosTillEdit: "pos:till_edit",
  PosWastage: "pos:wastage",
  PosAdmin: "pos:admin",
  PosManagerOverride: "pos:manager_override",
  PosCheckin: "pos:checkin",
  PosTabs: "pos:tabs",
  PosGuestsWrite: "pos:guests_write",
  PosChargeStored: "pos:charge_stored",
  // Accounting (double-entry ledger, AR/AP, banking, inventory costing, reports)
  AccountingRead: "accounting:read",
  AccountingManage: "accounting:manage",
  AccountingJournalsWrite: "accounting:journals_write",
  AccountingJournalsApprove: "accounting:journals_approve",
  AccountingJournalsPost: "accounting:journals_post",
  AccountingJournalsReverse: "accounting:journals_reverse",
  AccountingPeriodsClose: "accounting:periods_close",
  AccountingPeriodsReopen: "accounting:periods_reopen",
  AccountingReceivablesRead: "accounting:receivables_read",
  AccountingReceivablesWrite: "accounting:receivables_write",
  AccountingPayablesRead: "accounting:payables_read",
  AccountingPayablesWrite: "accounting:payables_write",
  AccountingPayablesApprove: "accounting:payables_approve",
  AccountingExpensesSubmit: "accounting:expenses_submit",
  AccountingExpensesRead: "accounting:expenses_read",
  AccountingExpensesWrite: "accounting:expenses_write",
  AccountingExpensesApprove: "accounting:expenses_approve",
  AccountingBankingRead: "accounting:banking_read",
  AccountingBankingWrite: "accounting:banking_write",
  AccountingReconcile: "accounting:reconcile",
  AccountingInventoryRead: "accounting:inventory_read",
  AccountingInventoryWrite: "accounting:inventory_write",
  AccountingReportsRead: "accounting:reports_read",
  AccountingExport: "accounting:export",
  AccountingAuditRead: "accounting:audit_read",
  AccountingStatementsReadOwn: "accounting:statements_read_own",
} as const;

/** Any accounting approval key (approvals inbox page + API). */
export const ACCOUNTING_APPROVE_PERMS = [
  "accounting:journals_approve",
  "accounting:payables_approve",
  "accounting:expenses_approve",
] as const;

/**
 * GET list/detail desk access for Memberships admin surfaces used by
 * sell/billing/cancel desks and plan editors:
 * read OR write OR sell OR billing OR cancel OR admin
 * (synced with isAdminPageAllowed Members OR-gate + Plans canRead).
 */
export const MEMBERSHIPS_DESK_READ_PERMS = [
  P.MembershipsRead,
  P.MembershipsWrite,
  P.MembershipsSell,
  P.MembershipsBilling,
  P.MembershipsCancel,
  P.MembershipsRedeem,
  P.MembershipsAdmin,
] as const;

export type Permission = (typeof P)[keyof typeof P];

export const PERMISSIONS: Permission[] = Object.values(P);

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/**
 * Human-readable catalog for admin UI (Users / role templates).
 * Catalog keys stay `domain:action`; labels map to menu + button names.
 */
export type PermissionCatalogEntry = {
  /** Sidebar / feature area (e.g. Products, Orders). */
  feature: string;
  /** Action button or capability (View, Edit, Delete, Manage…). */
  action: string;
  /** Short line for checkboxes: "Products · View". */
  label: string;
  /** Optional admin menu path. */
  menu?: string;
  /** One-line help under the label. */
  description: string;
  /** staff = org admin UI; client = customer/storefront. */
  audience: "staff" | "client";
  /**
   * Hide from Users → permission matrix (legacy umbrellas kept for API compat).
   * Prefer fine-grained sibling keys in the matrix instead.
   */
  matrixHidden?: boolean;
};

export const PERMISSION_CATALOG: Record<Permission, PermissionCatalogEntry> = {
  [P.ProductsRead]: {
    feature: "Menu items",
    action: "View",
    label: "View menu items",
    menu: "/admin/products",
    description:
      "Food sales → Menu items: sidebar menu, list table (S/N), View details, item detail page",
    audience: "staff",
  },
  [P.ProductsWrite]: {
    feature: "Menu items",
    action: "Create / Edit",
    label: "Create / Edit menu items",
    menu: "/admin/products",
    description:
      "Food sales → Menu items: Add menu item, Edit (modal/page). Images need uploads:write",
    audience: "staff",
  },
  [P.ProductsDelete]: {
    feature: "Menu items",
    action: "Delete",
    label: "Delete menu items",
    menu: "/admin/products",
    description: "Food sales → Menu items: Delete action on the menu table",
    audience: "staff",
  },
  [P.FabricsRead]: {
    feature: "Fabrics",
    action: "View",
    label: "View Fabrics",
    menu: "/admin/fabrics",
    description:
      "Catalog → Fabrics: sidebar menu, list table (S/N), View details, fabric detail page",
    audience: "staff",
  },
  [P.FabricsWrite]: {
    feature: "Fabrics",
    action: "Create / Edit",
    label: "Create / Edit Fabrics",
    menu: "/admin/fabrics",
    description:
      "Catalog → Fabrics: Add fabric, Edit. Fabric images need uploads:write",
    audience: "staff",
  },
  [P.FabricsDelete]: {
    feature: "Fabrics",
    action: "Delete",
    label: "Delete Fabrics",
    menu: "/admin/fabrics",
    description: "Catalog → Fabrics: Delete action on the fabrics table",
    audience: "staff",
  },
  [P.CategoriesRead]: {
    feature: "Categories",
    action: "View",
    label: "View Categories",
    menu: "/admin/categories",
    description:
      "Catalog → Categories: sidebar, list (shop product counts), View details, and the public link with the Copy button (link or iframe embed). Food sales only — Online Booking uses Booking category under Ticketing.",
    audience: "staff",
  },
  [P.CategoriesWrite]: {
    feature: "Categories",
    action: "Create / Edit",
    label: "Create / Edit Categories",
    menu: "/admin/categories",
    description:
      "Catalog → Categories: Add and Edit. Writers also save the public slug, layout, and embed flag. Renaming does not change the public slug. Org-wide folders for Food sales menu items (not Online Booking ticket products).",
    audience: "staff",
  },
  [P.CategoriesDelete]: {
    feature: "Categories",
    action: "Delete",
    label: "Delete Categories",
    menu: "/admin/categories",
    description:
      "Catalog → Categories: Delete — blocked while any shop Product still links this category. Deleting also removes the public page.",
    audience: "staff",
  },
  [P.OrdersRead]: {
    feature: "Orders",
    action: "View",
    label: "View Orders",
    menu: "/admin/orders",
    description:
      "Operations → Orders: list/detail, Print; header paid-order queue; profile menu Orders link",
    audience: "staff",
  },
  [P.OrdersManage]: {
    feature: "Orders",
    action: "Manage status",
    label: "Manage Order Status",
    menu: "/admin/orders",
    description:
      "Operations → Orders detail: Mark shipped / Mark delivered",
    audience: "staff",
  },
  [P.OrdersReadOwn]: {
    feature: "My Orders",
    action: "View own",
    label: "View Own Orders",
    menu: "/profile",
    description: "Customer /profile → Orders tab",
    audience: "client",
  },
  [P.OrdersCreateOwn]: {
    feature: "Checkout",
    action: "Place order",
    label: "Place Orders",
    menu: "/checkout",
    description: "Create an order from cart (Stripe checkout flow)",
    audience: "client",
  },
  [P.CustomizationsRead]: {
    feature: "Customizations",
    action: "View",
    label: "View Customizations",
    menu: "/admin/customizations",
    description:
      "Operations → Customizations: sidebar menu, list table (S/N), View details",
    audience: "staff",
  },
  [P.CustomizationsManage]: {
    feature: "Customizations",
    action: "Manage / Delete",
    label: "Manage / Delete Customizations",
    menu: "/admin/customizations",
    description:
      "Operations → Customizations detail: Delete Request (staff)",
    audience: "staff",
  },
  [P.CustomizationsManageOwn]: {
    feature: "My Customizations",
    action: "Manage own",
    label: "Manage Own Customizations",
    menu: "/customize",
    description:
      "Customer create / view / update / delete own requests (/profile + /customize)",
    audience: "client",
  },
  [P.ReviewsRead]: {
    feature: "Reviews",
    action: "View",
    label: "View Reviews",
    menu: "/admin/reviews",
    description:
      "Operations → Reviews: sidebar menu and list page (moderation queue UI placeholder)",
    audience: "staff",
  },
  [P.ReviewsModerate]: {
    feature: "Reviews",
    action: "Moderate",
    label: "Moderate Reviews",
    menu: "/admin/reviews",
    description:
      "Moderate or remove reviews via reviews API (admin queue UI placeholder; page gated)",
    audience: "staff",
  },
  [P.ReviewsCreateOwn]: {
    feature: "Reviews",
    action: "Write",
    label: "Write Reviews",
    description: "Customer can post storefront product reviews",
    audience: "client",
  },
  [P.TaxManage]: {
    feature: "Tax",
    action: "View / Save",
    label: "View / Edit Tax Settings",
    menu: "/admin/tax-settings",
    description:
      "Workspace settings → Tax: enable checkout tax rate/label. Separate from Venues / Billing / Payouts.",
    audience: "staff",
  },
  [P.AiManage]: {
    feature: "Assistant settings",
    action: "View / Save",
    label: "View / Edit Assistant Settings",
    menu: "/admin/ai-settings",
    description:
      "AI → Assistant settings: bot name, AI provider/model/key, knowledge mode, and connection test (Save)",
    audience: "staff",
  },
  [P.AiChatsRead]: {
    feature: "AI Chats",
    action: "View conversations",
    label: "View AI Conversations",
    menu: "/admin/ai-chats",
    description:
      "AI Chats → Conversations: inbox, history, handoffs, contacts (View)",
    audience: "staff",
  },
  [P.AiChatsReply]: {
    feature: "AI Chats",
    action: "Reply / Resolve",
    label: "Reply to AI Conversations",
    menu: "/admin/ai-chats",
    description:
      "AI Chats → Conversations: staff Reply, Reopen, Mark resolved",
    audience: "staff",
  },
  [P.AiChatsDelete]: {
    feature: "AI Chats",
    action: "Delete",
    label: "Delete AI Conversations",
    menu: "/admin/ai-chats",
    description:
      "AI Chats → Conversations: Delete one chat or bulk delete permanently",
    audience: "staff",
  },
  [P.AnalyticsRead]: {
    feature: "Dashboard",
    action: "View metrics",
    label: "View Dashboard Metrics",
    menu: "/admin",
    description:
      "Dashboard: analytics widgets, last transactions, recent orders, popular catalog items (shell is soft-gated; Preview website is ungated)",
    audience: "staff",
  },
  [P.UploadsWrite]: {
    feature: "Uploads",
    action: "Upload",
    label: "Upload Images",
    description:
      "POST /api/upload, /api/upload/sign, and /api/upload/bulk → Cloudinary for product, fabric, homepage CMS, ad banner, tailors, and tailoring-jobs folders (allowlist). Pair with products:write, fabrics:write, or settings:manage. Tailor portfolio images use POST /api/tailor/portfolio (folder tailors) with requireAuthFresh + active tailor Membership — not uploads:write",
    audience: "staff",
    matrixHidden: true,
  },
  [P.SettingsManage]: {
    feature: "Workspace settings",
    action: "Full workspace (legacy)",
    label: "Legacy: full Workspace settings umbrella",
    menu: "/admin/company-profile",
    description:
      "Legacy umbrella — implies Venues, HQ, Company profile, Billing, Payouts, Shipping fine-grained keys. Prefer those matrix checkboxes. Kept for existing seats/APIs.",
    audience: "staff",
    matrixHidden: true,
  },
  [P.UsersRead]: {
    feature: "Users",
    action: "View",
    label: "View Users",
    menu: "/admin/users",
    description:
      "Users sidebar: members list, member details, Role templates (read). Header profile menu → Users. Dashboard → Team members card",
    audience: "staff",
  },
  [P.UsersInvite]: {
    feature: "Users",
    action: "Invite",
    label: "Invite Users",
    menu: "/admin/users",
    description: "Users → Invite member (email invite to join the org)",
    audience: "staff",
  },
  [P.UsersManageRoles]: {
    feature: "Users",
    action: "Create / Edit roles",
    label: "Create Users / Edit Roles",
    menu: "/admin/users",
    description:
      "Users → Create user, Edit roles/permissions, Revoke membership, park venue assignments (PUT /api/admin/members/[id]/venue-assignments when actor is company-wide), New/Edit/Delete Role templates (permission matrix). Park admins must be assigned to at least one venue. FECSYNC storefront platform_admin also: Company workspaces (/admin/registered-companies) approve/suspend/clear_offboard/set_plan + Suspend any user account (platform-accounts) — Approve unlocks /admin; Suspend company uses ops_hold (records kept); Set plan emergency-stamps demo|starter|growth|enterprise (records untouched; enterprise stamp unlocks HQ when entitled); list shows venuesActive + enterpriseHqEligible; optional Approve plan stamp or Checkout entitles plan-capped creates; Approve alone does not entitle",
    audience: "staff",
  },
  [P.UsersDelete]: {
    feature: "Users",
    action: "Delete accounts",
    label: "Delete User Accounts",
    menu: "/admin/users",
    description:
      "Users → permanently delete a user (platform admin). Auto-blacklists email/phone",
    audience: "staff",
  },
  [P.UsersBlacklist]: {
    feature: "Users",
    action: "Manage blacklist",
    label: "Manage Account Blacklist",
    menu: "/admin/users",
    description:
      "Users → Blacklist tab: block/unblock email and phone from signup/login",
    audience: "staff",
  },
  [P.UsersResetPassword]: {
    feature: "Users",
    action: "Reset password",
    label: "Reset Staff Passwords",
    menu: "/admin/users",
    description:
      "Users → Reset password for another staff account (desk assist). Also grant View Users and company-wide view, or the Users list stays empty and Reset password stays hidden. Never applies to FECSYNC software owners unless you are also a software owner. Grant only to trusted seats — does not imply Users edit/delete, and cannot reveal or change a software owner.",
    audience: "staff",
  },
  [P.DeliveriesRead]: {
    feature: "Deliveries",
    action: "View",
    label: "View Deliveries",
    menu: "/admin/deliveries",
    description:
      "Operations → Deliveries: list/detail via GET /api/shipping/shipments (actor.orgId; CWV=false → shipments for orders you own)",
    audience: "staff",
  },
  [P.DeliveriesManage]: {
    feature: "Deliveries",
    action: "Update / Track",
    label: "Manage Deliveries",
    menu: "/admin/deliveries",
    description:
      "Operations → Deliveries: book/retry and cancel via POST /api/shipping/shipments (+ cancel); same CWV own-order rule as list",
    audience: "staff",
  },
  [P.ProfileManageOwn]: {
    feature: "Profile",
    action: "Manage own",
    label: "Manage Own Profile",
    menu: "/profile",
    description:
      "Customer /profile and staff /admin/profile: avatar, name, phone, bio, password. Email, role, and permissions are locked — only Users (platform admin) can change those",
    audience: "client",
  },
  [P.CartRead]: {
    feature: "Carts",
    action: "View list",
    label: "View Carts",
    description:
      "Staff cart list API (GET /api/cart). No dedicated Carts page in the admin sidebar",
    audience: "staff",
    matrixHidden: true,
  },
  [P.CartManageOwn]: {
    feature: "Cart",
    action: "Manage own",
    label: "Manage Own Cart",
    menu: "/cart",
    description:
      "Customer cart add / update / clear (/cart). Auth-any page; isolation is user=sub",
    audience: "client",
  },
  [P.WalletReadOwn]: {
    feature: "Wallet",
    action: "View own",
    label: "View Own Wallet",
    description: "Customer wallet balance (API; wallet UI pay is off)",
    audience: "client",
  },
  [P.WalletTransactOwn]: {
    feature: "Wallet",
    action: "Fund / Withdraw",
    label: "Fund / Withdraw Wallet",
    description: "Customer wallet fund / withdraw APIs",
    audience: "client",
  },
  [P.WalletRead]: {
    feature: "Wallets",
    action: "View list",
    label: "View Wallets",
    description:
      "Staff wallet list API (GET /api/wallet). No Wallets page in the admin sidebar",
    audience: "staff",
    matrixHidden: true,
  },
  [P.WalletManage]: {
    feature: "Wallets",
    action: "Manage",
    label: "Manage Wallets",
    description: "Staff wallet management APIs (no sidebar page)",
    audience: "staff",
    matrixHidden: true,
  },
  [P.PaymentsCheckoutOwn]: {
    feature: "Checkout",
    action: "Pay",
    label: "Pay at Checkout",
    menu: "/checkout",
    description:
      "Customer Stripe checkout (/checkout). Paystack UI off; wallet pay API-only",
    audience: "client",
  },
  [P.PaymentsRead]: {
    feature: "Payments",
    action: "View shop payments",
    label: "View Shop Payments (API)",
    description:
      "Staff payment / order totals APIs. No standalone shop Payments page in the admin sidebar — Online Booking → Payments uses bookings:payments_*",
    audience: "staff",
    matrixHidden: true,
  },
  [P.NotificationsReadOwn]: {
    feature: "Notifications",
    action: "View own",
    label: "View Own Notifications",
    description:
      "Own notification inbox (admin header bell + customer). Mark read / mark all; requireAuth + owner",
    audience: "client",
  },
  [P.TailorsRead]: {
    feature: "Tailors",
    action: "View",
    label: "View Tailors",
    menu: "/admin/tailors",
    description:
      "Tailors → Tailor profiles: sidebar menu, list table, View details (staff; actor.orgId)",
    audience: "staff",
  },
  [P.TailorsWriteOwn]: {
    feature: "Tailor Profile",
    action: "Edit own",
    label: "Edit Own Tailor Profile",
    menu: "/tailor/dashboard",
    description:
      "Approved tailor edits displayName, bio, specialties, location, portfolio, service info (/tailor/dashboard). Pending/draft/suspended cannot self-edit. Live API: requireAuthFresh + active tailor Membership (or staff owner) + status approved",
    audience: "client",
  },
  [P.TailorsManage]: {
    feature: "Tailors",
    action: "Create / Edit / Approve",
    label: "Manage Tailors",
    menu: "/admin/tailors",
    description:
      "Tailors → Tailor profiles: Create (link User), Edit, Approve, Suspend (staff; actor.orgId)",
    audience: "staff",
  },
  [P.MeasurementsReadOwn]: {
    feature: "Measurements",
    action: "View own",
    label: "View Own Measurements",
    description:
      "Customer measurement profiles. Live: requireAuth + user=sub via /api/measurement-profiles",
    audience: "client",
  },
  [P.MeasurementsWriteOwn]: {
    feature: "Measurements",
    action: "Manage own",
    label: "Manage Own Measurements",
    description:
      "Create/update own measurement profiles via /api/measurement-profiles",
    audience: "client",
  },
  [P.TailoringJobsReadOwn]: {
    feature: "My Tailoring Jobs",
    action: "View own",
    label: "View Own Tailoring Jobs",
    description:
      "Customer or assigned tailor views own jobs via /api/tailoring-jobs",
    audience: "client",
  },
  [P.TailoringJobsWriteOwn]: {
    feature: "My Tailoring Jobs",
    action: "Manage own",
    label: "Manage Own Tailoring Jobs",
    description:
      "Customer books/updates own jobs; tailor updates assigned jobs via /api/tailoring-jobs",
    audience: "client",
  },
  [P.TailoringJobsRead]: {
    feature: "Tailoring Jobs",
    action: "View",
    label: "View Tailoring Jobs",
    description:
      "Tailors → Tailoring jobs: staff list via /api/admin/tailoring-jobs (ops_manager+)",
    audience: "staff",
  },
  [P.TailoringJobsManage]: {
    feature: "Tailoring Jobs",
    action: "Manage",
    label: "Manage Tailoring Jobs",
    description:
      "Tailors → Tailoring jobs: staff manage via /api/admin/tailoring-jobs (ops_manager+)",
    audience: "staff",
  },
  [P.TicketingRead]: {
    feature: "Ticketing",
    action: "View (legacy)",
    label: "Legacy: view all Ticketing leaves",
    menu: "/admin/ticketing",
    description:
      "Legacy umbrella — implies View on Ticket products, Sessions, Add-ons, Passes, Resources, Ticketing settings. Prefer leaf checkboxes.",
    audience: "staff",
    matrixHidden: true,
  },
  [P.TicketingWrite]: {
    feature: "Ticketing",
    action: "Create / Edit (legacy)",
    label: "Legacy: edit all Ticketing leaves",
    menu: "/admin/ticketing",
    description:
      "Legacy umbrella — implies Create/Edit/Delete on ticketing leaf modules. Prefer leaf checkboxes.",
    audience: "staff",
    matrixHidden: true,
  },
  [P.TicketingManage]: {
    feature: "Ticketing settings",
    action: "Manage (legacy)",
    label: "Legacy: manage Ticketing settings",
    menu: "/admin/ticketing/settings",
    description:
      "Legacy umbrella — implies Ticketing settings View/Save plus write on ticketing leaves. Prefer ticketing_settings:* checkboxes.",
    audience: "staff",
    matrixHidden: true,
  },
  [P.BookingsRead]: {
    feature: "Bookings",
    action: "View",
    label: "View Bookings",
    menu: "/admin/bookings",
    description:
      "Bookings → list/detail/parties/calendar + Create booking domain tabs (live)",
    audience: "staff",
  },
  [P.BookingsWrite]: {
    feature: "Bookings",
    action: "Edit / Manage",
    label: "Edit / Manage Bookings",
    menu: "/admin/bookings",
    description:
      "Bookings list actions: edit, cancel, confirm, notes, ticket ids (Create booking is a separate permission)",
    audience: "staff",
  },
  [P.BookingsAssign]: {
    feature: "Bookings",
    action: "Assign staff",
    label: "Assign Booking Staff",
    menu: "/admin/bookings",
    description: "Bookings → assign staff on a booking (live)",
    audience: "staff",
  },
  [P.BookingsOverbook]: {
    feature: "Bookings",
    action: "Overbook",
    label: "Overbook Capacity",
    menu: "/admin/bookings",
    description: "Bookings → confirm beyond capacity (live)",
    audience: "staff",
  },
  [P.BookingsTaxExempt]: {
    feature: "Bookings",
    action: "Tax exempt",
    label: "Mark Booking Tax Exempt",
    menu: "/admin/bookings",
    description: "Bookings → mark tax-exempt (live)",
    audience: "staff",
  },
  [P.BookingsPaymentsRead]: {
    feature: "Payments",
    action: "View",
    label: "View Booking Payments",
    menu: "/admin/booking-payments",
    description: "Online Booking → Payments: payment list",
    audience: "staff",
  },
  [P.BookingsPaymentsTake]: {
    feature: "Payments",
    action: "Take payment",
    label: "Take Booking Payments",
    menu: "/admin/booking-payments",
    description: "Online Booking → Payments / booking detail: take payment / payment link",
    audience: "staff",
  },
  [P.BookingsChargeStored]: {
    feature: "Payments",
    action: "Charge stored card",
    label: "Charge Stored Card",
    menu: "/admin/booking-payments",
    description: "Online Booking → Take payment: charge stored card",
    audience: "staff",
  },
  [P.BookingsRefund]: {
    feature: "Payments",
    action: "Refund",
    label: "Refund Booking Payments",
    menu: "/admin/booking-payments",
    description: "Online Booking → Payments: refund a booking payment",
    audience: "staff",
  },
  [P.BookingsExport]: {
    feature: "Bookings",
    action: "Export",
    label: "Export Bookings",
    menu: "/admin/bookings",
    description:
      "Bookings → CSV/JSON export (live on bookings list; company workspace export includes redacted ticketing counts)",
    audience: "staff",
  },
  [P.BookingInvoicesRead]: {
    feature: "Booking invoices",
    action: "View",
    label: "View Booking Invoices",
    menu: "/admin/booking-invoices",
    description: "Bookings → Invoices list/detail (live)",
    audience: "staff",
  },
  [P.BookingInvoicesManage]: {
    feature: "Booking invoices",
    action: "Manage",
    label: "Manage Booking Invoices",
    menu: "/admin/booking-invoices",
    description: "Bookings → Invoices create/edit/cancel (live)",
    audience: "staff",
  },
  [P.BookingInvoicesSend]: {
    feature: "Booking invoices",
    action: "Send",
    label: "Send Booking Invoices",
    menu: "/admin/booking-invoices",
    description: "Bookings → Invoices send (live)",
    audience: "staff",
  },
  [P.BookingAccountsRead]: {
    feature: "Booking companies",
    action: "View",
    label: "View Booking Companies",
    menu: "/admin/booking-accounts",
    description: "Bookings → Companies (live): B2B booking accounts + contacts",
    audience: "staff",
  },
  [P.BookingAccountsWrite]: {
    feature: "Booking companies",
    action: "Create / Edit",
    label: "Create / Edit Booking Companies",
    menu: "/admin/booking-accounts",
    description: "Bookings → Companies (live): create/edit accounts and contacts",
    audience: "staff",
  },
  [P.BookingsReadOwn]: {
    feature: "My Bookings",
    action: "View own",
    label: "View Own Bookings",
    description:
      "Customer /api/me/bookings + profile Bookings tab (live)",
    audience: "client",
  },
  [P.BookingsWriteOwn]: {
    feature: "My Bookings",
    action: "Manage own",
    label: "Manage Own Bookings",
    description:
      "Customer cancel via /api/me/bookings + profile (live)",
    audience: "client",
  },
  [P.MembershipsReadOwn]: {
    feature: "My Memberships",
    action: "View own",
    label: "View Own Memberships",
    description:
      "Customer /api/me/memberships + profile Memberships tab (linked GuestProfile only)",
    audience: "client",
  },
  [P.MembershipsWriteOwn]: {
    feature: "My Memberships",
    action: "Manage own",
    label: "Manage Own Memberships",
    description:
      "Customer click-to-cancel, renew, upgrade, reactivate, card update, agreement sign via /api/me/memberships",
    audience: "client",
  },
  [P.BookingPackagesManage]: {
    feature: "Booking packages",
    action: "Manage (legacy)",
    label: "Legacy: full Booking packages manage",
    menu: "/admin/booking-packages",
    description:
      "Legacy umbrella — implies booking_packages:read|write|publish|delete. Prefer those checkboxes.",
    audience: "staff",
    matrixHidden: true,
  },
  [P.MarketplaceRefunds]: {
    feature: "Booking packages",
    action: "Refund marketplace bookings",
    label: "Refund Marketplace Bookings",
    menu: "/admin/booking-packages",
    description:
      "Online Booking → Booking packages: refund paid marketplace bookings (application fee with charge). Connect onboarding stays Payouts.",
    audience: "staff",
  },
  [P.VenuesRead]: {
    feature: "Venues",
    action: "View",
    label: "View Venues",
    menu: "/admin/venues",
    description: "Venues: list parks / sites for the company",
    audience: "staff",
  },
  [P.VenuesWrite]: {
    feature: "Venues",
    action: "Create / Edit",
    label: "Create / Edit Venues",
    menu: "/admin/venues",
    description: "Venues: create and edit park profiles (plan venues limit)",
    audience: "staff",
  },
  [P.VenuesArchive]: {
    feature: "Venues",
    action: "Archive / Reactivate",
    label: "Archive / Reactivate Venues",
    menu: "/admin/venues",
    description: "Venues: soft-archive or reactivate a park",
    audience: "staff",
  },
  [P.HqRead]: {
    feature: "Enterprise HQ",
    action: "View",
    label: "View Enterprise HQ",
    menu: "/admin/hq",
    description:
      "Workspace settings → Enterprise HQ: cross-park dashboard (entitled Enterprise; soft-upsell otherwise)",
    audience: "staff",
  },
  [P.CompanyProfileRead]: {
    feature: "Company profile",
    action: "View",
    label: "View Company Profile",
    menu: "/admin/company-profile",
    description: "Workspace settings → Company profile: view legal/contact/bank display fields and the public category switches",
    audience: "staff",
  },
  [P.CompanyProfileWrite]: {
    feature: "Company profile",
    action: "Edit",
    label: "Edit Company Profile",
    menu: "/admin/company-profile",
    description:
      "Workspace settings → Company profile: Save profile, logo, public category switches, embed origins, export, soft offboard (platform_admin)",
    audience: "staff",
  },
  [P.BillingRead]: {
    feature: "Billing",
    action: "View",
    label: "View Billing",
    menu: "/admin/billing",
    description: "Workspace settings → Billing: view plan, usage meters, invoices history",
    audience: "staff",
  },
  [P.BillingManage]: {
    feature: "Billing",
    action: "Checkout / Portal",
    label: "Manage Billing Checkout",
    menu: "/admin/billing",
    description: "Workspace settings → Billing: Stripe Checkout / Customer Portal (platform_admin)",
    audience: "staff",
  },
  [P.PayoutsRead]: {
    feature: "Payouts",
    action: "View",
    label: "View Payouts Status",
    menu: "/admin/payouts",
    description: "Workspace settings → Payouts: view Connect charge-ready / onboarding status",
    audience: "staff",
  },
  [P.PayoutsManage]: {
    feature: "Payouts",
    action: "Onboard / Sync",
    label: "Manage Connect Payouts",
    menu: "/admin/payouts",
    description:
      "Payouts: company org Connect (platform_admin + company-wide) or franchise park Connect (franchiseParkManager on assigned parks, or company-wide). Sync / Express login. Not SaaS Billing.",
    audience: "staff",
  },
  [P.ShippingRead]: {
    feature: "Shipping",
    action: "View",
    label: "View Shipping Settings",
    menu: "/admin/shipping-settings",
    description: "Workspace settings → Shipping: view origin, parcel, providers",
    audience: "staff",
  },
  [P.ShippingWrite]: {
    feature: "Shipping",
    action: "Save",
    label: "Edit Shipping Settings",
    menu: "/admin/shipping-settings",
    description: "Workspace settings → Shipping: save origin, parcel, auto-book, providers",
    audience: "staff",
  },
  [P.TicketingProductsRead]: {
    feature: "Ticket products",
    action: "View",
    label: "View Ticket Products",
    menu: "/admin/ticketing",
    description:
      "Online Booking → Ticket products: list and open product detail. Also opens Booking category, including the public link and embed snippet.",
    audience: "staff",
  },
  [P.TicketingProductsWrite]: {
    feature: "Ticket products",
    action: "Create / Edit",
    label: "Create / Edit Ticket Products",
    menu: "/admin/ticketing",
    description:
      "Online Booking → Ticket products: Create product, Edit, publish fields. Also creates and edits booking categories, including the public slug, layout, and embed flag.",
    audience: "staff",
  },
  [P.TicketingProductsDelete]: {
    feature: "Ticket products",
    action: "Archive / Delete",
    label: "Archive Ticket Products",
    menu: "/admin/ticketing",
    description: "Online Booking → Ticket products: archive or remove a product",
    audience: "staff",
  },
  [P.TicketingSessionsRead]: {
    feature: "Sessions",
    action: "View",
    label: "View Sessions",
    menu: "/admin/ticketing/sessions",
    description: "Online Booking → Sessions: list ticket sessions",
    audience: "staff",
  },
  [P.TicketingSessionsWrite]: {
    feature: "Sessions",
    action: "Create / Edit",
    label: "Create / Edit Sessions",
    menu: "/admin/ticketing/sessions",
    description: "Online Booking → Sessions: create, edit, close sessions",
    audience: "staff",
  },
  [P.TicketingAddOnsRead]: {
    feature: "Add-ons",
    action: "View",
    label: "View Add-ons",
    menu: "/admin/ticketing/add-ons",
    description: "Online Booking → Add-ons: list add-on products and stock periods",
    audience: "staff",
  },
  [P.TicketingAddOnsWrite]: {
    feature: "Add-ons",
    action: "Create / Edit",
    label: "Create / Edit Add-ons",
    menu: "/admin/ticketing/add-ons",
    description: "Online Booking → Add-ons: create/edit add-ons and stock periods",
    audience: "staff",
  },
  [P.TicketingPassesRead]: {
    feature: "Passes",
    action: "View",
    label: "View Passes",
    menu: "/admin/ticketing/passes",
    description: "Online Booking → Passes: list pass products",
    audience: "staff",
  },
  [P.TicketingPassesWrite]: {
    feature: "Passes",
    action: "Create / Edit",
    label: "Create / Edit Passes",
    menu: "/admin/ticketing/passes",
    description: "Online Booking → Passes: create/edit pass products",
    audience: "staff",
  },
  [P.TicketingResourcesRead]: {
    feature: "Resources",
    action: "View",
    label: "View Resources",
    menu: "/admin/ticketing/resources",
    description: "Online Booking → Resources: list capacity resources",
    audience: "staff",
  },
  [P.TicketingResourcesWrite]: {
    feature: "Resources",
    action: "Create / Edit",
    label: "Create / Edit Resources",
    menu: "/admin/ticketing/resources",
    description: "Online Booking → Resources: create/edit/archive resources",
    audience: "staff",
  },
  [P.TicketingSettingsRead]: {
    feature: "Ticketing settings",
    action: "View",
    label: "View Ticketing Settings",
    menu: "/admin/ticketing/settings",
    description: "Online Booking → Ticketing settings: view hold/reserve defaults",
    audience: "staff",
  },
  [P.TicketingSettingsWrite]: {
    feature: "Ticketing settings",
    action: "Save",
    label: "Save Ticketing Settings",
    menu: "/admin/ticketing/settings",
    description: "Online Booking → Ticketing settings: Save defaults, TTLs, pay-later",
    audience: "staff",
  },
  [P.MembershipsRead]: {
    feature: "Memberships",
    action: "View",
    label: "View Memberships",
    menu: "/admin/memberships/plans",
    description:
      "Memberships → plans, members, categories, eligibility, settings, reports, dunning queue (guest park — not staff seats). Category readers see the public link and embed snippet. Redeem desk page + verify/redeem actions need memberships:redeem",
    audience: "staff",
  },
  [P.MembershipsWrite]: {
    feature: "Memberships",
    action: "Create / Edit",
    label: "Edit Membership Plans & Settings",
    menu: "/admin/memberships/plans",
    description:
      "Memberships → create/edit plans, categories, settings, eligibility, guest profiles. Category writers save the public slug, layout, and embed flag. Renaming does not change the public slug.",
    audience: "staff",
  },
  [P.MembershipsSell]: {
    feature: "Memberships",
    action: "Sell",
    label: "Sell / Renew Memberships",
    menu: "/admin/memberships/members",
    description:
      "Memberships → sell/renew guest memberships (admin + POS adapter)",
    audience: "staff",
  },
  [P.MembershipsBilling]: {
    feature: "Memberships",
    action: "Billing",
    label: "Membership Billing Ops",
    menu: "/admin/memberships/members",
    description:
      "Memberships → upgrade/downgrade/pause/reactivate/card/credit/dunning",
    audience: "staff",
  },
  [P.MembershipsCancel]: {
    feature: "Memberships",
    action: "Cancel",
    label: "Cancel Memberships",
    menu: "/admin/memberships/members",
    description:
      "Memberships → staff cancel (immediate or end of period); guest click-to-cancel is Profile → Memberships when settings allow",
    audience: "staff",
  },
  [P.MembershipsRedeem]: {
    feature: "Memberships",
    action: "Redeem",
    label: "Redeem / Verify Memberships",
    menu: "/admin/memberships/redeem",
    description:
      "Memberships → verify/redeem entitlements at Redeem desk (+ POS/online adapters)",
    audience: "staff",
  },
  [P.MembershipsAdmin]: {
    feature: "Memberships",
    action: "Admin",
    label: "Memberships Admin",
    menu: "/admin/memberships/settings",
    description:
      "Memberships → elevated settings overrides; also unlocks redeem desk + money actions as admin override (same pattern as ticketing admin); plan archive also allowed via memberships:write",
    audience: "staff",
  },
  [P.WaiversRead]: {
    feature: "Waivers",
    action: "View",
    label: "View Waivers",
    menu: "/admin/waivers",
    description:
      "Waivers → Waivers, Template, Forms, Signage, Kiosk, and Settings. Verify, responses, export, sign on-site, import, and compliance open from the Waivers table.",
    audience: "staff",
  },
  [P.WaiversWrite]: {
    feature: "Waivers",
    action: "Create / Edit",
    label: "Edit Waiver Templates",
    menu: "/admin/waivers/templates",
    description:
      "Waivers → draft templates and forms (fields, clauses, layouts; questions are built in the form wizard), requirements, on-site and resend links, party chase, and standing signage",
    audience: "staff",
  },
  [P.WaiversVerify]: {
    feature: "Waivers",
    action: "Verify",
    label: "Verify Waivers",
    menu: "/admin/waivers/verify",
    description:
      "Front desk verify at /admin/waivers/verify. Optional admission product or membership plan uses the same engine as the product flag. This is not the check-in scanner.",
    audience: "staff",
  },
  [P.WaiversVoid]: {
    feature: "Waivers",
    action: "Void",
    label: "Void Waivers",
    menu: "/admin/waivers",
    description:
      "Void a signed waiver with a reason. The row and signature stay for retention.",
    audience: "staff",
  },
  [P.WaiversAdmin]: {
    feature: "Waivers",
    action: "Admin",
    label: "Waiver Admin",
    menu: "/admin/waivers/settings",
    description:
      "Waivers → settings (including optional staff notification email per venue), publish a version, historical signed-guest CSV import, kiosk devices (including token rotation), and jurisdiction",
    audience: "staff",
  },
  [P.WaiversExport]: {
    feature: "Waivers",
    action: "Export",
    label: "Export Waivers",
    menu: "/admin/waivers",
    description:
      "Download a waiver or form-response CSV. The file includes content hashes and omits signature drawings.",
    audience: "staff",
  },
  [P.MarketingRead]: {
    feature: "Marketing",
    action: "View",
    label: "View Marketing",
    menu: "/admin/marketing",
    description:
      "Marketing → overview, newsletter leads, automations, and send history (Growth+ guest marketing automation)",
    audience: "staff",
  },
  [P.MarketingWrite]: {
    feature: "Marketing",
    action: "Configure",
    label: "Configure Marketing",
    menu: "/admin/marketing/settings",
    description:
      "Marketing → automation toggles, delays, CTAs, from/reply settings, and lead consent edits",
    audience: "staff",
  },
  [P.MarketingSend]: {
    feature: "Marketing",
    action: "Send test",
    label: "Marketing test send",
    menu: "/admin/marketing/automations",
    description:
      "Send a one-off test promotional template to the signed-in staff email only (never bulk from test)",
    audience: "staff",
  },
  [P.MarketingSurveys]: {
    feature: "Marketing",
    action: "Surveys",
    label: "Guest surveys",
    menu: "/admin/marketing/surveys",
    description:
      "Marketing → create, publish, and review post-visit guest surveys and invite responses",
    audience: "staff",
  },
  [P.MarketingExport]: {
    feature: "Marketing",
    action: "Export",
    label: "Export marketing data",
    menu: "/admin/marketing/surveys",
    description:
      "Export survey response CSV from Marketing (no raw lead email dump from workspace export)",
    audience: "staff",
  },
  [P.PosSell]: {
    feature: "POS",
    action: "Sell",
    label: "POS · Sell",
    menu: "/admin/pos",
    description:
      "Open a POS cart and complete a sale (cash, in-browser card Elements confirm, or payment link). Includes confirm-card and card-secrets.",
    audience: "staff",
  },
  [P.PosRead]: {
    feature: "POS",
    action: "View",
    label: "POS · View",
    menu: "/admin/pos/sales",
    description:
      "View POS sales, catalog, and devices for parks in scope. Can see unpaid sales awaiting card; confirming card requires pos:sell.",
    audience: "staff",
  },
  [P.PosRefund]: {
    feature: "POS",
    action: "Refund",
    label: "POS · Refund",
    menu: "/admin/pos/sales",
    description: "Refund a POS sale back to the original tender or a gift card.",
    audience: "staff",
  },
  [P.PosVoid]: {
    feature: "POS",
    action: "Void",
    label: "POS · Void",
    menu: "/admin/pos/sales",
    description: "Void an open or completed POS sale.",
    audience: "staff",
  },
  [P.PosDiscount]: {
    feature: "POS",
    action: "Discount",
    label: "POS · Discount",
    menu: "/admin/pos",
    description: "Apply a POS discount code. A manager PIN is required when settings say so.",
    audience: "staff",
  },
  [P.PosCash]: {
    feature: "POS",
    action: "Cash",
    label: "POS · Cash",
    menu: "/admin/pos",
    description: "Take cash on a POS sale. Requires an open till when settings say so.",
    audience: "staff",
  },
  [P.PosTillOpen]: {
    feature: "POS",
    action: "Open till",
    label: "POS · Open till",
    menu: "/admin/pos/tills",
    description: "Open a till session with an opening float. One open session per device.",
    audience: "staff",
  },
  [P.PosTillClose]: {
    feature: "POS",
    action: "Close till",
    label: "POS · Close till",
    menu: "/admin/pos/tills",
    description: "Close a till with a counted cash total and variance.",
    audience: "staff",
  },
  [P.PosTillNoCount]: {
    feature: "POS",
    action: "Close till without count",
    label: "POS · Close till without count",
    menu: "/admin/pos/tills",
    description: "Close a till without entering a cash count.",
    audience: "staff",
  },
  [P.PosTillEdit]: {
    feature: "POS",
    action: "Edit till",
    label: "POS · Edit till",
    menu: "/admin/pos/tills",
    description: "Edit a closed till. An edit reason is required. Expected cash stays visible.",
    audience: "staff",
  },
  [P.PosWastage]: {
    feature: "POS",
    action: "Wastage",
    label: "POS · Wastage",
    menu: "/admin/pos/admin",
    description: "Record wastage that decrements on-hand stock without a sale.",
    audience: "staff",
  },
  [P.PosAdmin]: {
    feature: "POS",
    action: "Admin",
    label: "POS · Admin",
    menu: "/admin/pos/admin",
    description: "POS settings, devices, menus, products, and discount codes.",
    audience: "staff",
  },
  [P.PosManagerOverride]: {
    feature: "POS",
    action: "Manager override",
    label: "POS · Manager override",
    menu: "/admin/pos",
    description: "Approve a banned-guest sale, past-date redeem, or overbook with a manager PIN.",
    audience: "staff",
  },
  [P.PosCheckin]: {
    feature: "POS",
    action: "Check in",
    label: "POS · Check in",
    menu: "/admin/pos/check-in",
    description: "Redeem a paid ticket or guest membership on the POS check-in screen.",
    audience: "staff",
  },
  [P.PosTabs]: {
    feature: "POS",
    action: "Tabs",
    label: "POS · Tabs",
    menu: "/admin/pos/tabs",
    description:
      "Open, split, pre-authorize, and settle a guest tab. Card settle without preauth uses in-browser Elements confirm; tip on a captured preauth needs a separate tender. Split and preauth are beta.",
    audience: "staff",
  },
  [P.PosGuestsWrite]: {
    feature: "POS",
    action: "Guests",
    label: "POS · Guests",
    menu: "/admin/pos",
    description: "Create a guest profile from POS. Does not create a public shop user.",
    audience: "staff",
  },
  [P.PosChargeStored]: {
    feature: "POS",
    action: "Charge stored card",
    label: "POS · Charge stored card",
    menu: "/admin/pos",
    description:
      "Authorize the stored-card tender on POS. Vaulted GuestProfile.stripeCustomerId charge is not wired yet — today this uses the same in-browser Elements PaymentIntent path as card.",
    audience: "staff",
  },
  [P.PartiesRead]: {
    feature: "Parties",
    action: "View",
    label: "View Parties",
    menu: "/admin/parties",
    description:
      "Parties: list parties, open party detail, run sheets, balances, packages, rooms, menu, and party settings (read only)",
    audience: "staff",
  },
  [P.PartiesWrite]: {
    feature: "Parties",
    action: "Edit",
    label: "Edit Parties",
    menu: "/admin/parties",
    description:
      "Parties: create and edit parties, confirm, cancel, reactivate, change room, assign host, edit guests and run sheet",
    audience: "staff",
  },
  [P.PartiesManage]: {
    feature: "Parties",
    action: "Manage",
    label: "Manage Parties setup",
    menu: "/admin/parties/settings",
    description:
      "Parties: edit party settings (deposits, cutoffs, online booking) and manage party packages, rooms, and menu without ticketing write",
    audience: "staff",
  },
  [P.PartiesInvitations]: {
    feature: "Parties",
    action: "Invitations",
    label: "Send Party invitations",
    menu: "/admin/parties",
    description: "Parties: create, send, and cancel guest invitation links (RSVP)",
    audience: "staff",
  },
  [P.PartiesFood]: {
    feature: "Parties",
    action: "Food",
    label: "Edit Party food",
    menu: "/admin/parties",
    description:
      "Parties: edit food orders, submit them to the kitchen, and override the food cutoff with a reason",
    audience: "staff",
  },
  [P.PartiesReadOwn]: {
    feature: "My parties",
    action: "View",
    label: "View own parties",
    menu: "/profile?tab=bookings",
    description: "Customer: see party bookings you made (date, room, guests, amount due)",
    audience: "client",
  },
  [P.PartiesWriteOwn]: {
    feature: "My parties",
    action: "Edit",
    label: "Edit own parties",
    menu: "/profile?tab=bookings",
    description:
      "Customer: edit your own party guest list, food (when the venue allows), invitations, and cancel before the cutoff",
    audience: "client",
  },
  [P.BookingsCalendarRead]: {
    feature: "Calendar",
    action: "View",
    label: "View Bookings Calendar",
    menu: "/admin/bookings/calendar",
    description: "Online Booking → Calendar: view booking calendar",
    audience: "staff",
  },
  [P.BookingsCreate]: {
    feature: "Create booking",
    action: "Open wizard",
    label: "Create Booking",
    menu: "/admin/bookings/new",
    description:
      "Online Booking → Create booking: domain-tab staff create (Details → Product & session → Guests & add-ons → Options → Review); payments/staff remain on booking detail",
    audience: "staff",
  },
  [P.BookingPackagesRead]: {
    feature: "Booking packages",
    action: "View",
    label: "View Booking Packages",
    menu: "/admin/booking-packages",
    description: "Online Booking → Booking packages: list packages and marketplace bookings",
    audience: "staff",
  },
  [P.BookingPackagesWrite]: {
    feature: "Booking packages",
    action: "Create / Edit",
    label: "Create / Edit Booking Packages",
    menu: "/admin/booking-packages",
    description: "Online Booking → Booking packages: create and edit package fields",
    audience: "staff",
  },
  [P.BookingPackagesPublish]: {
    feature: "Booking packages",
    action: "Publish",
    label: "Publish Booking Packages",
    menu: "/admin/booking-packages",
    description: "Online Booking → Booking packages: Publish checkbox / go live",
    audience: "staff",
  },
  [P.BookingPackagesDelete]: {
    feature: "Booking packages",
    action: "Delete",
    label: "Delete Booking Packages",
    menu: "/admin/booking-packages",
    description: "Online Booking → Booking packages: delete or soft-retire a package",
    audience: "staff",
  },
  [P.RegisteredCompaniesRead]: {
    feature: "Company workspaces",
    action: "View",
    label: "View Company Workspaces",
    menu: "/admin/registered-companies",
    description:
      "Company workspaces: list registered companies (FECSYNC storefront platform_admin)",
    audience: "staff",
  },
  [P.RegisteredCompaniesManage]: {
    feature: "Company workspaces",
    action: "Approve / Suspend / Set plan",
    label: "Manage Company Workspaces",
    menu: "/admin/registered-companies",
    description:
      "Company workspaces: Approve, Suspend, Clear offboard, Set plan, Suspend user accounts",
    audience: "staff",
  },
  [P.UsersParkAssign]: {
    feature: "Users",
    action: "Assign park venues",
    label: "Assign Park Venues",
    menu: "/admin/users",
    description:
      "Users → park venue assignments on Create/Edit member (company-wide actor only)",
    audience: "staff",
  },
  [P.AccountingRead]: {
    feature: "Accounting",
    action: "View",
    label: "Accounting · View",
    menu: "/admin/accounting",
    description: "Accounting dashboard, chart of accounts, general ledger, journals, and source entries for parks in scope.",
    audience: "staff",
  },
  [P.AccountingManage]: {
    feature: "Accounting",
    action: "Manage setup",
    label: "Accounting · Manage setup",
    menu: "/admin/accounting/settings",
    description: "Setup, settings, chart of accounts, mappings, tax codes, periods, opening balances, bank accounts, expense categories, posting queue retry/skip.",
    audience: "staff",
  },
  [P.AccountingJournalsWrite]: {
    feature: "Accounting",
    action: "Create journals",
    label: "Accounting · Create journals",
    menu: "/admin/accounting/journals",
    description: "Create, edit, delete and submit draft manual journals.",
    audience: "staff",
  },
  [P.AccountingJournalsApprove]: {
    feature: "Accounting",
    action: "Approve journals",
    label: "Accounting · Approve journals",
    menu: "/admin/accounting/approvals",
    description: "Approve or reject manual journals waiting for approval (never your own unless self-approval is allowed).",
    audience: "staff",
  },
  [P.AccountingJournalsPost]: {
    feature: "Accounting",
    action: "Post journals",
    label: "Accounting · Post journals",
    menu: "/admin/accounting/journals",
    description: "Post approved (or below-threshold) manual journals to the ledger.",
    audience: "staff",
  },
  [P.AccountingJournalsReverse]: {
    feature: "Accounting",
    action: "Reverse entries",
    label: "Accounting · Reverse entries",
    menu: "/admin/accounting/journals",
    description: "Reverse posted manual entries with a reason (system entries are reversed by their source module).",
    audience: "staff",
  },
  [P.AccountingPeriodsClose]: {
    feature: "Accounting",
    action: "Close periods",
    label: "Accounting · Close periods",
    menu: "/admin/accounting/periods",
    description: "Close monthly periods and run the year-end close into retained earnings.",
    audience: "staff",
  },
  [P.AccountingPeriodsReopen]: {
    feature: "Accounting",
    action: "Reopen periods",
    label: "Accounting · Reopen periods",
    menu: "/admin/accounting/periods",
    description: "Reopen the latest closed period with a reason. Locked fiscal years stay locked.",
    audience: "staff",
  },
  [P.AccountingReceivablesRead]: {
    feature: "Accounting",
    action: "View receivables",
    label: "Accounting · View receivables",
    menu: "/admin/accounting/customers",
    description: "Customer balances, aging, invoices, receipts and statements.",
    audience: "staff",
  },
  [P.AccountingReceivablesWrite]: {
    feature: "Accounting",
    action: "Manage receivables",
    label: "Accounting · Manage receivables",
    menu: "/admin/accounting/invoices",
    description: "Manual invoices, credit notes, customer receipts, statement links, and write-off requests.",
    audience: "staff",
  },
  [P.AccountingPayablesRead]: {
    feature: "Accounting",
    action: "View payables",
    label: "Accounting · View payables",
    menu: "/admin/accounting/suppliers",
    description: "Suppliers, purchase orders, bills, supplier payments, and AP aging.",
    audience: "staff",
  },
  [P.AccountingPayablesWrite]: {
    feature: "Accounting",
    action: "Manage payables",
    label: "Accounting · Manage payables",
    menu: "/admin/accounting/bills",
    description: "Create suppliers, purchase orders, bills, and supplier payment drafts; receive goods; post approved documents.",
    audience: "staff",
  },
  [P.AccountingPayablesApprove]: {
    feature: "Accounting",
    action: "Approve payables",
    label: "Accounting · Approve payables",
    menu: "/admin/accounting/approvals",
    description: "Approve purchase orders, supplier bills, and supplier payments.",
    audience: "staff",
  },
  [P.AccountingExpensesSubmit]: {
    feature: "Accounting",
    action: "Submit expenses",
    label: "Accounting · Submit expenses",
    menu: "/admin/accounting/expenses",
    description: "Create and submit your own expenses with receipts.",
    audience: "staff",
  },
  [P.AccountingExpensesRead]: {
    feature: "Accounting",
    action: "View all expenses",
    label: "Accounting · View all expenses",
    menu: "/admin/accounting/expenses",
    description: "See every expense in your park scope.",
    audience: "staff",
  },
  [P.AccountingExpensesWrite]: {
    feature: "Accounting",
    action: "Manage expenses",
    label: "Accounting · Manage expenses",
    menu: "/admin/accounting/expenses",
    description: "Edit any draft expense, pay reimbursements, and void expenses.",
    audience: "staff",
  },
  [P.AccountingExpensesApprove]: {
    feature: "Accounting",
    action: "Approve expenses",
    label: "Accounting · Approve expenses",
    menu: "/admin/accounting/approvals",
    description: "Approve or reject submitted expenses.",
    audience: "staff",
  },
  [P.AccountingBankingRead]: {
    feature: "Accounting",
    action: "View banking",
    label: "Accounting · View banking",
    menu: "/admin/accounting/banking",
    description: "Bank, cash and clearing account balances, statement lines, and transfers.",
    audience: "staff",
  },
  [P.AccountingBankingWrite]: {
    feature: "Accounting",
    action: "Manage banking",
    label: "Accounting · Manage banking",
    menu: "/admin/accounting/banking",
    description: "Import statements, add bank lines, match, exclude, create entries from bank lines, and record transfers.",
    audience: "staff",
  },
  [P.AccountingReconcile]: {
    feature: "Accounting",
    action: "Reconcile",
    label: "Accounting · Reconcile",
    menu: "/admin/accounting/reconciliations",
    description: "Run and complete bank reconciliations.",
    audience: "staff",
  },
  [P.AccountingInventoryRead]: {
    feature: "Accounting",
    action: "View inventory value",
    label: "Accounting · View inventory value",
    menu: "/admin/accounting/inventory",
    description: "Inventory valuation, average costs, and stock movements.",
    audience: "staff",
  },
  [P.AccountingInventoryWrite]: {
    feature: "Accounting",
    action: "Adjust inventory",
    label: "Accounting · Adjust inventory",
    menu: "/admin/accounting/inventory",
    description: "Stock adjustments with a reason and unit cost updates (revaluation).",
    audience: "staff",
  },
  [P.AccountingReportsRead]: {
    feature: "Accounting",
    action: "View reports",
    label: "Accounting · View reports",
    menu: "/admin/accounting/reports",
    description: "Profit and loss, balance sheet, cash flow, trial balance, aging, sales, expenses, tax, and inventory reports.",
    audience: "staff",
  },
  [P.AccountingExport]: {
    feature: "Accounting",
    action: "Export",
    label: "Accounting · Export",
    menu: "/admin/accounting/reports",
    description: "Download accounting lists and reports as CSV or PDF.",
    audience: "staff",
  },
  [P.AccountingAuditRead]: {
    feature: "Accounting",
    action: "View audit trail",
    label: "Accounting · View audit trail",
    menu: "/admin/accounting/audit",
    description: "Who created, approved, posted, changed, or reversed financial records.",
    audience: "staff",
  },
  [P.AccountingStatementsReadOwn]: {
    feature: "My Billing",
    action: "View own",
    label: "View my invoices and statements",
    menu: "/profile?tab=billing",
    description: "Customer: own invoices, payments, balance, and statement.",
    audience: "client",
  },
};

/** Admin sidebar-aligned feature order for grant UIs (Users → Role templates matrix). */
export const PERMISSION_FEATURE_ORDER: string[] = [
  "Dashboard",
  "Menu items",
  "Categories",
  "Orders",
  "Deliveries",
  "Reviews",
  "Bookings",
  "Calendar",
  "Create booking",
  "Parties",
  "Ticket products",
  "Sessions",
  "Add-ons",
  "Passes",
  "Resources",
  "Booking packages",
  "Booking companies",
  "Booking invoices",
  "Payments",
  "Ticketing settings",
  "Memberships",
  "Accounting",
  "AI Chats",
  "Assistant settings",
  "Users",
  "Company workspaces",
  "Venues",
  "Enterprise HQ",
  "Company profile",
  "Billing",
  "Payouts",
  "Tax",
  "Shipping",
  "Uploads",
  "Payments",
  "Wallets",
  "Carts",
  // Hidden from matrix via adminUiHidden / matrixHidden — kept for order stability
  "Fabrics",
  "Customizations",
  "Tailors",
  "Tailoring Jobs",
  "Ticketing",
  "Workspace settings",
  "Marketplace payouts",
  // Customer / self-service (not shown in staff matrix)
  "Profile",
  "Tailor Profile",
  "My Orders",
  "My Customizations",
  "My Bookings",
  "My Billing",
  "My Tailoring Jobs",
  "Measurements",
  "Cart",
  "Wallet",
  "Checkout",
  "Notifications",
  "Other",
];

export function permissionCatalogEntry(
  permission: string
): PermissionCatalogEntry | null {
  if (!isPermission(permission)) return null;
  return PERMISSION_CATALOG[permission];
}

/** Checkbox label: "View catalog items". Falls back to raw key. */
export function permissionLabel(permission: string): string {
  return permissionCatalogEntry(permission)?.label ?? permission;
}

export function permissionFeature(permission: string): string {
  return permissionCatalogEntry(permission)?.feature ?? "Other";
}

export function permissionAction(permission: string): string {
  return permissionCatalogEntry(permission)?.action ?? permission;
}

export function permissionDescription(permission: string): string {
  return permissionCatalogEntry(permission)?.description ?? "";
}

/** Group permissions under feature headings (screenshot-style catalog). */
export function groupPermissionsByFeature(
  permissions: readonly string[]
): { feature: string; items: Permission[] }[] {
  const map = new Map<string, Permission[]>();
  for (const raw of permissions) {
    if (!isPermission(raw)) continue;
    const entry = PERMISSION_CATALOG[raw];
    if (entry.matrixHidden) continue;
    if (entry.audience !== "staff") continue;
    const feature = permissionFeature(raw);
    if (isAdminUiHiddenPermissionFeature(feature)) continue;
    const bucket = map.get(feature);
    if (bucket) {
      bucket.push(raw);
    } else {
      map.set(feature, [raw]);
    }
  }

  const ordered: { feature: string; items: Permission[] }[] = [];
  for (const feature of PERMISSION_FEATURE_ORDER) {
    if (isAdminUiHiddenPermissionFeature(feature)) {
      map.delete(feature);
      continue;
    }
    const items = map.get(feature);
    if (items?.length) {
      ordered.push({ feature, items });
      map.delete(feature);
    }
  }
  for (const [feature, items] of map) {
    if (isAdminUiHiddenPermissionFeature(feature)) continue;
    ordered.push({ feature, items });
  }
  return ordered;
}

/**
 * Matches User.role mongoose enum. Live writes use only `admin` | `client`.
 * `seller` remains for legacy rows until `yarn ensure-memberships` migrates them.
 */
export const DB_USER_ROLES = ["admin", "seller", "client"] as const;
export type DbUserRole = (typeof DB_USER_ROLES)[number];

/**
 * Step 7.1 — archived User.role values (not Membership presets).
 * Kept in the mongoose enum so old documents load; catalog + JWT normalize
 * them to `client`. Do not add `seller` to ROLE_PRESET_IDS.
 */
export const ARCHIVED_DB_ROLES = ["seller"] as const;
export type ArchivedDbRole = (typeof ARCHIVED_DB_ROLES)[number];

/** Canonical roles for new writes / JWT claims after archive normalization. */
export const LIVE_DB_USER_ROLES = ["admin", "client"] as const;
export type LiveDbUserRole = (typeof LIVE_DB_USER_ROLES)[number];

/** UI store maps backend `client` → `user` (see src/services/auth.ts). */
export const FRONTEND_ROLE_ALIASES = {
  user: "client",
} as const;

export type FrontendRoleAlias = keyof typeof FRONTEND_ROLE_ALIASES;

export function isFrontendRoleAlias(value: string): value is FrontendRoleAlias {
  return Object.prototype.hasOwnProperty.call(FRONTEND_ROLE_ALIASES, value);
}

export function isArchivedDbRole(value: string): value is ArchivedDbRole {
  return (ARCHIVED_DB_ROLES as readonly string[]).includes(value);
}

/**
 * JWT/DB role. UI `"user"` → `client`. Archived `"seller"` → `client`
 * (Step 7.1 — not a staff or Membership preset).
 */
export function toDbUserRole(role: string | null | undefined): LiveDbUserRole {
  if (!role) return "client";
  if (isFrontendRoleAlias(role)) {
    return FRONTEND_ROLE_ALIASES[role];
  }
  if (isArchivedDbRole(role)) return "client";
  if (role === "admin" || role === "client") return role;
  return "client";
}

export const ROLE_PRESET_IDS = [
  "platform_admin",
  "ops_manager",
  "catalog_editor",
  "finance",
  "custom",
  "tailor",
  "client",
] as const;
export type RolePresetId = (typeof ROLE_PRESET_IDS)[number];

export type PermissionList = readonly Permission[];

function isOwnPermission(permission: Permission): boolean {
  return permission.endsWith("_own");
}

/** Provider-only *_own keys — not granted on the storefront `client` preset. */
const PROVIDER_OWN_PERMISSIONS: ReadonlySet<Permission> = new Set([
  P.TailorsWriteOwn,
]);

/**
 * Booking *_own — storefront customers only. Excluded from CLIENT_PERMISSIONS
 * base so the `tailor` preset (CLIENT + TailorsWriteOwn) does not get ticketing/
 * bookings customer keys (spec: tailor none for ticketing/bookings).
 */
const BOOKING_OWN_PERMISSIONS: ReadonlySet<Permission> = new Set([
  P.BookingsReadOwn,
  P.BookingsWriteOwn,
  P.PartiesReadOwn,
  P.PartiesWriteOwn,
  P.MembershipsReadOwn,
  P.MembershipsWriteOwn,
  P.AccountingStatementsReadOwn,
]);

export const STAFF_PERMISSIONS: Permission[] = PERMISSIONS.filter(
  (permission) => !isOwnPermission(permission)
);

export const CLIENT_PERMISSIONS: Permission[] = PERMISSIONS.filter(
  (permission) =>
    isOwnPermission(permission) &&
    !PROVIDER_OWN_PERMISSIONS.has(permission) &&
    !BOOKING_OWN_PERMISSIONS.has(permission)
);

const CATALOG_EDITOR_PERMISSIONS: Permission[] = [
  P.ProductsRead,
  P.ProductsWrite,
  P.ProductsDelete,
  P.FabricsRead,
  P.FabricsWrite,
  P.FabricsDelete,
  P.CategoriesRead,
  P.CategoriesWrite,
  P.CategoriesDelete,
  P.UploadsWrite,
  P.TicketingRead,
  P.TicketingWrite,
  P.TicketingProductsRead,
  P.TicketingProductsWrite,
  P.TicketingProductsDelete,
  P.TicketingSessionsRead,
  P.TicketingSessionsWrite,
  P.TicketingAddOnsRead,
  P.TicketingAddOnsWrite,
  P.TicketingPassesRead,
  P.TicketingPassesWrite,
  P.TicketingResourcesRead,
  P.TicketingResourcesWrite,
  P.BookingsRead,
  P.BookingsCalendarRead,
  P.PartiesRead,
  P.BookingPackagesManage,
  P.BookingPackagesRead,
  P.BookingPackagesWrite,
  P.BookingPackagesPublish,
  P.BookingPackagesDelete,
  P.MembershipsRead,
  P.MembershipsWrite,
  P.AccountingInventoryRead,
  P.AccountingInventoryWrite,
];

const OPS_MANAGER_PERMISSIONS: Permission[] = [
  P.OrdersRead,
  P.OrdersManage,
  P.CustomizationsRead,
  P.CustomizationsManage,
  P.ReviewsRead,
  P.ReviewsModerate,
  P.AnalyticsRead,
  P.DeliveriesRead,
  P.DeliveriesManage,
  P.AiChatsRead,
  P.AiChatsReply,
  P.AiChatsDelete,
  P.TailorsRead,
  P.TailorsManage,
  P.TailoringJobsRead,
  P.TailoringJobsManage,
  P.TicketingRead,
  P.TicketingProductsRead,
  P.TicketingSessionsRead,
  P.TicketingAddOnsRead,
  P.TicketingPassesRead,
  P.TicketingResourcesRead,
  P.TicketingSettingsRead,
  P.BookingsRead,
  P.BookingsCalendarRead,
  P.BookingsWrite,
  P.BookingsCreate,
  P.BookingsAssign,
  P.BookingsPaymentsTake,
  P.BookingsPaymentsRead,
  P.BookingInvoicesRead,
  P.BookingInvoicesSend,
  P.BookingAccountsRead,
  P.BookingAccountsWrite,
  P.PartiesRead,
  P.PartiesWrite,
  P.PartiesInvitations,
  P.PartiesFood,
  P.MembershipsRead,
  P.MembershipsWrite,
  P.MembershipsSell,
  P.MembershipsBilling,
  P.MembershipsCancel,
  P.MembershipsRedeem,
  P.WaiversRead,
  P.WaiversWrite,
  P.WaiversVerify,
  P.WaiversVoid,
  P.WaiversAdmin,
  P.WaiversExport,
  P.MarketingRead,
  P.MarketingWrite,
  P.MarketingSend,
  P.MarketingSurveys,
  P.MarketingExport,
  P.PosSell,
  P.PosRead,
  P.PosRefund,
  P.PosVoid,
  P.PosDiscount,
  P.PosCash,
  P.PosTillOpen,
  P.PosTillClose,
  P.PosTillNoCount,
  P.PosTillEdit,
  P.PosWastage,
  P.PosAdmin,
  P.PosManagerOverride,
  P.PosCheckin,
  P.PosTabs,
  P.PosGuestsWrite,
  P.PosChargeStored,
  P.AccountingRead,
  P.AccountingExpensesSubmit,
  P.AccountingPayablesRead,
  P.AccountingPayablesWrite,
  P.AccountingInventoryRead,
  P.AccountingBankingRead,
];

const FINANCE_PERMISSIONS: Permission[] = [
  P.TaxManage,
  P.AnalyticsRead,
  P.PaymentsRead,
  P.WalletRead,
  P.TicketingRead,
  P.TicketingProductsRead,
  P.TicketingSessionsRead,
  P.TicketingAddOnsRead,
  P.TicketingPassesRead,
  P.TicketingResourcesRead,
  P.TicketingSettingsRead,
  P.BookingsRead,
  P.BookingsCalendarRead,
  P.PartiesRead,
  P.BookingsPaymentsRead,
  P.BookingsRefund,
  P.BookingsExport,
  P.BookingInvoicesRead,
  P.BookingInvoicesManage,
  P.BookingInvoicesSend,
  P.BookingAccountsRead,
  P.BookingsChargeStored,
  P.BookingsTaxExempt,
  P.MarketplaceRefunds,
  P.BookingPackagesRead,
  P.PayoutsRead,
  P.BillingRead,
  P.MembershipsRead,
  P.MembershipsBilling,
  P.MembershipsCancel,
  P.WaiversRead,
  P.WaiversExport,
  P.MarketingRead,
  P.MarketingExport,
  P.PosRead,
  P.PosRefund,
  P.PosTillClose,
  P.PosTillEdit,
  P.AccountingRead,
  P.AccountingManage,
  P.AccountingJournalsWrite,
  P.AccountingJournalsApprove,
  P.AccountingJournalsPost,
  P.AccountingJournalsReverse,
  P.AccountingPeriodsClose,
  P.AccountingReceivablesRead,
  P.AccountingReceivablesWrite,
  P.AccountingPayablesRead,
  P.AccountingPayablesWrite,
  P.AccountingPayablesApprove,
  P.AccountingExpensesSubmit,
  P.AccountingExpensesRead,
  P.AccountingExpensesWrite,
  P.AccountingExpensesApprove,
  P.AccountingBankingRead,
  P.AccountingBankingWrite,
  P.AccountingReconcile,
  P.AccountingInventoryRead,
  P.AccountingInventoryWrite,
  P.AccountingReportsRead,
  P.AccountingExport,
  P.AccountingAuditRead,
];

const TAILOR_PERMISSIONS: Permission[] = [
  ...CLIENT_PERMISSIONS,
  P.TailorsWriteOwn,
];

export const ROLE_PRESETS: Record<RolePresetId, Permission[]> = {
  /** Super admin — full catalog (staff + customer *_own). */
  platform_admin: [...PERMISSIONS],
  ops_manager: [...OPS_MANAGER_PERMISSIONS],
  catalog_editor: [...CATALOG_EDITOR_PERMISSIONS],
  finance: [...FINANCE_PERMISSIONS],
  /** Empty base — permissions come from Membership.permissionsOverride (union). */
  custom: [],
  /** Find-a-Tailor provider — not staff; /tailor/* pages. */
  tailor: [...TAILOR_PERMISSIONS],
  client: [
    ...CLIENT_PERMISSIONS,
    P.BookingsReadOwn,
    P.BookingsWriteOwn,
    P.PartiesReadOwn,
    P.PartiesWriteOwn,
    P.MembershipsReadOwn,
    P.MembershipsWriteOwn,
    P.AccountingStatementsReadOwn,
  ],
};

/**
 * Labels + one-line matrix summaries for Users → Role templates / Create user.
 * Keep in lockstep with ROLE_PRESETS grants above.
 */
export const ROLE_PRESET_META: Record<
  RolePresetId,
  { label: string; summary: string }
> = {
  platform_admin: {
    label: "Admin",
    summary:
      "Full staff permission matrix — each Online Booking leaf, Memberships (guest park), Workspace settings leaf (Venues, HQ, Company profile, Billing, Payouts, Tax, Shipping), Food sales, Operations, AI, Users, Company workspaces. Hidden sidebar surfaces (Fabrics, Tailors, Homepage, Ad banners) are omitted from the matrix. Data scope is separate (company-wide view).",
  },
  ops_manager: {
    label: "Ops manager",
    summary:
      "Online Booking ops (bookings, parties incl. invitations and food, payments take, invoices send, booking companies, ticketing view; no booking export, booking refund, overbook, or party setup) + Memberships (plans/settings/sell/billing/cancel/redeem/reports) + Digital Waivers (templates, publish, verify, void, import, export) + POS sell, refund, void, tills, wastage, check-in, and tabs + orders, deliveries, reviews, AI chats + Accounting view, own expense submit, supplier/bill drafts, inventory and banking view (no approve, post, reverse, close, reconcile, or export). Not catalog write, Billing/Payouts mutate, or overbook. Data scope is separate.",
  },
  catalog_editor: {
    label: "Catalog editor",
    summary:
      "Menu items / categories + ticketing product leaves write + booking packages write + bookings read + Memberships plan write + Accounting inventory value and cost/adjustments. Not invoices/payments/companies. Data scope is separate.",
  },
  finance: {
    label: "Finance",
    summary:
      "Tax, booking payments/refunds/invoices, booking packages read, payouts/billing view, marketplace refunds, Memberships billing/cancel/reports (dunning queue), waiver read and export, POS read, POS refund, and till close or edit + full Accounting (ledger, journals, approvals, periods close, receivables, payables, expenses, banking, reconciliation, inventory, reports, export, audit; not period reopen). Not Venues mutate, waiver verify, void, publish, import, or Homepage. Data scope is separate.",
  },
  custom: {
    label: "Custom",
    summary:
      "Empty base role — assign permissions via override or a Role template (matrix checkboxes). Data scope is separate (company-wide view checkbox)",
  },
  tailor: {
    label: "Tailor",
    summary:
      "Find-a-Tailor provider — edit own tailor profile + customer *_own (measurements/jobs). No ticketing/bookings. Not staff; uses /tailor/dashboard",
  },
  client: {
    label: "Client",
    summary:
      "Storefront customer *_own permissions only incl. own bookings, own party bookings, own guest park memberships, and own invoices/statements (not an admin Membership preset)",
  },
};

/**
 * Canonical live DB roles: `admin` | `client`.
 * Archived `seller` → client preset only (Step 7.1). Not catalog_editor,
 * not a Membership ROLE_PRESET_IDS entry.
 */
export const DB_ROLE_TO_PRESET: Record<DbUserRole, RolePresetId> = {
  admin: "platform_admin",
  client: "client",
  seller: "client",
};

/** Inverse of DB_ROLE_TO_PRESET for claims. Staff presets → DB `admin`. */
export const PRESET_TO_DB_ROLE: Record<RolePresetId, LiveDbUserRole> = {
  platform_admin: "admin",
  ops_manager: "admin",
  catalog_editor: "admin",
  finance: "admin",
  custom: "admin",
  tailor: "client",
  client: "client",
};

/**
 * Claims derived from a DB role, preset, or Membership (Step 5.2).
 * When a Membership exists, orgId + membershipRole are set and permissions
 * are preset ∪ override. Without membership, orgId/membershipRole stay null
 * and permissions expand from User.role (legacy).
 */
export type AuthzClaims = {
  /** Normalized live role (`admin` | `client`); never archived `seller`. */
  role: LiveDbUserRole;
  preset: RolePresetId;
  permissions: Permission[];
  orgId: string | null;
  membershipRole: string | null;
  /**
   * Membership.companyWideView — feature perms apply to all org data when true
   * (except documented org-wide exceptions: settings, role templates,
   * analytics job totals). Always true for platform_admin. Defaults true when
   * omitted (legacy JWT/docs).
   */
  companyWideView: boolean;
};

/**
 * Company-wide data scope for assigned feature permissions.
 * platform_admin is always company-wide; missing/legacy → true (no lockouts).
 */
export function resolveCompanyWideView(input: {
  companyWideView?: boolean | null;
  rolePreset?: string | null;
  preset?: string | null;
  membershipRole?: string | null;
}): boolean {
  const preset =
    (typeof input.rolePreset === "string" && input.rolePreset.trim()) ||
    (typeof input.preset === "string" && input.preset.trim()) ||
    (typeof input.membershipRole === "string" &&
      input.membershipRole.trim()) ||
    "";
  if (preset === "platform_admin") return true;
  // Tailor studio isolation is profile ownership, not staff CWV (Part 9 / Phase 2).
  if (preset === "tailor") return false;
  if (input.companyWideView === false) return false;
  return true;
}

export function uniquePermissions(
  permissions: Iterable<Permission>
): Permission[] {
  return [...new Set(permissions)];
}

/** Keep catalog strings only — drops unknown values from tokens/payloads. */
export function parsePermissionList(value: unknown): Permission[] {
  if (!Array.isArray(value)) return [];
  return uniquePermissions(
    value.filter(
      (item): item is Permission =>
        typeof item === "string" && isPermission(item)
    )
  );
}

export function isDbUserRole(value: string): value is DbUserRole {
  return (DB_USER_ROLES as readonly string[]).includes(value);
}

export function isRolePresetId(value: string): value is RolePresetId {
  return (ROLE_PRESET_IDS as readonly string[]).includes(value);
}

export function mapDbRoleToPreset(role: string): RolePresetId {
  return DB_ROLE_TO_PRESET[toDbUserRole(role)];
}

/** Storefront actor (preset `client`, including archived DB `seller`). */
export function isClientPreset(preset: RolePresetId): boolean {
  return preset === "client";
}

/** Find-a-Tailor provider (Membership rolePreset `tailor`). */
export function isTailorPreset(preset: RolePresetId): boolean {
  return preset === "tailor";
}

/** JWT/session: provider is Membership preset `tailor` only (not permissionsOverride). */
export function isTailorProviderPreset(
  preset?: string | null,
  membershipRole?: string | null
): boolean {
  const raw =
    (typeof preset === "string" && preset.trim()) ||
    (typeof membershipRole === "string" && membershipRole.trim()) ||
    "";
  return isRolePresetId(raw) && isTailorPreset(raw);
}

/** Staff actor (platform_admin / ops / catalog / finance / custom). Not client or tailor. */
export function isStaffPreset(preset: RolePresetId): boolean {
  return preset !== "client" && preset !== "tailor";
}

export function expandRoleToPermissions(
  roleOrPreset: string | null | undefined
): Permission[] {
  if (!roleOrPreset) {
    return [...ROLE_PRESETS.client];
  }
  if (isRolePresetId(roleOrPreset)) {
    return [...ROLE_PRESETS[roleOrPreset]];
  }
  return [...ROLE_PRESETS[mapDbRoleToPreset(roleOrPreset)]];
}

/** Compose multiple presets (union). */
export function expandPresetsToPermissions(
  presets: readonly RolePresetId[]
): Permission[] {
  return uniquePermissions(presets.flatMap((preset) => ROLE_PRESETS[preset]));
}

/**
 * Legacy umbrellas still stored on older seats → imply fine-grained matrix keys.
 */
export const LEGACY_PERMISSION_IMPLIES: Partial<
  Record<Permission, readonly Permission[]>
> = {
  [P.SettingsManage]: [
    P.VenuesRead,
    P.VenuesWrite,
    P.VenuesArchive,
    P.HqRead,
    P.CompanyProfileRead,
    P.CompanyProfileWrite,
    P.BillingRead,
    P.BillingManage,
    P.PayoutsRead,
    P.PayoutsManage,
    P.ShippingRead,
    P.ShippingWrite,
  ],
  [P.TicketingRead]: [
    P.TicketingProductsRead,
    P.TicketingSessionsRead,
    P.TicketingAddOnsRead,
    P.TicketingPassesRead,
    P.TicketingResourcesRead,
    P.TicketingSettingsRead,
  ],
  [P.TicketingWrite]: [
    P.TicketingProductsWrite,
    P.TicketingProductsDelete,
    P.TicketingSessionsWrite,
    P.TicketingAddOnsWrite,
    P.TicketingPassesWrite,
    P.TicketingResourcesWrite,
  ],
  [P.TicketingManage]: [
    P.TicketingSettingsRead,
    P.TicketingSettingsWrite,
    P.TicketingProductsWrite,
    P.TicketingProductsDelete,
    P.TicketingSessionsWrite,
    P.TicketingAddOnsWrite,
    P.TicketingPassesWrite,
    P.TicketingResourcesWrite,
  ],
  [P.BookingsRead]: [P.PartiesRead, P.BookingsCalendarRead],
  [P.BookingsWrite]: [P.PartiesWrite, P.BookingsCreate],
  [P.BookingPackagesManage]: [
    P.BookingPackagesRead,
    P.BookingPackagesWrite,
    P.BookingPackagesPublish,
    P.BookingPackagesDelete,
  ],
  [P.UsersManageRoles]: [
    P.RegisteredCompaniesRead,
    P.RegisteredCompaniesManage,
    P.UsersParkAssign,
  ],
};

export function expandHeldPermissions(
  perms: Iterable<string> | null | undefined
): Set<string> {
  const out = new Set<string>();
  if (!perms) return out;
  for (const p of perms) {
    if (typeof p === "string" && p.trim()) out.add(p.trim());
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const [umbrella, implied] of Object.entries(LEGACY_PERMISSION_IMPLIES)) {
      if (!out.has(umbrella)) continue;
      for (const next of implied) {
        if (!out.has(next)) {
          out.add(next);
          grew = true;
        }
      }
    }
  }
  return out;
}

/** Staff matrix catalog (visible sidebar features only). */
export function matrixStaffPermissions(): Permission[] {
  return PERMISSIONS.filter((p) => {
    const entry = PERMISSION_CATALOG[p];
    if (entry.audience !== "staff") return false;
    if (entry.matrixHidden) return false;
    if (isAdminUiHiddenPermissionFeature(entry.feature)) return false;
    return true;
  });
}

export function hasPermission(
  perms: Iterable<string> | null | undefined,
  needed: Permission
): boolean {
  if (!perms) return false;
  const held = expandHeldPermissions(perms);
  return held.has(needed);
}

export function hasAnyPermission(
  perms: Iterable<string> | null | undefined,
  needed: readonly Permission[]
): boolean {
  if (!perms || needed.length === 0) return false;
  const held = expandHeldPermissions(perms);
  return needed.some((permission) => held.has(permission));
}

export function hasAllPermissions(
  perms: Iterable<string> | null | undefined,
  needed: readonly Permission[]
): boolean {
  if (!perms) return false;
  if (needed.length === 0) return true;
  const held = expandHeldPermissions(perms);
  return needed.every((permission) => held.has(permission));
}

/** Membership / JWT identity used for privilege-escalation checks. */
export type GrantActorIdentity = {
  preset?: string | null;
  membershipRole?: string | null;
  permissions?: Iterable<string> | null;
  /** Actor org — used to hide FECSYNC-only matrix keys from company tenants. */
  orgId?: string | null;
  storefrontOrgId?: string | null;
};

/**
 * Permissions only the FECSYNC storefront software-owner surface exposes.
 * Registered-company Admins must not see or grant these in the Users matrix.
 */
export const STOREFRONT_OPS_ONLY_PERMISSIONS: readonly Permission[] = [
  P.RegisteredCompaniesRead,
  P.RegisteredCompaniesManage,
  P.AiManage,
];

const STOREFRONT_OPS_ONLY_SET: ReadonlySet<Permission> = new Set(
  STOREFRONT_OPS_ONLY_PERMISSIONS
);

/** True when the grant actor is signed into the storefront (DEFAULT_ORG) host. */
export function isStorefrontHostGrantActor(
  actor: GrantActorIdentity | null | undefined
): boolean {
  if (!actor) return false;
  const orgId =
    typeof actor.orgId === "string" && actor.orgId.trim()
      ? actor.orgId.trim()
      : "";
  const storefront =
    typeof actor.storefrontOrgId === "string" && actor.storefrontOrgId.trim()
      ? actor.storefrontOrgId.trim()
      : "";
  if (!orgId || !storefront) return false;
  return orgId === storefront;
}

/**
 * Staff matrix keys the actor may view/grant in their jurisdiction.
 * Company tenants omit FECSYNC Company workspaces + Assistant settings.
 */
export function jurisdictionStaffPermissions(
  actor?: GrantActorIdentity | null
): Permission[] {
  const matrix = matrixStaffPermissions();
  if (isStorefrontHostGrantActor(actor)) return matrix;
  return matrix.filter((p) => !STOREFRONT_OPS_ONLY_SET.has(p));
}

/** Org super-admin (Admin) — Membership preset platform_admin. */
export function isPlatformAdminActor(
  actor: GrantActorIdentity | null | undefined
): boolean {
  if (!actor) return false;
  return (
    actor.preset === "platform_admin" ||
    actor.membershipRole === "platform_admin"
  );
}

/**
 * Permissions the actor may show/check when inviting, creating users,
 * editing members, or building role templates.
 * - platform_admin: full jurisdiction matrix (storefront host includes FECSYNC ops)
 * - everyone else: only staff perms they already hold (never *_own)
 */
export function grantableCatalogPermissions(
  actor: GrantActorIdentity | null | undefined
): Permission[] {
  const matrix = jurisdictionStaffPermissions(actor);
  if (isPlatformAdminActor(actor)) {
    return [...matrix];
  }
  const held = expandHeldPermissions(actor?.permissions ?? []);
  return matrix.filter((p) => held.has(p));
}

/** True when grants cover the full staff surface (Admin-equivalent staff set). */
export function isFullStaffPermissionSet(
  perms: Iterable<string> | null | undefined
): boolean {
  return hasAllPermissions(perms, STAFF_PERMISSIONS);
}

/** Non-super actors must not assign the platform_admin (Admin) preset. */
export function canAssignPlatformAdminPreset(
  actor: GrantActorIdentity | null | undefined
): boolean {
  return isPlatformAdminActor(actor);
}

export function toAuthzClaims(role: string | null | undefined): AuthzClaims {
  const raw = role ?? "";
  if (isRolePresetId(raw)) {
    return {
      role: PRESET_TO_DB_ROLE[raw],
      preset: raw,
      permissions: expandRoleToPermissions(raw),
      orgId: null,
      membershipRole: null,
      companyWideView: raw === "platform_admin",
    };
  }
  const dbRole = toDbUserRole(raw);
  const preset = DB_ROLE_TO_PRESET[dbRole];
  return {
    role: dbRole,
    preset,
    permissions: expandRoleToPermissions(dbRole),
    orgId: null,
    membershipRole: null,
    // Legacy admin without Membership → company-wide; clients stay own-scoped.
    companyWideView: preset === "platform_admin",
  };
}

function longestPrefixPermission(
  pathname: string,
  table: Record<string, Permission>,
  skipExact?: string
): Permission | null {
  const exact = table[pathname];
  if (exact) return exact;

  const match = Object.keys(table)
    .filter((route) => route !== skipExact && pathname.startsWith(`${route}/`))
    .sort((a, b) => b.length - a.length)[0];

  return match ? table[match] : null;
}

/**
 * Minimum permission to view each admin route (nav + pages).
 * Sidebar structure: src/lib/adminNav.ts (must stay in sync with keys here).
 * Dashboard `/admin` is listed for inventory (analytics:read); UI soft-gates the shell via
 * `adminPagePermissionForPath` so widgets decide visibility.
 * `/admin/profile` is intentionally omitted — soft-gated for any authenticated staff
 * (self-service My profile; catalog key remains profile:manage_own for inventory).
 */
export const ADMIN_ROUTE_PERMISSIONS: Record<string, Permission> = {
  "/admin": P.AnalyticsRead,
  "/admin/products": P.ProductsRead,
  "/admin/orders": P.OrdersRead,
  "/admin/categories": P.CategoriesRead,
  "/admin/fabrics": P.FabricsRead,
  "/admin/customizations": P.CustomizationsRead,
  "/admin/users": P.UsersRead,
  "/admin/registered-companies": P.RegisteredCompaniesRead,
  "/admin/permissions": P.UsersRead,
  "/admin/tax-settings": P.TaxManage,
  "/admin/company-profile": P.CompanyProfileRead,
  "/admin/venues": P.VenuesRead,
  "/admin/hq": P.HqRead,
  "/admin/billing": P.BillingRead,
  "/admin/payouts": P.PayoutsRead,
  "/admin/booking-packages": P.BookingPackagesRead,
  "/admin/shipping-settings": P.ShippingRead,
  "/admin/settings/shipping": P.ShippingRead,
  "/admin/homepage-content": P.SettingsManage,
  "/admin/ad-banners": P.SettingsManage,
  "/admin/ai-settings": P.AiManage,
  "/admin/ai-chats": P.AiChatsRead,
  "/admin/reviews": P.ReviewsRead,
  "/admin/deliveries": P.DeliveriesRead,
  "/admin/tailors": P.TailorsRead,
  "/admin/tailoring-jobs": P.TailoringJobsRead,
  "/admin/ticketing": P.TicketingProductsRead,
  "/admin/ticketing/products": P.TicketingProductsRead,
  "/admin/ticketing/products/new": P.TicketingProductsWrite,
  "/admin/ticketing/categories": P.TicketingProductsRead,
  "/admin/ticketing/sessions": P.TicketingSessionsRead,
  "/admin/ticketing/resources": P.TicketingResourcesRead,
  "/admin/ticketing/add-ons": P.TicketingAddOnsRead,
  "/admin/ticketing/passes": P.TicketingPassesRead,
  "/admin/ticketing/settings": P.TicketingSettingsRead,
  "/admin/memberships": P.MembershipsRead,
  "/admin/memberships/plans": P.MembershipsRead,
  "/admin/memberships/categories": P.MembershipsRead,
  "/admin/memberships/members": P.MembershipsRead,
  "/admin/memberships/redeem": P.MembershipsRedeem,
  "/admin/memberships/eligibility": P.MembershipsRead,
  "/admin/memberships/settings": P.MembershipsRead,
  "/admin/memberships/reports": P.MembershipsRead,
  "/admin/waivers": P.WaiversRead,
  "/admin/waivers/new": P.WaiversWrite,
  "/admin/waivers/templates": P.WaiversRead,
  "/admin/waivers/forms": P.WaiversRead,
  "/admin/waivers/forms/responses": P.WaiversRead,
  "/admin/waivers/verify": P.WaiversVerify,
  "/admin/waivers/import": P.WaiversAdmin,
  "/admin/waivers/signage": P.WaiversWrite,
  "/admin/waivers/records": P.WaiversRead,
  "/admin/waivers/guests": P.WaiversRead,
  "/admin/waivers/kiosk": P.WaiversAdmin,
  "/admin/waivers/settings": P.WaiversAdmin,
  "/admin/waivers/compliance": P.WaiversRead,
  "/admin/marketing": P.MarketingRead,
  "/admin/marketing/newsletter": P.MarketingRead,
  "/admin/marketing/campaigns": P.MarketingRead,
  "/admin/marketing/automations": P.MarketingRead,
  "/admin/marketing/surveys": P.MarketingSurveys,
  "/admin/marketing/settings": P.MarketingRead,
  "/admin/bookings": P.BookingsRead,
  "/admin/bookings/new": P.BookingsCreate,
  "/admin/bookings/calendar": P.BookingsCalendarRead,
  "/admin/parties": P.PartiesRead,
  "/admin/parties/new": P.PartiesWrite,
  "/admin/parties/balances": P.PartiesRead,
  "/admin/parties/run-sheets": P.PartiesRead,
  "/admin/parties/packages": P.PartiesRead,
  "/admin/parties/packages/new": P.PartiesRead,
  "/admin/parties/rooms": P.PartiesRead,
  "/admin/parties/menu": P.PartiesRead,
  "/admin/parties/settings": P.PartiesRead,
  "/admin/booking-invoices": P.BookingInvoicesRead,
  "/admin/booking-payments": P.BookingsPaymentsRead,
  "/admin/booking-accounts": P.BookingAccountsRead,
  "/admin/pos": P.PosSell,
  "/admin/pos/admin": P.PosAdmin,
  "/admin/pos/sales": P.PosRead,
  "/admin/pos/check-in": P.PosCheckin,
  "/admin/pos/capacity": P.PosSell,
  "/admin/pos/tills": P.PosTillOpen,
  "/admin/pos/tabs": P.PosTabs,
  // Accounting (Growth+ moduleHints "accounting"). Dynamic segments resolve by prefix.
  "/admin/accounting": P.AccountingRead,
  "/admin/accounting/setup": P.AccountingManage,
  "/admin/accounting/settings": P.AccountingManage,
  "/admin/accounting/chart-of-accounts": P.AccountingManage,
  "/admin/accounting/mappings": P.AccountingManage,
  "/admin/accounting/tax-codes": P.AccountingManage,
  "/admin/accounting/opening-balances": P.AccountingManage,
  "/admin/accounting/posting-queue": P.AccountingManage,
  "/admin/accounting/expense-categories": P.AccountingManage,
  "/admin/accounting/bank-accounts": P.AccountingManage,
  "/admin/accounting/periods": P.AccountingRead,
  "/admin/accounting/journals": P.AccountingRead,
  "/admin/accounting/journals/new": P.AccountingJournalsWrite,
  "/admin/accounting/ledger": P.AccountingRead,
  "/admin/accounting/approvals": P.AccountingJournalsApprove,
  "/admin/accounting/customers": P.AccountingReceivablesRead,
  "/admin/accounting/invoices": P.AccountingReceivablesRead,
  "/admin/accounting/invoices/new": P.AccountingReceivablesWrite,
  "/admin/accounting/receipts": P.AccountingReceivablesRead,
  "/admin/accounting/receipts/new": P.AccountingReceivablesWrite,
  "/admin/accounting/suppliers": P.AccountingPayablesRead,
  "/admin/accounting/suppliers/new": P.AccountingPayablesWrite,
  "/admin/accounting/purchase-orders": P.AccountingPayablesRead,
  "/admin/accounting/purchase-orders/new": P.AccountingPayablesWrite,
  "/admin/accounting/bills": P.AccountingPayablesRead,
  "/admin/accounting/bills/new": P.AccountingPayablesWrite,
  "/admin/accounting/supplier-payments": P.AccountingPayablesRead,
  "/admin/accounting/supplier-payments/new": P.AccountingPayablesWrite,
  "/admin/accounting/expenses": P.AccountingExpensesSubmit,
  "/admin/accounting/expenses/new": P.AccountingExpensesSubmit,
  "/admin/accounting/banking": P.AccountingBankingRead,
  "/admin/accounting/transfers": P.AccountingBankingRead,
  "/admin/accounting/reconciliations": P.AccountingReconcile,
  "/admin/accounting/inventory": P.AccountingInventoryRead,
  "/admin/accounting/reports": P.AccountingReportsRead,
  "/admin/accounting/tax": P.AccountingReportsRead,
  "/admin/accounting/audit": P.AccountingAuditRead,
};

/**
 * Admin surfaces that bind to FECSYNC storefront data (no per-company orgId on
 * the underlying model, or explicit storefront-only settings). UI must hide
 * these when JWT orgId !== storefrontOrgId; API enforces via
 * assertStorefrontStaffOrg / getAiSettingsForStorefrontStaff.
 */
export const ADMIN_STOREFRONT_ONLY_PATHS = [
  "/admin/customizations",
  "/admin/ai-settings",
  "/admin/registered-companies",
  // Public homepage + ad banners read storefront org only — registered companies
  // must not edit orphan CMS rows that never go public.
  "/admin/homepage-content",
  "/admin/ad-banners",
] as const;

/**
 * Storefront surfaces that also require Membership preset platform_admin
 * (APIs use assertStorefrontPlatformAdmin — UI must match).
 */
export const ADMIN_STOREFRONT_PLATFORM_ADMIN_ONLY_PATHS = [
  "/admin/registered-companies",
] as const;

/**
 * Company SaaS surfaces that must not appear for the FECSYNC storefront org
 * (billing APIs reject isDefault / storefront via assertRegisteredCompanyBillingOrg).
 * Exception (UI only): storefront platform_admin (project owner) may open every
 * path here for QA — see isAdminPageAllowed / isStorefrontPlatformSuperAdmin.
 * Non-owner storefront staff: venues / hq / Online Booking ops subset only.
 */
export const ADMIN_REGISTERED_COMPANY_ONLY_PATHS = [
  "/admin/billing",
  "/admin/payouts",
  "/admin/booking-packages",
  "/admin/venues",
  "/admin/hq",
  "/admin/ticketing",
  "/admin/memberships",
  "/admin/waivers",
  "/admin/marketing",
  "/admin/bookings",
  "/admin/booking-accounts",
  "/admin/parties",
  "/admin/booking-invoices",
  "/admin/booking-payments",
  "/admin/pos",
  "/admin/accounting",
] as const;

export function adminPathRequiresStorefrontOrg(pathname: string): boolean {
  const normalized = pathname === "/admin/" ? "/admin" : pathname;
  return ADMIN_STOREFRONT_ONLY_PATHS.some(
    (prefix) =>
      normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}

export function adminPathRequiresStorefrontPlatformAdmin(
  pathname: string
): boolean {
  const normalized = pathname === "/admin/" ? "/admin" : pathname;
  return ADMIN_STOREFRONT_PLATFORM_ADMIN_ONLY_PATHS.some(
    (prefix) =>
      normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}

export function adminPathRequiresRegisteredCompanyOrg(
  pathname: string
): boolean {
  const normalized = pathname === "/admin/" ? "/admin" : pathname;
  return ADMIN_REGISTERED_COMPANY_ONLY_PATHS.some(
    (prefix) =>
      normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}

/** Minimum permission to mutate on each admin surface (create/edit/status).
 * Product/fabric/category **delete** uses products:delete / fabrics:delete /
 * categories:delete on the API and UI (not this write map).
 * AI chats **delete** uses ai:chats_delete (UI + API; this map stays reply).
 * Users **hard delete** uses users:delete; **blacklist** uses users:blacklist
 * (not this write map). Page inventory + mutation hints; live nav hide uses
 * soft-gated dashboard + ADMIN_ROUTE_PERMISSIONS via store can() (Steps 2.2 /
 * 6.2 / 6.3). Admin UI gates do not change PAYMENT_POLICY (Stripe on /
 * Paystack UI off / wallet API-only).
 */
export const ADMIN_ROUTE_MUTATION_PERMISSIONS: Record<string, Permission> = {
  "/admin/products": P.ProductsWrite,
  "/admin/orders": P.OrdersManage,
  "/admin/categories": P.CategoriesWrite,
  "/admin/fabrics": P.FabricsWrite,
  "/admin/customizations": P.CustomizationsManage,
  "/admin/users": P.UsersManageRoles,
  "/admin/registered-companies": P.RegisteredCompaniesManage,
  "/admin/permissions": P.UsersManageRoles,
  "/admin/tax-settings": P.TaxManage,
  "/admin/company-profile": P.CompanyProfileWrite,
  "/admin/venues": P.VenuesWrite,
  "/admin/hq": P.HqRead,
  "/admin/billing": P.BillingManage,
  "/admin/payouts": P.PayoutsManage,
  "/admin/booking-packages": P.BookingPackagesWrite,
  "/admin/shipping-settings": P.ShippingWrite,
  "/admin/settings/shipping": P.ShippingWrite,
  "/admin/homepage-content": P.SettingsManage,
  "/admin/ad-banners": P.SettingsManage,
  "/admin/ai-settings": P.AiManage,
  "/admin/ai-chats": P.AiChatsReply,
  "/admin/reviews": P.ReviewsModerate,
  "/admin/deliveries": P.DeliveriesManage,
  "/admin/tailors": P.TailorsManage,
  "/admin/tailoring-jobs": P.TailoringJobsManage,
  "/admin/ticketing": P.TicketingProductsWrite,
  "/admin/ticketing/products": P.TicketingProductsWrite,
  "/admin/ticketing/products/new": P.TicketingProductsWrite,
  "/admin/ticketing/categories": P.TicketingProductsWrite,
  "/admin/ticketing/sessions": P.TicketingSessionsWrite,
  "/admin/ticketing/resources": P.TicketingResourcesWrite,
  "/admin/ticketing/add-ons": P.TicketingAddOnsWrite,
  "/admin/ticketing/passes": P.TicketingPassesWrite,
  "/admin/ticketing/settings": P.TicketingSettingsWrite,
  "/admin/memberships/plans": P.MembershipsWrite,
  "/admin/memberships/categories": P.MembershipsWrite,
  "/admin/memberships/eligibility": P.MembershipsWrite,
  "/admin/memberships/settings": P.MembershipsWrite,
  "/admin/waivers/templates": P.WaiversWrite,
  "/admin/waivers/forms": P.WaiversWrite,
  "/admin/waivers/import": P.WaiversAdmin,
  "/admin/waivers/new": P.WaiversWrite,
  "/admin/waivers/signage": P.WaiversWrite,
  "/admin/waivers/kiosk": P.WaiversAdmin,
  "/admin/waivers/settings": P.WaiversAdmin,
  "/admin/marketing/settings": P.MarketingWrite,
  "/admin/marketing/automations": P.MarketingWrite,
  "/admin/marketing/surveys": P.MarketingSurveys,
  "/admin/bookings": P.BookingsWrite,
  "/admin/bookings/new": P.BookingsCreate,
  "/admin/parties": P.PartiesWrite,
  "/admin/parties/new": P.PartiesWrite,
  "/admin/parties/packages": P.TicketingProductsWrite,
  "/admin/parties/rooms": P.TicketingResourcesWrite,
  "/admin/parties/menu": P.PartiesManage,
  "/admin/parties/settings": P.PartiesManage,
  "/admin/booking-invoices": P.BookingInvoicesManage,
  "/admin/booking-payments": P.BookingsPaymentsTake,
  "/admin/booking-accounts": P.BookingAccountsWrite,
};

/**
 * Client profile tabs / authenticated storefront routes (inventory).
 * /cart and /checkout are AUTH_ANY in the proxy — do not gate pages or
 * Stripe checkout on CartManageOwn / PaymentsCheckoutOwn (staff lack _own).
 */
export const CLIENT_ROUTE_PERMISSIONS: Record<string, Permission> = {
  "/profile": P.ProfileManageOwn,
  "/profile/bookings": P.BookingsReadOwn,
  "/profile/parties": P.PartiesReadOwn,
  "/profile/invoices": P.AccountingStatementsReadOwn,
  "/user/profile": P.ProfileManageOwn,
  "/profile/customizations": P.CustomizationsManageOwn,
  "/profile/tailoring-jobs": P.TailoringJobsReadOwn,
  "/cart": P.CartManageOwn,
  "/checkout": P.PaymentsCheckoutOwn,
};

/** Profile page `?tab=` values (see profile-tabs.ts). Logout is an auth action. */
export const CLIENT_PROFILE_TAB_PERMISSIONS: Record<string, Permission> = {
  info: P.ProfileManageOwn,
  bookings: P.BookingsReadOwn,
  parties: P.PartiesReadOwn,
  memberships: P.MembershipsReadOwn,
  billing: P.AccountingStatementsReadOwn,
  orders: P.OrdersReadOwn,
  customizations: P.CustomizationsManageOwn,
  measurements: P.MeasurementsReadOwn,
  campaigns: P.MeasurementsReadOwn,
  "tailoring-jobs": P.TailoringJobsReadOwn,
  wishlist: P.ProfileManageOwn,
  "delete-account": P.ProfileManageOwn,
};

export function permissionForAdminPath(pathname: string): Permission | null {
  return longestPrefixPermission(pathname, ADMIN_ROUTE_PERMISSIONS, "/admin");
}

export function permissionForAdminMutationPath(
  pathname: string
): Permission | null {
  return longestPrefixPermission(pathname, ADMIN_ROUTE_MUTATION_PERMISSIONS);
}

export function permissionForClientPath(pathname: string): Permission | null {
  return longestPrefixPermission(pathname, CLIENT_ROUTE_PERMISSIONS);
}

export function permissionForProfileTab(tab: string): Permission | null {
  return CLIENT_PROFILE_TAB_PERMISSIONS[tab] ?? null;
}

/** Resolve client page + optional `/profile?tab=` (tabs are not separate routes). */
export function permissionForClientAccess(
  pathname: string,
  tab?: string | null
): Permission | null {
  if (tab && (pathname === "/profile" || pathname === "/user/profile")) {
    const fromTab = permissionForProfileTab(tab);
    if (fromTab) return fromTab;
  }
  return permissionForClientPath(pathname);
}

/**
 * Tenant root is Organization (Step 5.1). Membership links users to orgs
 * (Step 5.2). JWT carries orgId + membership permissions when a row exists;
 * storefront catalog still uses DEFAULT_ORG_ID / default org for public reads.
 * Isolation for carts/wallets remains user-scoped.
 */
export const PLATFORM = {
  tenancy: "organization",
  isolation: "user_scoped",
  /**
   * Staff Membership.companyWideView: when false, assigned feature permissions
   * only apply to the actor's own operational rows (not all org records).
   * platform_admin always has company-wide view.
   */
  companyWideView: "membership_flag",
} as const;

export type IsolationMode =
  | "own_user"
  | "staff_global"
  | "own_or_staff"
  | "public"
  | "provider"
  | "gone";

/** Public storefront, provider callbacks, and 410-deprecated unused APIs. */
export function isUnguardedApiIsolation(
  isolation: IsolationMode
): isolation is "public" | "provider" | "gone" {
  return (
    isolation === "public" || isolation === "provider" || isolation === "gone"
  );
}

/**
 * How API guards scope queries (user === JWT sub for owned rows).
 * Catalog + Order.orgId are Organization-scoped (Step 5.1). JWT may carry
 * Membership.orgId (Step 5.2). Shop CRUD is 410 Gone (Step 4.3) — not a tenant.
 */
export const MODEL_ISOLATION: Record<
  string,
  { field: string | null; mode: IsolationMode; notes: string }
> = {
  User: {
    field: "_id",
    mode: "own_or_staff",
    notes:
      "Client: sub === _id. Staff users:read|invite|manage_roles|delete|blacklist via /api/admin/members + /api/admin/users + /api/admin/user-blacklist and /admin/users UI (actor.orgId). Hard delete (users:delete) purges User and auto-blacklists email/phone. Role change bumps authzVersion + clears refreshTokenJTI. Self-delete blocked if sole platform_admin. Not a payment path.",
  },
  Order: {
    field: "user",
    mode: "own_or_staff",
    notes:
      "Client: user === sub (own orders; Steps 3.x). Staff list/detail/mutate scoped to actor.orgId (Step 5.3); cross-tenant → 403. Optional venueLocationId stamps park scope — park-locked staff apply venueStampedResourceFilter (null shared rows hidden); CWV HQ preference may narrow park-stamped rows. POST sets orgId from line ownership or storefront/default org. Cart/Wishlist stay user-scoped (no orgId).",
  },
  Cart: {
    field: "user",
    mode: "own_user",
    notes:
      "Owner-only on [id]* (403 if not owner; no cart:read bypass). Staff checkout uses their own cart (user===sub). GET /api/cart staff list via requirePermissionFresh(cart:read) + assertStorefrontStaffOrg (no Cart.orgId — registered companies denied). Live own routes use requireAuth, not cart:manage_own (staff lack _own).",
  },
  Wallet: {
    field: "user",
    mode: "own_user",
    notes:
      "Owner-only on [id] (403 if not owner; no wallet:read mutate bypass). Staff list GET /api/wallet via requirePermissionFresh(wallet:read) + assertStorefrontStaffOrg (no Wallet.orgId — registered companies denied). Fund/withdraw/me use requireAuth + user=sub (staff lack _own). PUT never applies user/balance/transactions. Checkout attaches ensureOwnedWallet(sub).",
  },
  Wishlist: {
    field: "user",
    mode: "own_user",
    notes:
      "Owner-only. Live: requireAuth + ownedByFilter (not profile:manage_own — staff lack _own). Ignore query/body userId. Product favourite flags use JWT sub.",
  },
  Customization: {
    field: "user",
    mode: "own_or_staff",
    notes:
      "Staff list GET /api/customization via requirePermissionFresh(customizations:read) + assertStorefrontStaffOrg (no Customization.orgId — registered companies denied). GET [id] owner or storefront staff read; PUT/DELETE owner or storefront staff manage. Never apply body.user. POST and GET /me use requireAuth + user=sub (staff lack _own). GET /user/[userId] owner if userId===sub, else storefront customizations:read. Not a payment/checkout path (Stripe UI unchanged).",
  },
  CustomRequest: {
    field: "user",
    mode: "own_or_staff",
    notes:
      "Unused by UI. POST/GET: requireAuth + user=sub (not customizations:manage_own — staff lack _own). PATCH status: customizations:manage + assertStorefrontStaffOrg only. No tenant/shop/seller key. Not a payment/checkout path.",
  },
  Review: {
    field: "user",
    mode: "own_or_staff",
    notes:
      "GET ?productId= is public for storefront/default org products only (Step 5.1). POST requireAuth + user=sub; product must be storefront org. PATCH/DELETE owner or reviews:moderate (staff moderate requires product.orgId === actor.orgId, Step 5.3). Empty-body like-toggle is any auth user. Never body.user. No staff list-all without productId. Not a payment/checkout path.",
  },
  Notification: {
    field: "user",
    mode: "own_user",
    notes:
      "Live: requireAuth + ownedByFilter. PATCH mark-read asserts owner (403 IDOR). Never findByIdAndUpdate(id) alone. Schema field is read (not isRead). Ignore ?userId=. Not a payment/checkout path.",
  },
  Profile: {
    field: "user",
    mode: "own_user",
    notes:
      "Live: requireAuth + ownedByFilter / user=sub (not profile:manage_own — staff lack _own). Never body.user. Picture/address scoped to session profile only. Not a payment/checkout path (Stripe UI unchanged).",
  },
  Product: {
    field: "orgId",
    mode: "staff_global",
    notes:
      "Organization tenant (Steps 5.1–5.3). Storefront GET list/detail/category filter by DEFAULT_ORG_ID or default org. Admin GET ?scope=staff + mutations use actor.orgId; cross-tenant → 403. Optional venueLocationId for park-stamped catalog — park-locked staff filter via venueStampedResourceFilter; CWV preference may narrow stamped rows while null (company-shared) fashion rows stay visible to CWV. Never apply body.seller/shop/orgId. GET bulk + unused /api/product/shop|seller → products:read on actor.orgId. taxRate/taxExempt are catalog fields for TaxSettings override (PAYMENT_POLICY.tax). Admin create embeds base64 on POST product; POST /api/upload* is uploads:write (Step 4.4).",
  },
  Fabric: {
    field: "orgId",
    mode: "staff_global",
    notes:
      "Organization tenant (Steps 5.1–5.3). Storefront GET list/detail filter by DEFAULT_ORG_ID or default org. Admin GET ?scope=staff + mutations use actor.orgId; cross-tenant → 403. Never apply body.seller/shop/orgId. taxRate/taxExempt persist for fabrics:write editors — not tax:manage. Cart add-fabric is owner isolation + storefront org catalog. Admin create embeds base64; POST /api/upload* is uploads:write (Step 4.4).",
  },
  ProductCategory: {
    field: "orgId",
    mode: "staff_global",
    notes:
      "Organization tenant (Steps 5.1–5.3). Storefront GET list/detail filter by DEFAULT_ORG_ID or default org. Admin GET ?scope=staff + mutations use actor.orgId. Unique name is per org. Shared by ecommerce Product.categoryId (required) and ticketing AdmissionProduct.categoryId (optional). Never apply body.seller/shop/orgId. Ignore ?seller=&shop=&orgId=.",
  },
  TaxSettings: {
    field: "orgId",
    mode: "staff_global",
    notes:
      "One row per Organization (Steps 5.1–5.3). Public GET /api/tax-settings is storefront org. GET|PUT /api/admin/tax-settings uses actor.orgId (tax:manage).",
  },
  HomepageSection: {
    field: "orgId",
    mode: "staff_global",
    notes:
      "One row per (Organization, section key). Public GET /api/homepage-content returns published sections for storefront org. Admin list/mutate requires settings:manage + assertStorefrontStaffOrg (storefront-only UI). Keys: hero, whatWeOffer, newArrivals, fashionJourney.",
  },
  AdBanner: {
    field: "orgId",
    mode: "staff_global",
    notes:
      "Unlimited slider ads for Trending Fashion sidebar. Public GET /api/ad-banners returns active banners for storefront org. Admin CRUD requires settings:manage + assertStorefrontStaffOrg (storefront-only UI). Images via uploads:write folder banners. AdBannerSeedLock prevents re-seeding after delete-all.",
  },
  TailorProfile: {
    field: "orgId",
    mode: "own_or_staff",
    notes:
      "Find-a-Tailor provider directory. Staff list/create/edit/approve via /api/admin/tailors (tailors:read|manage, actor.orgId). Owner GET|PUT /api/tailor/me + portfolio via requireAuthFresh + active Membership rolePreset tailor on profile.orgId (or staff who own the profile). Studio roster: GET|POST /api/tailor/clients + DELETE /api/tailor/clients/[id] (org plan limit via assertWithinPlanLimit(tailorClients)). Public discovery: GET /api/tailors + GET /api/tailors/[slug] (approved + storefront org only; PublicTailorDto strips user/email/orgId). Unique slug + unique user. Status: draft|pending|approved|suspended. Admin create promotes+activates Membership (unless staff). Membership assign-as-tailor creates pending TailorProfile without force-activating invites. Demote/revoke/suspend membership suspends TailorProfile; hard/self delete purges tailor-domain rows (jobs, reviews, clients, campaigns).",
  },
  MeasurementProfile: {
    field: "user",
    mode: "own_user",
    notes:
      "Customer body measurements. Live CRUD: /api/measurement-profiles (+/[id], /[id]/default, /[id]/category, /[id]/ai-scan). Isolation: user=sub. No orgId.",
  },
  TailoringJob: {
    field: "customer",
    mode: "own_or_staff",
    notes:
      "Customer ↔ tailor booking. Live: /api/tailoring-jobs (+/[id]) with role-based status machine; /api/admin/tailoring-jobs for staff org read/manage. Stripe payment via POST /api/payment/tailoring settles to paid → in_progress.",
  },
  AdBannerSeedLock: {
    field: "orgId",
    mode: "staff_global",
    notes:
      "One row per Organization. Created on first demo seed or first admin create/delete so empty banner lists stay empty.",
  },
  AiSettings: {
    field: "orgId",
    mode: "staff_global",
    notes:
      "One row per Organization (Steps 5.1–5.3). Public GET /api/ai-settings is storefront botName. GET|PUT|POST /api/admin/ai-settings uses storefront org (actor must match) via ai:manage. Provider/model/API key/maxTokens are dashboard-managed (encrypted key in Mongo; GET returns last4 only). POST { action: importFromEnv } migrates legacy OPENROUTER_* env into dashboard storage. Legacy env_default rows still read server env until migrated. Admin UI /admin/ai-settings (AI Chats → Assistant settings). Fashion-chat reads the same storefront org row. Not a payment path.",
  },
  Organization: {
    field: "_id",
    mode: "staff_global",
    notes:
      "Tenant root (Step 5.1). No Organization CRUD API. Membership permission UI is /admin/users (Step 6.2); admin page/action gates are Step 6.3. Default org bootstrap is yarn ensure-default-org. Membership (Step 5.2) links users; JWT carries orgId when present. Shop is not this model.",
  },
  Membership: {
    field: "orgId",
    mode: "staff_global",
    notes:
      "Step 5.2–8 + franchise Step 2. Unique (userId, orgId). franchiseParkManager (boolean) requires park-lock and forbids platform_admin — park-local invite/roster only; company SaaS billing stays on Organization. Staff list/mutate via /api/admin/members + /admin/users; franchise managers see intersecting park roster only. POST /api/admin/users stays company-wide (assertNotParkLocked). Soft pointer hqSelectedLocationId cleared on venue archive. MembershipVenueAssignment park-locks the seat. Not a payment/checkout path.",
  },
  MembershipVenueAssignment: {
    field: "orgId",
    mode: "staff_global",
    notes:
      "Park assignment row (membershipId + locationId + orgId). One+ active rows → park-locked for non-platform_admin seats. Soft-archive clears assignments for that venue and clears franchiseParkManager when the seat has zero parks left. Manage via PUT /api/admin/members/[id]/venue-assignments (company-wide or franchise manager within their parks). Never trust client orgId/locationId as authority.",
  },
  VenueLocation: {
    field: "orgId",
    mode: "staff_global",
    notes:
      "Multi-park / franchise park under Organization (venues meter = active only). isFranchise + franchise profile fields (display name, support phone/email, code, notes) — Option A, not a second tenant. Soft-archive frees quota, clears hqSelectedLocationId + MembershipVenueAssignment (+ franchiseParkManager when empty) and disables VenueLocationMarketplaceAccount for new charges. Franchise managers may PATCH park-manageable profile fields on assigned franchise parks only. Enterprise HQ rolls up all parks including franchise. Guest park Connect: VenueLocationMarketplaceAccount + resolveGuestPayoutDestination (Step 3). Ignores client orgId.",
  },
  UserBlacklist: {
    field: "orgId",
    mode: "staff_global",
    notes:
      "Org-scoped blocked emails/phones. CRUD via /api/admin/user-blacklist (users:blacklist). Enforced on signup, login (email+phone), Google OAuth, email verify/resend, forgot/reset password, profile email/phone update, admin create/invite (resolved user identity), and token refresh. Hard delete auto-adds email/phone and kills sessions. UI: /admin/users → Blacklist. Not a payment path.",
  },
  RoleTemplate: {
    field: "orgId",
    mode: "staff_global",
    notes:
      "Step 8. Org-scoped reusable permission bundles. Unique (orgId, name). Catalog strings only (permissions.ts SSOT). CRUD via /api/admin/role-templates; assigned on Membership.roleTemplateId with rolePreset custom. Delete blocked while assigned to active/invited/suspended members. Not a payment path.",
  },
  ActivityLog: {
    field: "user",
    mode: "staff_global",
    notes:
      "Written on order create; membership admin mutates (Steps 6.1–6.2); permission denials on sensitive admin routes (Step 7.3 via authErrorToResponse + authAudit). Analytics reads Order entity logs scoped to actor.orgId (Step 5.3). No dedicated CRUD API. Not a payment path.",
  },
  FashionChat: {
    field: "orgId",
    mode: "staff_global",
    notes:
      "Storefront: guest sessionId+IP or auth user=sub; contact (name/email/phone) for inbox. Staff list/reply/delete via /api/admin/fashion-chats (ai:chats_read / ai:chats_reply / ai:chats_delete) scoped to actor.orgId. Admin UI under AI Chats nav (Conversations). Public POST/GET /api/fashion-chat* (+ /start, /end) stay guest-open. Never body.user/usePublicData. Not a payment path.",
  },
  Shop: {
    field: null,
    mode: "gone",
    notes:
      "Unused by UI. Live: all /api/shop CRUD → 410 Gone (Step 4.3). Not the tenant root — Organization is (Step 5.1). Do not apply Shop.owner checks. settings:manage gates Store settings → Homepage (/admin/homepage-content) and Ad banners (/admin/ad-banners), not Shop CRUD. Public /shop is GET /api/product storefront. Product.shop leftover; /api/product/shop|seller → 410 Gone. Not a payment/checkout path.",
  },
};

/**
 * Checkout and tax as implemented today (UI + APIs).
 * Stripe is the live checkout method; Paystack UI is disabled; wallet pay is API-only.
 * Gateway confirm/callback routes are provider-verified, not RBAC.
 */
export const PAYMENT_POLICY = {
  methods: {
    stripe: {
      uiEnabled: true,
      api: "/api/payment/purchase type=stripe-gateway",
      confirm: "/api/payment/stripe/confirm",
      webhook: "/api/webhooks/stripe",
      legacySession: "/api/payment/stripe/create-session",
    },
    paystack: {
      uiEnabled: false,
      api: "/api/payment/purchase type=paystack-gateway",
      callback: "/api/payment/paystack/callback",
      legacyInitialize: "/api/payment/paystack/initialize",
      banks: "/api/payment/paystack/banks",
      verifyTransfer: "/api/payment/paystack/verify-transfer",
    },
    wallet: { uiEnabled: false, api: "/api/payment/purchase type=wallet" },
  },
  clientCheckout: P.PaymentsCheckoutOwn,
  clientOrderCreate: P.OrdersCreateOwn,
  staffLedger: P.PaymentsRead,
  staffWallets: P.WalletRead,
  isolation: "purchase / confirm / callback load Order and Wallet by user === JWT sub (or provider uuid → that user). Legacy create-session and paystack/initialize require owned order; amount from order (never body.amount/uuid). Banks/verify-transfer requireAuth. Order.orgId is set on create (Step 5.1); checkout isolation stays user-scoped. Public tax/checkout totals use storefront TaxSettings; admin tax:manage uses actor.orgId (Step 5.3). Staff JWT may carry Membership.orgId (Step 5.2). Membership admin APIs + /admin/users UI + admin page/action gates (Steps 6.1–6.3) do not change checkout method UI/API or Order/Wallet isolation. Stripe UI on; Paystack UI off; wallet API-only.",
  /**
   * CLOSED (sync): `/payment/callback` uses GET paystack/callback.
   * No `/api/payment/verify` handler — do not reintroduce. Stripe → stripe/confirm.
   */
  removedVerifyRoute: "/api/payment/verify — removed; use PAYMENT_POLICY.methods.paystack.callback or stripe.confirm",
  uiReturnPaths: {
    stripe: "/payment/success → GET /api/payment/stripe/confirm",
    paystack: "/payment/callback → GET /api/payment/paystack/callback (UI method off; API-only)",
  },
  tax: {
    publicRead: true,
    staffManage: P.TaxManage,
    source: "per-org TaxSettings + optional Product/Fabric taxRate|taxExempt",
    catalogOverrideWrite: {
      product: P.ProductsWrite,
      fabric: P.FabricsWrite,
    },
    isolation: "organization",
    notes:
      "tax:manage is the TaxSettings PUT for actor.orgId (Step 5.3). Per-product/fabric taxRate|taxExempt are catalog fields (products:write / fabrics:write). Public GET of catalog includes those fields for Stripe tax display. Shop CRUD is 410 Gone and has no tax fields.",
  },
} as const;

export type CheckoutMethod = keyof typeof PAYMENT_POLICY.methods;

/** POST /api/payment/purchase `type` values. */
export const PURCHASE_TYPE_TO_METHOD = {
  "stripe-gateway": "stripe",
  "paystack-gateway": "paystack",
  wallet: "wallet",
} as const satisfies Record<string, CheckoutMethod>;

export type PurchaseType = keyof typeof PURCHASE_TYPE_TO_METHOD;

export function checkoutMethodFromPurchaseType(
  type: string | null | undefined
): CheckoutMethod | null {
  if (!type) return null;
  return (
    (PURCHASE_TYPE_TO_METHOD as Record<string, CheckoutMethod>)[type] ?? null
  );
}

/** Checkout UI: Stripe only. Paystack and wallet stay off in PaymentMethodSelector. */
export function isCheckoutUiEnabled(method: CheckoutMethod): boolean {
  return PAYMENT_POLICY.methods[method].uiEnabled === true;
}

/**
 * Checkout APIs as implemented: Stripe, Paystack, and wallet all have handlers.
 * `payments:checkout_own` does not turn a method's UI on.
 */
export function isCheckoutApiImplemented(method: CheckoutMethod): boolean {
  return typeof PAYMENT_POLICY.methods[method].api === "string";
}

export type ApiPermissionRule = {
  /** Empty = no RBAC (public or provider). Multiple = OR. */
  permissions: readonly Permission[];
  isolation: IsolationMode;
  notes?: string;
};

const own = (permission: Permission, notes?: string): ApiPermissionRule => ({
  permissions: [permission],
  isolation: "own_user",
  notes,
});

const staff = (permission: Permission, notes?: string): ApiPermissionRule => ({
  permissions: [permission],
  isolation: "staff_global",
  notes,
});

/** Staff route guarded by any one of several keys (requireAnyPermissionFresh). */
const staffAny = (
  permissions: readonly Permission[],
  notes?: string
): ApiPermissionRule => ({
  permissions,
  isolation: "staff_global",
  notes,
});

const ownOrStaff = (
  permissions: readonly Permission[],
  notes?: string
): ApiPermissionRule => ({
  permissions,
  isolation: "own_or_staff",
  notes,
});

const pub = (notes?: string): ApiPermissionRule => ({
  permissions: [],
  isolation: "public",
  notes,
});

const provider = (notes?: string): ApiPermissionRule => ({
  permissions: [],
  isolation: "provider",
  notes,
});

const gone = (notes?: string): ApiPermissionRule => ({
  permissions: [],
  isolation: "gone",
  notes,
});

/**
 * Intended guard inventory for every live API handler.
 * Live enforcement is per-route (`requirePermissionFresh` / `requireAuth` / …).
 * `requireApiPermission` exists but is unused — do not auto-wire without handling
 * dual-purpose catalog GETs (`?scope=staff` vs storefront `pub`).
 * Dynamic segments use [id] / [userId] / [addressId] / [productId] / [fabricId].
 */
export const API_PERMISSIONS: Record<string, ApiPermissionRule> = {
  // Catalog — public reads, staff writes
  "GET /api/product": pub(
    "Storefront listing filtered by DEFAULT_ORG_ID or default org. Admin list: ?scope=staff → actor.orgId (products:read). Ignore ?seller=&shop=&orgId=. Invalid category/fabric id → 404."
  ),
  "POST /api/product": staff(
    P.ProductsWrite,
    "Live: requirePermissionFresh(products:write). Stamp actor.orgId. Never body.seller/shop/orgId. Admin create embeds base64 images (POST /api/upload* is uploads:write, Step 4.4). Plan limit via assertWithinPlanLimit(products)."
  ),
  "GET /api/product/[id]": pub(
    "Storefront detail; DEFAULT_ORG_ID / default org. ?scope=staff → actor.orgId (cross-tenant 403)."
  ),
  "PUT /api/product/[id]": staff(
    P.ProductsWrite,
    "Live: requirePermissionFresh(products:write). Actor.orgId only; cross-tenant 403. Never apply seller/shop/orgId."
  ),
  "DELETE /api/product/[id]": staff(
    P.ProductsDelete,
    "Live: requirePermissionFresh(products:delete). Actor.orgId only; cross-tenant 403."
  ),
  "GET /api/product/bulk": staff(
    P.ProductsRead,
    "Live: requirePermissionFresh(products:read). Actor.orgId. Not public storefront."
  ),
  "POST /api/product/bulk": staff(
    P.ProductsWrite,
    "Live: requirePermissionFresh(products:write). Stamp actor.orgId. Never seller/shop/orgId on items. Plan limit via assertWithinPlanLimit(products, count)."
  ),
  "GET /api/product/category/[id]": pub(
    "Public storefront. Invalid id → 404."
  ),
  "GET /api/product/shop/[id]": gone(
    "Retired. Live: 410 Gone — use /api/product?scope=staff."
  ),
  "PUT /api/product/shop/[id]": gone(
    "Retired. Live: 410 Gone — use /api/product/[id]."
  ),
  "DELETE /api/product/shop/[id]": gone(
    "Retired. Live: 410 Gone — use /api/product/[id]."
  ),
  "GET /api/product/seller/[id]": gone(
    "Retired. Live: 410 Gone — use /api/product?scope=staff."
  ),
  "PUT /api/product/seller/[id]": gone(
    "Retired. Live: 410 Gone — use /api/product/[id]."
  ),
  "DELETE /api/product/seller/[id]": gone(
    "Retired. Live: 410 Gone — use /api/product/[id]."
  ),
  "GET /api/fabric": pub(
    "Storefront filtered by DEFAULT_ORG_ID or default org. Admin list: ?scope=staff → actor.orgId. ?sellable=true is public shop filter. Ignore ?seller=&shop=&orgId=."
  ),
  "POST /api/fabric": staff(
    P.FabricsWrite,
    "Live: requirePermissionFresh(fabrics:write). Stamp actor.orgId. taxRate/taxExempt persist (catalog override, not tax:manage). Never body.seller/shop/orgId. Plan limit via assertWithinPlanLimit(fabrics)."
  ),
  "GET /api/fabric/[id]": pub(
    "Storefront detail; DEFAULT_ORG_ID / default org. ?scope=staff → actor.orgId (cross-tenant 403). Ignore ?seller=&shop=&orgId=."
  ),
  "PUT /api/fabric/[id]": staff(
    P.FabricsWrite,
    "Live: requirePermissionFresh(fabrics:write). Actor.orgId only; cross-tenant 403. taxRate/taxExempt persist. Never apply seller/shop/orgId."
  ),
  "DELETE /api/fabric/[id]": staff(
    P.FabricsDelete,
    "Live: requirePermissionFresh(fabrics:delete). Actor.orgId only; cross-tenant 403."
  ),
  "GET /api/product-category": pub(
    "Storefront filtered by DEFAULT_ORG_ID or default org. Admin list: ?scope=staff → actor.orgId via categories:read, including publicPage url and embed snippet. Counts include shop Product links only. Ignore ?seller=&shop=&orgId=."
  ),
  "POST /api/product-category": staff(
    P.CategoriesWrite,
    "Live: requirePermissionFresh(categories:write). Stamp actor.orgId. Never body.seller/shop/orgId. Plan limit via assertWithinPlanLimit(categories). Creates a menu PublicCategoryPage (skipped for isDefault). Demo-locked."
  ),
  "GET /api/product-category/[id]": pub(
    "Storefront detail; DEFAULT_ORG_ID / default org. ?scope=staff → actor.orgId (cross-tenant 403) plus publicPage url/snippet. Counts include shop products. Ignore ?seller=&shop=&orgId=."
  ),
  "PUT /api/product-category/[id]": staff(
    P.CategoriesWrite,
    "Live: requirePermissionFresh(categories:write). Actor.orgId only; cross-tenant 403. Never apply seller/shop/orgId. Rename does not change the public slug. publicSlug, layout, and embedEnabled update the menu PublicCategoryPage. Demo-locked."
  ),
  "DELETE /api/product-category/[id]": staff(
    P.CategoriesDelete,
    "Live: requirePermissionFresh(categories:delete). Actor.orgId only; cross-tenant 403. Deactivates the menu PublicCategoryPage in the same transaction, then deletes the category. Blocked while shop products are linked."
  ),
  "GET /api/shop": gone(
    "Unused by UI. Live: 410 Gone (Step 4.3). Not multi-tenant. Public /shop is GET /api/product."
  ),
  "POST /api/shop": gone(
    "Unused by UI. Live: 410 Gone. Not settings:manage / products:write — do not invent tenant shops."
  ),
  "PUT /api/shop": gone("Unused by UI. Live: 410 Gone (collection mutate closed)."),
  "PATCH /api/shop": gone("Unused by UI. Live: 410 Gone (collection mutate closed)."),
  "DELETE /api/shop": gone("Unused by UI. Live: 410 Gone (collection mutate closed)."),
  "GET /api/shop/[id]": gone(
    "Unused by UI. Live: 410 Gone. Not a tenant. Public /shop/[slug] is product detail."
  ),
  "POST /api/shop/[id]": gone("Unused by UI. Live: 410 Gone."),
  "PUT /api/shop/[id]": gone(
    "Unused by UI. Live: 410 Gone. Do not apply body.owner or invent owner checks."
  ),
  "PATCH /api/shop/[id]": gone("Unused by UI. Live: 410 Gone."),
  "DELETE /api/shop/[id]": gone("Unused by UI. Live: 410 Gone."),

  // Shipping (customer checkout rates — Phase 2)
  "POST /api/shipping/rates": own(
    P.OrdersCreateOwn,
    "requireAuth; quote bound to actor.sub + cart; rate tokens stay server-side in quote cache"
  ),

  // Shipping shipments (Phase 3)
  "GET /api/shipping/shipments": staff(
    P.DeliveriesRead,
    "actor.orgId shipment list; CWV=false → order.userId=sub (filters: status, orderId, page, limit)"
  ),
  "POST /api/shipping/shipments": staff(
    P.DeliveriesManage,
    "Manual book/retry for paid order in actor.orgId (+ CWV own-order); never rolls back payment"
  ),
  "GET /api/shipping/shipments/[id]": staff(
    P.DeliveriesRead,
    "actor.orgId shipment detail; CWV=false → order.userId=sub"
  ),
  "POST /api/shipping/shipments/[id]/cancel": staff(
    P.DeliveriesManage,
    "Cancel provider label when possible; CWV=false → order.userId=sub; mark Shipment cancelled"
  ),
  "GET /api/shipping/shipments/by-order/[orderId]": ownOrStaff(
    [P.DeliveriesRead, P.OrdersRead, P.OrdersReadOwn],
    "Staff deliveries:read or orders:read (org + CWV) OR order owner; ops fields only with deliveries:read"
  ),
  "POST /api/webhooks/shipping/shipbubble": provider(
    "Signature-only (x-ship-signature HMAC-SHA512). Updates Shipment + Order status monotonically."
  ),
  "POST /api/webhooks/shipping/fez": provider(
    "Signature-only (X-Signature HMAC-SHA256 of orderNumber+status+timestamp). Updates Shipment + Order status monotonically."
  ),

  // Orders
  "GET /api/order": staff(
    P.OrdersRead,
    "Staff list filtered by actor.orgId; CWV=false → userId=sub (Step 5.3). Clients use GET /api/order/me"
  ),
  "POST /api/order": own(
    P.OrdersCreateOwn,
    "requireAuth; user=sub; cart.user must match sub; Order.orgId from line ownership or storefront org"
  ),
  "GET /api/order/me": own(P.OrdersReadOwn, "requireAuth + ownedByFilter; staff list is GET /api/order"),
  "GET /api/order/[id]": ownOrStaff(
    [P.OrdersRead, P.OrdersReadOwn],
    "Owner or orders:read. Staff must match actor.orgId (Step 5.3; cross-tenant 403)."
  ),
  "PUT /api/order/[id]": ownOrStaff(
    [P.OrdersManage, P.OrdersCreateOwn],
    "Owner or orders:manage; status changes require orders:manage. Staff (non-owner) scoped to actor.orgId; owners stay user-scoped (Steps 3.x). Never apply body.user."
  ),
  "DELETE /api/order/[id]": ownOrStaff(
    [P.OrdersManage, P.OrdersCreateOwn],
    "Owner may delete own pending/initiated; staff with orders:manage delete pending/initiated in actor.orgId. Owners who are also staff stay user-scoped."
  ),

  // Customizations — live: staff list + owner-or-staff on [id]. Do NOT require
  // CustomizationsManageOwn on POST/GET /me (staff presets have no _own).
  "GET /api/customization": staff(
    P.CustomizationsRead,
    "Staff list (requirePermissionFresh) + assertStorefrontStaffOrg; clients use GET /api/customization/me. Admin customizations UI is storefront-only."
  ),
  "POST /api/customization": own(
    P.CustomizationsManageOwn,
    "Live: requireAuth; user=sub. Never body.user. Catalog ManageOwn is inventory only."
  ),
  "GET /api/customization/me": own(
    P.CustomizationsManageOwn,
    "Live: requireAuth + ownedByFilter; ignore ?userId="
  ),
  "GET /api/customization/[id]": ownOrStaff(
    [P.CustomizationsRead, P.CustomizationsManageOwn],
    "Live: owner or storefront customizations:read (403 IDOR / non-storefront staff). Populate user for admin detail."
  ),
  "PUT /api/customization/[id]": ownOrStaff(
    [P.CustomizationsManage, P.CustomizationsManageOwn],
    "Live: owner or storefront customizations:manage. Never apply body.user (keep original owner)."
  ),
  "DELETE /api/customization/[id]": ownOrStaff(
    [P.CustomizationsManage, P.CustomizationsManageOwn],
    "Live: owner or storefront customizations:manage"
  ),
  "GET /api/customization/user/[userId]": ownOrStaff(
    [P.CustomizationsRead, P.CustomizationsManageOwn],
    "Live: owner if userId===sub, else storefront customizations:read"
  ),
  "POST /api/custom-request": own(
    P.CustomizationsManageOwn,
    "Unused by UI. Live: requireAuth; user=sub. Never body.user."
  ),
  "GET /api/custom-request": own(
    P.CustomizationsManageOwn,
    "Unused by UI. Live: requireAuth + ownedByFilter."
  ),
  "PATCH /api/custom-request": staff(
    P.CustomizationsManage,
    "Live: customizations:manage only. Closed gap: any auth user could PATCH status."
  ),

  // Reviews — live isolation. Public GET by productId only (no list-all).
  "GET /api/reviews": pub(
    "Live: public by productId for storefront/default org products (Step 5.1). Missing productId → 400. Ignore ?userId=."
  ),
  "POST /api/reviews": own(
    P.ReviewsCreateOwn,
    "Live: requireAuth; user=sub; product must be storefront org. Never body.user. Catalog CreateOwn is inventory only."
  ),
  "PATCH /api/reviews/[id]": ownOrStaff(
    [P.ReviewsCreateOwn, P.ReviewsModerate],
    "Live: empty body like-toggle (any auth). rating/comment: owner or reviews:moderate. Never body.user."
  ),
  "DELETE /api/reviews/[id]": ownOrStaff(
    [P.ReviewsCreateOwn, P.ReviewsModerate],
    "Live: owner or reviews:moderate"
  ),

  // Cart — live: requireAuth + user=sub / owner-only. Do NOT require CartManageOwn
  // (staff presets have no _own; AUTH_ANY /cart+/checkout must keep working).
  "GET /api/cart": staff(
    P.CartRead,
    "Staff list (requirePermissionFresh) + assertStorefrontStaffOrg; clients use GET /api/cart/me. No Cart.orgId — registered companies denied."
  ),
  "POST /api/cart": own(
    P.CartManageOwn,
    "Live: requireAuth; user=sub. Catalog CartManageOwn is inventory only."
  ),
  "GET /api/cart/me": own(
    P.CartManageOwn,
    "Live: requireAuth + ownedByFilter; ignore ?userId="
  ),
  "POST /api/cart/me": own(
    P.CartManageOwn,
    "Live: requireAuth; addLinesToUserCart(sub); never body.user"
  ),
  "GET /api/cart/[id]": own(
    P.CartManageOwn,
    "Live: owner-only (403 IDOR). No cart:read staff override."
  ),
  "PUT /api/cart/[id]": own(
    P.CartManageOwn,
    "Live: owner-only. Never apply body.user"
  ),
  "DELETE /api/cart/[id]": own(P.CartManageOwn, "Live: owner-only"),
  "DELETE /api/cart/[id]/clear": own(P.CartManageOwn, "Live: owner-only"),
  "POST /api/cart/[id]/product/[productId]": own(P.CartManageOwn, "Live: owner-only"),
  "DELETE /api/cart/[id]/product/[productId]": own(P.CartManageOwn, "Live: owner-only"),
  "POST /api/cart/[id]/fabric/[fabricId]": own(P.CartManageOwn, "Live: owner-only"),
  "DELETE /api/cart/[id]/fabric/[fabricId]": own(P.CartManageOwn, "Live: owner-only"),
  "PATCH /api/cart/[id]/fabric/[fabricId]": own(P.CartManageOwn, "Live: owner-only"),

  // Wallet
  "GET /api/wallet": staff(
    P.WalletRead,
    "Staff list (requirePermissionFresh) + assertStorefrontStaffOrg; clients use GET /api/wallet/me. No Wallet.orgId — registered companies denied."
  ),
  "POST /api/wallet": own(
    P.WalletReadOwn,
    "Live: requireAuth; user=sub. Catalog WalletReadOwn is inventory only (staff lack _own)."
  ),
  "GET /api/wallet/me": own(
    P.WalletReadOwn,
    "Live: requireAuth; ensureOwnedWallet(sub); ignore ?userId="
  ),
  "POST /api/wallet/fund": own(
    P.WalletTransactOwn,
    "Live: requireAuth; metadata.uuid from session; never body.user"
  ),
  "POST /api/wallet/withdraw": own(
    P.WalletTransactOwn,
    "Live: requireAuth; deductFunds(user=sub)"
  ),
  "POST /api/wallet/reciept/generate": own(
    P.WalletReadOwn,
    "Filename is misspelled reciept. Live: requireAuth; transaction must belong to sub"
  ),
  "GET /api/wallet/[id]": own(
    P.WalletReadOwn,
    "Live: owner-only (403 IDOR). No wallet:read staff override."
  ),
  "PUT /api/wallet/[id]": own(
    P.WalletManage,
    "Live: owner-only; beneficiary only; never user/balance/transactions. No staff mutate of others."
  ),
  "DELETE /api/wallet/[id]": own(
    P.WalletManage,
    "Live: owner-only. No wallet:manage staff override."
  ),

  // Payments
  "POST /api/payment/purchase": own(P.PaymentsCheckoutOwn),
  "GET /api/payment/stripe/confirm": provider(
    "ACCEPTED OPEN (Step 7.1): Stripe session_id via getCheckoutSession — not JWT. Success pages + webhook."
  ),
  "POST /api/payment/stripe/create-session": own(
    P.PaymentsCheckoutOwn,
    "Legacy; checkout uses purchase. Live: requireAuth + owned order; amount from order (not checkout_own — staff lack _own). Never body.amount/uuid."
  ),
  "GET /api/payment/paystack/callback": provider(
    "ACCEPTED OPEN (Step 7.1): Paystack secret verify — not JWT. UI checkout off."
  ),
  "POST /api/payment/paystack/initialize": own(
    P.PaymentsCheckoutOwn,
    "Legacy; UI disabled. Live: requireAuth + owned order; amount from order. Never body.amount/uuid."
  ),
  "GET /api/payment/paystack/banks": own(
    P.WalletTransactOwn,
    "Unused by UI. Live: requireAuth (not transact_own — staff lack _own)."
  ),
  "POST /api/payment/paystack/verify-transfer": own(
    P.WalletTransactOwn,
    "Paystack transfer OTP. Live: requireAuth (was open). Not transact_own — staff lack _own."
  ),
  "POST /api/webhooks/stripe": provider(
    "ACCEPTED OPEN (Step 7.1): Stripe-Signature verify — not JWT."
  ),
  "GET /api/cron/reconcile-company-subscriptions": provider(
    "Step 3: Bearer CRON_SECRET (hourly). Calls runReconcileCompanySubscriptions — not JWT/RBAC."
  ),
  "POST /api/cron/reconcile-company-subscriptions": provider(
    "Step 3: same as GET; Bearer CRON_SECRET."
  ),
  "GET /api/cron/parties-maintenance": provider(
    "Live: Bearer CRON_SECRET (external schedulers). runPartyMaintenance: party hold expiry, invitation expiry, balance reminders, no-show overlay. Also runs inside the hourly reconcile cron."
  ),
  "POST /api/cron/parties-maintenance": provider("Same as GET /api/cron/parties-maintenance."),
  "GET /api/cron/remind-company-subscriptions": provider(
    "Step 3: Bearer CRON_SECRET (daily). 14/7/3/1d + ops-grant reminds (catch-up); also expires overdue membership invites (Hobby 2-cron); piggybacks guest memberships dunning (Feature 08). Never suspends."
  ),
  "POST /api/cron/remind-company-subscriptions": provider(
    "Step 3: same as GET; Bearer CRON_SECRET. 14/7/3/1d catch-up reminds + memberships dunning piggyback."
  ),
  "GET /api/cron/expire-membership-invites": provider(
    "Step 3: Bearer CRON_SECRET (daily). Revokes overdue Membership.inviteExpiresAt seats."
  ),
  "POST /api/cron/expire-membership-invites": provider(
    "Step 3: same as GET; Bearer CRON_SECRET."
  ),
  // Profile / auth (authenticated identity; catalog *_own is inventory only)
  "GET /api/auth/me": own(
    P.ProfileManageOwn,
    "Live: requireAuthFresh + ownedByFilter for Profile. Not ProfileManageOwn (staff lack _own)."
  ),
  "DELETE /api/auth/me": own(
    P.ProfileManageOwn,
    "Live: requireAuthFresh; Restrict-FK preflight; Serializable last-admin recheck + detach invitedBy/activityLog/fashionChat refs + purge tailor/profile/wallet/memberships/user; clears session cookies. Blocks sole platform_admin (Step 6.1) and users with orders/reviews/jobs/etc."
  ),
  "PATCH /api/auth/profile": own(
    P.ProfileManageOwn,
    "Live: requireAuth; User/Profile by sub. Email/role/permissions not self-editable. Syncs User+Profile names. Never body.user."
  ),
  "POST /api/auth/profile/picture": own(
    P.ProfileManageOwn,
    "Live: requireAuth + ownedByFilter update (creates Profile if missing)."
  ),
  "POST /api/auth/change-password": own(
    P.ProfileManageOwn,
    "Live: requireAuth; currentPassword + newPassword for session user. Google-only accounts with no password → 400."
  ),
  "DELETE /api/auth/profile/address/[addressId]": own(
    P.ProfileManageOwn,
    "Live: requireAuth; address on session user's Profile only."
  ),
  "GET /api/wishlist": own(
    P.ProfileManageOwn,
    "Live: requireAuth + ownedByFilter; ignore ?userId=. Not ProfileManageOwn (staff lack _own)."
  ),
  "POST /api/wishlist": own(
    P.ProfileManageOwn,
    "Live: requireAuth; user=sub; never body.user. Catalog ProfileManageOwn is inventory only."
  ),
  "GET /api/notification": own(
    P.NotificationsReadOwn,
    "Live: requireAuth + ownedByFilter; ignore ?userId=. Not NotificationsReadOwn (staff lack _own)."
  ),
  "PATCH /api/notification": own(
    P.NotificationsReadOwn,
    "Live: requireAuth + owner (403 IDOR). Never findByIdAndUpdate(id) alone."
  ),
  "DELETE /api/notification": own(
    P.NotificationsReadOwn,
    "Live: requireAuth + owner. Delete own notification by id in body."
  ),

  // Fashion chat — public storefront isolation + staff inbox RBAC.
  "GET /api/fashion-chat": pub(
    "Guest sessionId/IP or auth user=sub. Returns own conversation history. Ignore ?userId=."
  ),
  "POST /api/fashion-chat": pub(
    "ACCEPTED guest mutator. sessionId + contact for inbox. Never body.user/usePublicData."
  ),
  "POST /api/fashion-chat/stream": pub(
    "SSE StyleForge stream. Same isolation; persists conversation for staff inbox."
  ),
  "POST /api/fashion-chat/end": pub(
    "Customer ends session. Marks open FashionChat resolved; keeps contact + transcript for admin."
  ),
  "POST /api/fashion-chat/start": pub(
    "Customer submits contact form. Creates/opens shell conversation so admin sees name/email/phone before first message."
  ),
  "GET /api/admin/fashion-chats": staff(
    P.AiChatsRead,
    "Live: requirePermissionFresh(ai:chats_read). Actor.orgId FashionChat list/inbox; CWV=false → assignee/queue own-scope (incl. stats counts)."
  ),
  "GET /api/admin/fashion-chats/[id]": staff(
    P.AiChatsRead,
    "Live: requirePermissionFresh(ai:chats_read). Actor.orgId detail + same CWV own-scope as list."
  ),
  "POST /api/admin/fashion-chats/[id]/reply": staff(
    P.AiChatsReply,
    "Live: requirePermissionFresh(ai:chats_reply). Append staff message; actor.orgId."
  ),
  "PATCH /api/admin/fashion-chats/[id]": staff(
    P.AiChatsReply,
    "Live: requirePermissionFresh(ai:chats_reply). status / handoffRequired; actor.orgId."
  ),
  "DELETE /api/admin/fashion-chats/[id]": staff(
    P.AiChatsDelete,
    "Live: requirePermissionFresh(ai:chats_delete). Permanently delete one FashionChat in actor.orgId."
  ),
  "DELETE /api/admin/fashion-chats": staff(
    P.AiChatsDelete,
    "Live: requirePermissionFresh(ai:chats_delete). Bulk delete FashionChat docs by ids in actor.orgId."
  ),

  // Staff settings / analytics / uploads
  "GET /api/analytics": staff(
    P.AnalyticsRead,
    "Live: requirePermissionFresh(analytics:read). Orders/products/activity CWV-scoped to actor; tailoring job totals stay org-wide ops metrics."
  ),
  "GET /api/tax-settings": pub(
    "Checkout/cart tax display for storefront org. enabled/rate/label only — no secrets."
  ),
  "GET /api/admin/tax-settings": staff(
    P.TaxManage,
    "Live: requirePermissionFresh(tax:manage). Actor.orgId TaxSettings. Public copy is GET /api/tax-settings."
  ),
  "PUT /api/admin/tax-settings": staff(
    P.TaxManage,
    "Live: requirePermissionFresh(tax:manage). Actor.orgId only."
  ),
  "GET /api/admin/company-profile": {
    permissions: [P.SettingsManage, P.OrdersRead, P.OrdersManage],
    isolation: "staff_global",
    notes:
      "Live: requireAuthFresh then branch — settings:manage → assertOrganizationAllowsWorkspaceLifecycle (soft-hold OK for export/offboard UI) + full redacted DTO + optional workspaceLifecycle; orders:read|manage only → assertOrganizationActive (no soft-hold) + print-safe (no routing/IBAN, billingEmail, logoPublicId). Actor.orgId only. Bank ciphertext never returned. PUT still uses Active Fresh (writes denied on soft-hold).",
  },
  "PUT /api/admin/company-profile": staff(
    P.CompanyProfileWrite,
    "Live: requirePermissionFresh(company_profile:write, allowOnDemo for existing profile fields). Upsert actor.orgId. Ignores body.orgId/logoUrl/logoPublicId/ciphertext. Public logo/phone/support email/website/address switches and embedOrigins are demo-locked. Unknown public* keys (bank, tax, billing email) are rejected. Origins are https with no path or wildcard. organizationSlug rename rejects reserved first segments (app routes, public/ folders) and moves every /{orgSlug}/{categorySlug} link."
  ),
  "POST /api/admin/company-profile/logo": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage). Upload logo to company-profiles/{orgId}; updates logoUrl/logoPublicId."
  ),
  "DELETE /api/admin/company-profile/logo": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage). Clear logoUrl/logoPublicId and destroy prior Cloudinary asset."
  ),
  "POST /api/admin/company-profile/signin-background": staff(
    P.CompanyProfileWrite,
    "Live: requirePermissionFresh(company_profile:write, allowOnDemo) + active org + not park-locked. JPEG/PNG/WebP ≤8MB (magic-byte sniff) → Cloudinary company-profiles/{orgId}/signin-background; updates signinBackgroundUrl/PublicId."
  ),
  "DELETE /api/admin/company-profile/signin-background": staff(
    P.CompanyProfileWrite,
    "Live: requirePermissionFresh(company_profile:write, allowOnDemo). Clear signinBackgroundUrl/PublicId, then destroy the org-owned Cloudinary asset (best effort)."
  ),
  "GET /api/admin/venue-locations": {
    permissions: [
      P.SettingsManage,
      P.ProductsRead,
      P.ProductsWrite,
      P.TicketingRead,
      P.TicketingWrite,
      P.BookingsRead,
      P.BookingsWrite,
      P.MembershipsRead,
      P.MembershipsWrite,
      P.MembershipsSell,
      P.MembershipsBilling,
      P.MembershipsAdmin,
      P.AnalyticsRead,
      P.WaiversRead,
      P.WaiversWrite,
      P.WaiversVerify,
      P.WaiversAdmin,
    ],
    isolation: "staff_global",
    notes:
      "Live: requireAnyPermissionFresh(settings:manage|products:*|ticketing:*|bookings:*|memberships:read|write|sell|billing|admin|analytics:read) + Demo lock + active registered company (not storefront/isDefault). List VenueLocation for actor.orgId. Default applies actorLocationScope (HQ preference + MembershipVenueAssignment park lock). ?scope=all skips preference filter (switchers); park-locked still capped to assigned set. Rejects ?orgId=/?organizationId=/?locationId=. Park-stamped Product/Order/ticketing/memberships filter by scope; members list org-wide; meters company-wide. Ignores client orgId. POST create stays settings:manage only.",
  },
  "POST /api/admin/venue-locations": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage) + Demo lock + active registered company (not storefront/isDefault). Create VenueLocation; plan limit via assertWithinPlanLimit(venues). Park-locked → ForbiddenError. Ignores body.orgId."
  ),
  "GET /api/admin/venue-locations/[id]": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage) + Demo lock + registered company. Get one VenueLocation for actor.orgId. Cross-org id → forbidden. Park-locked outside assignment → forbidden."
  ),
  "PATCH /api/admin/venue-locations/[id]": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage) + Demo lock + registered company. Update profile (company-wide: full + isFranchise flag; franchiseParkManager: park-manageable franchise profile fields on assigned isFranchise parks only) or action=archive|reactivate (park-locked → ForbiddenError). Archive clears hqSelectedLocationId + MembershipVenueAssignment (+ franchiseParkManager when empty) + guest park eligibility/settings; soft-archives park-specific MembershipPlans. Ignores body.orgId/status."
  ),
  "DELETE /api/admin/venue-locations/[id]": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage) + Demo lock + registered company. Soft-archive VenueLocation (frees venues quota; clears HQ prefs + park assignments + membership eligibility/settings/cancel-alternatives + defaultHomeLocationId pointers; soft-archives park-specific MembershipPlans while keeping locationId historical — never promotes to org-default). Park-locked → ForbiddenError. Not hard-delete."
  ),
  "GET /api/admin/hq/overview": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage) + assertEnterpriseHqEnabled + assertNotParkLockedCompanyHq. Cross-venue HQ control plane (rollup + usage meters) for actor.orgId. locationScope may narrow venues.items; active/archived counts + meters stay company-wide. Park-stamped ticketing/Product/Order filter by scope when stamped; members list not park-filtered. Rejects ?orgId=/?locationId=. UI /admin/hq soft-upsells non-Enterprise (no fetch). Storefront/Starter/Growth/Demo/park-locked APIs denied."
  ),
  "GET /api/admin/hq/location-context": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage) + assertEnterpriseHqEnabled + assertNotParkLockedCompanyHq. Read Membership.hqSelectedLocationId (null = All locations). Park-locked must use /api/admin/park-context. Rejects ?orgId=/?userId=/?membershipId=/?locationId=."
  ),
  "PUT /api/admin/hq/location-context": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage) + assertEnterpriseHqEnabled + assertNotParkLockedCompanyHq. Set Membership.hqSelectedLocationId; venue must belong to actor.orgId. Park-locked must use /api/admin/park-context. Ignores body.orgId/userId/membershipId. Rejects org/user/membership/location selectors in query."
  ),
  "GET /api/admin/park-context": {
    permissions: [
      P.SettingsManage,
      P.AnalyticsRead,
      P.ProductsWrite,
      P.ProductsRead,
      P.OrdersRead,
      P.TicketingRead,
      P.TicketingWrite,
      P.BookingsRead,
      P.BookingsWrite,
      P.MembershipsRead,
      P.MembershipsWrite,
      P.MembershipsSell,
      P.MembershipsBilling,
      P.MembershipsAdmin,
      P.WaiversRead,
      P.WaiversWrite,
      P.WaiversVerify,
      P.WaiversAdmin,
      P.PosRead,
      P.PosSell,
      P.PosAdmin,
      P.PosCheckin,
      P.PosTabs,
      P.PosTillOpen,
    ],
    isolation: "staff_global",
    notes:
      "Live: requireAnyPermissionFresh(settings:manage|analytics:read|products:*|orders:read|ticketing:*|bookings:*|memberships:*|waivers:*|pos:read|sell|admin|checkin|tabs|till_open). Park assignment scope + selected park for Growth/Starter (no Enterprise required). Returns parkLocked, assignedLocations, effectiveLocationId. Rejects ?orgId=/?userId=/?membershipId=/?locationId=. UI: AdminHeader ParkContextSwitcher.",
  },
  "PUT /api/admin/park-context": {
    permissions: [
      P.SettingsManage,
      P.AnalyticsRead,
      P.ProductsWrite,
      P.ProductsRead,
      P.OrdersRead,
      P.TicketingRead,
      P.TicketingWrite,
      P.BookingsRead,
      P.BookingsWrite,
      P.MembershipsRead,
      P.MembershipsWrite,
      P.MembershipsSell,
      P.MembershipsBilling,
      P.MembershipsAdmin,
      P.WaiversRead,
      P.WaiversWrite,
      P.WaiversVerify,
      P.WaiversAdmin,
      P.PosRead,
      P.PosSell,
      P.PosAdmin,
      P.PosCheckin,
      P.PosTabs,
      P.PosTillOpen,
    ],
    isolation: "staff_global",
    notes:
      "Live: requireAnyPermissionFresh + rate limit. Body { locationId } → Membership.hqSelectedLocationId. Park-locked: must be in assigned set (never null All). Company-wide: null = All locations. Ignores body.orgId/userId/membershipId.",
  },
  "GET /api/admin/billing/plans": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage) + active org. Plan catalog + actor.orgId billing state (no Stripe secrets)."
  ),
  "GET /api/admin/billing/state": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage) + active org. Thin billing state for dashboard widgets."
  ),
  "POST /api/admin/billing/checkout": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage) + active org + platform_admin. Park-locked → ForbiddenError. Body { plan } → Stripe Checkout mode=subscription metadata type=company_subscription. Rate-limited."
  ),
  "POST /api/admin/billing/portal": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage) + active org + platform_admin. Park-locked → ForbiddenError. Stripe Customer Portal for actor.orgId customer only."
  ),
  "GET /api/admin/marketplace/account": {
    permissions: [
      P.SettingsManage,
      P.AnalyticsRead,
      P.BookingPackagesManage,
      P.MarketplaceRefunds,
    ],
    isolation: "staff_global",
    notes:
      "Live: requireAnyPermissionFreshWorkspaceLifecycle(settings:manage|analytics:read|booking_packages:manage|marketplace:refunds) + assertNotDemoPlanLocked. Soft-hold/suspended readable (payouts banner; chargeReady false). Actor.orgId OrganizationMarketplaceAccount DTO + chargeReady + publishedActivePackageCount. Ignore ?orgId. World B (marketplace Connect) — not company_subscription billing. Franchise park Connect uses /api/admin/marketplace/park-accounts (Step 3).",
  },
  "GET /api/admin/marketplace/park-accounts": staff(
    P.PayoutsRead,
    "Live: requirePermissionFresh(payouts:read). Company-wide lists all franchise park Connect rows; franchiseParkManager → assigned parks only; park-locked non-managers Forbidden. Never SaaS billing."
  ),
  "GET /api/admin/marketplace/park-accounts/[locationId]": staff(
    P.PayoutsRead,
    "Live: requirePermissionFresh(payouts:read) + assertCanAccessParkPayouts (company-wide any franchise park incl. archived, or franchise manager on assigned parks). Mutating Connect routes use assertCanManageParkConnect (active only)."
  ),
  "POST /api/admin/marketplace/park-accounts/[locationId]/connect/onboard": staff(
    P.PayoutsManage,
    "Live: requirePermissionFresh(payouts:manage) + assertCanManageParkConnect. Stripe Connect Express for VenueLocationMarketplaceAccount. Return/refresh URLs → /admin/payouts?locationId=. Never body.orgId."
  ),
  "POST /api/admin/marketplace/park-accounts/[locationId]/connect/refresh": staff(
    P.PayoutsManage,
    "Live: requirePermissionFresh(payouts:manage) + assertCanManageParkConnect. Refresh park Account Link."
  ),
  "POST /api/admin/marketplace/park-accounts/[locationId]/connect/sync": staff(
    P.PayoutsManage,
    "Live: requirePermissionFresh(payouts:manage) + assertCanManageParkConnect. Pull Stripe flags into VenueLocationMarketplaceAccount. Never mutates SaaS subscription columns."
  ),
  "POST /api/admin/marketplace/park-accounts/[locationId]/connect/login-link": staff(
    P.PayoutsManage,
    "Live: requirePermissionFresh(payouts:manage) + assertCanManageParkConnect. Express Dashboard login when park onboarding complete."
  ),
  "POST /api/admin/marketplace/connect/onboard": staff(
    P.PayoutsManage,
    "Live: requirePermissionFresh(payouts:manage) + platform_admin + assertNotParkLockedCompanyHq + apiRateLimited(8/15m). Start Stripe Connect Express onboarding for actor.orgId. Ignore body.orgId."
  ),
  "POST /api/admin/marketplace/connect/refresh": staff(
    P.PayoutsManage,
    "Live: requirePermissionFresh(payouts:manage) + platform_admin + assertNotParkLockedCompanyHq + apiRateLimited(8/15m). Refresh Connect Account Link for actor.orgId."
  ),
  "POST /api/admin/marketplace/connect/login-link": staff(
    P.PayoutsManage,
    "Live: requirePermissionFresh(payouts:manage) + platform_admin + assertNotParkLockedCompanyHq + apiRateLimited(8/15m). Express Dashboard login link when onboarding complete."
  ),
  "POST /api/admin/marketplace/connect/sync": staff(
    P.PayoutsManage,
    "Live: requirePermissionFresh(payouts:manage) + assertNotParkLockedCompanyHq. Pull Stripe Connect account flags into OrganizationMarketplaceAccount; return DTO + chargeReady."
  ),
  "GET /api/admin/booking-packages": staff(
    P.BookingPackagesManage,
    "Live: requirePermissionFresh(booking_packages:manage). List BookingPackage for actor.orgId. Ignore ?orgId."
  ),
  "POST /api/admin/booking-packages": staff(
    P.BookingPackagesManage,
    "Live: requirePermissionFresh(booking_packages:manage). Create BookingPackage (plan limit bookingPackages). Ignore body.orgId."
  ),
  "GET /api/admin/booking-packages/[id]": staff(
    P.BookingPackagesManage,
    "Live: requirePermissionFresh(booking_packages:manage). Get package for actor.orgId (cross-tenant 403)."
  ),
  "PATCH /api/admin/booking-packages/[id]": staff(
    P.BookingPackagesManage,
    "Live: requirePermissionFresh(booking_packages:manage). Update package for actor.orgId. Ignore body.orgId."
  ),
  "DELETE /api/admin/booking-packages/[id]": staff(
    P.BookingPackagesManage,
    "Live: requirePermissionFresh(booking_packages:manage). Hard-delete or soft-retire package for actor.orgId."
  ),
  "GET /api/admin/marketplace/bookings": {
    permissions: [
      P.MarketplaceRefunds,
      P.SettingsManage,
      P.BookingPackagesManage,
      P.AnalyticsRead,
    ],
    isolation: "staff_global",
    notes:
      "Live: requireAnyPermissionFreshWorkspaceLifecycle + assertNotDemoPlanLocked. Soft-hold/suspended: paid history remains readable. List recent MarketplaceBooking for actor.orgId (refund UI). Redacted — no Connect/PI ids. Ignore ?orgId.",
  },
  "POST /api/admin/marketplace/bookings/[id]/refund": {
    permissions: [P.MarketplaceRefunds, P.SettingsManage],
    isolation: "staff_global",
    notes:
      "Live: requireAnyPermissionFreshWorkspaceLifecycle + (marketplace:refunds OR settings:manage+platform_admin) + assertNotDemoPlanLocked. Soft-hold/suspended may reverse paid money; new Checkout still charge-ready fail-closed. Stripe refund_application_fee. Ignore body.orgId.",
  },
  "GET /api/public/booking-packages/[publicOrgKey]/[slug]": pub(
    "Published+active BookingPackage by org slug/id + package slug. No private Connect/ledger fields."
  ),
  "POST /api/public/booking-packages/[publicOrgKey]/[slug]/checkout": pub(
    "Public marketplace checkout. Body: email, name?, idempotencyKey only. Destination charge to company Connect account. Rate-limited by IP."
  ),
  "GET /api/public/marketplace/checkout-session/[sessionId]": pub(
    "Public read-only marketplace booking reconcile by Stripe Checkout session id (success page). Never marks paid — webhook is SSOT. Rate-limited by IP."
  ),
  "GET /api/admin/company-export": staff(
    P.SettingsManage,
    "Live: requirePermissionFreshWorkspaceLifecycle(settings:manage) + platform_admin + apiRateLimited(8/15m). Actor.orgId redacted workspace JSON export (venues + HQ location prefs on memberships). Soft billing hold allowed. UI: /admin/company-profile and soft-hold /company-pending. Ignores ?orgId. No Stripe ids / bank secrets / passwords. Storefront denied. ZIP not shipped (JSON download)."
  ),
  "POST /api/admin/company-offboard-request": staff(
    P.SettingsManage,
    "Live: requirePermissionFreshWorkspaceLifecycle(settings:manage) + platform_admin + apiRateLimited(8/15m). Soft offboardRequestedAt + audit + ops/company notices (idempotent). Soft billing hold allowed. UI: /admin/company-profile and soft-hold /company-pending; FECSYNC list filter status=offboard + Offboard req badge (cleared on Approve). Ignores body.orgId. No hard-delete. Storefront denied."
  ),
  "GET /api/admin/billing/usage": {
    permissions: [
      P.SettingsManage,
      P.AnalyticsRead,
      P.UsersInvite,
      P.UsersManageRoles,
      P.ProductsWrite,
      P.FabricsWrite,
      P.CategoriesWrite,
      P.BookingPackagesManage,
      P.TailorsManage,
    ],
    isolation: "staff_global",
    notes:
      "Live: requireAnyPermissionFresh(settings:manage|analytics:read|users:invite|users:manage_roles|products:write|fabrics:write|categories:write|booking_packages:manage|tailors:manage) + active registered company. Plan usage meters for dashboard + create/invite UI mirrors (incl. bookingPackages soft-gates). tailorSeats = distinct users with live tailor Membership OR non-suspended TailorProfile. tailorSeatOccupantUserIds only for settings:manage|users:invite|users:manage_roles|tailors:manage (empty otherwise).",
  },
  "GET /api/admin/registered-companies/metrics": staff(
    P.UsersManageRoles,
    "Live: requirePermissionFresh(users:manage_roles) + FECSYNC storefront platform_admin. Aggregated pending/active/suspended/subscribed/expiring + offboardRequestedCount. UI: CompaniesOverviewCards links to status filters."
  ),
  "GET /api/admin/shipping-settings": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage). Actor.orgId ShippingSettings (origin, parcel, providers)."
  ),
  "PUT /api/admin/shipping-settings": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage). Upsert actor.orgId ShippingSettings."
  ),
  "POST /api/admin/shipping-settings": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage). Test connection — sandbox rate fetch via providerRouter."
  ),
  "GET /api/ai-settings": pub(
    "Storefront chatbot botName only — no usePublicData."
  ),
  "GET /api/admin/ai-settings": staff(
    P.AiManage,
    "Live: requirePermissionFresh(ai:manage). Actor.orgId AiSettings. Never returns API keys (last4 hint only)."
  ),
  "PUT /api/admin/ai-settings": staff(
    P.AiManage,
    "Live: requirePermissionFresh(ai:manage). Actor.orgId only."
  ),
  "POST /api/admin/ai-settings": staff(
    P.AiManage,
    "Live: requirePermissionFresh(ai:manage). POST { action: importFromEnv } migrates OPENROUTER_* from env into dashboard storage; otherwise ping saved or draft provider credentials."
  ),
  "GET /api/homepage-content": pub(
    "Storefront homepage marketing sections (published only) for storefront org."
  ),
  "GET /api/admin/homepage-content": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage) + assertStorefrontStaffOrg. List storefront HomepageSection rows. UI storefront-only."
  ),
  "GET /api/admin/homepage-content/[key]": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage) + assertStorefrontStaffOrg. Storefront section by key."
  ),
  "PUT /api/admin/homepage-content/[key]": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage) + assertStorefrontStaffOrg. Update storefront section."
  ),
  "DELETE /api/admin/homepage-content/[key]": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage) + assertStorefrontStaffOrg. Reset storefront section defaults."
  ),
  "GET /api/ad-banners": pub(
    "Storefront Trending Fashion sidebar ad banners (active only) for storefront org."
  ),
  "GET /api/admin/ad-banners": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage) + assertStorefrontStaffOrg. List storefront AdBanner rows. UI storefront-only."
  ),
  "POST /api/admin/ad-banners": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage) + assertStorefrontStaffOrg. Create storefront AdBanner."
  ),
  "GET /api/admin/ad-banners/[id]": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage) + assertStorefrontStaffOrg. Storefront banner by id."
  ),
  "PUT /api/admin/ad-banners/[id]": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage) + assertStorefrontStaffOrg. Update storefront AdBanner."
  ),
  "DELETE /api/admin/ad-banners/[id]": staff(
    P.SettingsManage,
    "Live: requirePermissionFresh(settings:manage) + assertStorefrontStaffOrg. Delete storefront AdBanner."
  ),

  // Find-a-Tailor (live)
  "GET /api/tailors": pub(
    "Storefront Find-a-Tailor list. status=approved + DEFAULT_ORG_ID/default org only. Query: q, specialty, location, country, city, page, limit. PublicTailorDto — no user/email/orgId/status."
  ),
  "GET /api/tailors/[slug]": pub(
    "Storefront Find-a-Tailor detail by slug. Approved only; draft/pending/suspended → 404. No PII."
  ),
  "GET /api/admin/tailors": staff(
    P.TailorsRead,
    "Live: requirePermissionFresh(tailors:read). List TailorProfile for actor.orgId. UI: /admin/tailors."
  ),
  "POST /api/admin/tailors": staff(
    P.TailorsManage,
    "Live: requirePermissionFresh(tailors:manage). Create TailorProfile linked to User; stamp actor.orgId; upsert tailor Membership unless user is staff."
  ),
  "GET /api/admin/tailors/[id]": staff(
    P.TailorsRead,
    "Live: requirePermissionFresh(tailors:read). Actor.orgId tailor by id."
  ),
  "PUT /api/admin/tailors/[id]": staff(
    P.TailorsManage,
    "Live: requirePermissionFresh(tailors:manage). Update TailorProfile fields for actor.orgId."
  ),
  "PATCH /api/admin/tailors/[id]": staff(
    P.TailorsManage,
    "Live: requirePermissionFresh(tailors:manage). Status transitions (approve/suspend) for actor.orgId."
  ),
  "GET /api/tailor/me": own(
    P.TailorsWriteOwn,
    "Live: requireAuthFresh + active Membership rolePreset tailor on profile.orgId (or staff owner). Not write_own live — staff lack _own."
  ),
  "PUT /api/tailor/me": own(
    P.TailorsWriteOwn,
    "Live: same gate as GET + status must be approved (pending/draft/suspended → 403). Edit displayName/bio/specialties/location/portfolio/services. Cannot change status/slug. Demoted/revoked membership → 403."
  ),
  "POST /api/tailor/portfolio": own(
    P.TailorsWriteOwn,
    "Live: same gate as PUT /me (approved only). Cloudinary folder tailors (like profile-pictures)."
  ),
  "GET /api/tailor/clients": own(
    P.TailorsWriteOwn,
    "Live: requireAuthFresh + active tailor Membership (or staff owner). List TailorClient for actor TailorProfile."
  ),
  "POST /api/tailor/clients": own(
    P.TailorsWriteOwn,
    "Live: same gate as GET clients. Create TailorClient; org plan limit via assertWithinPlanLimit(tailorClients)."
  ),
  "DELETE /api/tailor/clients/[id]": own(
    P.TailorsWriteOwn,
    "Live: same gate as GET clients. Delete only clients owned by actor TailorProfile."
  ),
  "GET /api/tailor/campaigns": own(
    P.TailorsWriteOwn,
    "Live: requireAuthFresh + active tailor Membership (or staff owner). List MeasurementCampaign for actor TailorProfile."
  ),
  "POST /api/tailor/campaigns": own(
    P.TailorsWriteOwn,
    "Live: same gate as GET campaigns. Create MeasurementCampaign owned by actor TailorProfile."
  ),
  "POST /api/tailor/campaigns/media": own(
    P.TailorsWriteOwn,
    "Live: same gate as GET campaigns. Cloudinary folder campaigns for logo/cover; returns URL only."
  ),
  "GET /api/tailor/campaigns/[id]": own(
    P.TailorsWriteOwn,
    "Live: same gate; campaign must belong to actor TailorProfile."
  ),
  "PUT /api/tailor/campaigns/[id]": own(
    P.TailorsWriteOwn,
    "Live: same gate; update owned campaign fields."
  ),
  "PATCH /api/tailor/campaigns/[id]": own(
    P.TailorsWriteOwn,
    "Live: same gate; archive (and related actions) on owned campaign."
  ),
  "DELETE /api/tailor/campaigns/[id]": own(
    P.TailorsWriteOwn,
    "Live: same gate; delete owned campaign (participants cascade)."
  ),
  "GET /api/tailor/campaigns/[id]/participants": own(
    P.TailorsWriteOwn,
    "Live: requireAuthFresh + active tailor. List participants for owned campaign."
  ),
  "POST /api/tailor/campaigns/[id]/participants": own(
    P.TailorsWriteOwn,
    "Live: invite (email records + optional mailer), remind, allocate-scans on owned campaign."
  ),
  "GET /api/tailor/campaigns/credits": own(
    P.TailorsWriteOwn,
    "Live: aggregate sponsored AI credit wallet + recent campaign activity for actor TailorProfile."
  ),
  "GET /api/tailor/campaigns/[id]/participants/export": own(
    P.TailorsWriteOwn,
    "Live: CSV export of owned campaign participants and measurement snapshots."
  ),
  "GET /api/tailor/campaigns/participants/export": own(
    P.TailorsWriteOwn,
    "Live: CSV export of all campaign participants for actor TailorProfile."
  ),
  "GET /api/campaigns/join/[slug]": pub(
    "Public join landing by slug (active + approved tailor). Returns hero fields + instructions for all visitors. Authenticated verified users: + participantStatus and scan allocation (?invite= forwarded when signed in). participantId is not exposed on this route."
  ),
  "POST /api/campaigns/join/[slug]": own(
    P.MeasurementsWriteOwn,
    "Live: requirePermissionFresh(MeasurementsWriteOwn). Join (optional inviteToken) and/or submit owned measurementProfileId; notifies tailor."
  ),
  "GET /api/campaigns/my": own(
    P.MeasurementsReadOwn,
    "Live: requirePermissionFresh(MeasurementsReadOwn). List campaign participations for signed-in customer (userId + invited email)."
  ),
  "GET /api/campaigns/my/[participantId]/invitees": own(
    P.MeasurementsReadOwn,
    "Live: requirePermissionFresh(MeasurementsReadOwn). Coordinator lists their invited members, group link, and stats (actor must own coordinator row)."
  ),
  "POST /api/campaigns/my/[participantId]/invitees": own(
    P.MeasurementsWriteOwn,
    "Live: requirePermissionFresh(MeasurementsWriteOwn). Coordinator invites members (email or link-only) or sets group label."
  ),
  "GET /api/campaigns/my/[participantId]/group-link": own(
    P.MeasurementsReadOwn,
    "Live: requirePermissionFresh(MeasurementsReadOwn). Coordinator group join link after ensureCoordinatorShareToken."
  ),
  "GET /api/measurement-profiles": own(
    P.MeasurementsReadOwn,
    "Live: requirePermissionFresh(MeasurementsReadOwn). List own MeasurementProfile rows."
  ),
  "POST /api/measurement-profiles": own(
    P.MeasurementsWriteOwn,
    "Live: requirePermissionFresh(MeasurementsWriteOwn). Create MeasurementProfile."
  ),
  "GET /api/measurement-profiles/[id]": own(
    P.MeasurementsReadOwn,
    "Live: requirePermissionFresh(MeasurementsReadOwn) + owner only."
  ),
  "PUT /api/measurement-profiles/[id]": own(
    P.MeasurementsWriteOwn,
    "Live: requirePermissionFresh(MeasurementsWriteOwn) + owner only."
  ),
  "DELETE /api/measurement-profiles/[id]": own(
    P.MeasurementsWriteOwn,
    "Live: requirePermissionFresh(MeasurementsWriteOwn) + owner only."
  ),
  "PATCH /api/measurement-profiles/[id]/default": own(
    P.MeasurementsWriteOwn,
    "Live: requirePermissionFresh(MeasurementsWriteOwn) + owner only. Sets isDefault; clears others."
  ),
  "PATCH /api/measurement-profiles/[id]/category": own(
    P.MeasurementsWriteOwn,
    "Live: requirePermissionFresh(MeasurementsWriteOwn) + owner only. Merges measurements for one MEASUREMENT_CATEGORIES id into profile JSON."
  ),
  "POST /api/measurement-profiles/[id]/ai-scan": own(
    P.MeasurementsWriteOwn,
    "Live: requirePermissionFresh(MeasurementsWriteOwn) + owner only. AI scan merges pose photos into profile; optional campaignSlug consumes sponsored scan quota."
  ),
  "GET /api/tailoring-jobs": own(
    P.TailoringJobsReadOwn,
    "Live: requireAuth. ?scope=customer (default) or tailor. Staff use admin API."
  ),
  "POST /api/tailoring-jobs": own(
    P.TailoringJobsWriteOwn,
    "Live: requirePermissionFresh(TailoringJobsWriteOwn). Accepts owned measurementProfileId OR inline measurements (atomic profile+job create). Stamp orgId from approved TailorProfile; notify tailor."
  ),
  "GET /api/tailoring-jobs/[id]": own(
    P.TailoringJobsReadOwn,
    "Live: requireAuthFresh. customer owner OR assigned tailor OR staff (preset/perms, not User.role) with tailoring_jobs:read + org match."
  ),
  "PATCH /api/tailoring-jobs/[id]": own(
    P.TailoringJobsWriteOwn,
    "Live: requireAuthFresh. status machine by role. Tailor: accept/decline/quote/complete. Customer: cancel while submitted; pay via POST /api/payment/tailoring (not PATCH)."
  ),
  "POST /api/tailoring-jobs/reference-images": own(
    P.TailoringJobsWriteOwn,
    "Live: requirePermissionFresh(TailoringJobsWriteOwn). Cloudinary folder tailoring-jobs for booking wizard."
  ),
  "POST /api/tailoring-jobs/[id]/reference-images": own(
    P.TailoringJobsWriteOwn,
    "Live: requirePermissionFresh(TailoringJobsWriteOwn) + customer owner + submitted/draft. Cloudinary folder tailoring-jobs."
  ),
  "POST /api/payment/tailoring": own(
    P.PaymentsCheckoutOwn,
    "Live: requireAuth. Job owner only; status quoted|payment_pending; creates Stripe Checkout (metadata type=tailoring)."
  ),
  "GET /api/payment/tailoring/confirm": provider(
    "Live: Stripe session_id via getCheckoutSession (ACCEPTED OPEN). Idempotent settle via tailoringJobPaymentSettle."
  ),
  "POST /api/payment/tailoring/cancel": own(
    P.TailoringJobsWriteOwn,
    "Live: { jobId } + auth, or { sessionId } from Stripe cancel URL (no JWT). Reverts payment_pending → quoted."
  ),
  "GET /api/tailors/[slug]/reviews": pub(
    "Public approved tailor reviews. Pagination ?page=&limit=. No PII beyond reviewer display name."
  ),
  "POST /api/tailors/[slug]/reviews": own(
    P.TailoringJobsWriteOwn,
    "Live: requireAuth. Customer owner of completed job; one review per job; updates TailorProfile avgRating."
  ),
  "GET /api/admin/tailoring-jobs": staff(
    P.TailoringJobsRead,
    "Live: requirePermissionFresh(tailoring_jobs:read). Org-scoped list."
  ),
  "GET /api/admin/tailoring-jobs/[id]": staff(
    P.TailoringJobsRead,
    "Live: requirePermissionFresh(tailoring_jobs:read). Org-scoped detail."
  ),
  "PATCH /api/admin/tailoring-jobs/[id]": staff(
    P.TailoringJobsManage,
    "Live: requirePermissionFresh(tailoring_jobs:manage). Ops transitions incl. quoted→in_progress."
  ),

  // Online Booking / Ticketing (catalog + B2B accounts — live)
  "GET /api/admin/ticketing/products": staff(
    P.TicketingRead,
    "requirePermissionFresh(ticketing:read) + actor.orgId. List ticketing products (?categoryId= optional BookingCategory filter). Rejects ?orgId=."
  ),
  "POST /api/admin/ticketing/products": staff(
    P.TicketingWrite,
    "requirePermissionFresh(ticketing:write) + actor.orgId. Create product; optional categoryId must belong to actor org BookingCategory. Ignores body.orgId."
  ),
  "GET /api/admin/ticketing/products/[id]": staff(
    P.TicketingRead,
    "requirePermissionFresh(ticketing:read) + actor.orgId. Product detail (includes categoryId/category)."
  ),
  "PATCH /api/admin/ticketing/products/[id]": staff(
    P.TicketingWrite,
    "requirePermissionFresh(ticketing:write) + actor.orgId. Update product incl. optional categoryId (same-org BookingCategory) or clear. Ignores body.orgId."
  ),
  "DELETE /api/admin/ticketing/products/[id]": staff(
    P.TicketingWrite,
    "requirePermissionFresh(ticketing:write) + actor.orgId. Soft-archive product (clears categoryId)."
  ),
  "GET /api/admin/ticketing/categories": staff(
    P.TicketingProductsRead,
    "requirePermissionFresh(ticketing_products:read) + actor.orgId. ticketing:read implies this. Demo-locked. List BookingCategory folders plus publicPage url and embed snippet. Not shop ProductCategory."
  ),
  "POST /api/admin/ticketing/categories": staff(
    P.TicketingProductsWrite,
    "requirePermissionFresh(ticketing_products:write) + actor.orgId. ticketing:write implies this. Create BookingCategory and its PublicCategoryPage (slug once; skipped when isDefault). Demo-locked. Ignores body.orgId."
  ),
  "GET /api/admin/ticketing/categories/[id]": staff(
    P.TicketingProductsRead,
    "requirePermissionFresh(ticketing_products:read) + actor.orgId. ticketing:read implies this. Demo-locked. BookingCategory detail plus publicPage. Cross-tenant → 403."
  ),
  "PATCH /api/admin/ticketing/categories/[id]": staff(
    P.TicketingProductsWrite,
    "requirePermissionFresh(ticketing_products:write) + actor.orgId. ticketing:write implies this. Update BookingCategory. Rename does not change slug. slug, layout, and embedEnabled save the public page. Demo-locked. Ignores body.orgId."
  ),
  "DELETE /api/admin/ticketing/categories/[id]": staff(
    P.TicketingProductsWrite,
    "requirePermissionFresh(ticketing_products:write) + actor.orgId. ticketing:write implies this. Soft-archive BookingCategory, set PublicCategoryPage inactive in the same transaction, and unlink admission products."
  ),
  "GET /api/admin/ticketing/products/[id]/prices": staff(
    P.TicketingRead,
    "requirePermissionFresh(ticketing:read) + actor.orgId. List price bands."
  ),
  "POST /api/admin/ticketing/products/[id]/prices": staff(
    P.TicketingWrite,
    "requirePermissionFresh(ticketing:write) + actor.orgId. Create/replace price bands."
  ),
  "GET /api/admin/ticketing/products/[id]/addons": staff(
    P.TicketingRead,
    "requirePermissionFresh(ticketing:read) + actor.orgId. List linked add-ons."
  ),
  "POST /api/admin/ticketing/products/[id]/addons": staff(
    P.TicketingWrite,
    "requirePermissionFresh(ticketing:write) + actor.orgId. Attach add-ons."
  ),
  "DELETE /api/admin/ticketing/products/[id]/addons": staff(
    P.TicketingWrite,
    "requirePermissionFresh(ticketing:write) + actor.orgId. Unlink add-ons."
  ),
  "PATCH /api/admin/ticketing/products/[id]/expiry": staff(
    P.TicketingWrite,
    "requirePermissionFresh(ticketing:write) + actor.orgId. Update default pass expiry."
  ),
  "GET /api/admin/ticketing/sessions": staff(
    P.TicketingRead,
    "requirePermissionFresh(ticketing:read) + actor.orgId. List sessions/slots."
  ),
  "POST /api/admin/ticketing/sessions": staff(
    P.TicketingWrite,
    "requirePermissionFresh(ticketing:write) + actor.orgId. Create session series. Ignores body.orgId."
  ),
  "PATCH /api/admin/ticketing/sessions/[id]": staff(
    P.TicketingWrite,
    "requirePermissionFresh(ticketing:write) + actor.orgId. Update/close session."
  ),
  "DELETE /api/admin/ticketing/sessions/[id]": staff(
    P.TicketingWrite,
    "requirePermissionFresh(ticketing:write) + actor.orgId. Soft-delete/close session."
  ),
  "GET /api/admin/ticketing/resources": staff(
    P.TicketingRead,
    "requirePermissionFresh(ticketing:read) + actor.orgId. List capacity resources."
  ),
  "POST /api/admin/ticketing/resources": staff(
    P.TicketingWrite,
    "requirePermissionFresh(ticketing:write) + actor.orgId. Create resource. Ignores body.orgId."
  ),
  "PATCH /api/admin/ticketing/resources/[id]": staff(
    P.TicketingWrite,
    "requirePermissionFresh(ticketing:write) + actor.orgId. Update/archive resource."
  ),
  "GET /api/admin/ticketing/stock-periods": staff(
    P.TicketingRead,
    "requirePermissionFresh(ticketing:read) + actor.orgId. List add-on stock periods."
  ),
  "POST /api/admin/ticketing/stock-periods": staff(
    P.TicketingWrite,
    "requirePermissionFresh(ticketing:write) + actor.orgId. Create stock period. Ignores body.orgId."
  ),
  "PATCH /api/admin/ticketing/stock-periods/[id]": staff(
    P.TicketingWrite,
    "requirePermissionFresh(ticketing:write) + actor.orgId. Update stock period."
  ),
  "DELETE /api/admin/ticketing/stock-periods/[id]": staff(
    P.TicketingWrite,
    "requirePermissionFresh(ticketing:write) + actor.orgId. Delete stock period."
  ),
  "GET /api/admin/ticketing/settings": staff(
    P.TicketingRead,
    "requirePermissionFresh(ticketing:read) + actor.orgId. Read org ticketing defaults (settings read)."
  ),
  "PATCH /api/admin/ticketing/settings": staff(
    P.TicketingManage,
    "requirePermissionFresh(ticketing:manage) + actor.orgId. Update hold/reserve TTLs, pay-later, cancel cutoff."
  ),
  "GET /api/admin/ticketing/availability": staff(
    P.TicketingRead,
    "requirePermissionFresh(ticketing:read) + actor.orgId. Staff preview of remaining capacity (not public mutate)."
  ),
  // Digital Waivers (Feature 05) — Growth/Enterprise via assertWaiversEnabled
  "GET /api/admin/waivers/settings": staff(
    P.WaiversAdmin,
    "Live: requirePermissionFresh(waivers:admin) + assertWaiversEnabled. Org or venue WaiverSettings. Never query orgId."
  ),
  "PUT /api/admin/waivers/settings": staff(
    P.WaiversAdmin,
    "Live: requirePermissionFresh(waivers:admin) + assertWaiversEnabled. Upsert settings. Never body.orgId."
  ),
  "GET /api/admin/waivers/templates": staff(
    P.WaiversRead,
    "Live: requirePermissionFresh(waivers:read) + assertWaiversEnabled. List templates. Park scope filters locationId. Org-default rows stay visible."
  ),
  "POST /api/admin/waivers/templates": staff(
    P.WaiversWrite,
    "Live: requirePermissionFresh(waivers:write) + assertWaiversEnabled. Create draft template + version. Never body.orgId."
  ),
  "GET /api/admin/waivers/templates/[id]": staff(
    P.WaiversRead,
    "Live: requirePermissionFresh(waivers:read) + assertWaiversEnabled. Template + version history. Cross-tenant 403."
  ),
  "PATCH /api/admin/waivers/templates/[id]": staff(
    P.WaiversWrite,
    "Live: requirePermissionFresh(waivers:write) + assertWaiversEnabled. Edit draft only. Published version body is immutable."
  ),
  "GET /api/admin/waivers/templates/[id]/versions": staff(
    P.WaiversRead,
    "Live: requirePermissionFresh(waivers:read) + assertWaiversEnabled. Version history including contentSha256."
  ),
  "POST /api/admin/waivers/templates/[id]/versions": staff(
    P.WaiversWrite,
    "Live: requirePermissionFresh(waivers:write) + assertWaiversEnabled. Create the next draft version."
  ),
  "POST /api/admin/waivers/templates/[id]/publish": staff(
    P.WaiversAdmin,
    "Live: requirePermissionFresh(waivers:admin) + assertWaiversEnabled. Publish draft; sets contentSha256. Does not rewrite prior signatures."
  ),
  "GET /api/admin/waivers/templates/blueprint": staff(
    P.WaiversWrite,
    "Live: requirePermissionFresh(waivers:write) + assertWaiversEnabled. Closed. Form questions are built in the wizard, not from a spreadsheet. Never query orgId."
  ),
  "POST /api/admin/waivers/templates/[id]/blueprint": staff(
    P.WaiversWrite,
    "Live: requirePermissionFresh(waivers:write) + assertWaiversEnabled. Closed. A spreadsheet cannot replace draft form fields. Never body.orgId."
  ),
  "GET /api/admin/waivers/requirements": staff(
    P.WaiversRead,
    "Live: requirePermissionFresh(waivers:read) + assertWaiversEnabled. List WaiverRequirement rows."
  ),
  "POST /api/admin/waivers/requirements": staff(
    P.WaiversWrite,
    "Live: requirePermissionFresh(waivers:write) + assertWaiversEnabled. Attach template to a target. Venue must belong to actor org."
  ),
  "DELETE /api/admin/waivers/requirements/[id]": staff(
    P.WaiversWrite,
    "Live: requirePermissionFresh(waivers:write) + assertWaiversEnabled. Delete requirement. Cross-tenant 403."
  ),
  "GET /api/admin/waivers/kiosk-devices": staff(
    P.WaiversAdmin,
    "Live: requirePermissionFresh(waivers:admin) + assertWaiversEnabled. List devices. Token hash is never returned."
  ),
  "POST /api/admin/waivers/kiosk-devices": staff(
    P.WaiversAdmin,
    "Live: requirePermissionFresh(waivers:admin) + assertWaiversEnabled. Create device. Raw token returned once. Archived venue rejected."
  ),
  "PATCH /api/admin/waivers/kiosk-devices/[id]": staff(
    P.WaiversAdmin,
    "Live: requirePermissionFresh(waivers:admin) + assertWaiversEnabled. Update or archive device. Does not return the token."
  ),
  "POST /api/admin/waivers/kiosk-devices/[id]/rotate": staff(
    P.WaiversAdmin,
    "Live: requirePermissionFresh(waivers:admin) + assertWaiversEnabled. Replaces the device token. The previous token stops working. Raw token returned once."
  ),
  "GET /api/admin/waivers/records": staff(
    P.WaiversRead,
    "Live: requirePermissionFresh(waivers:read) + assertWaiversEnabled. Signed waiver list."
  ),
  "POST /api/admin/waivers/records": staff(
    P.WaiversWrite,
    "Live: requirePermissionFresh(waivers:write) + assertWaiversEnabled. On-site signing link. Staff id is audit metadata, not the signer."
  ),
  "GET /api/admin/waivers/records/[id]": staff(
    P.WaiversRead,
    "Live: requirePermissionFresh(waivers:read) + assertWaiversEnabled. Record detail includes the signature image for staff. Export CSV does not."
  ),
  "POST /api/admin/waivers/requests": staff(
    P.WaiversWrite,
    "Live: requirePermissionFresh(waivers:write) + assertWaiversEnabled. Email or SMS a hashed signing token. SMS without a provider is 400."
  ),
  "GET /api/admin/waivers/guests/search": staff(
    P.WaiversRead,
    "Live: requirePermissionFresh(waivers:read) + assertWaiversEnabled. Search GuestProfile in the actor org. No shop User create."
  ),
  "GET /api/admin/waivers/guests/[id]": staff(
    P.WaiversRead,
    "Live: requirePermissionFresh(waivers:read) + assertWaiversEnabled. Read-only waiver history for one GuestProfile in the actor org and park scope."
  ),
  "GET /api/admin/waivers/templates/[id]/qr": staff(
    P.WaiversWrite,
    "Live: requirePermissionFresh(waivers:write) + assertWaiversEnabled. Standing sign URL, SVG, venue name, and logo for one venue and template."
  ),
  "GET /api/admin/waivers/evaluate": staff(
    P.WaiversVerify,
    "Live: requirePermissionFresh(waivers:verify). Guest search or evaluateGuestWaivers. Optional admissionProductId and membershipPlanId apply the product or plan waiver flag. Not the check-in scanner."
  ),
  "POST /api/admin/waivers/records/[id]/void": staff(
    P.WaiversVoid,
    "Live: requirePermissionFresh(waivers:void). Reason required. Sets status voided. Does not delete the signature."
  ),
  "POST /api/admin/waivers/records/[id]/resend": staff(
    P.WaiversWrite,
    "Live: requirePermissionFresh(waivers:write). Cancels outstanding links and issues a new token."
  ),
  "POST /api/admin/waivers/records/bulk": staff(
    P.WaiversWrite,
    "Live: requirePermissionFresh(waivers:write). Resend up to 50 records or cancel one outstanding link."
  ),
  "POST /api/admin/waivers/import": staff(
    P.WaiversAdmin,
    "Live: requirePermissionFresh(waivers:admin). CSV preview then commit. Does not overwrite a newer live signature."
  ),
  "GET /api/admin/waivers/export": staff(
    P.WaiversExport,
    "Live: requirePermissionFresh(waivers:export). CSV of records or form responses. No signature SVG. Rate limited."
  ),
  "GET /api/admin/waivers/responses": staff(
    P.WaiversRead,
    "Live: requirePermissionFresh(waivers:read). Form response list for the actor org and park scope."
  ),
  "GET /api/admin/waivers/party-chase": staff(
    P.WaiversRead,
    "Live: requirePermissionFresh(waivers:read). Lists party guests missing a current waiver for one booking. Not the party command center."
  ),
  "POST /api/admin/waivers/party-chase": staff(
    P.WaiversWrite,
    "Live: requirePermissionFresh(waivers:write). Emails or texts the booking contact a signing link for guests still missing a current waiver."
  ),
  "GET /api/admin/waivers/targets": staff(
    P.WaiversRead,
    "Live: requirePermissionFresh(waivers:read). Admission products and membership plans for requirement pickers. POS stays manual."
  ),
  "GET /api/admin/waivers/compliance-guides": staff(
    P.WaiversRead,
    "Live: requirePermissionFresh(waivers:read) + assertWaiversEnabled. Static operator checklists. Not legal advice."
  ),
  // Guest Marketing Automation (Growth+)
  "GET /api/admin/marketing/overview": staff(
    P.MarketingRead,
    "Live: requirePermissionFresh(marketing:read) + assertMarketingEnabled. KPIs, bridges to memberships dunning and waiver reminders. Never query orgId."
  ),
  "GET /api/admin/marketing/settings": staff(
    P.MarketingRead,
    "Live: requirePermissionFresh(marketing:read) + assertMarketingEnabled. Org or venue MarketingAutomationSettings. Optional locationId query when venue belongs to actor org."
  ),
  "PATCH /api/admin/marketing/settings": staff(
    P.MarketingWrite,
    "Live: requirePermissionFresh(marketing:write) + assertMarketingEnabled. Patch automation toggles, delays, CTAs, from/reply. Never body.orgId."
  ),
  "GET /api/admin/marketing/automations": staff(
    P.MarketingRead,
    "Live: requirePermissionFresh(marketing:read) + assertMarketingEnabled. Automation toggle subset of settings for the automations desk."
  ),
  "PATCH /api/admin/marketing/automations": staff(
    P.MarketingWrite,
    "Live: requirePermissionFresh(marketing:write) + assertMarketingEnabled. Patch welcome/birthday/reengagement/post-visit toggles and delays only."
  ),
  "POST /api/admin/marketing/automations/test-send": staff(
    P.MarketingSend,
    "Live: requirePermissionFresh(marketing:send) + assertMarketingEnabled. Sends one test template to the signed-in staff User email only."
  ),
  "GET /api/admin/marketing/leads": staff(
    P.MarketingRead,
    "Live: requirePermissionFresh(marketing:read) + assertMarketingEnabled. Newsletter / opted-in lead list (no workspace export dump)."
  ),
  "PATCH /api/admin/marketing/leads/[guestProfileId]/consent": staff(
    P.MarketingWrite,
    "Live: requirePermissionFresh(marketing:write) + assertMarketingEnabled. Set marketing email opt-in for a GuestProfile in actor org."
  ),
  "GET /api/admin/marketing/sends": staff(
    P.MarketingRead,
    "Live: requirePermissionFresh(marketing:read) + assertMarketingEnabled. Recent MarketingSendLog rows for actor org."
  ),
  "GET /api/admin/marketing/surveys": staff(
    P.MarketingSurveys,
    "Live: requirePermissionFresh(marketing:surveys) + assertMarketingEnabled. List GuestSurvey rows."
  ),
  "POST /api/admin/marketing/surveys": staff(
    P.MarketingSurveys,
    "Live: requirePermissionFresh(marketing:surveys) + assertMarketingEnabled. Create draft survey. Never body.orgId."
  ),
  "GET /api/admin/marketing/surveys/[id]": staff(
    P.MarketingSurveys,
    "Live: requirePermissionFresh(marketing:surveys) + assertMarketingEnabled. Survey detail. Cross-tenant id → 403."
  ),
  "PATCH /api/admin/marketing/surveys/[id]": staff(
    P.MarketingSurveys,
    "Live: requirePermissionFresh(marketing:surveys) + assertMarketingEnabled. Update draft or publish. Cross-tenant id → 403."
  ),
  "GET /api/admin/marketing/surveys/[id]/responses": staff(
    P.MarketingSurveys,
    "Live: requirePermissionFresh(marketing:surveys) + assertMarketingEnabled. List GuestSurveyResponse for survey."
  ),
  "POST /api/admin/marketing/surveys/[id]/export": staff(
    P.MarketingExport,
    "Live: requirePermissionFresh(marketing:export) + assertMarketingEnabled. CSV text of survey responses."
  ),
  "GET /api/admin/marketing/bridges/memberships": staff(
    P.MarketingRead,
    "Live: requirePermissionFresh(marketing:read) + assertMarketingEnabled. Read-only MembershipSettings dunning + past_due count (SSOT memberships engine)."
  ),
  "GET /api/admin/marketing/bridges/waivers": staff(
    P.MarketingRead,
    "Live: requirePermissionFresh(marketing:read) + assertMarketingEnabled. Read-only waiver remind settings + recent remind volume."
  ),
  "POST /api/public/marketing/newsletter": pub(
    "Public orgSlug newsletter signup. Rate limited. Resolves company by slug; assertMarketingEnabled; upserts GuestProfile + opt-in. Not storefront DEFAULT_ORG."
  ),
  "GET /api/public/marketing/surveys/[token]": pub(
    "Public survey invite by token. Returns published survey questions when invite valid and not expired."
  ),
  "POST /api/public/marketing/surveys/[token]/submit": pub(
    "Public survey submit by invite token. Rate limited. Stores GuestSurveyResponse; optional thank-you promo email when opted in."
  ),
  "GET /api/public/marketing/unsubscribe": pub(
    "Tokenized unsubscribe. Browsers (Accept text/html) get a confirm page that POSTs — link scanners never unsubscribe. JSON clients unsubscribe directly. No tenant JWT."
  ),
  "POST /api/public/marketing/unsubscribe": pub(
    "Tokenized unsubscribe (query token or body). Sets marketingEmailOptIn false for GuestProfile. No tenant JWT."
  ),
  "GET /api/cron/marketing-automations": provider(
    "Live: Bearer CRON_SECRET. Runs welcome, birthday, reengagement, and post-visit survey automations for Growth+ active orgs."
  ),
  "POST /api/cron/marketing-automations": provider(
    "Same as GET /api/cron/marketing-automations."
  ),
  "GET /api/admin/marketing/campaigns": staff(
    P.MarketingRead,
    "Live: requirePermissionFresh(marketing:read) + assertMarketingEnabled. Newsletter campaigns for actor org; park-locked seats see assigned parks only."
  ),
  "POST /api/admin/marketing/campaigns": staff(
    P.MarketingWrite,
    "Live: requirePermissionFresh(marketing:write) + assertMarketingEnabled. Create draft newsletter campaign. Never body.orgId; locationId must belong to actor org / park assignment."
  ),
  "GET /api/admin/marketing/campaigns/[id]": staff(
    P.MarketingRead,
    "Live: requirePermissionFresh(marketing:read) + assertMarketingEnabled. Campaign detail + current audience count. Cross-tenant id → not found."
  ),
  "PATCH /api/admin/marketing/campaigns/[id]": staff(
    P.MarketingWrite,
    "Live: requirePermissionFresh(marketing:write) + assertMarketingEnabled. Edit content / audience / schedule (not while sending; sent is read-only)."
  ),
  "DELETE /api/admin/marketing/campaigns/[id]": staff(
    P.MarketingWrite,
    "Live: requirePermissionFresh(marketing:write) + assertMarketingEnabled. Soft-archive campaign (recipient history kept)."
  ),
  "POST /api/admin/marketing/campaigns/[id]/actions": staff(
    P.MarketingSend,
    "Live: requirePermissionFresh(marketing:send) + assertMarketingEnabled. schedule | pause | resume | send_now | duplicate."
  ),
  "POST /api/admin/marketing/campaigns/[id]/test-send": staff(
    P.MarketingSend,
    "Live: requirePermissionFresh(marketing:send) + assertMarketingEnabled. Sends the saved campaign to the signed-in staff User email only."
  ),
  "POST /api/admin/marketing/campaigns/images": staff(
    P.MarketingWrite,
    "Live: requirePermissionFresh(marketing:write) + assertMarketingEnabled. Newsletter image upload (PNG/JPG/GIF/WebP ≤ 5 MB) to Cloudinary marketing/{actor.orgId}. Rate-limited."
  ),
  "POST /api/admin/marketing/campaigns/preview": staff(
    P.MarketingRead,
    "Live: requirePermissionFresh(marketing:read) + assertMarketingEnabled. Renders unsaved composer state to branded HTML + audience count. No send."
  ),
  "GET /api/cron/marketing-campaigns": provider(
    "Live: Bearer CRON_SECRET. Delivers due newsletter campaigns (one-off + monthly) in resumable batches for Growth+ active orgs. Run every 15 minutes."
  ),
  "POST /api/cron/marketing-campaigns": provider(
    "Same as GET /api/cron/marketing-campaigns."
  ),
  // Guest park Memberships (Feature 08) — not staff Membership seats
  "GET /api/admin/memberships/plans": {
    permissions: MEMBERSHIPS_DESK_READ_PERMS,
    isolation: "staff_global",
    notes:
      "Live: requireAnyPermissionFresh(MEMBERSHIPS_DESK_READ_PERMS) + assertMembershipsEnabled. List MembershipPlan catalog. Actor.orgId only.",
  },
  "POST /api/admin/memberships/plans": staff(
    P.MembershipsWrite,
    "Live: requirePermissionFresh(memberships:write) + assertMembershipsEnabled. Create plan. Never body.orgId. No Stripe."
  ),
  "GET /api/admin/memberships/plans/[id]": {
    permissions: MEMBERSHIPS_DESK_READ_PERMS,
    isolation: "staff_global",
    notes:
      "Live: requireAnyPermissionFresh(MEMBERSHIPS_DESK_READ_PERMS) + assertMembershipsEnabled. Plan detail. Cross-tenant → 403.",
  },
  "PATCH /api/admin/memberships/plans/[id]": staff(
    P.MembershipsWrite,
    "Live: requirePermissionFresh(memberships:write) + assertMembershipsEnabled. Update plan. Never body.orgId."
  ),
  "DELETE /api/admin/memberships/plans/[id]": staff(
    P.MembershipsWrite,
    "Live: requirePermissionFresh(memberships:write) + assertMembershipsEnabled. Soft-archive plan (no hard-delete). Cross-tenant id → 403."
  ),
  "GET /api/admin/memberships/categories": {
    permissions: MEMBERSHIPS_DESK_READ_PERMS,
    isolation: "staff_global",
    notes:
      "Live: requireAnyPermissionFresh(MEMBERSHIPS_DESK_READ_PERMS) + assertMembershipsEnabled. List MembershipCategory folders plus publicPage url and embed snippet (not shop ProductCategory).",
  },
  "POST /api/admin/memberships/categories": staff(
    P.MembershipsWrite,
    "Live: requirePermissionFresh(memberships:write) + assertMembershipsEnabled. Create membership category and its PublicCategoryPage (slug once; skipped when isDefault). Demo-locked. Never body.orgId."
  ),
  "GET /api/admin/memberships/categories/[id]": {
    permissions: MEMBERSHIPS_DESK_READ_PERMS,
    isolation: "staff_global",
    notes:
      "Live: requireAnyPermissionFresh(MEMBERSHIPS_DESK_READ_PERMS) + assertMembershipsEnabled. Category detail plus publicPage. Cross-tenant → 403.",
  },
  "PATCH /api/admin/memberships/categories/[id]": staff(
    P.MembershipsWrite,
    "Live: requirePermissionFresh(memberships:write) + assertMembershipsEnabled. Update membership category. Rename does not change slug. slug, layout, and embedEnabled save the public page. Demo-locked. Never body.orgId."
  ),
  "DELETE /api/admin/memberships/categories/[id]": staff(
    P.MembershipsWrite,
    "Live: requirePermissionFresh(memberships:write) + assertMembershipsEnabled. Soft-archive category, set PublicCategoryPage inactive in the same transaction, and unlink plans.categoryId."
  ),
  "GET /api/admin/memberships/settings": staff(
    P.MembershipsRead,
    "Live: requirePermissionFresh(memberships:read) + assertMembershipsEnabled. Org/venue MembershipSettings."
  ),
  "PUT /api/admin/memberships/settings": staff(
    P.MembershipsWrite,
    "Live: requirePermissionFresh(memberships:write) + assertMembershipsEnabled. Upsert settings. Never body.orgId."
  ),
  "GET /api/admin/memberships/eligibility": staff(
    P.MembershipsRead,
    "Live: requirePermissionFresh(memberships:read) + assertMembershipsEnabled. Plan × venue eligibility matrix."
  ),
  "PUT /api/admin/memberships/eligibility": staff(
    P.MembershipsWrite,
    "Live: requirePermissionFresh(memberships:write) + assertMembershipsEnabled. Replace eligibility rows for a plan."
  ),
  "GET /api/admin/memberships/guests": {
    permissions: MEMBERSHIPS_DESK_READ_PERMS,
    isolation: "staff_global",
    notes:
      "Live: requireAnyPermissionFresh(MEMBERSHIPS_DESK_READ_PERMS) + assertMembershipsEnabled. Search GuestProfile CRM hub.",
  },
  "POST /api/admin/memberships/guests": staff(
    P.MembershipsWrite,
    "Live: requirePermissionFresh(memberships:write) + assertMembershipsEnabled. Create GuestProfile. Never reopen /signup."
  ),
  "GET /api/admin/memberships/members": {
    permissions: MEMBERSHIPS_DESK_READ_PERMS,
    isolation: "staff_global",
    notes:
      "Live: requireAnyPermissionFresh(MEMBERSHIPS_DESK_READ_PERMS) + assertMembershipsEnabled. List GuestMembership.",
  },
  "POST /api/admin/memberships/members": {
    permissions: [P.MembershipsSell, P.MembershipsBilling, P.MembershipsAdmin],
    isolation: "staff_global",
    notes:
      "Live: requireAnyPermissionFresh(memberships:sell|billing|admin) + rate limit. Sell via billingEngine. Never body.orgId. Demo 403.",
  },
  "GET /api/admin/memberships/members/[id]": {
    permissions: MEMBERSHIPS_DESK_READ_PERMS,
    isolation: "staff_global",
    notes:
      "Live: requireAnyPermissionFresh(MEMBERSHIPS_DESK_READ_PERMS) + assertMembershipsEnabled. Member detail with plan, attempts, family, credits.",
  },
  "POST /api/admin/memberships/members/[id]": {
    permissions: [
      P.MembershipsSell,
      P.MembershipsBilling,
      P.MembershipsCancel,
      P.MembershipsAdmin,
    ],
    isolation: "staff_global",
    notes:
      "Live: requireAnyPermissionFresh by action (sell/billing/cancel/admin). renew|upgrade|downgrade|pause|resume|cancel|reactivate|payment-method|credit via billingEngine. Never body.orgId. Money actions require client idempotencyKey.",
  },
  "PATCH /api/admin/memberships/members/[id]/media": {
    permissions: [P.MembershipsWrite, P.MembershipsSell, P.MembershipsAdmin],
    isolation: "staff_global",
    notes:
      "Live: memberships:write|sell|admin + Mutable for photo/custom ID; family links Mutable. assertSafeHttpsPhotoUrl. Actor.orgId only.",
  },
  "GET /api/admin/memberships/members/[id]/card": {
    permissions: MEMBERSHIPS_DESK_READ_PERMS,
    isolation: "staff_global",
    notes:
      "Live: membership card print payload (name, custom id, QR, org brand).",
  },
  "GET /api/admin/memberships/members/[id]/wallet": {
    permissions: MEMBERSHIPS_DESK_READ_PERMS,
    isolation: "staff_global",
    notes:
      "Live: assertMembershipsEnabled + Visible; wallet pass or honest not_configured + digitalCard QR.",
  },
  "POST /api/admin/memberships/verify": {
    permissions: [...MEMBERSHIPS_DESK_READ_PERMS, P.MembershipsRedeem],
    isolation: "staff_global",
    notes:
      "Live: MEMBERSHIPS_DESK_READ_PERMS|redeem + assertMembershipsEnabled + venue scope + Visible. verifyBenefits via entitlementEngine. Redeem/undo stay redeem|admin.",
  },
  "POST /api/admin/memberships/redeem": {
    permissions: [P.MembershipsRedeem, P.MembershipsAdmin],
    isolation: "staff_global",
    notes:
      "Live: memberships:redeem|admin + assertMembershipsEnabled + venue scope + Visible. redeemVisit / undoConsumeBenefit ledger.",
  },
  "GET /api/admin/memberships/guests/[id]": {
    permissions: MEMBERSHIPS_DESK_READ_PERMS,
    isolation: "staff_global",
    notes:
      "Live: MEMBERSHIPS_DESK_READ_PERMS. GuestProfile + memberships (status, home venue, remaining, dunningFailCount). Park scope enforced.",
  },
  "POST /api/admin/memberships/guests/[id]/invite": {
    permissions: [
      P.MembershipsSell,
      P.MembershipsBilling,
      P.MembershipsWrite,
      P.MembershipsAdmin,
    ],
    isolation: "staff_global",
    notes:
      "Live: invite guest to membership dashboard — link existing customer by email or invite-only client User create (no staff seat / no /signup). Soft-linked on sell.",
  },
  "POST /api/admin/memberships/members/[id]/agreement": {
    permissions: [P.MembershipsSell, P.MembershipsBilling, P.MembershipsAdmin],
    isolation: "staff_global",
    notes:
      "Live: memberships:sell|billing|admin. Staff records in-person agreement acceptance; pending → active. Not Digital Waivers.",
  },
  "GET /api/admin/memberships/reports": {
    permissions: MEMBERSHIPS_DESK_READ_PERMS,
    isolation: "staff_global",
    notes:
      "Live: MEMBERSHIPS_DESK_READ_PERMS. DB aggregates (sold, active, churn, past_due, failed payments). hqRollup=1 requires Enterprise HQ.",
  },
  "GET /api/admin/memberships/cancel-alternatives": {
    permissions: MEMBERSHIPS_DESK_READ_PERMS,
    isolation: "staff_global",
    notes:
      "Live: MEMBERSHIPS_DESK_READ_PERMS. List cancel alternatives (beta).",
  },
  "POST /api/admin/memberships/cancel-alternatives": {
    permissions: [P.MembershipsWrite, P.MembershipsAdmin],
    isolation: "staff_global",
    notes:
      "Live: memberships:write|admin. Upsert cancel alternative (beta). Never body.orgId.",
  },
  "GET /api/admin/memberships/dunning-queue": {
    permissions: [
      P.MembershipsBilling,
      P.MembershipsRead,
      P.MembershipsAdmin,
    ],
    isolation: "staff_global",
    notes:
      "Live: memberships:billing|read|admin. past_due work queue; advanced schedule on Enterprise.",
  },
  "POST /api/pos/memberships": {
    permissions: [
      ...MEMBERSHIPS_DESK_READ_PERMS,
      P.MembershipsRedeem,
      P.MembershipsSell,
    ],
    isolation: "staff_global",
    notes:
      "Live: module gate; verify/discount need desk read + Visible; redeem/undo need redeem|admin + Visible; sell/upgrade-product need sell|billing|admin; renew/upgrade/downgrade need billing|sell|admin + Mutable (sell+home in park scope); allowGroupOverride requires memberships:admin.",
  },
  "POST /api/memberships/verify": {
    permissions: [...MEMBERSHIPS_DESK_READ_PERMS, P.MembershipsRedeem],
    isolation: "staff_global",
    notes:
      "Live: MEMBERSHIPS_DESK_READ_PERMS|redeem (not bare bookings). assertMembershipsEnabled + venue scope + Visible.",
  },
  "GET /api/cron/memberships-dunning": provider(
    "Live: Bearer CRON_SECRET. Guest memberships dunning ticks + fixed-term expiry. Also piggybacked on remind-company-subscriptions."
  ),
  "POST /api/cron/memberships-dunning": provider(
    "Same as GET /api/cron/memberships-dunning."
  ),
  "GET /api/admin/booking-accounts": staff(
    P.BookingAccountsRead,
    "requirePermissionFresh(booking_accounts:read) + actor.orgId. List B2B booking companies."
  ),
  "POST /api/admin/booking-accounts": staff(
    P.BookingAccountsWrite,
    "requirePermissionFresh(booking_accounts:write) + actor.orgId. Create booking account. Ignores body.orgId."
  ),
  "GET /api/admin/booking-accounts/[id]": staff(
    P.BookingAccountsRead,
    "requirePermissionFresh(booking_accounts:read) + actor.orgId. Account detail + contacts."
  ),
  "PATCH /api/admin/booking-accounts/[id]": staff(
    P.BookingAccountsWrite,
    "requirePermissionFresh(booking_accounts:write) + actor.orgId. Update account. Ignores body.orgId."
  ),
  "GET /api/admin/booking-accounts/[id]/contacts": staff(
    P.BookingAccountsRead,
    "requirePermissionFresh(booking_accounts:read) + actor.orgId. List account contacts."
  ),
  "POST /api/admin/booking-accounts/[id]/contacts": staff(
    P.BookingAccountsWrite,
    "requirePermissionFresh(booking_accounts:write) + actor.orgId. Create account contact."
  ),

  // Booking engine + payments (live)
  "GET /api/admin/bookings": staff(
    P.BookingsRead,
    "List bookings (actor.orgId + HQ location scope). Filters: status, locationId, q (guest/email/phone/publicId/credential/card fingerprint/PI), amountDue/amountDueOnly, productType, sessionId, accountId, channel, partyOnly, visitFrom/to, staffId. Ignores ?orgId=."
  ),
  "GET /api/admin/bookings/export": staff(
    P.BookingsExport,
    "CSV/JSON bookings export (redacted columns). Rate-limited. Audit logged. Ignores ?orgId=."
  ),
  "POST /api/admin/bookings": staff(
    P.BookingsCreate,
    "create booking via bookingEngine (Write implies Create). Ignores body.orgId. Fresh-gates: overbook, tax_exempt=true, accountId→booking_accounts:read|write. Catalog pricing only (strips line unitPrice). Confirm is a separate Write call."
  ),
  "GET /api/admin/bookings/[id]": staff(
    P.BookingsRead,
    "booking detail + activity."
  ),
  "GET /api/admin/bookings/[id]/waivers": staff(
    P.BookingsRead,
    "Live: requirePermissionFresh(bookings:read). Calls evaluateBookingWaivers for this org's booking. Does not mint a signing token. Starter returns available:false."
  ),
  "PATCH /api/admin/bookings/[id]": staff(
    P.BookingsWrite,
    "edit contacts/costs/notes; past lock BOOKING_PAST_LOCKED."
  ),
  "POST /api/admin/bookings/[id]/hold": staff(
    P.BookingsWrite,
    "hold capacity (TTL)."
  ),
  "POST /api/admin/bookings/[id]/reserve": staff(
    P.BookingsWrite,
    "reserve capacity (longer TTL)."
  ),
  "POST /api/admin/bookings/[id]/confirm": staff(
    P.BookingsWrite,
    "confirm; ticketsPerMonth; review gate."
  ),
  "POST /api/admin/bookings/[id]/cancel": staff(
    P.BookingsWrite,
    "cancel; release unused capacity; no auto-refund."
  ),
  "POST /api/admin/bookings/[id]/reactivate": staff(
    P.BookingsWrite,
    "reactivate cancelled → draft/hold/reserved."
  ),
  "POST /api/admin/bookings/[id]/payments": staff(
    P.BookingsPaymentsTake,
    "take payment tenders on BookingPayment (never shop Order)."
  ),
  "POST /api/admin/bookings/[id]/refunds": staff(
    P.BookingsRefund,
    "refund original or gift_card."
  ),
  "GET /api/admin/booking-payments": staff(
    P.BookingsPaymentsRead,
    "payment transaction history."
  ),
  "GET /api/admin/booking-invoices": staff(
    P.BookingInvoicesRead,
    "list booking invoices. Filters: bookingId, accountId."
  ),
  "POST /api/admin/booking-invoices": staff(
    P.BookingInvoicesManage,
    "create invoice INV-{slug}-{seq}."
  ),
  "POST /api/admin/bookings/[id]/review": staff(
    P.BookingsWrite,
    "mark booking reviewed before confirm."
  ),
  "POST /api/admin/bookings/[id]/assign-staff": staff(
    P.BookingsAssign,
    "assign staff membership on booking."
  ),
  "POST /api/admin/bookings/[id]/ticket-ids": staff(
    P.BookingsWrite,
    "bulk custom ticket IDs (unique per org)."
  ),
  "PATCH /api/admin/bookings/[id]/pass-expiry": staff(
    P.BookingsWrite,
    "edit issued credential pass expiry."
  ),
  "PATCH /api/admin/bookings/[id]/resources": staff(
    P.BookingsWrite,
    "atomic resource/session move."
  ),
  "POST /api/admin/bookings/[id]/overbook": staff(
    P.BookingsOverbook,
    "permissioned overbook only."
  ),
  "PATCH /api/admin/bookings/[id]/notes": staff(
    P.BookingsWrite,
    "guest-visible booking notes."
  ),
  "PATCH /api/admin/bookings/[id]/pos-notes": staff(
    P.BookingsWrite,
    "staff-only POS notes."
  ),
  "PATCH /api/admin/bookings/[id]/tax-exemption": staff(
    P.BookingsTaxExempt,
    "tax exemption recomputes totals."
  ),
  "POST /api/admin/bookings/[id]/activity": staff(
    P.BookingsWrite,
    "log call/email/note on booking."
  ),
  "GET /api/admin/bookings/[id]/tickets": staff(
    P.BookingsRead,
    "ticket credential payload."
  ),
  "POST /api/admin/bookings/[id]/payment-link": staff(
    P.BookingsPaymentsTake,
    "create guest payment link."
  ),
  "POST /api/admin/bookings/[id]/charge-stored": staff(
    P.BookingsChargeStored,
    "charge stored card (not payments:take alone)."
  ),
  "POST /api/admin/bookings/[id]/resend-confirmation": staff(
    P.BookingsWrite,
    "resend confirmation email path."
  ),
  "GET /api/admin/booking-invoices/[id]": staff(
    P.BookingInvoicesRead,
    "invoice detail."
  ),
  "PATCH /api/admin/booking-invoices/[id]": staff(
    P.BookingInvoicesManage,
    "patch unpaid invoice."
  ),
  "POST /api/admin/booking-invoices/[id]/send": staff(
    P.BookingInvoicesSend,
    "send invoice email."
  ),
  "POST /api/admin/booking-invoices/[id]/cancel": staff(
    P.BookingInvoicesManage,
    "cancel unpaid invoice."
  ),
  // Party Management (Feature 04). Every staff route: parties gate (Active +
  // billing + Demo/storefront deny + ticketing module) + HQ / park scope;
  // body/query orgId rejected; cross-tenant ids 404.
  "GET /api/admin/parties": staff(
    P.PartiesRead,
    "List parties (date in venue TZ or today, locationId, q, opsStatus, amountDueOnly, roomResourceId, hostStaffUserId, take/skip). Same data as the POS PARTY action (getTodayParties)."
  ),
  "POST /api/admin/parties": staff(
    P.PartiesWrite,
    "Create a party (Booking + PartyBookingDetail in one transaction via the booking engine). overbook needs bookings:overbook + reason."
  ),
  "GET /api/admin/parties/hosts": staff(
    P.PartiesRead,
    "Party host picker: users with an active Membership on the actor's org (name + email only)."
  ),
  "GET /api/admin/parties/contacts": staff(
    P.PartiesWrite,
    "Create-wizard contact search (q): previous booking contacts in org + location scope; hasAccount when the email matches a User (linked on create, never created)."
  ),
  "POST /api/admin/parties/quote": staff(
    P.PartiesWrite,
    "Create-wizard preview (no write): package + extras + add-ons + food, tax via TaxSettings, deposit + due dates in venue TZ, room conflict, session remaining."
  ),
  "GET /api/admin/parties/[bookingId]": staff(
    P.PartiesRead,
    "Party detail incl. guests, invitations (no tokens), food, run sheet, payments (tender/amount/status), activity newest first."
  ),
  "PATCH /api/admin/parties/[bookingId]": staff(
    P.PartiesWrite,
    "Edit counts, room, session, add-ons, contact, names, host, notes, opsStatus. Reprices and re-holds through the engine; PARTY_PAST_LOCKED after start + grace."
  ),
  "POST /api/admin/parties/[bookingId]/confirm": staff(
    P.PartiesWrite,
    "Confirm through the engine: deposit gate (PARTY_DEPOSIT_REQUIRED), ticketsPerMonth, credentials for kidCount + adultCount. depositOverrideReason only when allowConfirmWithoutDeposit."
  ),
  "POST /api/admin/parties/[bookingId]/cancel": staff(
    P.PartiesWrite,
    "Cancel with a reason. Releases room + unredeemed session capacity, voids unused credentials, cancels open invitations / food / reminders. Never refunds."
  ),
  "POST /api/admin/parties/[bookingId]/reactivate": staff(
    P.PartiesWrite,
    "Reactivate a cancelled party to held (or confirmed with the deposit gate). overbook needs bookings:overbook + reason."
  ),
  "GET /api/admin/parties/[bookingId]/guests": staff(
    P.PartiesRead,
    "Named party guests (kind, RSVP, waiver status)."
  ),
  "POST /api/admin/parties/[bookingId]/guests": staff(
    P.PartiesWrite,
    "Add a named guest. Caps: kids + honoree ≤ kidCount, adults + chaperones ≤ adultCount, one honoree, unique email."
  ),
  "PATCH /api/admin/parties/[bookingId]/guests": staff(
    P.PartiesWrite,
    "Legacy full replace of the guest list (entries without kind are stored as other)."
  ),
  "PATCH /api/admin/parties/[bookingId]/guests/[guestId]": staff(
    P.PartiesWrite,
    "Edit one named guest (same caps). Syncs a linked BookingGuest."
  ),
  "DELETE /api/admin/parties/[bookingId]/guests/[guestId]": staff(
    P.PartiesWrite,
    "Remove one named guest."
  ),
  "PATCH /api/admin/parties/[bookingId]/host": staff(
    P.PartiesWrite,
    "Assign or clear party host staff (active Membership on the same org only)."
  ),
  "GET /api/admin/parties/[bookingId]/invitations": staff(
    P.PartiesRead,
    "List party invitations (never returns tokens)."
  ),
  "POST /api/admin/parties/[bookingId]/invitations": staff(
    P.PartiesInvitations,
    "Create an invitation (crypto token, expiresAt from invitationExpiresHours). send:true delivers by email / SMS; returns the RSVP link once."
  ),
  "POST /api/admin/parties/[bookingId]/invitations/[id]/cancel": staff(
    P.PartiesInvitations,
    "Cancel a pending / sent invitation."
  ),
  "POST /api/admin/parties/[bookingId]/invitations/[id]/bounced": staff(
    P.PartiesInvitations,
    "Mark a pending / sent invitation bounced (no mail-provider bounce webhook is wired; staff mark it manually)."
  ),
  "GET /api/admin/parties/[bookingId]/food": staff(
    P.PartiesRead,
    "Party food orders + cutoff state."
  ),
  "PUT /api/admin/parties/[bookingId]/food": staff(
    P.PartiesFood,
    "Replace the draft food order lines (menu item snapshot, POS price when linked). Food totals reprice the booking as add-on lines."
  ),
  "POST /api/admin/parties/[bookingId]/food/submit": staff(
    P.PartiesFood,
    "Submit the draft to the kitchen (queued KitchenTicket). Inside foodOrderCutoffMinutes needs an override reason (logged)."
  ),
  "POST /api/admin/parties/[bookingId]/food/cancel": staff(
    P.PartiesFood,
    "Cancel the open food order (voids its kitchen ticket, reprices)."
  ),
  "POST /api/admin/parties/[bookingId]/room": staff(
    P.PartiesWrite,
    "Move the party to another room (PARTY_ROOM_CONFLICT unless bookings:overbook + reason)."
  ),
  "GET /api/admin/parties/[bookingId]/run-sheet": staff(
    P.PartiesRead,
    "Party run sheet timeline."
  ),
  "PUT /api/admin/parties/[bookingId]/run-sheet": staff(
    P.PartiesWrite,
    "Replace party run-sheet items (time, title, notes, sort)."
  ),
  "PATCH /api/admin/parties/[bookingId]/run-sheet": staff(
    P.PartiesWrite,
    "Legacy alias of PUT run-sheet."
  ),
  "GET /api/admin/parties/[bookingId]/summary": staff(
    P.PartiesRead,
    "Party summary: ?format=json (default) | csv (download) | html (printable). Payments: tender, amount, status only — no card data, Stripe secrets, or Stripe ids."
  ),
  "GET /api/admin/parties/run-sheets": staff(
    P.PartiesRead,
    "Daily party run sheets for a venue day (venue timezone)."
  ),
  "GET /api/admin/parties/balances": staff(
    P.PartiesRead,
    "Outstanding party balances (Booking.amountDue > 0, not cancelled), sorted by balanceDueAt."
  ),
  "GET /api/admin/parties/rooms/availability": staff(
    P.PartiesRead,
    "Party room availability + conflicts for a window (locationId, startsAt, endsAt, excludeBookingId)."
  ),
  "GET /api/admin/parties/settings": staff(
    P.PartiesRead,
    "Effective party settings for the org default or a venue, with per-field source (schema default / org default / venue override)."
  ),
  "PATCH /api/admin/parties/settings": staff(
    P.PartiesManage,
    "Update org-default or venue-override party settings; resetFields returns venue fields to the org default."
  ),
  "GET /api/admin/parties/packages": staff(
    P.PartiesRead,
    "List party packages (party_package AdmissionProduct + PartyPackageConfig); status published | draft | archived | all."
  ),
  "POST /api/admin/parties/packages": staffAny(
    [P.TicketingProductsWrite, P.PartiesManage],
    "Live: any of ticketing_products:write / parties:manage. Create a party package; publish validation returns PARTY_PACKAGE_INVALID with field errors."
  ),
  "GET /api/admin/parties/packages/[id]": staff(P.PartiesRead, "One party package with config, bands, add-ons."),
  "PATCH /api/admin/parties/packages/[id]": staffAny(
    [P.TicketingProductsWrite, P.PartiesManage],
    "Live: any of ticketing_products:write / parties:manage. Edit / publish a party package (same publish rules)."
  ),
  "DELETE /api/admin/parties/packages/[id]": staffAny(
    [P.TicketingProductsDelete, P.PartiesManage],
    "Live: any of ticketing_products:delete / parties:manage. Soft-archive a party package."
  ),
  "GET /api/admin/parties/packages/[id]/sessions": staff(P.PartiesRead, "Sessions for a party package."),
  "POST /api/admin/parties/packages/[id]/sessions": staffAny(
    [P.TicketingSessionsWrite, P.PartiesManage],
    "Live: any of ticketing_sessions:write / parties:manage. Create one slot or a weekday series (ticketing/sessions)."
  ),
  "GET /api/admin/parties/rooms": staff(P.PartiesRead, "List party rooms (party_room / room resources)."),
  "POST /api/admin/parties/rooms": staffAny(
    [P.TicketingResourcesWrite, P.PartiesManage],
    "Live: any of ticketing_resources:write / parties:manage. Create a party room (name unique per venue, case-insensitive)."
  ),
  "PATCH /api/admin/parties/rooms/[id]": staffAny(
    [P.TicketingResourcesWrite, P.PartiesManage],
    "Live: any of ticketing_resources:write / parties:manage. Rename, capacity, archive / unarchive a party room."
  ),
  "GET /api/admin/parties/menu": staff(
    P.PartiesRead,
    "Party menu items; ?posProducts=1&locationId= lists same-venue POS products for linking."
  ),
  "POST /api/admin/parties/menu": staff(P.PartiesManage, "Create a party menu item (PosProduct must be same org + venue)."),
  "PATCH /api/admin/parties/menu/[id]": staff(
    P.PartiesManage,
    "Edit, toggle available, archive / unarchive a party menu item."
  ),
  "GET /api/public/parties/packages": pub(
    "Published party packages for a published venue (orgSlug + venueSlug). Demo / storefront / unentitled → 404. Rate limited."
  ),
  "GET /api/public/parties/availability": pub(
    "Party sessions with remaining + room availability (productId, date, kids, adults). Rate limited."
  ),
  "POST /api/public/parties/holds": pub(
    "Hold one party slot (one hold engine). PARTY_ONLINE_DISABLED when online party booking is off. Rate limited."
  ),
  "POST /api/public/parties/checkout": pub(
    "Party checkout via publicCheckout (one checkout engine): pay deposit online or pay later (allowOnlinePayLater + allowOnlinePartyBooking). Rate limited."
  ),
  "GET /api/public/parties/confirmation/[bookingPublicId]": pub(
    "Party confirmation for the viewToken holder (no guest contacts). Rate limited."
  ),
  "GET /api/public/parties/pay/[paymentLinkToken]": pub("Payment link details + party name / deposit. Rate limited."),
  "POST /api/public/parties/pay/[paymentLinkToken]": pub("Pay a party balance / deposit via payment link. Rate limited."),
  "GET /api/public/parties/invite/[token]": pub(
    "Invitation view: party name, honoree, date/time (venue TZ), venue name, RSVP status only. Invalid → 404. Rate limited."
  ),
  "POST /api/public/parties/invite/[token]/rsvp": pub(
    "RSVP accept (name, age) or decline; idempotent; cancelled party / expired invite → 410. Rate limited."
  ),
  "GET /api/me/parties": own(P.PartiesReadOwn, "Signed-in host: own party bookings."),
  "GET /api/me/parties/[id]": own(P.PartiesReadOwn, "Own party detail (no POS / staff notes). Others → 404."),
  "PATCH /api/me/parties/[id]/guests": own(
    P.PartiesWriteOwn,
    "Replace own guest list when allowHostEditGuestList (caps enforced)."
  ),
  "PUT /api/me/parties/[id]/food": own(
    P.PartiesWriteOwn,
    "Own food draft when allowHostEditFood and before the cutoff (menu prices only)."
  ),
  "POST /api/me/parties/[id]/cancel": own(
    P.PartiesWriteOwn,
    "Cancel own party before hostCancelCutoffHours. Never refunds automatically."
  ),
  "POST /api/me/parties/[id]/invitations": own(P.PartiesWriteOwn, "Create invitations for own party within caps."),
  "POST /api/me/parties/[id]/pay": own(
    P.PartiesWriteOwn,
    "Own party pay button: payment link for the outstanding balance (existing /booking/pay flow). Others → 404."
  ),
  "GET /api/admin/pos/settings": staff(P.PosRead, "POS settings for a venue, or the org default."),
  "PUT /api/admin/pos/settings": staff(P.PosAdmin, "Save POS settings. PIN hash is never returned."),
  "GET /api/admin/pos/devices": staff(P.PosRead, "List POS devices in park scope."),
  "POST /api/admin/pos/devices": staff(P.PosAdmin, "Register a POS device. Enforces posTerminals."),
  "GET /api/admin/pos/devices/[id]": staff(P.PosRead, "One POS device. No PIN hash."),
  "PATCH /api/admin/pos/devices/[id]": staff(P.PosAdmin, "Update or archive a POS device."),
  "GET /api/admin/pos/menus": staff(P.PosAdmin, "POS menus."),
  "POST /api/admin/pos/menus": staff(P.PosAdmin, "Create a POS menu."),
  "POST /api/admin/pos/menus/[id]/categories": staff(P.PosAdmin, "Add a menu category."),
  "POST /api/admin/pos/menus/[id]/items": staff(P.PosAdmin, "Add a menu item."),
  "GET /api/admin/pos/products": staff(P.PosAdmin, "POS products."),
  "POST /api/admin/pos/products": staff(P.PosAdmin, "Create a POS product. Does not create a shop Product."),
  "PATCH /api/admin/pos/products/[id]": staff(P.PosAdmin, "Update a POS product, modifiers, or package links."),
  "POST /api/admin/pos/products/[id]/suspend": staff(P.PosAdmin, "Suspend POS product sales."),
  "GET /api/admin/pos/discount-codes": staff(P.PosAdmin, "POS discount codes."),
  "POST /api/admin/pos/discount-codes": staff(P.PosAdmin, "Create a POS discount code."),
  "POST /api/admin/pos/manager-pin": staff(P.PosSell, "Set the signed-in staff manager PIN. Hash only."),
  "GET /api/admin/pos/guests": staff(P.PosRead, "Search POS guests."),
  "POST /api/admin/pos/guests": staff(P.PosGuestsWrite, "Create a guest profile. No public user."),
  "POST /api/pos/manager-pin/verify": staff(P.PosSell, "Verify a manager PIN. Rate limited. Never logged."),
  "GET /api/pos/guests/search": staff(P.PosRead, "Search guests by name, email, or phone."),
  "POST /api/pos/guests": staff(P.PosGuestsWrite, "Create a guest profile from the till."),
  "GET /api/pos/catalog": staff(P.PosSell, "Device menu, sellable POS products, published admissions."),
  "GET /api/pos/availability": staff(P.PosSell, "Session and resource remaining."),
  "GET /api/pos/waivers/search": staff(P.PosRead, "Waiver status for a guest. Empty list when nothing matches."),
  "POST /api/pos/carts": staff(P.PosSell, "Open a POS cart."),
  "GET /api/pos/carts": staff(P.PosSell, "List parked POS carts for a venue."),
  "GET /api/pos/carts/[id]": staff(P.PosSell, "Read a POS cart."),
  "PATCH /api/pos/carts/[id]": staff(P.PosSell, "Add, update, or remove POS cart lines."),
  "POST /api/pos/carts/[id]/park": staff(P.PosSell, "Park a cart and hold admission capacity."),
  "POST /api/pos/carts/[id]/checkout": staff(
    P.PosSell,
    "Checkout a POS cart. Idempotent per org. Card tenders without Terminal return cardClientSecrets for Elements confirm."
  ),
  "GET /api/pos/sales": staff(P.PosRead, "List POS sales in park scope."),
  "GET /api/pos/sales/[id]": staff(P.PosRead, "One POS sale."),
  "POST /api/pos/sales/[id]/void": staff(P.PosVoid, "Void a POS sale."),
  "POST /api/pos/sales/[id]/refunds": staff(P.PosRefund, "Refund a POS sale."),
  "POST /api/pos/sales/[id]/payments": staff(P.PosSell, "Add a tender. Cash also needs pos:cash."),
  "POST /api/pos/sales/[id]/payment-link": staff(P.PosSell, "Email a Stripe payment link. Leaves the sale unpaid."),
  "POST /api/pos/sales/[id]/confirm-card": staff(
    P.PosSell,
    "Settle a POS card PaymentIntent after in-browser Elements confirmPayment (no Terminal)."
  ),
  "GET /api/pos/sales/[id]/card-secrets": staff(
    P.PosSell,
    "Re-fetch Stripe client_secret values for pending card tenders (checkout replay / sale resume)."
  ),
  "POST /api/pos/sales/[id]/receipt": staff(P.PosRead, "Email a POS receipt."),
  "POST /api/pos/discounts/preview": staff(P.PosDiscount, "Preview a discount code."),
  "GET /api/pos/gift-cards/balance": staff(P.PosSell, "Gift card balance by code."),
  "POST /api/pos/gift-cards/issue": staff(P.PosSell, "Issue a gift card. Raw code returned once."),
  "POST /api/pos/gift-cards/redeem": staff(P.PosSell, "Redeem a gift card. Cannot exceed the balance."),
  "GET /api/pos/cashless/balance": staff(P.PosSell, "Cashless stored-value balance."),
  "POST /api/pos/cashless/issue": staff(P.PosSell, "Issue a cashless card."),
  "POST /api/pos/cashless/top-up": staff(P.PosSell, "Top up a cashless card."),
  "GET /api/pos/wallets/balance": staff(P.PosSell, "Park wallet balance. Not the shop Wallet."),
  "POST /api/pos/wallets/issue": staff(P.PosSell, "Open a park wallet."),
  "POST /api/pos/wallets/top-up": staff(P.PosSell, "Top up a park wallet."),
  "POST /api/pos/wallets/redeem": staff(P.PosSell, "Redeem a park wallet."),
  "POST /api/pos/wastage": staff(P.PosWastage, "Record wastage."),
  "GET /api/pos/memberships/lookup": staff(P.MembershipsRead, "Lookup a guest membership. Still requires the memberships module."),
  "POST /api/pos/bookings/[id]/reschedule": staff(P.BookingsWrite, "Reschedule a POS booking through the booking engine."),
  "POST /api/pos/bookings/[id]/adjust-items": staff(P.BookingsWrite, "Replace POS booking lines through the booking engine."),
  "POST /api/pos/check-in/redeem": staff(P.PosCheckin, "Redeem a ticket credential or guest membership."),
  "POST /api/pos/credentials/custom-ids": staff(P.PosCheckin, "Assign custom ticket ids."),
  "GET /api/pos/tabs": staff(P.PosTabs, "List open guest tabs for a venue."),
  "POST /api/pos/tabs": staff(P.PosTabs, "Open a guest tab."),
  "POST /api/pos/tabs/[id]/lines": staff(P.PosTabs, "Add a tab line."),
  "POST /api/pos/tabs/[id]/split": staff(P.PosTabs, "Split a tab. Beta."),
  "POST /api/pos/tabs/[id]/preauth": staff(P.PosTabs, "Pre-authorize a tab. Beta."),
  "POST /api/pos/tabs/[id]/settle": staff(P.PosTabs, "Settle a tab through the sale engine."),
  "POST /api/pos/tills/open": staff(P.PosTillOpen, "Open a till."),
  "GET /api/pos/tills": staff(P.PosRead, "List tills. Expected cash hidden unless settings or till edit allow it."),
  "POST /api/pos/tills/[id]/movements": staff(P.PosCash, "Cash in or cash out."),
  "POST /api/pos/tills/[id]/close": staff(P.PosTillClose, "Close a till with a count."),
  "POST /api/pos/tills/[id]/close-no-count": staff(P.PosTillNoCount, "Close a till without a count."),
  "POST /api/pos/tills/[id]/edit": staff(P.PosTillEdit, "Edit a closed till."),
  "POST /api/pos/offline/sync": staff(P.PosSell, "Apply an offline cash mutation. Admissions conflict."),
  "POST /api/pos/devices/[id]/drawer-kick": staff(P.PosCash, "Request a drawer kick. No agent means kicked false."),
  "POST /api/pos/terminal/connection-token": staff(P.PosSell, "Stripe Terminal connection token."),
  "POST /api/pos/bookings": staff(
    P.BookingsCreate,
    "POS-channel create via same bookingEngine (Write implies Create). Fresh-gates: overbook, tax_exempt=true, accountId→booking_accounts:read|write. Catalog pricing only."
  ),
  "PATCH /api/pos/bookings/[id]": staff(
    P.BookingsWrite,
    "POS edit lines/contacts/costs/pos notes."
  ),
  "PATCH /api/pos/bookings/[id]/pos-notes": staff(
    P.BookingsWrite,
    "POS notes only."
  ),
  "GET /api/me/bookings": own(
    P.BookingsReadOwn,
    "guest own bookings (no POS notes)."
  ),
  "GET /api/me/bookings/[id]": own(
    P.BookingsReadOwn,
    "guest own booking detail."
  ),
  "POST /api/me/bookings/[id]/cancel": own(
    P.BookingsWriteOwn,
    "guest cancel own booking."
  ),
  "GET /api/me/bookings/[id]/tickets": own(
    P.BookingsReadOwn,
    "guest own tickets."
  ),
  "PATCH /api/me/bookings/[id]/party-guests": own(
    P.BookingsWriteOwn,
    "host edits own party guest list (no POS notes)."
  ),
  "GET /api/me/memberships": own(
    P.MembershipsReadOwn,
    "Live: guest memberships on GuestProfiles where userId === actor.sub. Never body/query orgId."
  ),
  "POST /api/me/memberships/link": own(
    P.MembershipsWriteOwn,
    "Live: link unlinked GuestProfile when email matches account email. Never creates User/GuestProfile (no /signup)."
  ),
  "GET /api/me/memberships/[id]": own(
    P.MembershipsReadOwn,
    "Live: assertOwnGuestMembership → detail + verify (lean) + cancel alternatives. Other user's id → 403."
  ),
  "POST /api/me/memberships/[id]/cancel": own(
    P.MembershipsWriteOwn,
    "Live: click-to-cancel (confirm required). Alternatives (beta) offered first unless declined. billingEngine cancel."
  ),
  "POST /api/me/memberships/[id]/renew": own(
    P.MembershipsWriteOwn,
    "Live: self-serve renew via billingEngine (stripe). Idempotency key required."
  ),
  "POST /api/me/memberships/[id]/upgrade": own(
    P.MembershipsWriteOwn,
    "Live: self-serve upgrade (same upgradeGroupKey) via billingEngine (stripe)."
  ),
  "POST /api/me/memberships/[id]/reactivate": own(
    P.MembershipsWriteOwn,
    "Live: self-serve reactivate via billingEngine (stripe)."
  ),
  "GET /api/me/memberships/[id]/card": own(
    P.MembershipsReadOwn,
    "Live: own digital card (QR payload) + wallet pass or honest not_configured."
  ),
  "GET /api/me/memberships/[id]/wallet": own(
    P.MembershipsReadOwn,
    "Live: own wallet pass JSON or honest not_configured — never staff admin wallet URL."
  ),
  "POST /api/me/memberships/[id]/update-card": own(
    P.MembershipsWriteOwn,
    "Live: Stripe SetupIntent clientSecret only. No raw PAN."
  ),
  "POST /api/me/memberships/[id]/sign-agreement": own(
    P.MembershipsWriteOwn,
    "Live: minimal agreement acceptance (not Digital Waivers). Pending → active when signed."
  ),

  "GET /api/public/booking/venues/[orgSlug]/[venueSlug]": pub(
    "published venue only (publicBookingEnabled)."
  ),
  "GET /api/public/booking/venues/[orgSlug]/[venueSlug]/products": pub(
    "published products for public venue."
  ),
  "GET /api/public/booking/availability": pub(
    "session availability for published venue products."
  ),
  "POST /api/public/booking/holds": pub(
    "rate-limited public hold."
  ),
  "POST /api/public/booking/special-request": pub(
    "rate-limited guest special request → draft booking + company email/in-app."
  ),
  "DELETE /api/public/booking/holds/[holdId]": pub(
    "release public hold."
  ),
  "POST /api/public/booking/checkout": pub(
    "guest checkout; optional session userId → account channel."
  ),
  "POST /api/public/category/[orgSlug]/[categorySlug]/checkout": pub(
    "company category booking checkout (rate-limited). Tenant from URL slugs only; active page, product in that category on a public-booking park, Demo/ticketing gated. Stripe embedded Checkout returning to /{orgSlug}/{categorySlug}/payment/success. embed=true requires the frame and Origin/Referer on the company's https embed origins (+ https website)."
  ),
  "POST /api/public/booking/pay-now": pub(
    "guest card Checkout after public checkout (viewToken)."
  ),
  "GET /api/public/booking/confirmation/[bookingPublicId]": pub(
    "guest confirmation. Requires viewToken (publicId alone is 404; no POS notes / invite tokens)."
  ),
  "GET /api/public/booking/pay/[paymentLinkToken]": pub(
    "payment link detail."
  ),
  "POST /api/public/booking/pay/[paymentLinkToken]": pub(
    "settle payment link (Demo/module gated)."
  ),
  "GET /api/public/booking/magic/[token]": pub(
    "magic token validation."
  ),
  "PATCH /api/public/booking/magic/[token]/guests": pub(
    "host party guest list via unguessable magic token (~72h)."
  ),
  "GET /api/public/booking/tickets/[ticketToken]": pub(
    "ticket by opaque token."
  ),
  "POST /api/public/booking/party/[bookingPublicId]/rsvp": pub(
    "Legacy party RSVP. Requires the invitation token (publicId alone cannot add guests); delegates to the party RSVP lib (idempotent, caps)."
  ),
  "POST /api/payment/booking": staff(
    P.BookingsPaymentsTake,
    "Live: requirePermissionFresh(bookings:payments_take). Staff card tender via takeBookingPayments / Stripe Checkout (metadata type=venue_booking). Not a public guest checkout — that is POST /api/public/booking/checkout."
  ),
  "GET /api/payment/booking/confirm": provider(
    "ACCEPTED OPEN: Stripe session_id via getCheckoutSession. Idempotent settleVenueBookingStripePayment. Never creates a shop Order."
  ),
  "POST /api/payment/booking/cancel": pub(
    "browser cancel ping after Checkout cancel_url. Stripe PI cancel on booking cancel/expire is cancelPendingStripeForBooking — this route must not settle shop orders."
  ),

  "GET /api/admin/registered-companies": staff(
    P.UsersManageRoles,
    "Live: requirePermissionFresh(users:manage_roles) + FECSYNC storefront platform_admin. List non-default companies (pending|active|suspended|offboard). Soft-hold projects as suspended + soft_hold (display-only). Payload includes venuesActive + enterpriseHqEligible (ops HQ visibility). UI: /admin/registered-companies. Public shop unaffected."
  ),
  "POST /api/admin/registered-companies": staff(
    P.UsersManageRoles,
    "Live: requirePermissionFresh(users:manage_roles) + storefront platform_admin. Ops-create company + admin user (no public /register-company or Checkout). activate=true → Approve + plan stamp in one step. UI: Company workspaces → Create company."
  ),
  "PATCH /api/admin/registered-companies": staff(
    P.UsersManageRoles,
    "Live: requirePermissionFresh(users:manage_roles) + storefront platform_admin. action=approve|suspend|clear_offboard|set_plan; subscriptionPlan on approve (optional) or set_plan (required: demo|starter|growth|enterprise). Approve alone → org active; plan stamp or Checkout → entitled creates. set_plan = emergency entitlement stamp on any registered company (status→active + plan window) — never deletes venues/catalog/orders/memberships/history. Suspend → ops_hold (self-serve renew blocked; records kept). Soft-hold listed as suspended — Reactivate via Approve or Set plan."
  ),
  "GET /api/admin/platform-accounts": staff(
    P.UsersManageRoles,
    "Live: requirePermissionFresh(users:manage_roles) + storefront platform_admin. Search any user for soft account suspend. UI: /admin/registered-companies Suspend a user panel."
  ),
  "PATCH /api/admin/platform-accounts": staff(
    P.UsersManageRoles,
    "Live: requirePermissionFresh(users:manage_roles) + storefront platform_admin. suspend | unsuspend User.accountSuspended (records kept). Cannot suspend self or the last unsuspended storefront platform_admin (Serializable). UI: /admin/registered-companies."
  ),
  "GET /api/admin/members": staff(
    P.UsersRead,
    "Live: requirePermissionFresh(users:read). List Membership for actor.orgId. Company-wide/CWV → full roster; franchiseParkManager park-locked → only seats with active assignment intersecting actor parks; else CWV=false → self only. Includes assignedLocationIds / parkLocked / franchiseParkManager. UI: /admin/users. Not a payment/checkout path."
  ),
  "POST /api/admin/members": {
    permissions: [P.UsersInvite, P.UsersManageRoles],
    isolation: "staff_global",
    notes:
      "Live: requireAnyPermissionFresh(users:invite|users:manage_roles) + assertCompanyWideStaffAdminOrFranchiseManager. Company-wide invite as before. Franchise park managers: park-lock invite only (locationIds ⊆ actor parks; CWV forced false; never platform_admin; stamp assignments; re-invite rejects CWV/platform_admin and sister-park-only seats). Normal park-locked non-managers still Forbidden. Grants ⊆ actor; stamp invitedBy. Invalidate target sessions. Plan limit members + tailorSeats. Not a payment/checkout path.",
  },
  "PATCH /api/admin/members/[id]": {
    permissions: [P.UsersManageRoles, P.UsersInvite],
    isolation: "staff_global",
    notes:
      "Live: requireAnyPermissionFresh(users:manage_roles|users:invite) + company-wide or franchiseParkManager scope. Franchise managers: roster intersection only; CWV/franchiseParkManager grants denied; invite-only → status changes only. Company-wide manage_roles may grant/revoke franchiseParkManager when park-locked (clearCachedLocationScopesForOrg on flag change). Protect last platform_admin. Invalidate target sessions + silentRefresh. UI: /admin/users Edit. Not a payment/checkout path.",
  },
  "PUT /api/admin/members/[id]/venue-assignments": staff(
    P.UsersParkAssign,
    "Live: requirePermissionFresh(users:park_assign) + assertCanManageVenueAssignments (company-wide / platform_admin / software owner, OR franchiseParkManager scoped to their parks). Body { locationIds } replace-set. Empty clears park lock + franchiseParkManager for company-wide actors; franchise managers reject empty (no silent expand-to-all). Franchise managers cannot assign sister parks or company-wide seats. Invalidate target sessions. UI: /admin/users."
  ),
  "DELETE /api/admin/members/[id]": {
    permissions: [P.UsersManageRoles, P.UsersDelete],
    isolation: "staff_global",
    notes:
      "Live: soft-revoke → requirePermissionFresh(users:manage_roles) + assertNotParkLocked. ?hard=1 → requirePermissionFresh(users:delete) + platform_admin; permanently deletes User+Profile+Wallet+Memberships and auto-blacklists email/phone. Protect last platform_admin; no self-delete. UI: /admin/users Delete / Revoke. Not a payment/checkout path.",
  },
  "GET /api/admin/user-blacklist": staff(
    P.UsersBlacklist,
    "Live: requirePermissionFresh(users:blacklist) + assertNotParkLocked. List org email/phone blacklist. UI: /admin/users → Blacklist."
  ),
  "POST /api/admin/user-blacklist": staff(
    P.UsersBlacklist,
    "Live: requirePermissionFresh(users:blacklist) + assertNotParkLocked. Add email or phone to org blacklist. Blocks signup/login/create until removed."
  ),
  "DELETE /api/admin/user-blacklist/[id]": staff(
    P.UsersBlacklist,
    "Live: requirePermissionFresh(users:blacklist) + assertNotParkLocked. Remove blacklist entry so the identity can register again."
  ),
  "GET /api/admin/role-templates": staff(
    P.UsersRead,
    "Live: requirePermissionFresh(users:read). List org RoleTemplate rows for actor.orgId (Step 8). UI: /admin/users Role templates tab."
  ),
  "POST /api/admin/role-templates": staff(
    P.UsersManageRoles,
    "Live: requirePermissionFresh(users:manage_roles) + assertNotParkLocked. Create org role template; permissions ⊆ actor grants. Unique name per org. Plan limit via assertWithinPlanLimit(roleTemplates)."
  ),
  "GET /api/admin/role-templates/[id]": staff(
    P.UsersRead,
    "Live: requirePermissionFresh(users:read). Single template in actor.orgId."
  ),
  "PATCH /api/admin/role-templates/[id]": staff(
    P.UsersManageRoles,
    "Live: requirePermissionFresh(users:manage_roles) + assertNotParkLocked. Update name/description/permissions; permissions ⊆ actor grants."
  ),
  "DELETE /api/admin/role-templates/[id]": staff(
    P.UsersManageRoles,
    "Live: requirePermissionFresh(users:manage_roles) + assertNotParkLocked. Hard delete when not assigned to active memberships."
  ),
  "POST /api/admin/users": staff(
    P.UsersManageRoles,
    "Live: requirePermissionFresh(users:manage_roles) + assertNotParkLocked. Create User (client role, verified) + Profile + wallet + Membership in actor.orgId (Step 8). Optional roleTemplateId with rolePreset custom. Optional locationIds park-lock the seat. Grants ⊆ actor. UI: /admin/users Create user."
  ),
  "POST /api/admin/users/[id]/reset-password": staff(
    P.UsersResetPassword,
    "Live: requirePermissionFresh(users:reset_password) + company-wide view (platform_admin always qualifies). Desk-assist set password for a User that holds Membership in actor.orgId. Also needs users:read to open Users. Fail-closed vs FECSYNC software owners (only another software owner). Invalidates sessions; optional credentials email. UI: /admin/users Reset password. Not self-serve /forgot-password."
  ),
  "POST /api/upload": staff(
    P.UploadsWrite,
    "Live: requirePermissionFresh(uploads:write). Never public."
  ),
  "POST /api/upload/sign": staff(
    P.UploadsWrite,
    "Live: requirePermissionFresh(uploads:write). Signed Cloudinary params for direct browser upload."
  ),
  "POST /api/upload/bulk": staff(
    P.UploadsWrite,
    "Live: requirePermissionFresh(uploads:write). Never public."
  ),
  "POST /api/public/waivers/sign/[token]/extract": pub(
    "Public token route. Same sign-token checks as GET /api/public/waivers/sign/[token]. No tenant JWT. 403 when allowDocumentExtract is false. Missing extract env returns a manual fallback and does not store the image."
  ),
  "POST /api/public/waivers/kiosk/[deviceToken]/extract": pub(
    "Public kiosk device token. No tenant JWT. 403 when the published agreement has document reading off. Missing extract env returns a manual fallback and does not store the image."
  ),
  "POST /api/public/waivers/kiosk/[deviceToken]/walkin/revoke": pub(
    "Public kiosk device token. Sets revokedAt on a walk-in pass for that device location only. A pass for another park is rejected. Rate limited."
  ),

  // ─── Accounting (catch-all src/app/api/admin/accounting/[...path]; gate = requireAccountingActor:
  // Fresh permission → actor org → assertModuleEnabled("accounting") → initialized → park scope; body/query orgId → 400).
  "GET /api/admin/accounting/settings": staff(P.AccountingRead, "Live: requireAccountingActor(accounting:read, initialized optional). Settings or { initialized:false } + setup defaults."),
  "PATCH /api/admin/accounting/settings": staff(P.AccountingManage, "Live: requireAccountingActor(accounting:manage). Base currency / fiscal year / timezone / go-live locks."),
  "POST /api/admin/accounting/setup": staff(P.AccountingManage, "Live: requireAccountingActor(accounting:manage, initialized optional). One-transaction setup; idempotent; optional history import."),
  "GET /api/admin/accounting/setup/preview": staff(P.AccountingManage, "Live: requireAccountingActor(accounting:manage, initialized optional). Defaults + chart template + history counts (dry run)."),
  "GET /api/admin/accounting/lookups": staffAny([P.AccountingRead, P.AccountingExpensesSubmit, P.AccountingInventoryRead, P.AccountingBankingRead], "Live: requireAccountingActor(any). Venues in scope, team members, base currency for pickers."),
  "GET /api/admin/accounting/accounts": staffAny([P.AccountingRead, P.AccountingExpensesSubmit, P.AccountingPayablesWrite, P.AccountingReceivablesWrite], "Live: requireAccountingActor. Chart of accounts (+balances as of date in scope)."),
  "POST /api/admin/accounting/accounts": staff(P.AccountingManage, "Live: requireAccountingActor(accounting:manage). Code unique, parent header same type."),
  "GET /api/admin/accounting/accounts/[id]": staff(P.AccountingRead, "Live: requireAccountingActor(accounting:read). Account + balance. Cross-tenant 404."),
  "PATCH /api/admin/accounting/accounts/[id]": staff(P.AccountingManage, "Live: requireAccountingActor(accounting:manage). Type locked once used; system accounts locked."),
  "DELETE /api/admin/accounting/accounts/[id]": staff(P.AccountingManage, "Live: requireAccountingActor(accounting:manage). Archive only; zero balance and no mappings."),
  "POST /api/admin/accounting/accounts/import": staff(P.AccountingManage, "Live: requireAccountingActor(accounting:manage). CSV ≤ 1 MB; all-or-nothing."),
  "GET /api/admin/accounting/mappings": staff(P.AccountingRead, "Live: requireAccountingActor(accounting:read). Mappings + catalog items."),
  "PUT /api/admin/accounting/mappings": staff(P.AccountingManage, "Live: requireAccountingActor(accounting:manage). ≤ 500 rows; account type validated per kind."),
  "GET /api/admin/accounting/tax-codes": staffAny([P.AccountingRead, P.AccountingExpensesSubmit, P.AccountingPayablesWrite, P.AccountingReceivablesWrite], "Live: requireAccountingActor. Tax codes."),
  "POST /api/admin/accounting/tax-codes": staff(P.AccountingManage, "Live: requireAccountingActor(accounting:manage). Rate 0..100; SALES reserved."),
  "PATCH /api/admin/accounting/tax-codes/[id]": staff(P.AccountingManage, "Live: requireAccountingActor(accounting:manage). Synced SALES rate read-only."),
  "POST /api/admin/accounting/tax-codes/sync": staff(P.AccountingManage, "Live: requireAccountingActor(accounting:manage). Sync from checkout TaxSettings."),
  "GET /api/admin/accounting/periods": staff(P.AccountingRead, "Live: requireAccountingActor(accounting:read). Fiscal periods."),
  "POST /api/admin/accounting/periods/generate": staff(P.AccountingManage, "Live: requireAccountingActor(accounting:manage). Fiscal year within go-live − 1 .. current + 1."),
  "GET /api/admin/accounting/periods/[id]/close-checklist": staff(P.AccountingRead, "Live: requireAccountingActor(accounting:read). Blocking items + warnings."),
  "POST /api/admin/accounting/periods/[id]/close": staff(P.AccountingPeriodsClose, "Live: requireAccountingActor(accounting:periods_close). Earlier periods closed; no pending postings/drafts."),
  "POST /api/admin/accounting/periods/[id]/reopen": staff(P.AccountingPeriodsReopen, "Live: requireAccountingActor(accounting:periods_reopen). Reason 5..500; no later closed period."),
  "POST /api/admin/accounting/periods/year-end-close": staff(P.AccountingPeriodsClose, "Live: requireAccountingActor(accounting:periods_close). Closing entry to retained earnings; locks year."),
  "GET /api/admin/accounting/journals": staff(P.AccountingRead, "Live: requireAccountingActor(accounting:read). Filters + cursor; park scope."),
  "POST /api/admin/accounting/journals": staff(P.AccountingJournalsWrite, "Live: requireAccountingActor(accounting:journals_write). Balanced, open period, no control accounts."),
  "GET /api/admin/accounting/journals/[id]": staff(P.AccountingRead, "Live: requireAccountingActor(accounting:read). Entry + lines + approvals."),
  "PATCH /api/admin/accounting/journals/[id]": staff(P.AccountingJournalsWrite, "Live: requireAccountingActor(accounting:journals_write). Draft only."),
  "DELETE /api/admin/accounting/journals/[id]": staff(P.AccountingJournalsWrite, "Live: requireAccountingActor(accounting:journals_write). Draft only (status void)."),
  "POST /api/admin/accounting/journals/[id]/submit": staff(P.AccountingJournalsWrite, "Live: requireAccountingActor(accounting:journals_write). Requests approval."),
  "POST /api/admin/accounting/journals/[id]/approve": staff(P.AccountingJournalsApprove, "Live: requireAccountingActor(accounting:journals_approve). Maker-checker."),
  "POST /api/admin/accounting/journals/[id]/reject": staff(P.AccountingJournalsApprove, "Live: requireAccountingActor(accounting:journals_approve). Reason required."),
  "POST /api/admin/accounting/journals/[id]/post": staff(P.AccountingJournalsPost, "Live: requireAccountingActor(accounting:journals_post) + period open + approval when required."),
  "POST /api/admin/accounting/journals/[id]/reverse": staff(P.AccountingJournalsReverse, "Live: requireAccountingActor(accounting:journals_reverse). Reason; system entries only via suspense correction."),
  "GET /api/admin/accounting/ledger": staff(P.AccountingRead, "Live: requireAccountingActor(accounting:read). accountId required; running balance."),
  "GET /api/admin/accounting/opening-balances": staff(P.AccountingManage, "Live: requireAccountingActor(accounting:manage). Current opening entry + inventory candidates."),
  "PUT /api/admin/accounting/opening-balances": staff(P.AccountingManage, "Live: requireAccountingActor(accounting:manage). Re-save reverses previous version."),
  "GET /api/admin/accounting/posting-queue": staff(P.AccountingManage, "Live: requireAccountingActor(accounting:manage). Outbox rows + counts."),
  "POST /api/admin/accounting/posting-queue/process": staff(P.AccountingManage, "Live: requireAccountingActor(accounting:manage). Rate limited 6/min; ≤ 500 rows."),
  "POST /api/admin/accounting/posting-queue/[id]/retry": staff(P.AccountingManage, "Live: requireAccountingActor(accounting:manage). Reset + process."),
  "POST /api/admin/accounting/posting-queue/[id]/skip": staff(P.AccountingManage, "Live: requireAccountingActor(accounting:manage). Reason required."),
  "GET /api/admin/accounting/approvals": staffAny([P.AccountingJournalsApprove, P.AccountingPayablesApprove, P.AccountingExpensesApprove], "Live: requireAccountingActor(any approve key). Entities the actor can approve."),
  "POST /api/admin/accounting/approvals/[id]/decide": staffAny([P.AccountingJournalsApprove, P.AccountingPayablesApprove, P.AccountingExpensesApprove], "Live: requireAccountingActor + per-entity permission + maker-checker."),
  "GET /api/admin/accounting/audit": staff(P.AccountingAuditRead, "Live: requireAccountingActor(accounting:audit_read). ActivityLog accounting.* rows with diffs."),
  "GET /api/admin/accounting/customers": staff(P.AccountingReceivablesRead, "Live: requireAccountingActor(accounting:receivables_read). AR balances + aging."),
  "GET /api/admin/accounting/customers/search": staffAny([P.AccountingReceivablesRead, P.AccountingReceivablesWrite, P.AccountingManage], "Live: requireAccountingActor. Party picker (guests, booking companies)."),
  "GET /api/admin/accounting/customers/[partyKey]": staff(P.AccountingReceivablesRead, "Live: requireAccountingActor(accounting:receivables_read). Same-org party or 404."),
  "GET /api/admin/accounting/customers/[partyKey]/statement": staff(P.AccountingReceivablesRead, "Live: requireAccountingActor(accounting:receivables_read). Statement JSON."),
  "POST /api/admin/accounting/customers/[partyKey]/statement-link": staff(P.AccountingReceivablesWrite, "Live: requireAccountingActor(accounting:receivables_write). Crypto token, expires."),
  "GET /api/admin/accounting/invoices": staff(P.AccountingReceivablesRead, "Live: requireAccountingActor(accounting:receivables_read). Booking + manual + credit notes."),
  "POST /api/admin/accounting/invoices": staff(P.AccountingReceivablesWrite, "Live: requireAccountingActor(accounting:receivables_write). Manual invoice or credit note draft."),
  "GET /api/admin/accounting/invoices/[id]": staff(P.AccountingReceivablesRead, "Live: requireAccountingActor(accounting:receivables_read)."),
  "PATCH /api/admin/accounting/invoices/[id]": staff(P.AccountingReceivablesWrite, "Live: requireAccountingActor(accounting:receivables_write). Draft manual only."),
  "POST /api/admin/accounting/invoices/[id]/issue": staff(P.AccountingReceivablesWrite, "Live: requireAccountingActor(accounting:receivables_write). Posts AR."),
  "POST /api/admin/accounting/invoices/[id]/void": staff(P.AccountingReceivablesWrite, "Live: requireAccountingActor(accounting:receivables_write). No payments."),
  "POST /api/admin/accounting/invoices/[id]/credit-note": staff(P.AccountingReceivablesWrite, "Live: requireAccountingActor(accounting:receivables_write). ≤ amount due."),
  "POST /api/admin/accounting/invoices/[id]/write-off": staff(P.AccountingReceivablesWrite, "Live: requireAccountingActor(accounting:receivables_write). Through approvals."),
  "GET /api/admin/accounting/receipts": staff(P.AccountingReceivablesRead, "Live: requireAccountingActor(accounting:receivables_read)."),
  "POST /api/admin/accounting/receipts": staff(P.AccountingReceivablesWrite, "Live: requireAccountingActor(accounting:receivables_write). Allocations same party, ≤ due."),
  "GET /api/admin/accounting/receipts/[id]": staff(P.AccountingReceivablesRead, "Live: requireAccountingActor(accounting:receivables_read)."),
  "POST /api/admin/accounting/receipts/[id]/void": staff(P.AccountingReceivablesWrite, "Live: requireAccountingActor(accounting:receivables_write). Reverses + recomputes invoices."),
  "POST /api/admin/accounting/receipts/[id]/allocate": staff(P.AccountingReceivablesWrite, "Live: requireAccountingActor(accounting:receivables_write). Unapplied credit."),
  "GET /api/admin/accounting/suppliers": staffAny([P.AccountingPayablesRead, P.AccountingExpensesSubmit], "Live: requireAccountingActor. Suppliers + balances."),
  "POST /api/admin/accounting/suppliers": staff(P.AccountingPayablesWrite, "Live: requireAccountingActor(accounting:payables_write). Bank number encrypted."),
  "POST /api/admin/accounting/suppliers/import": staff(P.AccountingPayablesWrite, "Live: requireAccountingActor(accounting:payables_write). CSV ≤ 1 MB."),
  "GET /api/admin/accounting/suppliers/[id]": staff(P.AccountingPayablesRead, "Live: requireAccountingActor(accounting:payables_read)."),
  "PATCH /api/admin/accounting/suppliers/[id]": staff(P.AccountingPayablesWrite, "Live: requireAccountingActor(accounting:payables_write)."),
  "DELETE /api/admin/accounting/suppliers/[id]": staff(P.AccountingPayablesWrite, "Live: requireAccountingActor(accounting:payables_write). Archive; no open bills or balance."),
  "GET /api/admin/accounting/suppliers/[id]/statement": staff(P.AccountingPayablesRead, "Live: requireAccountingActor(accounting:payables_read)."),
  "GET /api/admin/accounting/purchase-orders": staff(P.AccountingPayablesRead, "Live: requireAccountingActor(accounting:payables_read)."),
  "POST /api/admin/accounting/purchase-orders": staff(P.AccountingPayablesWrite, "Live: requireAccountingActor(accounting:payables_write). Supplier active, venue writable."),
  "GET /api/admin/accounting/purchase-orders/[id]": staff(P.AccountingPayablesRead, "Live: requireAccountingActor(accounting:payables_read)."),
  "PATCH /api/admin/accounting/purchase-orders/[id]": staff(P.AccountingPayablesWrite, "Live: requireAccountingActor(accounting:payables_write). Draft only."),
  "POST /api/admin/accounting/purchase-orders/[id]/submit": staff(P.AccountingPayablesWrite, "Live: requireAccountingActor(accounting:payables_write). Threshold approval."),
  "POST /api/admin/accounting/purchase-orders/[id]/approve": staff(P.AccountingPayablesApprove, "Live: requireAccountingActor(accounting:payables_approve). Maker-checker."),
  "POST /api/admin/accounting/purchase-orders/[id]/reject": staff(P.AccountingPayablesApprove, "Live: requireAccountingActor(accounting:payables_approve)."),
  "POST /api/admin/accounting/purchase-orders/[id]/send": staff(P.AccountingPayablesWrite, "Live: requireAccountingActor(accounting:payables_write). Marks sent."),
  "POST /api/admin/accounting/purchase-orders/[id]/receive": staff(P.AccountingPayablesWrite, "Live: requireAccountingActor(accounting:payables_write). Stock + Dr inventory / Cr GRNI."),
  "POST /api/admin/accounting/purchase-orders/[id]/close": staff(P.AccountingPayablesWrite, "Live: requireAccountingActor(accounting:payables_write)."),
  "POST /api/admin/accounting/purchase-orders/[id]/cancel": staff(P.AccountingPayablesWrite, "Live: requireAccountingActor(accounting:payables_write). Nothing received or billed."),
  "POST /api/admin/accounting/purchase-orders/[id]/convert-to-bill": staff(P.AccountingPayablesWrite, "Live: requireAccountingActor(accounting:payables_write). Draft bill from received-not-billed."),
  "GET /api/admin/accounting/bills": staff(P.AccountingPayablesRead, "Live: requireAccountingActor(accounting:payables_read)."),
  "POST /api/admin/accounting/bills": staff(P.AccountingPayablesWrite, "Live: requireAccountingActor(accounting:payables_write). Duplicate supplier invoice → 409."),
  "GET /api/admin/accounting/bills/[id]": staff(P.AccountingPayablesRead, "Live: requireAccountingActor(accounting:payables_read)."),
  "PATCH /api/admin/accounting/bills/[id]": staff(P.AccountingPayablesWrite, "Live: requireAccountingActor(accounting:payables_write). Draft only."),
  "POST /api/admin/accounting/bills/[id]/submit": staff(P.AccountingPayablesWrite, "Live: requireAccountingActor(accounting:payables_write)."),
  "POST /api/admin/accounting/bills/[id]/approve": staff(P.AccountingPayablesApprove, "Live: requireAccountingActor(accounting:payables_approve). Maker-checker."),
  "POST /api/admin/accounting/bills/[id]/reject": staff(P.AccountingPayablesApprove, "Live: requireAccountingActor(accounting:payables_approve)."),
  "POST /api/admin/accounting/bills/[id]/post": staff(P.AccountingPayablesWrite, "Live: requireAccountingActor(accounting:payables_write) + approval when over threshold."),
  "POST /api/admin/accounting/bills/[id]/void": staff(P.AccountingPayablesWrite, "Live: requireAccountingActor(accounting:payables_write). No payments allocated."),
  "POST /api/admin/accounting/bills/[id]/credit-note": staff(P.AccountingPayablesWrite, "Live: requireAccountingActor(accounting:payables_write)."),
  "GET /api/admin/accounting/supplier-payments": staff(P.AccountingPayablesRead, "Live: requireAccountingActor(accounting:payables_read)."),
  "POST /api/admin/accounting/supplier-payments": staff(P.AccountingPayablesWrite, "Live: requireAccountingActor(accounting:payables_write). Allocations same supplier, ≤ due."),
  "GET /api/admin/accounting/supplier-payments/[id]": staff(P.AccountingPayablesRead, "Live: requireAccountingActor(accounting:payables_read)."),
  "POST /api/admin/accounting/supplier-payments/[id]/approve": staff(P.AccountingPayablesApprove, "Live: requireAccountingActor(accounting:payables_approve). Maker-checker."),
  "POST /api/admin/accounting/supplier-payments/[id]/post": staff(P.AccountingPayablesWrite, "Live: requireAccountingActor(accounting:payables_write). Approved only."),
  "POST /api/admin/accounting/supplier-payments/[id]/void": staff(P.AccountingPayablesWrite, "Live: requireAccountingActor(accounting:payables_write)."),
  "POST /api/admin/accounting/supplier-payments/[id]/remittance": staff(P.AccountingPayablesWrite, "Live: requireAccountingActor(accounting:payables_write). Marks remittance sent; email delivery uses remittance payload."),
  "GET /api/admin/accounting/expenses": staffAny([P.AccountingExpensesSubmit, P.AccountingExpensesRead, P.AccountingExpensesApprove, P.AccountingExpensesWrite], "Live: requireAccountingActor. Own only without expenses_read."),
  "POST /api/admin/accounting/expenses": staff(P.AccountingExpensesSubmit, "Live: requireAccountingActor(accounting:expenses_submit)."),
  "GET /api/admin/accounting/expenses/[id]": staffAny([P.AccountingExpensesSubmit, P.AccountingExpensesRead, P.AccountingExpensesApprove, P.AccountingExpensesWrite], "Live: requireAccountingActor. Owner or reader; else 404."),
  "PATCH /api/admin/accounting/expenses/[id]": staffAny([P.AccountingExpensesSubmit, P.AccountingExpensesWrite], "Live: requireAccountingActor. Draft/rejected; owner or expenses_write."),
  "POST /api/admin/accounting/expenses/[id]/submit": staffAny([P.AccountingExpensesSubmit, P.AccountingExpensesWrite], "Live: requireAccountingActor. Receipt rule + approval threshold."),
  "POST /api/admin/accounting/expenses/[id]/approve": staff(P.AccountingExpensesApprove, "Live: requireAccountingActor(accounting:expenses_approve). Maker-checker; posts."),
  "POST /api/admin/accounting/expenses/[id]/reject": staff(P.AccountingExpensesApprove, "Live: requireAccountingActor(accounting:expenses_approve). Reason required."),
  "POST /api/admin/accounting/expenses/[id]/pay": staff(P.AccountingExpensesWrite, "Live: requireAccountingActor(accounting:expenses_write). Reimbursable only."),
  "POST /api/admin/accounting/expenses/[id]/void": staff(P.AccountingExpensesWrite, "Live: requireAccountingActor(accounting:expenses_write). Reverses postings."),
  "GET /api/admin/accounting/expense-categories": staffAny([P.AccountingRead, P.AccountingExpensesSubmit, P.AccountingManage], "Live: requireAccountingActor."),
  "POST /api/admin/accounting/expense-categories": staff(P.AccountingManage, "Live: requireAccountingActor(accounting:manage)."),
  "PATCH /api/admin/accounting/expense-categories/[id]": staff(P.AccountingManage, "Live: requireAccountingActor(accounting:manage)."),
  "POST /api/admin/accounting/attachments": staffAny([P.AccountingJournalsWrite, P.AccountingPayablesWrite, P.AccountingExpensesSubmit, P.AccountingReceivablesWrite, P.AccountingManage], "Live: requireAccountingActor. pdf/jpg/png/webp ≤ ACCOUNTING_ATTACHMENT_MAX_MB; MIME sniffed."),
  "GET /api/admin/accounting/bank-accounts": staffAny([P.AccountingBankingRead, P.AccountingManage, P.AccountingExpensesSubmit, P.AccountingPayablesWrite, P.AccountingReceivablesWrite], "Live: requireAccountingActor. Balances in scope."),
  "POST /api/admin/accounting/bank-accounts": staff(P.AccountingManage, "Live: requireAccountingActor(accounting:manage). Creates/links ledger account."),
  "PATCH /api/admin/accounting/bank-accounts/[id]": staff(P.AccountingManage, "Live: requireAccountingActor(accounting:manage)."),
  "DELETE /api/admin/accounting/bank-accounts/[id]": staff(P.AccountingManage, "Live: requireAccountingActor(accounting:manage). Archive; zero balance, nothing unreconciled."),
  "GET /api/admin/accounting/bank-accounts/[id]/transactions": staff(P.AccountingBankingRead, "Live: requireAccountingActor(accounting:banking_read)."),
  "POST /api/admin/accounting/bank-accounts/[id]/transactions": staff(P.AccountingBankingWrite, "Live: requireAccountingActor(accounting:banking_write). Manual bank line."),
  "POST /api/admin/accounting/bank-accounts/[id]/import": staff(P.AccountingBankingWrite, "Live: requireAccountingActor(accounting:banking_write). CSV ≤ 5 MB, ≤ 20k rows; dedupe; 10/hour."),
  "GET /api/admin/accounting/bank-transactions/[id]/suggestions": staff(P.AccountingBankingRead, "Live: requireAccountingActor(accounting:banking_read)."),
  "POST /api/admin/accounting/bank-transactions/[id]/match": staff(P.AccountingBankingWrite, "Live: requireAccountingActor(accounting:banking_write). Sum must equal bank amount."),
  "POST /api/admin/accounting/bank-transactions/[id]/unmatch": staff(P.AccountingBankingWrite, "Live: requireAccountingActor(accounting:banking_write). Not reconciled."),
  "POST /api/admin/accounting/bank-transactions/[id]/exclude": staff(P.AccountingBankingWrite, "Live: requireAccountingActor(accounting:banking_write). Reason required."),
  "POST /api/admin/accounting/bank-transactions/[id]/create-entry": staff(P.AccountingBankingWrite, "Live: requireAccountingActor(accounting:banking_write). Posts and matches."),
  "GET /api/admin/accounting/transfers": staff(P.AccountingBankingRead, "Live: requireAccountingActor(accounting:banking_read)."),
  "POST /api/admin/accounting/transfers": staff(P.AccountingBankingWrite, "Live: requireAccountingActor(accounting:banking_write). Different active accounts."),
  "POST /api/admin/accounting/transfers/[id]/void": staff(P.AccountingBankingWrite, "Live: requireAccountingActor(accounting:banking_write)."),
  "GET /api/admin/accounting/reconciliations": staff(P.AccountingReconcile, "Live: requireAccountingActor(accounting:reconcile)."),
  "POST /api/admin/accounting/reconciliations": staff(P.AccountingReconcile, "Live: requireAccountingActor(accounting:reconcile). One in progress per bank account."),
  "GET /api/admin/accounting/reconciliations/[id]": staff(P.AccountingReconcile, "Live: requireAccountingActor(accounting:reconcile)."),
  "PATCH /api/admin/accounting/reconciliations/[id]": staff(P.AccountingReconcile, "Live: requireAccountingActor(accounting:reconcile). Toggle cleared lines."),
  "POST /api/admin/accounting/reconciliations/[id]/complete": staff(P.AccountingReconcile, "Live: requireAccountingActor(accounting:reconcile). Difference must be 0.00."),
  "POST /api/admin/accounting/reconciliations/[id]/reopen": staff(P.AccountingReconcile, "Live: requireAccountingActor(accounting:reconcile) + accounting:manage in lib. Latest only."),
  "GET /api/admin/accounting/inventory": staff(P.AccountingInventoryRead, "Live: requireAccountingActor(accounting:inventory_read). Valuation vs ledger."),
  "GET /api/admin/accounting/inventory/movements": staff(P.AccountingInventoryRead, "Live: requireAccountingActor(accounting:inventory_read)."),
  "POST /api/admin/accounting/inventory/adjustments": staff(P.AccountingInventoryWrite, "Live: requireAccountingActor(accounting:inventory_write). Reason 3..500; no negative stock."),
  "PATCH /api/admin/accounting/inventory/costs": staff(P.AccountingInventoryWrite, "Live: requireAccountingActor(accounting:inventory_write). Revaluation when on hand."),
  "GET /api/admin/accounting/products": staffAny([P.AccountingInventoryRead, P.AccountingPayablesWrite, P.AccountingManage], "Live: requireAccountingActor. POS + shop product picker in scope."),
  "GET /api/admin/accounting/dashboard": staff(P.AccountingRead, "Live: requireAccountingActor(accounting:read). KPIs + 12-month trend."),
  "GET /api/admin/accounting/reports": staff(P.AccountingReportsRead, "Live: requireAccountingActor(accounting:reports_read). Report catalog."),
  "GET /api/admin/accounting/reports/[report]": staffAny([P.AccountingReportsRead, P.AccountingAuditRead], "Live: requireAccountingActor + reports_read (audit-trail: audit_read). Range ≤ 5 years."),
  "GET /api/admin/accounting/source-entries": staff(P.AccountingRead, "Live: requireAccountingActor(accounting:read). Journal entries for a source document; scope-checked."),
  "GET /api/admin/accounting/export/journal-lines": staff(P.AccountingExport, "Live: requireAccountingActor(accounting:export). Generic journal lines CSV (from/to ≤ 5 years); park scope."),
  "GET /api/me/accounting/summary": own(P.AccountingStatementsReadOwn, "Live: requireAuth + statements_read_own. Own balance across orgs with accounting enabled."),
  "GET /api/me/accounting/invoices": own(P.AccountingStatementsReadOwn, "Live: own invoices only (customerUserId / own GuestProfile)."),
  "GET /api/me/accounting/invoices/[id]": own(P.AccountingStatementsReadOwn, "Live: own invoice or 404."),
  "GET /api/me/accounting/statement": own(P.AccountingStatementsReadOwn, "Live: own statement per org; from/to."),
  "GET /api/public/accounting/invoices/[token]": pub("Invoice view token (crypto random). 30/min/IP. Header, lines, totals, branding only."),
  "POST /api/public/accounting/invoices/[token]/pay": pub("Invoice token. 10/min/IP. Stripe Checkout for amountDue (never body amount); booking invoices use the booking payment link."),
  "GET /api/public/accounting/statements/[token]": pub("Statement token; expired → 410. Rate limited."),
};

/** Privileged handlers (includes staff GETs). Public storefront GET and provider callbacks excluded. */
export const GUARDED_API_PERMISSIONS: Record<string, ApiPermissionRule> =
  Object.fromEntries(
    Object.entries(API_PERMISSIONS).filter(
      ([, rule]) => !isUnguardedApiIsolation(rule.isolation)
    )
  );

/** Mutating subset of GUARDED_API_PERMISSIONS (POST/PUT/PATCH/DELETE). */
export const MUTATING_API_PERMISSIONS: Record<string, ApiPermissionRule> =
  Object.fromEntries(
    Object.entries(GUARDED_API_PERMISSIONS).filter(
      ([key]) => !key.startsWith("GET ")
    )
  );

export function lookupApiPermission(
  method: string,
  pathname: string
): ApiPermissionRule | null {
  const verb = method.toUpperCase();
  const exact = API_PERMISSIONS[`${verb} ${pathname}`];
  if (exact) return exact;

  let best: { length: number; rule: ApiPermissionRule } | null = null;
  for (const [pattern, rule] of Object.entries(API_PERMISSIONS)) {
    const space = pattern.indexOf(" ");
    if (space < 0) continue;
    if (pattern.slice(0, space) !== verb) continue;
    const pathPattern = pattern.slice(space + 1);
    const regex = new RegExp(
      `^${pathPattern.replace(/\[.*?\]/g, "[^/]+")}$`
    );
    if (!regex.test(pathname)) continue;
    if (!best || pathPattern.length > best.length) {
      best = { length: pathPattern.length, rule };
    }
  }

  return best?.rule ?? null;
}

export function ruleAllows(
  rule: ApiPermissionRule,
  held: Iterable<string> | null | undefined
): boolean {
  if (isUnguardedApiIsolation(rule.isolation)) return true;
  return hasAnyPermission(held, rule.permissions);
}

/**
 * Identity auth and Stripe webhook have no catalog permission by design
 * (Step 7.1 ACCEPTED — not unguarded resource mutations).
 * /api/shop CRUD is 410 Gone (Step 4.3) — unused, not a tenant, listed in API_PERMISSIONS.
 * product/shop|seller are unused by UI but live-gated in API_PERMISSIONS (Step 4.1)
 * — do not add shop/seller/tenant perms or treat them as isolation keys.
 *
 * Step 0.1 OPEN inventory → Step 7.1 disposition (CLOSED or ACCEPTED):
 * every former OPEN mutator is either gated, 410, provider-verified, or listed below.
 */
export const UNUSED_OR_IDENTITY_APIS = {
  /**
   * ACCEPTED OPEN (identity): public credential/OAuth flows. Must never accept
   * client-supplied admin role (signup + Google force `client` — Step 0.2 / 7.1).
   */
  identity: [
    "POST /api/auth/signup — CLOSED (410). Guest shop self-reg disabled; use /register-company.",
    "POST /api/auth/login",
    "POST /api/auth/register-company — Company onboarding; required plan (demo|starter|growth|enterprise); demo uses free Stripe Checkout (no card / no charge); paid creates User+Organization(pending)+platform_admin; Checkout when Price exists; else /company-pending. Existing email or existing company seat → 409 refuse (no auto-login; use /signin).",
    "POST /api/auth/company-onboarding-checkout — Resume Stripe Checkout for pending company platform_admin (allowSuspendedOrg). Payment webhook + success confirm activate org + stamp plan. Success → /company-checkout/complete → /signin.",
    "POST /api/auth/company-onboarding-confirm — Public confirm of Stripe Checkout session_id; verifies paid company_subscription and auto-activates pending org (idempotent with webhook).",
    "POST /api/auth/company-billing-renew — Platform admin renew (Portal/Checkout); allowSuspendedOrg for soft-hold + billing expired-suspend self-serve unlock. ops_hold (manual Suspend) is blocked until Approve or Set plan.",
    "POST /api/auth/refresh",
    "POST /api/auth/logout",
    "POST /api/auth/verify — OTP marks email verified + provisions profile/wallet; no session cookies; client must POST /api/auth/login",
    "POST /api/auth/resend",
    "POST /api/auth/forgot-password",
    "POST /api/auth/reset-password",
    "POST /api/memberships/activate — Invite-only guest membership dashboard set-password (JWT type guest_membership_invite; never /signup).",
    "GET /api/auth/google",
    "GET /api/auth/google/callback",
  ],
  /**
   * ACCEPTED OPEN (provider proof, not JWT): Stripe/Paystack verify payment
   * with the provider before mutating wallet/order state.
   */
  webhooksAndProviderConfirm: [
    "POST /api/webhooks/stripe — Stripe-Signature (ACCEPTED)",
    "GET /api/payment/stripe/confirm — Stripe session_id via getCheckoutSession (ACCEPTED)",
    "GET /api/payment/tailoring/confirm — Stripe session_id for tailoring jobs (ACCEPTED)",
    "GET /api/payment/booking/confirm — Stripe session_id for venue bookings (ACCEPTED; never shop Order)",
    "GET /api/payment/paystack/callback — Paystack secret verify (ACCEPTED; UI off)",
    "GET|POST /api/cron/reconcile-company-subscriptions — Bearer CRON_SECRET (ACCEPTED; Step 3)",
    "GET|POST /api/cron/remind-company-subscriptions — Bearer CRON_SECRET (ACCEPTED; Step 3)",
    "GET|POST /api/cron/expire-membership-invites — Bearer CRON_SECRET (ACCEPTED; Step 3)",
  ],
  /**
   * ACCEPTED OPEN (guest storefront): fashion-chat may run signed-out; when
   * authenticated, handlers force user=sub (Step 3.5). Not a staff/resource IDOR surface.
   */
  guestPublicMutators: [
    "POST /api/fashion-chat — guest sessionId+IP or auth user=sub; contact required (ACCEPTED)",
    "POST /api/fashion-chat/stream — same isolation SSE (ACCEPTED)",
    "POST /api/fashion-chat/start — contact shell before first message (ACCEPTED)",
    "POST /api/fashion-chat/end — resolve open chat with contact kept (ACCEPTED)",
  ],
  unusedByUi: [
    "GET|POST|PUT|PATCH|DELETE /api/shop — 410 Gone (Step 4.3; not multi-tenant)",
    "GET|POST|PUT|PATCH|DELETE /api/shop/[id] — 410 Gone (Step 4.3; not multi-tenant)",
    "GET|PUT|DELETE /api/product/shop/[id] — 410 Gone (retired)",
    "GET|PUT|DELETE /api/product/seller/[id] — 410 Gone (retired)",
  ],
  missingHandler: [
    "POST /api/payment/verify — no handler; CLOSED — /payment/callback uses GET paystack/callback (PAYMENT_POLICY)",
    "GET /api/product-category/slug/[slug] — unused client helper; no handler (do not leave open)",
  ],
  /**
   * Step 7.1 role-model disposition (not an API OPEN):
   * User.role `seller` ARCHIVED → client preset; migrate via yarn ensure-memberships.
   * Not a Membership ROLE_PRESET. Membership presets include Find-a-Tailor `tailor`
   * (non-staff provider) separately from archived seller.
   */
  archivedRoles: ["seller → client (ARCHIVED)"],
} as const;

/**
 * Proxy matcher vs catalog. Wired in `src/proxy.ts` + `src/lib/auth/routePolicy.ts`.
 * Edge verifies the access-token only (no DB). /api is not in the matcher.
 */
export const PROXY_AUTH_COVERAGE = {
  matcherProtects: [
    "/",
    "/admin",
    "/tailor",
    "/profile",
    "/cart",
    "/checkout",
    "/user/profile",
    "/settings",
    "/dashboard",
  ],
  matcherDoesNotProtect: [
    "/api",
    "/customize",
    "/payment",
    "/success",
    "/cancel",
  ],
  phantomPaths: ["/settings", "/dashboard", "/user/profile"],
  intendedAdminGate: "/admin",
  /**
   * Wrong-role pages (existing copy, not the Step 2.1 prompt path names):
   * client on /admin → /403 (Admin Access Required).
   * /403/admin is the inverse (admin on a user surface); staff on /profile
   * are sent to /admin instead, matching `(user)` layout.
   * Edge cannot hit Mongo; staff vs client is JWT role / preset / permissions.
   */
  wrongRole: {
    clientOnAdmin: "/403",
    staffOnProfile: "/admin",
  },
  publicStorefront: [
    "/home",
    "/shop",
    "/fabrics",
    "/customize",
    "/trending-fashion",
    "/terms",
    "/privacy",
    "/payment/success",
    "/payment/failure",
    "/payment/cancel",
    "/payment/callback",
    "/success",
    "/cancel",
    "/403",
    "/403/admin",
  ],
  identityPages: [
    "/signin",
    "/signup",
    "/register-company",
    "/verify-email",
    "/forgot-password",
    "/reset-password",
    "/check-email",
    "/memberships/activate",
    "/google/callback",
  ],
} as const;
