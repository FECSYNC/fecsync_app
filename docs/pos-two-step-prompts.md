# POS (Point of Sale) — two Cursor prompts

Paste one step at a time. After that step finishes, paste its follow-up before you paste the next step. Do not skip a follow-up. Do not start Step 2 while the Step 1 follow-up still reports a failure.

This file is the execution source of truth. `docs/pos-complete-spec.md` is an older five-phase draft written before Online Ticketing, guest Memberships, and Digital Waivers shipped. Do not follow that five-phase split, and do not recreate models that already exist.

Step 1 builds the gates, the POS tables, the catalog admin, and the sale engine and APIs, and it connects them to ticketing, memberships, waivers, tax, Stripe, and the shop so the shop stays untouched. Step 2 builds the staff terminal, check-in, tills, receipts, offline sync, hardware honesty, webhooks, HQ and export, and the proof that nothing in Step 1 was left disconnected.

There are two steps. There is no Step 3.

---

## Step 1 prompt

```
You are implementing Step 1 only of POS (Point of Sale) for this multi-tenant venue SaaS. Build the foundation, the catalog, and the sale engine and every API the terminal will call. Do not build the cashier terminal screens, the check-in camera screen, the till cash-count screen, or the offline banner UI in this step. Those are Step 2. Do not stop halfway through Step 1. Do not ask for a shorter feature list. Everything required is in this prompt.

Before you change anything, scan this project and write down what already exists versus what you must add. Read the real files. Do not invent a second organization, a second venue, a second guest, a second booking, a second membership plan, a second gift-card ledger, a second waiver record, or a second tax engine.

Start the scan with these files and follow every import they use:

.cursor/rules/saas-venue-platform.mdc
.cursor/rules/customer-vs-tailor-sections.mdc
docs/saas-module-extension.md
docs/enterprise-hq-controls.md
docs/online-booking-ticketing-complete-spec.md
docs/memberships-complete-spec.md
docs/digital-waivers-complete-spec.md
README.md module entitlement contract
prisma/schema.prisma models Organization, VenueLocation, Membership, GuestProfile, MembershipPlan, GuestMembership, Booking, BookingLine, BookingHold, BookingPayment, BookingPaymentLink, TicketCredential, TicketSession, AdmissionProduct, AdmissionAddOnLink, StockPeriod, CapacityResource, BookingSettings, GiftCard, WaiverRecord, TaxSettings, CompanyProfile, Product, Cart, Order, Wallet
src/lib/moduleEntitlement.ts
src/lib/subscriptionPlans.ts
src/lib/planLimits.ts
src/lib/demoPlanLock.ts
src/lib/demoPlanAssert.ts
src/lib/auth/permissions.ts
src/lib/adminNav.ts
src/lib/parkAdminScope.ts
src/lib/actorLocationScope.ts
src/lib/staffOrg.ts
src/lib/companyExport.ts
src/lib/hqOverview.ts
src/lib/stripe.ts
src/lib/sendReceipts.ts
src/lib/rateLimit.ts
src/lib/audit/activityLog.ts
src/lib/ticketing/bookingEngine.ts
src/lib/ticketing/credentials.ts
src/lib/ticketing/capacity.ts
src/lib/ticketing/holds.ts
src/lib/ticketing/giftCards.ts
src/lib/ticketing/payments.ts
src/lib/ticketing/paymentLinks.ts
src/lib/ticketing/refunds.ts
src/lib/ticketing/tax.ts
src/lib/ticketing/confirmations.ts
src/lib/memberships/posAdapter.ts
src/lib/memberships/billingEngine.ts
src/lib/memberships/entitlementEngine.ts
src/lib/waivers/evaluateWaiver.ts
src/lib/waivers/bookingHooks.ts
src/app/api/pos/bookings/route.ts
src/app/api/pos/bookings/[id]/route.ts
src/app/api/pos/bookings/[id]/pos-notes/route.ts
src/app/api/pos/memberships/route.ts
src/app/api/webhooks/stripe/route.ts

Search the repo for every other writer of GiftCard, BookingPayment, GuestProfile.bannedAt, GuestMembership.createdFromSaleId, and channel pos. Those call sites must stay in sync with the new POS sale.

Standing rules for this step

Organization is the paying company. VenueLocation is the park. Membership is the staff seat. GuestMembership plus MembershipPlan is the guest park membership. DEFAULT_ORG and isDefault is the public Harewa storefront and never runs park POS. Demo companies stay locked to the dashboard, company profile, and Billing. Starter has ticketing and does not get POS. Growth and Enterprise get POS because their moduleHints already include pos or all. Unpaid, pending, and suspended companies fail closed through the existing billing gate.

Shop Product, Cart, CartLine, Order, and Wallet stay the fashion store. Do not store food, gift cards, tills, park wallets, or POS sales in those tables. Do not reopen /signup or POST /api/auth/signup. POS may create GuestProfile rows. It must not create a public client User.

Ignore client orgId, organizationId, and a spoofed locationId. Stamp actor.orgId. A locationId is accepted only after the venue belongs to that org and src/lib/parkAdminScope.ts assertActorCanAccessLocation allows it. Lists of sales, devices, and tills must respect src/lib/actorLocationScope.ts the same way ticketing and memberships lists do. Park-locked seats stay on assigned parks. Company-wide meters stay company-wide. Platform software owner bypass that exists for ticketing on the storefront must not be copied onto POS. Park POS never runs on the storefront org.

Guest billing stays in Feature 08. Sell, renew, upgrade, downgrade, verify, redeem, and discount for memberships go through src/lib/memberships/posAdapter.ts into billingEngine and entitlementEngine. Do not write a second membership commerce ledger. Admissions stay in the booking engine. A POS admission line calls src/lib/ticketing/bookingEngine.ts with channel pos. Do not build a parallel booking schema. Do not build or restyle public /book. Do not claim Feature 01, Digital Waivers signing, the check-in scanner product, or the ticket-purchase kiosk.

One card tender is one Stripe PaymentIntent on the POS sale. When that sale also confirms a booking, update the booking amountPaid through the existing booking payment helpers and store the POS sale id on that booking payment so reports can see the allocation. Do not create a second PaymentIntent for the same card. Do not create a shop Order. ticketsPerMonth is already enforced inside booking confirm. POS must confirm admissions through that engine so the meter still applies.

Do not fake Intercard, Sacoa, Amusement Connect, a Kitchen Display screen, cash recyclers, a self-service kiosk, OTAs, dynamic pricing, or a BOGO promo engine.

What Step 1 must ship

1. Entitlement. Add assertPosEnabled in src/lib/pos/assertPosEnabled.ts as a thin wrapper around assertModuleEnabled(orgId, "pos"). It must not grant the storefront-owner bypass that assertTicketingEnabled grants. Add "pos" to SHIPPED_MODULE_HINT_IDS in src/lib/subscriptionPlans.ts and update the comments that still say POS is story-only. Call assertPosEnabled on every new POS route and on the four routes that already exist: POST /api/pos/bookings, the booking id route, the pos-notes route, and POST /api/pos/memberships. Those four routes keep their current booking and membership permission checks. The memberships route still requires the memberships module as well. Inside bookingEngine, any create or confirm whose channel is pos must also fail when POS is not enabled, including a staff booking create that sets channel pos. Starter, Demo, storefront, pending, suspended, and unpaid orgs receive 403. Growth and Enterprise that are active and entitled receive 200 on catalog reads.

2. Plan meter. Move posTerminals from FuturePlanModules into PlanLimits in src/lib/subscriptionPlans.ts and into PlanResource in src/lib/planLimits.ts. Caps are demo 0, starter 0, growth 5, enterprise null for unlimited. Count active PosDevice rows for the org, where archivedAt is null. Enforce the cap on device create only. ticketsPerMonth already exists. Do not add a second ticket meter. Update plan copy that says POS is not a live app yet only after the Step 1 APIs exist, and say the terminal screens arrive in Step 2. Landing marketing may stay as it is until Step 2.

3. Prisma. Add one migration with yarn db:migrate named pos_terminal, then prisma generate. Follow the repo migration style. Every new park table has orgId, a required locationId foreign key to VenueLocation, indexes on orgId plus locationId plus createdAt, and a check that the venue belongs to the org in the write path. Org-default settings may use a null locationId. Extend ActivityEntityType with PosSale, PosDevice, TillSession, GiftCard, GuestTab. NotificationType gains pos. Do not duplicate GuestProfile, MembershipPlan, GuestMembership, Booking, BookingLine, BookingHold, BookingPayment, TicketCredential, TicketSession, AdmissionProduct, WaiverRecord, or TaxSettings.

Extend the existing GiftCard model rather than creating a second card table. Keep codeHash as the lookup secret. Add last4, kind digital or physical, status active pending disabled expired or void, locationId optional, issuedToGuestId optional, issuedSaleId optional, expiresAt optional. Add GiftCardLedger with giftCardId, orgId, type issue redeem refund adjust or void, amount, saleId optional, bookingId optional, createdById, createdAt, and a unique idempotency key. The existing issueGiftCard, redeemGiftCard, and creditGiftCard functions in src/lib/ticketing/giftCards.ts must keep working for booking refunds. Teach them to write a ledger row. Never store the raw code or a PIN in plaintext. Return the raw code once on issue.

Add these POS models with complete fields and relations back to Organization and VenueLocation.

PosSettings, unique on orgId plus locationId. Fields: captureGuestPostcode default false, postcodeRequired default false, requireGuestOnSale default false, allowOpenPrice default true, allowParkedCarts default true, allowUnpaidBookings default true, paidRequiredForRedeem default true, defaultReceiptEmail, printTicketsOnSale, showExpectedTillTotals default true, tipPromptEnabled default true, tipSuggestedPercents Json default 15 18 20, managerPinRequiredForDiscount default true, managerPinRequiredForRefund default true, managerPinRequiredForVoid default true, managerPinRequiredForWastage default true, offlineEnabled default true, cashRequiresOpenTill default true, lateRedemptionGraceMinutes default 0, allowPastDateRedemption default false, bannedGuestPrompt default true, managerOverridePinHash optional. A null locationId row is the org default. A venue row overrides it.

PosDevice: name, code unique per org, templateKey, registeredAt, lastSeenAt, archivedAt, settingsOverride Json, printEnabled, cashDrawerEnabled, stripeTerminalId optional, printAgentUrl optional. Active rows count toward posTerminals.

PosMenu, PosMenuCategory, PosMenuItem: orgId, locationId, name, deviceTemplateKey optional, sortOrder, productId, hidden, color optional, icon optional.

PosProduct: kind is one of admission_proxy, food, beverage, merchandise, open_price, package, party_package_proxy, add_on, gift_card, membership_plan, cashless_card, park_wallet, gratuity, other. Also name, description, sku optional, openPrice, taxExemptDefault, trackInventory, onHand, suspendSales default false, archivedAt, images, kitchenRoute optional string, membershipPlanId optional, giftCardDefaultAmount optional, denominations Json, allowCustomAmount. admission_proxy and party_package_proxy store the AdmissionProduct id they sell. They are not a second admission catalog.

PosModifierGroup and PosModifier: productId, name, required, minSelect, maxSelect, priceDelta, stockTrack optional.

PosProductLink: parentProductId, childProductId, required, maxQty, for packages and add-ons.

PosDiscountCode: orgId, locationId optional, code unique per org, percentOff or amountOff, minSubtotal, startsAt, endsAt, maxRedemptions, redemptionCount, archivedAt, requiresManagerPin.

PosCart and PosCartLine: deviceId, cashierUserId, guestProfileId optional, status open or parked, expiresAt, bookingHoldIds, and lines with kind, product snapshot, qty, unitPrice, modifiers Json, sessionId optional, booking fields. Status values for the sale document are open, parked, held_booking, unpaid, completed, voided, refunded, partially_refunded.

PosSale, PosSaleLine, PosSalePayment, PosSaleRefund, PosSaleBooking. The sale has publicId unique, deviceId, tillSessionId optional, cashierUserId, guestProfileId optional, postalCodeCaptured optional, status, currency, subtotal, discountTotal, taxAmount, tipAmount, total, amountPaid, amountDue, receiptEmail, notes, posNotes, idempotencyKey unique per org. Lines snapshot name, kind, qty, unit price, tax, modifiers. Payments have tender card, cash, split_component, gift_card, park_wallet, cashless, stored_card, payment_link, or other, plus amount, status pending authorized completed failed cancelled refunded or partial_refund, stripePaymentIntentId optional, giftCardId optional, idempotencyKey unique. PosSaleBooking links the sale to Booking ids created for admission lines.

TillSession and TillMovement. Session statuses open, counting, closed, closed_no_count, void. Movements open_float, cash_in, cash_out, sale_cash, refund_cash, tip, drop, pickup, other. Fields for opening float, expected cash, counted cash, variance, notes, openedById, closedById, closedAt, reconciledAt, editedAfterCloseAt, editReason. One open session per device.

GuestTab and GuestTabLine. Status open, authorized, settled, voided, split_child. tableLabel, preauthPaymentIntentId optional, parentTabId optional, saleId when settled.

CashlessAccount: codeHash, last4, guestProfileId optional, balance, status active disabled or void, issuedSaleId. Internal stored value only.

ParkWallet and ParkWalletTxn. Wallet is per org, location, and guestProfile, with balance and status. Transactions are issue, topup, redeem, refund, adjust, with amount, saleId optional, and a unique reference. This is not the shop Wallet model.

PosWastage: productId, qty, reason, recordedById, managerOverrideId optional.

PosTipAllocation: saleId, userId of a staff user in the same org, amount. The allocations for a sale must sum to the sale tipAmount.

KitchenTicket: saleId, station, items Json, status queued sent accepted fulfilled or void. Rows only. No kitchen screen.

PosOfflineMutation: deviceId, clientMutationId unique per device, payload Json, status queued syncing applied conflict failed or discarded, appliedSaleId, error, syncedAt.

PosDrawerEvent: deviceId, saleId optional, requestedById, result kicked or not, reason.

Manager PIN lives on the staff Membership row: pinHash, pinSetAt, failedAttempts, lockedUntil. Never store the PIN in plaintext. Hash with bcrypt. Optional org override hash stays on PosSettings.

Guest ban uses the existing GuestProfile.bannedAt and bannedReason. When staff ban or unban, also append a GuestBan history row with guestProfileId, reason, createdById, active. The live flag remains bannedAt. Do not create a second guest table.

Waiver search reads the existing WaiverRecord through evaluateGuestWaivers and evaluateBookingWaivers. Do not add a stub status enum that fights the waiver module.

4. Permissions. Add these bits to the P object, PERMISSION_CATALOG, preset arrays, API_PERMISSIONS, and ADMIN_ROUTE_PERMISSIONS in src/lib/auth/permissions.ts, and document them in the file header inventory the same way other modules are documented. Bits: pos:sell, pos:read, pos:refund, pos:void, pos:discount, pos:cash, pos:till_open, pos:till_close, pos:till_no_count, pos:till_edit, pos:wastage, pos:admin, pos:manager_override, pos:checkin, pos:tabs, pos:guests_write, pos:charge_stored. Keep the existing bookings and memberships permission names. Do not add a second bookings vocabulary. Do not add a new MembershipRolePreset enum value. Map the new bits onto the existing presets: platform_admin receives all of them, ops_manager receives sell read refund void discount cash till open close no-count edit wastage admin manager override check-in tabs guests write and charge stored, finance receives read refund till close and till edit, catalog_editor receives none of the sell bits. Ship one documented RoleTemplate seed named POS cashier whose bits are sell, read, cash, check-in, tabs, guests write, and discount. The Users permission matrix must show the new catalog entries because it already reads PERMISSION_CATALOG.

5. Admin routes and shells. Register every path below in ADMIN_ROUTE_PERMISSIONS and src/lib/adminNav.ts under a Sell section in the existing operations or bookings group. Unknown admin paths stay fail closed. Demo allowed paths in src/lib/demoPlanLock.ts stay exactly the dashboard, company profile, profile, and Billing. Do not add /admin/pos to the demo allow list. Page files follow the existing pattern: a thin page under src/app/(admin)/admin/pos and the screen component under src/components/Protected/admin/pages/pos. Use the existing admin layout, gold #D4AF37, and stone colors. Do not copy a tailor bottom nav. Do not put POS on /profile or /tailor.

Pages in this step, all backed by real APIs: /admin/pos/admin for settings, devices, menus, and products. /admin/pos/sales may be a read-only list of PosSale rows. The terminal home /admin/pos may render a short notice that the sell pad ships in Step 2, plus a link to admin setup. It must not be a dead route. Check-in, tills, and tabs screens are Step 2, but their route permissions can be registered now so Step 2 does not invent a second map.

6. Admin and staff APIs. Every handler uses requirePermissionFresh or requireAnyPermissionFresh, requireActorOrgId, assertPosEnabled, connectDB, and the venue scope checks. Register each verb and path in API_PERMISSIONS. Typed clients go in src/services/pos.ts. Reject client org fields the same way memberships routes do.

GET and PUT /api/admin/pos/settings with locationId. GET and POST /api/admin/pos/devices. POST enforces posTerminals. GET PATCH and archive on /api/admin/pos/devices/[id]. GET and POST /api/admin/pos/menus and nested items and categories. GET POST and PATCH /api/admin/pos/products including modifiers and package links. POST /api/admin/pos/products/[id]/suspend. GET and POST /api/admin/pos/discount-codes. POST /api/admin/pos/manager-pin for the signed-in staff member to set a PIN. POST /api/pos/manager-pin/verify. Rate-limit verify with src/lib/rateLimit.ts. Never log the PIN. Never return pinHash. GET and POST /api/admin/pos/guests and GET /api/pos/guests/search on name, email, and phone using the existing GuestProfile indexes. POST /api/pos/guests requires pos:guests_write. GET /api/pos/catalog with locationId and deviceId returns the device menu, sellable PosProduct rows that are not archived and not suspended, and published AdmissionProduct rows for that venue from the ticketing catalog. GET /api/pos/availability returns session and resource remaining from the booking engine for that venue. GET /api/pos/waivers/search uses evaluateGuestWaivers and returns an empty list when nothing matches. It must not 404.

Sale APIs, all idempotent on Idempotency-Key or body.idempotencyKey unique per org: POST /api/pos/carts. GET and PATCH /api/pos/carts/[id]. POST /api/pos/carts/[id]/park. POST /api/pos/carts/[id]/checkout. GET /api/pos/sales and GET /api/pos/sales/[id]. POST /api/pos/sales/[id]/void. POST /api/pos/sales/[id]/refunds. POST /api/pos/sales/[id]/payments. POST /api/pos/sales/[id]/payment-link. POST /api/pos/sales/[id]/confirm-card. GET /api/pos/sales/[id]/card-secrets. POST /api/pos/discounts/preview. GET /api/pos/gift-cards/balance. POST /api/pos/gift-cards/issue. POST /api/pos/gift-cards/redeem. GET /api/pos/cashless/balance. POST /api/pos/cashless/issue and top-up. GET /api/pos/wallets/balance. POST /api/pos/wallets/issue, top-up, and redeem. POST /api/pos/wastage. GET /api/pos/memberships/lookup may delegate to the existing POST /api/pos/memberships verify action. Keep that existing route. Add POST /api/pos/bookings/[id]/reschedule and POST /api/pos/bookings/[id]/adjust-items that call the existing booking engine reschedule and line replace functions, with past-lock from BookingSettings. Add POST /api/pos/check-in/redeem for ticket credentials and a membership redeem that calls posRedeemMembership. Add POST /api/pos/credentials/custom-ids that calls assignCustomTicketIds. Add tab APIs POST /api/pos/tabs, POST /api/pos/tabs/[id]/lines, POST /api/pos/tabs/[id]/split marked as beta in the JSON, POST /api/pos/tabs/[id]/preauth, and POST /api/pos/tabs/[id]/settle. Add till APIs POST /api/pos/tills/open, POST /api/pos/tills/[id]/movements, POST /api/pos/tills/[id]/close, POST /api/pos/tills/[id]/close-no-count, POST /api/pos/tills/[id]/edit, GET /api/pos/tills. Add POST /api/pos/offline/sync and POST /api/pos/devices/[id]/drawer-kick. Add POST /api/pos/terminal/connection-token. Add POST /api/pos/sales/[id]/receipt for the email payload Step 2 will call, using src/lib/sendReceipts.ts and CompanyProfile. Add tip allocation on checkout when tipAmount is greater than zero.

7. Sale engine in src/lib/pos/saleEngine.ts. One engine opens a cart, adds updates and removes lines, parks a cart, resumes it, and abandons it. Parking an admission line creates or extends a BookingHold. Hold TTL comes from BookingSettings.holdTtlMinutes or 15 minutes. Abandon and expiry release holds through src/lib/ticketing/holds.ts. Quote uses src/lib/ticketing/tax.ts and the org TaxSettings unless the line is tax exempt. Checkout runs in one database transaction. It writes the PosSale, decrements PosProduct.onHand when trackInventory is true, rejects suspendSales, validates modifier min and max, explodes package links, writes gift cashless and park-wallet ledger rows, calls posSellMembership or the matching adapter for membership lines, confirms or holds bookings, writes payments, writes a KitchenTicket for food and beverage lines, and issues ticket credentials only through the booking engine. Void requires pos:void and the manager PIN when settings say so. Refund requires pos:refund and the PIN when settings say so. Refund restores unused ticket capacity through the existing refund and capacity helpers. Refund can return value to the original tender or to a gift card ledger. A discount code applies as sale lines. If settings or the code require a manager PIN, the same request must include the PIN in a header or body field that is hashed and compared and then discarded. Do not persist the PIN on the sale.

Product behavior that must all work through this engine. Admission and party package proxies call the booking engine with channel pos. One cart may hold several sessions. Capacity remaining changes inside the transaction. Overbook requires the existing bookings:overbook permission plus pos:manager_override. Open price requires a cashier amount greater than zero. Gift issue returns the code once. Redeem cannot exceed the balance. Concurrent redeem uses the existing conditional balance update so the balance cannot go negative. Membership sell, upgrade, downgrade, and renew go through posAdapter with source pos and an idempotency key. Recurring billing creates a Stripe subscription only when STRIPE_SECRET_KEY is set. Otherwise record pending and the amount collected at the till. Do not invent recurring invoices. Fixed plans set endsAt from the plan. Upgrade and downgrade may add a remaining-value credit as a discount line. Document the formula next to the function. Cashless and park wallet are internal ledgers. A banned guest, bannedAt set, blocks checkout unless pos:manager_override and a valid PIN are present, and that override is written to the activity log. Unpaid admissions are allowed only when allowUnpaidBookings is true. They stay pending_payment with amountDue greater than zero, and credentials must not become redeemable while paidRequiredForRedeem is true.

Payments. Cash requires pos:cash. If cashRequiresOpenTill is true and the device has no open TillSession, return 400 and do not record the tender. A successful cash tender writes a sale_cash till movement on that open session. Card creates a Stripe PaymentIntent with metadata type pos_sale, posSaleId, and the sale public id, returns client_secret for in-browser Elements confirm (Terminal reader collect not wired), and settles via webhook or POST confirm-card under a row lock. Do not use the shop checkout session path. Stored card currently uses the same Elements PaymentIntent path and requires pos:charge_stored; vaulted GuestProfile.stripeCustomerId charge is not wired yet. Payment link creates a Stripe Checkout Session (`cs:…` placeholder until the PI attaches) and leaves the sale unpaid. Email uses the existing mailer. Skip SMS when no provider is configured, the same way ticketing SMS does. Split tenders are several PosSalePayment rows until amountDue is zero. Apple Pay and Google Pay ride Stripe automatic payment methods when Stripe is configured. If Stripe is not configured, card and payment link return a clear configuration error and do not pretend success. Extend src/app/api/webhooks/stripe/route.ts so metadata type pos_sale, pos_tab_preauth, and pos_membership_subscription settle or fail the POS records. Verify the Stripe signature. Make the handler idempotent so a replay cannot double-complete a sale. Do not settle a shop Order from a POS event. Do not treat a venue_booking event as a POS sale. A POS membership subscription event must call the existing guest membership webhook helper in src/lib/memberships/webhookGuest.ts rather than a new billing implementation.

Tills. Open requires pos:till_open and an opening float. One open session per device. Cash in and cash out record a reason and an amount. Expected cash is the float plus cash sales minus cash refunds plus cash in minus cash out. Close with a count requires pos:till_close and stores counted cash and variance. Close without a count requires pos:till_no_count. Edit after close requires pos:till_edit, an editReason, and an activity row. Notes exist on open and close. If showExpectedTillTotals is false, cashier read APIs omit the expected figure. Finance and pos:till_edit can still read it.

Drawer kick writes a PosDrawerEvent. If the device has no print agent URL, respond 200 with kicked false and reason NO_DRAWER_AGENT. Do not claim the drawer opened.

Tips. Checkout accepts a tip amount. PosTipAllocation rows for staff in the same org must sum to tipAmount. A mismatch is 400.

Tabs. Open, add lines, split into child tabs, and settle through the same sale engine. Preauth is a Stripe PaymentIntent captured on settle. If Stripe cannot authorize, return the Stripe error. Mark split and preauth responses with beta true.

Check-in API. Redeem an unused paid TicketCredential by code or customTicketId. Set status redeemed and redeemedAt through src/lib/ticketing/credentials.ts. Add the redeem function there if it does not exist. A second redeem returns 400. Unpaid bookings and pending_payment credentials return 403. Past the session end plus lateRedemptionGraceMinutes returns 403 unless allowPastDateRedemption or a manager override is present. Membership redeem calls posRedeemMembership. Waiver search returns the real waiver status for the guest or booking. Do not build the signing form.

Offline sync API. Accept clientMutationId. Apply cash plus already priced merchandise, food, beverage, and open price only. Admission and capacity lines that cannot be satisfied become status conflict and do not decrement session remaining. Replaying the same clientMutationId returns the original result.

Wastage decrements onHand without a sale and requires the PIN when settings say so.

Receipt data on the sale includes lines, tenders, publicId, and credential codes so Step 2 can email and reprint. The receipt email function may be called from the API in this step.

Activity log on sale complete, void, refund, discount override, banned-guest override, till close, and wastage, using src/lib/audit/activityLog.ts.

Export. src/lib/companyExport.ts adds counts for PosDevice, PosProduct, PosSale, TillSession, and gift-card liability totals. Include gift last4 only. Omit pin hashes, code hashes, raw codes, and Stripe ids.

8. Tests. Add scripts/smoke-pos-step1.mts and package.json script smoke:pos:step1, following the style of scripts/smoke-memberships-phase1.mts and scripts/smoke-ticketing-phase1.mts. The script must assert all of the following and fail on the first real miss after printing which case failed. Storefront staff receive 403 on POS. Demo receives 403. Starter entitled for ticketing receives 403 on POS and on channel pos booking create. Growth or Enterprise entitled receives 200 on settings and device list. Cross-tenant device, product, cart, and gift redeem receive 403. Device create over the cap receives 403. Creating a PosProduct does not insert a shop Product. Shop Order count is unchanged after a POS checkout. A mixed cart of merchandise plus open price plus gift issue plus cash completes, inventory falls, and the gift ledger has an issue row. An admission hold then checkout confirms and session remaining falls. A second checkout of the last seat does not oversell. Several sessions can sit on one sale. Split cash plus a mocked card tender reaches amountDue zero. Gift redeem above balance returns 400 and the balance stays unchanged. A discount without a PIN returns 403 when the setting requires it, and the same discount with a valid PIN returns 200. The PIN is not present in the sale row or the log line. An unpaid booking sale has amountDue greater than zero and redeem returns 403. A paid credential redeems once and the second redeem returns 400. Membership sell writes a GuestMembership through the adapter and does not create a staff Membership. A suspended product cannot be added. Wastage decrements onHand. Cash without an open till returns 400 when the setting requires a till. Opening a till, selling cash, and closing with a count stores a variance. Close without the no-count permission returns 403. A webhook replay of pos_sale does not double-complete. Fashion Wallet balance is unchanged by a park wallet top-up. /signup still returns 410 or a redirect. Manager PIN hash is absent from GET settings and GET devices.

Run the smoke. Fix every failure and run the failed case again. Also run the existing ticketing, memberships, and waivers smokes that touch booking confirm, gift cards, and the memberships POS adapter if those files changed. Fix regressions. If a browser is available, open /admin/pos/admin as an entitled Growth user and save a device, a product, and a setting, then confirm a Demo user cannot open that page. Do not start Step 2.
```

