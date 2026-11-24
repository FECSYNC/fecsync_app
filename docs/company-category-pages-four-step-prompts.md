# Company category pages — four Cursor prompts

Paste one step at a time. After that step finishes, paste its follow-up before you paste the next step. Do not skip a follow-up. Do not start the next step while the follow-up still reports a failure.

Step 1 builds the public identity and the admin copy controls. Step 2 builds the white-label company pages and in-page booking payment. Step 3 builds the iframe embed. Step 4 locks security, keeps the rest of the app in sync, and proves the whole feature.

---

## Step 1 prompt

```
You are implementing Step 1 only of company category pages, white-label links, and embeddable booking. Do not build the guest website, the iframe page, or Stripe embedded checkout in this step. Do not stop halfway through Step 1.

Before you change anything, scan this project and record what already exists versus what you must add. Read the real files. Do not invent a second organization model, a second category table, or a second company profile. Match the existing permission checks, org stamping, demo lock, and API registration style.

Start the scan with these files and follow every import they use:

prisma/schema.prisma models Organization, CompanyProfile, VenueLocation, BookingCategory, MembershipCategory, ProductCategory, AdmissionProduct, Product, MembershipPlan.

src/lib/ticketing/categories.ts
src/lib/memberships/categories.ts
src/lib/categoryWrite.ts
src/lib/publicAppBaseUrl.ts
src/lib/demoPlanLock.ts
src/lib/demoPlanAssert.ts
src/lib/auth/permissions.ts
src/lib/companyExport.ts
src/app/api/admin/ticketing/categories/route.ts
src/app/api/admin/ticketing/categories/[id]/route.ts
src/app/api/admin/memberships/categories/route.ts
src/app/api/admin/memberships/categories/[id]/route.ts
src/app/api/product-category/route.ts
src/app/api/product-category/[id]/route.ts
src/components/Protected/admin/pages/ticketing/BookingCategoriesPage.tsx
src/components/Protected/admin/pages/memberships/MembershipCategoriesPage.tsx
src/components/Protected/admin/pages/categories/CategoriesPage.tsx
src/components/Protected/admin/pages/company-profile/CompanyProfilePage.tsx

Search for every other create, update, and archive path for BookingCategory, MembershipCategory, and ProductCategory, and for every CompanyProfile write. Those call sites must stay in sync with the new public page row.

Implement all of the following in this step.

Add a Prisma migration. Add PublicCategoryPage with orgId, kind set to booking or menu or membership, exactly one foreign key among bookingCategoryId, membershipCategoryId, and productCategoryId, slug, layout set to auto or grid or stack, embedEnabled, and active. Unique on orgId plus slug. Index orgId. Add CompanyEmbedOrigin with orgId and origin. Add CompanyProfile booleans for whether logo, phone, support email, website, and address are public. Default trading name and logo to visible. Default phone, email, website, and address to hidden. Do not add a public flag for bank name, account, routing, tax id, or billing email.

The three category tables stay separate. A public page row points at exactly one of them. The storefront organization where isDefault is true does not get a PublicCategoryPage.

When a staff member creates a booking, menu, or membership category, generate a slug from the name once, in the same flow as the category insert. Renaming the category later must not change the slug. The slug changes only when a staff member edits the slug field itself. Uniqueness is per organization, so two companies may both use birthday. If two catalogs inside one company would produce the same slug, suffix -2, then -3. Reject reserved first path segments so a later guest route cannot swallow existing app routes. Build that reserved list from the real first segments under src/app, and it must include book, admin, shop, cart, checkout, api, payment, sign, kiosk, profile, tailor, tailors, signin, signup, register-company, home, privacy, terms, join, fabrics, customize, trending-fashion, memberships, waivers, users, company-pending, forgot-password, reset-password, verify-email, check-email, success, cancel, and embed. Archiving a category sets the matching PublicCategoryPage inactive in the same transaction. Creating the category creates the public page in the same flow.

The absolute URL is the value from publicAppBaseUrl() plus /{orgSlug}/{categorySlug}. The embed snippet is an iframe whose src is that URL with ?embed=1, with width 100 percent and no border, plus a script tag for /embed/category.js. Escape the slugs in the snippet. You do not serve the guest page or the script in this step. You only store the settings and show the copy controls.

Staff who can already read that catalog receive the URL and the snippet. Staff who can already write that catalog may save slug, layout, and embedEnabled. company_profile:write saves the public-field booleans and the origin list. Ignore client orgId. Stamp actor.orgId. Demo plan lock must reject these writes the same way it rejects other company app writes. Origins must be https origins with no path and no wildcard. Register every new or changed staff route in API_PERMISSIONS in src/lib/auth/permissions.ts. If you extend an existing category GET DTO, update every typed client under src/services that reads booking categories, membership categories, or product categories. If company export already lists these categories, include the public slug and active flag. Do not invent a new export if that category is not exported today.

Extend these screens. Do not replace them and do not add a new sidebar app.

src/components/Protected/admin/pages/ticketing/BookingCategoriesPage.tsx shows the public URL, Copy link, layout choice, embed enabled, and Copy embed.
src/components/Protected/admin/pages/memberships/MembershipCategoriesPage.tsx shows the same controls.
src/components/Protected/admin/pages/categories/CategoriesPage.tsx shows the same controls for menu categories.
src/components/Protected/admin/pages/company-profile/CompanyProfilePage.tsx shows the public-field switches and the embed origin list.

Put slug helpers in src/lib/publicCategory/slug.ts and the URL and snippet builder in src/lib/publicCategory/snippet.ts if those files do not already exist. If an existing category service should own the create and archive wiring, extend that service instead of duplicating it.

Do not add a guest route. Do not change /book, Stripe, the shop cart, or next.config.ts framing headers in this step.

Test before you finish. Cover slug stability on rename, collision suffix, reserved words, cross-tenant 403, demo lock, inactive page after archive, and absence of bank, tax, and billing email from the staff public-URL payload. Fix every failure and run the failed check again. Do not start Step 2.
```

## Step 1 follow-up

```
Audit Step 1 of company category pages only. Do not build the guest site, the embed script, or Stripe changes. Do not trust the previous completion notes. Scan the code and fix every miss, then retest that miss.

Confirm all of the following.

PublicCategoryPage exists with orgId, kind booking or menu or membership, exactly one category foreign key, slug, layout auto or grid or stack, embedEnabled, active, and a unique constraint on orgId plus slug. CompanyEmbedOrigin exists. CompanyProfile has public switches for logo, phone, support email, website, and address only. Bank, tax, and billing email have no public switch.

Booking, menu, and membership create paths generate a slug once. Rename does not change it. Reserved first path segments are rejected. In-org collisions get a numeric suffix. Two companies may share the same slug text. The storefront default org has no public category page. Archive sets the public page inactive in the same flow as the category archive.

Copy URL and copy embed appear on BookingCategoriesPage, MembershipCategoriesPage, and CategoriesPage, and they follow the existing read permission for that catalog. Layout, slug, and embedEnabled follow the existing write permission. Company profile write saves the switches and origins. Client orgId is ignored. Demo lock still blocks the writes. Origins are https, without a path or a wildcard. The snippet points at /{orgSlug}/{categorySlug}?embed=1 and /embed/category.js, and the slugs are escaped. Typed service clients and API_PERMISSIONS match the responses. companyExport includes the slug only where it already exports that category.

No guest route was added. /book, Stripe hosted checkout, the shop cart, and the global X-Frame-Options header were not changed.

Re-check slug stability, cross-tenant denial, and the private-field payload after the last fix. Step 1 is complete only when every item above passes.
```

---

## Step 2 prompt