## Step 1 follow-up

```
Audit Step 1 of POS only. Do not build the cashier sell pad, the check-in camera page, the till count page, or the offline banner. Do not trust the previous completion notes. Scan the code and the database schema. Fix every miss, then retest that miss. When you finish, write a result the operator can read. For each numbered item below, write one sentence that says PASS or FAIL, the file that proves it, and what you fixed if it had failed. Do not use a table. A FAIL that you fixed becomes PASS only after you rerun the check. If any item is still FAIL, say Step 1 is not complete and do not claim otherwise.

1. assertPosEnabled wraps assertModuleEnabled for pos and does not copy the storefront owner bypass. It runs on every new POS route and on POST /api/pos/bookings, the booking id route, the pos-notes route, and POST /api/pos/memberships. bookingEngine also rejects channel pos when POS is not enabled. Starter, Demo, storefront, pending, suspended, and unpaid receive 403. An entitled Growth or Enterprise org receives 200 on a catalog read.

2. posTerminals is a real PlanLimits and PlanResource meter. Caps are demo 0, starter 0, growth 5, enterprise unlimited. Device create over the cap returns 403. Archived devices do not count. ticketsPerMonth was not replaced.

3. The migration exists and Prisma client includes PosSettings, PosDevice, PosMenu, PosMenuCategory, PosMenuItem, PosProduct, PosModifierGroup, PosModifier, PosProductLink, PosDiscountCode, PosCart, PosCartLine, PosSale, PosSaleLine, PosSalePayment, PosSaleRefund, PosSaleBooking, TillSession, TillMovement, GuestTab, GuestTabLine, CashlessAccount, ParkWallet, ParkWalletTxn, PosWastage, PosTipAllocation, KitchenTicket, PosOfflineMutation, PosDrawerEvent, GiftCardLedger, and GuestBan history. GiftCard was extended and the booking refund issuer still works. GuestProfile, MembershipPlan, GuestMembership, Booking, TicketCredential, WaiverRecord, shop Product, Cart, Order, and shop Wallet were not duplicated.

4. Guest membership sell, renew, upgrade, downgrade, verify, and redeem from POS go through src/lib/memberships/posAdapter.ts. Admissions go through bookingEngine with channel pos, one PaymentIntent per card tender, and ticketsPerMonth still applied on confirm. Holds park and release. Unpaid admissions are not redeemable when paidRequiredForRedeem is true.

5. Permissions exist in P, PERMISSION_CATALOG, presets, API_PERMISSIONS, and ADMIN_ROUTE_PERMISSIONS. platform_admin, ops_manager, and finance match the Step 1 map. catalog_editor cannot sell. No new MembershipRolePreset value was added. A POS cashier role template seed exists. Demo allow list does not include /admin/pos. Nav points at /admin/pos and /admin/pos/admin. Client orgId is ignored. Park scope and actorLocationScope filter lists and block cross-park writes.

6. Settings, devices, menus, products, modifiers, packages, suspend, discount codes, guests, manager PIN set and verify, catalog, availability, and waiver search all respond. PIN verify is rate-limited. pinHash and raw gift codes are absent from GET payloads and from logs. Zip flags exist on PosSettings and postalCode exists on GuestProfile and PosSale.

7. The sale engine completes a mixed cart, split tender, gift issue and redeem, cashless, park wallet, membership, open price, modifiers, packages, multi-session booking, void, refund, wastage, kitchen ticket row, tip allocations that must sum, tabs including beta split and preauth, till open movement close variance no-count and edit, drawer honesty with NO_DRAWER_AGENT, and offline sync that conflicts admissions instead of overselling. Cash without an open till returns 400 when required. Gift balance cannot go negative. Idempotency replay does not double-write.

8. Stripe webhook handles pos_sale, pos_tab_preauth, and pos_membership_subscription once, with signature verification. Shop Order is not settled by those events. venue_booking handling still works. Membership subscription events use the existing guest webhook helper.

9. companyExport includes POS counts and gift liability and omits hashes, raw codes, and Stripe ids. Shop checkout still creates shop orders. /signup is still closed.

10. yarn smoke:pos:step1 is green. Quote the command and the last success line. If you changed booking confirm, gift cards, or the membership adapter, the related existing smokes are green too.

Step 1 is complete only when every item is PASS. Do not start Step 2 from this audit.
```