```
You are implementing Step 2 only of company category pages, white-label links, and embeddable booking.

First verify Step 1. Read PublicCategoryPage, CompanyEmbedOrigin, the CompanyProfile public-field switches, and the three category screens. Confirm slug stability, reserved words, demo lock, archive deactivation, and that bank, tax, and billing email are not in the staff payload. If any of that is missing or wrong, fix it and retest it before you continue. Do not skip that repair.

Then scan these files and follow their imports before you write guest pages:

src/lib/ticketing/publicBooking.ts
src/lib/ticketing/payments.ts
src/lib/ticketing/publicBookPaths.ts
src/lib/ticketing/loadPublicBook.ts
src/lib/ticketing/publicVenue.ts
src/lib/stripe.ts function createCheckoutSession
src/lib/moduleEntitlement.ts
src/lib/demoPlanAssert.ts
src/app/api/webhooks/stripe/route.ts where metadata.type is venue_booking
src/components/Public_C/booking/VenueBookHome.tsx
src/components/Public_C/Layout/public-layout/publiclayout.tsx
src/app/(public)/layout.tsx
src/app/(public)/book/[venueSlug]/page.tsx
src/app/layout.tsx metadata
src/app/api/admin/bookings routes and booking payment list routes, enough to confirm a Booking row for an org already appears on /admin/bookings and /admin/booking-payments

Search every caller of createCheckoutSession. Only the new company booking path may request embedded checkout. Every existing caller, including /book and payment links, must keep receiving a hosted Checkout session.url.

Implement the guest company site in this step.

Create a route group that is not inside src/app/(public), because that layout wraps children in PublicLayout and PublicLayout renders VenueFlowHeader and VenueFlowFooter. Use src/app/(company-site)/. Required paths:

/{orgSlug}/{categorySlug}
/{orgSlug}/{categorySlug}/p/{productId}
/{orgSlug}/{categorySlug}/party/{productId}
/{orgSlug}/{categorySlug}/checkout
/{orgSlug}/{categorySlug}/payment/success
/{orgSlug}/{categorySlug}/payment/cancel

Static routes such as /book and /admin must keep winning over the dynamic segment. Resolve the organization by Organization.slug, then the active PublicCategoryPage by orgId plus slug. Never trust a query or body orgId. generateMetadata must set the document title to the company trading name and the category. These pages must not show the FECSYNC name, the marketing header, the marketing footer, the shop header, or a powered-by line.

The header used on every company-site page shows the trading name, the logo when that switch is on, and only the contact fields that are switched on: phone, support email, website, and address. If the profile row is missing, show the organization name and the logo only when a logo exists. Bank, tax, and billing email never render.

Booking kind: a wrapping card grid of published AdmissionProduct rows in that BookingCategory on parks with publicBookingEnabled. Reuse the product listing rules in src/lib/ticketing/publicBooking.ts. Do not copy the booking engine. If several parks have products in the category, each card shows the park name, and checkout stays on that product’s locationId. Cards link to /{orgSlug}/{categorySlug}/p/{productId} or /{orgSlug}/{categorySlug}/party/{productId} for party packages. Those pages and checkout reuse publicBooking.ts and payments.ts, including capacity, holds, and waiver checks.

Extend createCheckoutSession so this company path uses Stripe embedded checkout, ui_mode embedded, with return_url on the company success and cancel paths. Keep hosted Checkout for /book and payment links. Do not put viewToken in the category URL. The success page loads the booking through the existing confirm path and must ignore a Stripe session whose orgId does not match the company slug. Confirming the same session twice must not double-settle. The webhook in src/app/api/webhooks/stripe/route.ts must keep settling metadata.type venue_booking. The resulting Booking and BookingPayment must be visible on the existing /admin/bookings and /admin/booking-payments screens for that org. Do not add a new payments dashboard.

Menu kind: a wrapping card grid of that company’s Product rows in that ProductCategory. Do not call cart APIs, /cart, or /checkout. Do not add a new food payment flow.

Membership kind: a wrapping card grid of non-archived MembershipPlan rows in that MembershipCategory where hideFromOnlineSales is false. Do not charge. Do not create a second membership billing flow. Purchase stays on the existing membership screens.

404 when the slug is missing, the public page is inactive, the org is the default storefront, or the product is not in this company and category. An empty category still renders the company header and an empty state. The 404 body must not say FECSYNC. Rate-limit public resolve and checkout the same way other public booking routes are limited.

Add src/lib/publicCategory/resolve.ts and src/lib/publicCategory/publicDto.ts if they do not exist. Reuse VenueBookHome card behavior without importing the FECSYNC page chrome.

Do not implement the iframe loader, frame-ancestors, or the embed=1 layout modes in this step beyond making the company pages able to accept a later embed query. Do not weaken X-Frame-Options.

Test before you finish. Assert the booking grid contains only that company’s published products in that category, a product from another company 404s, menu page loads do not call the shop cart, membership cards do not create a payment, the company checkout session is embedded and its return URL is the company path, a /book checkout session still has a hosted url, and a settled venue_booking payment is the same Booking row the existing admin list returns for that org. Fix every failure and run it again. Do not start Step 3.
```

## Step 2 follow-up

```
Audit Step 2 of company category pages. Fix every failure, then retest it. Do not start Step 3 work except to repair Step 1 or Step 2 gaps you find.

First recheck Step 1. Slug stability, reserved words, demo lock, archive deactivation, copy controls on all three category screens, and private bank, tax, and billing email fields must still be true. Fix any regression before you judge Step 2.

Then confirm all of the following in the code and by running the relevant checks.

Guest routes live under src/app/(company-site)/ and are not wrapped by PublicLayout. VenueFlowHeader, VenueFlowFooter, the shop header, and the chatbot do not render on /{orgSlug}/{categorySlug}. The document title is the company and the category and does not say FECSYNC. These paths exist: the category page, p/[productId], party/[productId], checkout, payment/success, and payment/cancel.

The grid shows only that company’s products in that category. Booking cards are published AdmissionProducts on parks with publicBookingEnabled. Multi-park cards show the park name and checkout uses that product’s locationId. Menu cards do not call cart or shop checkout. Membership cards are non-archived plans with hideFromOnlineSales false and they cannot charge.

Company checkout uses Stripe embedded mode and returns to the company path. /book and payment links still use hosted Checkout and session.url. The webhook still settles venue_booking. A replay does not double-confirm. The booking appears for that org on the existing bookings and booking payments screens. A Stripe session for another org cannot confirm on this slug. viewToken is not in the URL.

Unknown slug, inactive page, default storefront org, and a foreign product id 404, and the 404 body does not say FECSYNC. Allowed profile fields render. Disallowed ones do not. An empty category shows the company header and an empty state.

Re-check the embedded-versus-hosted split and one cross-tenant 404 after the last fix. Step 2 is complete only when Step 1 still passes and every item above passes.
```

---

## Step 3 prompt

```
You are implementing Step 3 only of company category pages, white-label links, and embeddable booking. This step is the iframe embed.

First verify Step 2. Confirm the company routes are outside PublicLayout, company checkout uses embedded Checkout with a company return URL, /book still uses hosted Checkout, menu pages do not touch the cart, and membership cards do not charge. If any of that is missing, fix it and retest it before you add the embed. Also recheck Step 1 slug stability and the copy snippet on the three category screens. Repair those if they regressed.

Then implement the embed. Do not open framing for the whole app. Leave the global X-Frame-Options SAMEORIGIN rule in place until Step 4. This step builds the embed document and the loader. Step 4 will allow only the company’s saved origins to frame it.

?embed=1 on the company category page, package page, party page, checkout, success, and cancel renders the same company content with no software chrome and with overflow auto on the document, so a short frame scrolls vertically and a frame narrower than a card scrolls horizontally. Layout auto, stored on PublicCategoryPage, shows one card when the frame is narrow and a wrapping grid when the frame is wide. Layout grid always uses a grid. Layout stack always uses one column. The page reads the saved layout on each request, so an old snippet picks up a layout change without a new paste. If embedEnabled is false, ?embed=1 returns 404 and the direct company link still works.

Serve /embed/category.js from public/embed/category.js or from src/app/embed/category.js/route.ts. The staff snippet built in Step 1 must match this URL. The script finds the container the company marked, measures it, and sets the iframe width and height. The snippet also sets the iframe to width 100 percent and border 0 so a simple paste fills the parent. A cross-origin iframe cannot read the parent page’s DOM. The loader script is the supported way to match their div. Do not claim a bare iframe measures an unmarked div. The script contains no secrets. If it runs twice it must not insert a second iframe. Escape org and category slugs in the snippet.

Checkout return URLs opened while embed=1 must keep embed=1 so success and cancel stay inside the frame. Payment still creates the same Booking and BookingPayment rows through the Step 2 checkout path, and those rows still show on the existing company bookings and payments screens.

Update the snippet builder in src/lib/publicCategory/snippet.ts if the script path or markup needs to match what you serve.

Test before you finish. Cover a narrow width as one card, a wide width as a grid, a forced stack layout staying one column even when wide, scroll when the height is short, embed=1 returning 404 when embed is disabled, the direct link still opening, the loader not duplicating the iframe, and a payment return URL that stays on the company path with embed=1. Fix every failure and run it again. Do not start Step 4. Do not remove SAMEORIGIN from the rest of the app in this step.
```