---

## Step 2 prompt

```
You are implementing Step 2 only of POS (Point of Sale). This is the last step. It turns the Step 1 engine into a staff terminal and proves the whole feature against the rest of the app. Do not add a third step. Do not invent Intercard, a kitchen display screen, a self-service kiosk, public online booking, waiver signing, cash recyclers, OTAs, dynamic pricing, or a BOGO engine.

Before you add screens, verify Step 1. Run yarn smoke:pos:step1. Read src/lib/pos, src/app/api/pos, src/app/api/admin/pos, prisma POS models, and src/services/pos.ts. If any Step 1 promise is missing, partial, or failing, fix it and rerun the failed check before you build UI. Do not assume the previous chat finished Step 1.

Standing rules stay in force. assertPosEnabled on every POS route. No storefront POS. No Demo POS. No Starter POS. No client orgId. Park scope through actorLocationScope and parkAdminScope. Shop Product, Cart, Order, and Wallet stay untouched. Guest memberships stay on posAdapter. Admissions stay on bookingEngine channel pos. One card PaymentIntent per tender. Staff Membership is not a guest membership. Guest ban is GuestProfile.bannedAt. Waivers stay on evaluateGuestWaivers and evaluateBookingWaivers. UI uses the existing admin layout and gold #D4AF37. The terminal may use a focused full-height layout that hides the bulky catalog sidebar, and it must keep the same brand tokens and a way back to admin. Customer /profile never gets operator POS. Tailor /tailor never gets POS.

Build the terminal in src/components/Protected/admin/pages/pos and thin pages under src/app/(admin)/admin/pos. Wire every control to the Step 1 APIs in src/services/pos.ts. A button that does not call an API is a bug. Empty, loading, error, and entitlement-locked states are required on every screen.

1. Terminal home at /admin/pos. The cashier picks a venue they are allowed to use and a PosDevice that belongs to that venue. Persist the device id in localStorage. Show sections SELL, CHECK IN, TABS, CAPACITY, and GUEST. SELL loads the device menu from GET /api/pos/catalog. Search SKUs. Open-price dialog. Modifier dialog that enforces min and max. Package and add-on lines. After an admission is added, show the linked add-ons as a simple suggestion list from PosProductLink or AdmissionAddOnLink. Session picker uses GET /api/pos/availability and can add more than one session to the same cart. Park and resume carts. Unpaid booking choice when settings allow it. Discount code. Tip prompt using tipSuggestedPercents when tipPromptEnabled. Split pay pad for cash, card, gift card, park wallet, and cashless. Stored card and payment link actions. Manager PIN modal that posts to the verify API and does not put the PIN in the query string. Guest search and create. If captureGuestPostcode is on, show postal code. If postcodeRequired is on, checkout stays disabled until it is filled. If requireGuestOnSale is on, checkout stays disabled until a guest is attached. Banned guest shows the approval prompt and will not sell without an override. Show till status for the device. If no till is open, cash pay explains that the till must be opened.

2. Check-in at /admin/pos/check-in and the same flow inside the terminal CHECK IN section. Accept keyboard wedge input always. Use the camera for QR or barcode when the browser can. Use Web NFC only when the browser exposes it. If NFC is missing, show the sentence NFC is not supported on this browser, use the camera or the keyboard. Do not simulate a successful NFC tap. Redeem through POST /api/pos/check-in/redeem. Show success, already redeemed, unpaid, and past-date errors from the API. Membership redeem shows the member, the photo from GuestMembership.photoUrl or GuestProfile.photoUrl, and asks the cashier to confirm the photo before redeem. Group or family quantity uses the entitlements already on the membership. Waiver panel calls the waiver search API and shows missing, signed, or expired using the words the waiver module already uses. Do not open a signing form. Offer a link to the existing waiver desk if the guest must sign. Custom ticket ids and custom membership ids can be looked up and, with permission, saved through the custom-id API. Membership card print uses window.print with the guest name, custom membership id, and a QR of that id. Past-date and banned-guest rules stay on the server. The UI only collects the manager PIN when the API asks for it.

3. Capacity at /admin/pos/capacity. Show today’s sessions and resources for the selected venue, remaining counts, and closed flags, from the availability API. Reschedule posts to the Step 1 reschedule API. Refresh remaining after a reschedule. Do not let the UI offer a full session.

4. Tabs at /admin/pos/tabs. Open a tab, add items, and settle with the same pay pad as SELL. Split is visible only as a beta control and the API response beta flag is shown in the UI. Card preauth is beta. If Stripe is not configured, say so and do not show a fake authorization code.

5. Receipts. After a completed sale, offer email receipt and reprint. Email goes through the Step 1 receipt API and includes the sale publicId QR and ticket credential codes. Reprint uses the sale read API and window.print. Send payment link uses the payment-link API and shows the unpaid state until the webhook completes the sale.

6. Refund, void, reschedule, and adjust-items from the sale detail at /admin/pos/sales and /admin/pos/sales/[id]. PIN modal when settings require it. After a refund of unused tickets, the capacity numbers on the capacity screen match the engine.

7. Tills at /admin/pos/tills. Open with a float, cash in, cash out, notes, expected total when the setting allows the cashier to see it, close with a count and a variance, close without a count when the user has that permission, and edit a reconciled session when the user has pos:till_edit. Hide expected cash from cashiers when showExpectedTillTotals is false. A manager with till edit still sees it.

8. Offline. When PosSettings.offlineEnabled is true, the terminal detects navigator.onLine and shows a banner for online, offline, syncing, and conflict. While offline, the client queues cash sales of merchandise, food, beverage, and open price in local storage and posts them to /api/pos/offline/sync with a clientMutationId when the browser is back. Admissions, memberships, gift issue, and anything that needs live capacity stay disabled offline with a sentence that says they need a connection. Conflicts from the server stay on screen until the cashier retries or discards. Register a small service worker only if the app already has one you can extend. If it does not, the local queue plus the sync API is enough. Do not pretend admissions sold offline.

9. Admin setup that Step 1 started must be finishable by a pos:admin user at /admin/pos/admin. Settings include zip capture, postcode required, guest required, open price, parked carts, unpaid bookings, paid redeem rule, receipt defaults, expected till visibility, tip percents, PIN policies, offline, cash requires till, late redemption grace, past-date redemption, and banned guest prompt. Devices, menus, products, modifiers, packages, suspend, discount codes, and the wastage log are on this screen. Device create shows the plan cap error from the API.

10. Hardware honesty. Stripe Terminal reader collect is not wired yet (`POST /api/pos/terminal/connection-token` exists for future use). Card checkout creates a PaymentIntent and returns `client_secret`; the sell pad / sale detail / tabs open Stripe Elements to confirm in-browser, or the cashier uses payment link / cash. Drawer kick shows the API reason when the drawer did not open. Do not animate a drawer opening on NO_DRAWER_AGENT.

11. Control plane sync. Confirm these files agree with the live POS module and edit them so they tell the truth. src/lib/subscriptionPlans.ts SHIPPED_MODULE_HINT_IDS includes pos. Growth and Enterprise feature copy names the live terminal and still says the check-in scanner product and the ticket-purchase kiosk are separate. src/lib/hqOverview.ts no longer says POS ships later. It may show real device and sale counts for the selected park and must not invent revenue the sale table does not have. src/lib/companyExport.ts already gained POS counts in Step 1. Confirm a location-scoped export or HQ list filters by actorLocationScope. README module entitlement contract lists pos as enforced for Growth and Enterprise. docs/saas-module-extension.md says the POS terminal is live and still says the check-in scanner and the ticket-purchase kiosk are not. .cursor/rules/saas-venue-platform.mdc no longer says the POS terminal is unshipped. It still says the check-in scanner and the ticket-purchase kiosk are not shipped. Demo lock, plan limits, and enterprise HQ docs mention the posTerminals meter in a sentence if they list other meters. docs/pos-env.md records STRIPE_SECRET_KEY, the optional Stripe Terminal connection token secret if you added one, NOTIFICATION_EMAIL settings the mailer already uses, optional per-device print agent URL, and that BOOKING SMS stays on the existing ticketing provider. Rate limits stay on PIN verify, payment link, refund, and offline sync.

12. Proof. Add scripts/smoke-pos-step2.mts and package.json scripts smoke:pos:step2 and smoke:pos:all. smoke:pos:all runs step 1 then step 2. Step 2 smoke covers the cases Step 1 might not have driven from the UI routes. Cross-tenant deny on devices, sales, tills, guests, and gift redeem. Demo, storefront, Starter, and unpaid deny. Last seat cannot be sold twice. A hold that has expired cannot check out. Discount, refund, and void without a PIN fail when required. Split cash, card, and gift. Gift issue, redeem, balance, and refund onto a gift card. Membership sell plus upgrade through the adapter. Cashless and park wallet top-up and redeem, with shop Wallet unchanged. Unpaid booking cannot redeem. Check-in double redeem fails. Past-date redemption obeys the grace setting. Banned guest without override fails. Tab settle works and a beta split does not corrupt the parent. Cash requires a till and the variance is stored. Close without count checks the permission. Offline merchandise cash sync is idempotent and an admission payload becomes conflict. Payment link webhook settles once. Wastage and suspend behave. Postcode required blocks checkout in the API when the flag is on. ticketsPerMonth still applies when POS confirms a booking. HQ or park scope filters a sale list. Export omits hashes, PINs, and raw codes. Shop checkout still works. Fashion Product rows do not appear in the POS catalog. Device cap holds. Tip allocations that do not sum are rejected. A food line creates a KitchenTicket and no kitchen page exists. Manager PIN verify locks out or rate-limits a burst of bad PINs. /signup stays closed.

If browser tools are available, use them as a cashier would. Sign in as an entitled Growth or Enterprise user, open /admin/pos/admin, save settings and a product, open /admin/pos, select the venue and device, sell a merchandise item for cash with the till open, email or reprint the receipt, redeem a paid test credential on check-in, open the capacity screen, and open a tab and settle it. Then open the same POS url as a Demo user and confirm the lock. Check a mobile-width viewport on the sell pad so the pay actions remain reachable. Fix anything that fails and walk that path again.

When Step 2 is done, list every file you changed, say smoke:pos:all is green with the success line, and list the honest non-goals in sentences: public booking wizard was not rebuilt, waiver signing was not rebuilt, Intercard was not added, kitchen display UI was not added, the ticket-purchase kiosk was not added, the separate check-in scanner product was not added, cash recyclers were not added, OTAs were not added, dynamic pricing was not added, and the BOGO engine was not added. POS station check-in on /admin/pos/check-in is in scope and must be real.
```