## Step 3 follow-up

```
Audit Step 3 of the category embed. Fix every failure, then retest it. Do not add the origin allowlist in this audit except to repair a bug that already broke Step 1 or Step 2. Recheck those two steps if the embed work touched them.

Confirm all of the following.

The copied snippet is unique per category, escapes slugs, includes an iframe with width 100 percent and no border, points at /{orgSlug}/{categorySlug}?embed=1, and includes /embed/category.js. The served script measures a marked container and does not insert a second iframe when loaded twice. It contains no secrets.

embed=1 renders the company page without FECSYNC chrome. A narrow frame is one card. A wide frame is a grid. Layout stack forces one column. Layout grid forces a grid. A short frame scrolls vertically. Content wider than the frame can scroll horizontally. embedEnabled false makes embed=1 return 404 while the direct link still works. Changing layout in admin changes the next load of an already copied snippet.

Payment success and cancel inside the embed stay on the company path and keep embed=1. The booking is still a normal Booking row for that org. /book still uses hosted Checkout. X-Frame-Options was not removed from the rest of the app.

Re-check the layout breakpoints and the embed return URL after the last fix. Step 3 is complete only when those checks pass and Steps 1 and 2 still behave as their follow-ups required.
```

---

## Step 4 prompt

```
You are implementing Step 4 only of company category pages, white-label links, and embeddable booking. This step locks security, synchronizes the feature with the rest of the app, and proves the whole path. Do not add a new catalog or a new checkout.

First verify Steps 1, 2, and 3. Confirm stable slugs and copy controls, company pages outside PublicLayout, embedded checkout only on the company path, hosted checkout still on /book, menu pages off the shop cart, membership cards not charging, embed layout and scroll, and the loader script. Fix any gap and retest it before you harden.

Then scan next.config.ts, any middleware, src/lib/companyExport.ts, src/lib/auth/permissions.ts, src/lib/demoPlanLock.ts, src/lib/moduleEntitlement.ts, the Stripe webhook, and every createCheckoutSession caller again.

Implement the remaining production rules.

Company-site responses must not send X-Frame-Options SAMEORIGIN. Set Content-Security-Policy frame-ancestors on those responses only, to that company’s saved CompanyEmbedOrigin values plus the origin of CompanyProfile.website when that value is a valid https origin. Every other route, including /admin, /book, /shop, /api, and /payment, keeps SAMEORIGIN. Do this without leaving the rest of the app framable. Reject embed checkout when the request Origin or Referer is not on that list. A direct visit to the company URL, with no embed, stays allowed.

404 the company site when the org is the default storefront, Demo, pending, or suspended. 404 a booking page when ticketing is not enabled. 404 a membership page when memberships are not enabled. Archiving a category deactivates PublicCategoryPage. Unpublishing a product or turning publicBookingEnabled off removes only that card. The success handler ignores a Stripe session whose orgId does not match the slug. Embedded checkout return URLs must start with this company’s own path or they are rejected. Public DTOs and 404 bodies must not include bank, tax, billing email, or the word FECSYNC. Rate limits on public resolve and checkout stay in place.

Confirm Harewa /shop, /cart, and /checkout do not receive company menu items from this feature. Confirm membership sell, redeem, and guest billing APIs are unchanged. Confirm park-locked staff still follow their existing category permissions, while the public page lists the company’s published parks rather than the staff member’s park assignment. Confirm webhook replay does not double-settle venue_booking.

Add scripts/smoke-company-category-pages.mts in the style of scripts/smoke-ticketing-category.mts. It must cover two organizations with the same category name and different public paths, a cross-tenant product id 404, a Demo org 404, slug stability on rename, archive deactivating the page, a public payload with no bank, tax, or billing email, an embedded session on the company path, a hosted session url still present for /book, and a 404 body that does not contain FECSYNC. Run that smoke. Run scripts/smoke-ticketing-category.mts. Fix failures and run the failed check again.

If the dev server is already running, verify in the browser. Use a birthday booking category, copy the link, open it, confirm the grid, the company logo, and only the allowed details, confirm the document title is not FECSYNC, confirm there is no marketing header, start checkout, cancel to the company cancel page, and confirm the booking is visible on the company bookings screen. Load the embed snippet in a wide box and a narrow box and confirm grid versus one card, and confirm a short box scrolls.

When this step is finished, the feature must satisfy every rule from Steps 1, 2, 3, and this step together. Do not leave a TODO or a stub. Do not start a different feature.
```

## Step 4 follow-up

```
Final audit of company category pages, white-label links, and embeddable booking. Do not trust earlier completion notes. Scan the repository and trace the feature through booking, shop, memberships, permissions, company profile, and Stripe. If anything is missing, partial, wrong, duplicated, or out of sync, fix it, then retest that fix and the surrounding workflow. Do not call the feature complete while any item below still fails.

Scan prisma/schema.prisma, src/lib/publicCategory/, src/lib/ticketing/categories.ts, src/lib/memberships/categories.ts, src/lib/categoryWrite.ts, src/lib/ticketing/publicBooking.ts, src/lib/ticketing/payments.ts, src/lib/stripe.ts, src/app/api/webhooks/stripe/route.ts, src/lib/auth/permissions.ts, src/lib/companyExport.ts, the three category admin screens, CompanyProfilePage, src/app/(company-site)/, src/app/(public)/book/, PublicLayout, next.config.ts, framing headers, and scripts/smoke-company-category-pages.mts. Follow imports until you have seen every reader and writer of PublicCategoryPage, createCheckoutSession, and the new company profile flags.

Confirm Step 1 still holds. The three category tables are separate. Each can own one public page per organization. The default storefront org has none. Slugs generate on create, survive rename, suffix collisions inside one org, and reject reserved first segments. Copy link and copy embed are on the booking, membership, and food category screens. Public switches exist only for logo, phone, support email, website, and address. Bank, tax, and billing email are never public. Demo lock and cross-tenant denial still work. Archive deactivates the public page.

Confirm Step 2 still holds. Company routes are outside the public layout and show no FECSYNC chrome. The document title is the company and the category. The grid is only that company’s products in that category. Booking cards are published products on public-booking parks and show the park name when needed. Menu cards do not call the cart. Membership cards do not charge. Company checkout is embedded and returns to the company path. /book and payment links stay hosted. Webhook venue_booking settles once. The booking appears on the existing admin bookings and payments screens. A foreign org session cannot confirm on this slug. viewToken is absent from the URL.

Confirm Step 3 still holds. The snippet matches /embed/category.js and ?embed=1. Narrow is one card, wide is a grid, stack and grid overrides win, short frames scroll, disabled embed 404s the frame only, and payment return URLs inside the embed keep embed=1. The loader does not duplicate the iframe.

Confirm Step 4 holds. Only company-site responses are framable, and only by that company’s saved https origins plus a valid https website origin. Every other route still sends SAMEORIGIN. Embed payment from an unknown origin is rejected. A direct company URL still opens. Demo, pending, suspended, and the default storefront 404. Ticketing and memberships module gates 404 the matching pages. Unpublish and publicBookingEnabled false remove only the affected card. Public payloads and 404 bodies do not contain bank fields or FECSYNC. Shop, cart, membership billing, and existing category permissions still behave as they did, aside from the new copy controls.

Run scripts/smoke-company-category-pages.mts and scripts/smoke-ticketing-category.mts. If the dev server is up, open one company category link and one wide embed and one narrow embed, and cancel a checkout back to the company page.

After the last fix, recheck the item you fixed and the workflow next to it. Report any requirement that still fails. If none fail, state that the four steps pass. If any fail, do not call the feature complete.
```