## Step 2 follow-up

```
Final audit of POS after Step 2. Do not trust the completion notes. Scan the code, the schema, the nav, the permissions, the webhook, the export, and the smokes. Fix every miss, retest that miss, and then write a result the operator can read. For each numbered item, write one sentence that says PASS or FAIL, the file or route that proves it, and the fix if you had to make one. Do not use a table. A fixed item is PASS only after the check is green. End with one sentence: POS is complete, or POS is not complete, followed by the FAIL items still open.

Walk this path in the audit, in order. An entitled Growth or Enterprise company opens a venue, registers a device under the cap, builds a menu, creates a guest, sells a mixed cart of an admission session, a food item with a modifier, an open price, a gift card issue, and a membership, applies a discount with a manager PIN, splits tender, receives a receipt with a QR, reprints it, sends a payment link, refunds with a PIN, reschedules from the capacity screen, redeems the paid ticket on check-in, redeems the membership with the photo visible, searches the waiver, hits the banned-guest prompt, obeys the late redemption rule, prints a membership card, settles a tab, syncs an offline merchandise cash sale, opens a till, records cash in and cash out, closes with a variance, and exports without secrets. Then confirm Demo, Starter, and the storefront are denied, the shop Order and shop Wallet and shop Product tables did not absorb the POS sale, and /signup is still closed.

1. Step 1 is still true. yarn smoke:pos:step1 is green. Quote the success line. Entitlement, posTerminals, schema, adapter, booking channel, permissions, and webhook idempotency still hold.

2. /admin/pos sell pad calls the real cart, catalog, availability, discount, guest, PIN, and payment APIs. There is no placeholder button. Postcode and guest-required settings are enforced in the UI and the API. Multi-session booking and parked carts call the engine.

3. /admin/pos/check-in and the in-terminal check-in redeem paid credentials once, reject unpaid and double redeem, show membership photo confirmation, search waivers without a signing form, assign custom ids through the existing credential helper, and print a card. NFC is honest when the browser lacks it. Camera or keyboard wedge works.

4. Capacity shows live remaining and reschedule uses the booking engine. A full session cannot be sold from the screen.

5. Tabs settle through the sale engine. Split and preauth are marked beta. Missing Stripe is an error, not a fake auth code.

6. Email receipt, reprint, and payment link work from the sale. The QR is the sale publicId. Webhook completion of a payment link happens once and does not touch shop Order.

7. Till screens open, move cash, show or hide expected totals from the setting, close with variance, close without count only with permission, and edit with a reason. Cash sale without a till is rejected when the setting requires it. Drawer kick records NO_DRAWER_AGENT when no agent URL is set.

8. Offline queues priced merch and food for cash and refuses admissions. Replay of clientMutationId is idempotent. Conflicts remain visible.

9. Admin setup saves every PosSettings flag, devices, menus, products, modifiers, suspend, discounts, and wastage. The device cap error is visible.

10. Tips on a sale sum across PosTipAllocation. KitchenTicket rows exist for food and no kitchen display page was added. Gift codes and PINs are not stored in plaintext and are not in the export. Gift balance cannot go negative.

11. HQ park scope and park-locked seats filter POS lists and cannot write another park. companyExport, README, docs/saas-module-extension.md, src/lib/hqOverview.ts, and the venue platform rule agree that the POS terminal is live and that the check-in scanner product and the ticket-purchase kiosk are not. SHIPPED_MODULE_HINT_IDS includes pos.

12. yarn smoke:pos:all is green. Quote the command and the last success line. Shop checkout still works. Existing ticketing, memberships, and waiver smokes you touched are green. /signup is closed.

13. Honest non-goals are still absent from the UI as if they worked: Intercard, kitchen display, self-service kiosk, cash recyclers, OTAs, dynamic pricing, BOGO, a second membership ledger, a second booking schema, and public /signup.

POS is complete only when every item is PASS and smoke:pos:all is green. If a critical sale, payment, capacity, till, or tenant bug remains, say POS is not complete.
```
