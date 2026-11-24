# Company category pages — one Cursor prompt

Paste **Prompt 1** into Cursor and let it run from start to finish. After that run finishes, paste **Prompt 2**. Do not split Prompt 1 into smaller steps.

---

## Prompt 1

```
You are implementing one complete feature in this repository: company category pages, white-label public links, and embeddable booking. Do the whole feature in this single run. Do not stop after a foundation slice. Do not leave guest pages, payment, embed, security, or tests for a later step.

Before you change anything, scan this project and write down what already exists versus what you must add or connect. Read the real files. Do not invent a second booking system, a second organization model, a second Stripe account, or a second category table. Match the code style, permission checks, org stamping, and demo lock that are already here.

Start the scan with these files and follow every import they use:

prisma/schema.prisma models Organization, CompanyProfile, VenueLocation, BookingCategory, MembershipCategory, ProductCategory, AdmissionProduct, Product, MembershipPlan, Booking, BookingPayment.

src/lib/ticketing/categories.ts
src/lib/memberships/categories.ts
src/lib/categoryWrite.ts
src/lib/ticketing/publicBooking.ts
src/lib/ticketing/payments.ts
src/lib/ticketing/publicBookPaths.ts
src/lib/ticketing/loadPublicBook.ts
src/lib/ticketing/publicVenue.ts
src/lib/stripe.ts function createCheckoutSession
src/lib/publicAppBaseUrl.ts
src/lib/demoPlanLock.ts
src/lib/demoPlanAssert.ts
src/lib/moduleEntitlement.ts
src/lib/auth/permissions.ts
src/app/api/webhooks/stripe/route.ts where metadata.type is venue_booking
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
src/components/Public_C/booking/VenueBookHome.tsx
src/components/Public_C/Layout/public-layout/publiclayout.tsx
src/app/(public)/layout.tsx
src/app/(public)/book/[venueSlug]/page.tsx
src/app/layout.tsx metadata
next.config.ts security headers, especially X-Frame-Options SAMEORIGIN
scripts/smoke-ticketing-category.mts

Also search for every other reader and writer of BookingCategory, MembershipCategory, ProductCategory, createCheckoutSession, and CompanyProfile so those call sites stay in sync. Update them when they must return the new public URL, respect archive, or keep working unchanged. Register every new API in API_PERMISSIONS. If a staff page is added, register it in ADMIN_PAGES and the admin nav only if a new screen is truly required. Prefer extending the three existing category screens and the company profile screen.

What this feature must do when you are finished:

Each company operates on its own. A company is an Organization with a unique slug. Parks stay VenueLocation rows. Booking categories, menu categories, and membership categories stay three different tables. Do not merge them.

For each of those categories, the system creates one public page for that company only. The address is this app’s domain plus the company slug plus the category slug, in the form /{orgSlug}/{categorySlug}. Example shape: /skyline-play/birthday. The domain stays ours. The path is the company and the category. It must not use the existing /book/{venueSlug} path as the share link.

All products assigned to that same category appear together on that one page as a wrapping card grid. Booking pages list published AdmissionProduct rows in that BookingCategory whose park has publicBookingEnabled. If the company has several parks, each card shows the park name and checkout stays bound to that product’s locationId. Menu pages list that company’s Product rows in that ProductCategory and must not add those items to the Harewa cart, /cart, or /checkout. Membership pages list non-archived MembershipPlan rows in that MembershipCategory where hideFromOnlineSales is false, and they must not charge and must not create a second membership billing flow.

The slug is generated from the category name when the category is created. Renaming the category later must not change the slug. A staff member may change the slug only by editing the slug itself. The slug is unique per organization, not globally, so two companies may both have birthday. If two catalogs inside one company would produce the same slug, suffix -2, -3, and so on. Reject reserved top-level words so the new dynamic route cannot swallow existing app routes. The reserved list must include every real top-level path in this app, including book, admin, shop, cart, checkout, api, payment, sign, kiosk, profile, tailor, tailors, signin, signup, register-company, home, privacy, terms, join, fabrics, customize, trending-fashion, memberships, waivers, users, company-pending, forgot-password, reset-password, verify-email, check-email, success, cancel, and any other first segment you find under src/app. The storefront organization where isDefault is true does not get a public category page.

Company admins, and staff who already have permission to read that catalog, can see and copy the absolute public URL on the existing category screen. Staff who can write that catalog can set the layout and whether embed is enabled. Company profile write permission controls which company facts are public and which websites may frame the page. Ignore any orgId sent by the client. Stamp actor.orgId. Demo plan lock must keep blocking these writes the same way it blocks other company apps.

The public page shows the company trading name, the logo when the logo switch is on, and only the contact facts the company has switched on: phone, support email, website, and address. Bank name, account, routing, tax id, and billing email never have a public switch and never appear in any public response. The document title is the company and the category. These pages must not show the FECSYNC name, the marketing header, the marketing footer, the shop header, or a powered-by line.

Build the guest routes in a new route group that is not inside src/app/(public), because src/app/(public)/layout.tsx wraps children in PublicLayout and that layout adds VenueFlowHeader and VenueFlowFooter for /book. Required guest paths:

/{orgSlug}/{categorySlug}
/{orgSlug}/{categorySlug}/p/{productId}
/{orgSlug}/{categorySlug}/party/{productId}
/{orgSlug}/{categorySlug}/checkout
/{orgSlug}/{categorySlug}/payment/success
/{orgSlug}/{categorySlug}/payment/cancel

Static routes such as /book and /admin must keep winning over this dynamic segment. Resolve the organization by slug, then the active public category row by orgId plus slug. Never trust a query or body orgId on these public reads.

Opening a booking package from the grid continues on those company paths and reuses src/lib/ticketing/publicBooking.ts and src/lib/ticketing/payments.ts. Do not copy the booking engine. Capacity, holds, waivers, and entitlement checks stay where they are. Extend createCheckoutSession in src/lib/stripe.ts so this company path uses Stripe embedded checkout (ui_mode embedded) and a return_url on the company path. The existing /book flow and payment links must still receive a hosted Checkout session.url and must still redirect as they do today. Success and cancel for the company path must stay on the company path. The Stripe webhook in src/app/api/webhooks/stripe/route.ts must keep settling metadata.type venue_booking exactly as it does now, so the booking and payment show up on the existing /admin/bookings and /admin/booking-payments screens for that org. Do not add a new payments dashboard. Do not put viewToken in the category URL or the embed URL. The success handler must ignore a Stripe session whose orgId does not match the company slug in the path. Confirming the same session twice must not double-settle.

Each category also gets a unique iframe snippet the same staff can copy. The snippet loads /{orgSlug}/{categorySlug}?embed=1 inside an iframe with width 100 percent and no border, plus a script tag for /embed/category.js. When embed is disabled, ?embed=1 returns 404 and the normal link still works. embed=1 renders the same company page with overflow auto so a short frame scrolls vertically and a frame that is narrower than a card scrolls horizontally. Layout auto shows one card when the frame is narrow and a wrapping grid when the frame is wide. Layout grid always uses a grid. Layout stack always uses one column. The saved layout is read on each request, so an old snippet picks up a layout change without a new paste. /embed/category.js measures the container the company marked on their own site and sets the iframe size. A cross-origin iframe cannot read the parent DOM by itself, so the script is required for that measurement. The script must not contain secrets and must not insert a second iframe if it runs twice. Escape the slugs in the snippet. Checkout return URLs opened from the embed must keep embed=1 so success and cancel remain inside the frame. Payment still creates the same Booking and BookingPayment rows.

Framing security: next.config.ts currently sends X-Frame-Options SAMEORIGIN on every path. Company-site responses must be the only responses that can be framed, and only by origins that company saved. Store CompanyEmbedOrigin as an https origin with no path and no wildcard, and also allow the origin of CompanyProfile.website when that value is a valid https origin. Set Content-Security-Policy frame-ancestors to that list on the company-site responses. Every other route keeps SAMEORIGIN. Reject embed checkout when the request origin is not on that list. A direct visit to the company URL, with no embed, stays allowed. Do not open framing for /admin, /book, /shop, or /api.

Public availability: 404 when the org is the default storefront, Demo, pending, or suspended. 404 when the public category row is missing or inactive. 404 a booking page when ticketing is not enabled for that company. 404 a membership page when memberships are not enabled. Archiving a category sets its public page inactive. Unpublishing a product, or turning publicBookingEnabled off for a park, removes only that card. A product id from another company opened under this slug is 404. Rate-limit the public resolve and checkout endpoints the same way other public booking routes are limited. Unknown companies and inactive categories use a 404 that does not say FECSYNC.

Empty categories still have a link and show the company header plus an empty state. Missing company profile shows the organization name and the logo only if a logo exists.

Data you must add, in a Prisma migration, and wire through every create, update, and archive path:

PublicCategoryPage with orgId, kind booking or menu or membership, exactly one foreign key among bookingCategoryId, membershipCategoryId, and productCategoryId, slug, layout auto or grid or stack, embedEnabled, active. Unique on orgId plus slug. Index orgId.

CompanyProfile booleans for whether logo, phone, support email, website, and address are public. Default trading name and logo to visible. Default phone, email, website, and address to hidden. Do not add public flags for bank or tax fields.

CompanyEmbedOrigin with orgId and origin.

When you archive a category in the existing ticketing, membership, or product-category services, deactivate the matching PublicCategoryPage in the same transaction. When you create a category, create the public page in the same flow. Export and any company export that already lists categories should include the public slug and active flag if that export already lists the category, so the export stays honest. Do not invent a new export product if company export does not list that category today. Check src/lib/companyExport.ts and update it only where it already exports these categories.

Admin UI to extend, not replace:

src/components/Protected/admin/pages/ticketing/BookingCategoriesPage.tsx shows the public URL, Copy link, layout choice, embed enabled, and Copy embed.
src/components/Protected/admin/pages/memberships/MembershipCategoriesPage.tsx shows the same controls.
src/components/Protected/admin/pages/categories/CategoriesPage.tsx shows the same controls for menu categories.
src/components/Protected/admin/pages/company-profile/CompanyProfilePage.tsx shows the public-field switches and the embed origin list.

Guest UI to create under the new route group, reusing booking card behavior from VenueBookHome without importing the FECSYNC page chrome:

Company header component used by every company-site page.
Category grid page.
Booking product page and party product page.
Checkout page that mounts embedded Checkout.
Success and cancel pages.

APIs to add or extend, all registered in permissions, all org-scoped on staff routes, all slug-scoped on guest routes:

Staff read of the public URL and snippet on the existing category GET responses, or a nested staff endpoint if stuffing the list DTO would break current clients. If you extend the DTO, update every typed client in src/services that reads those categories.
Staff patch for slug, layout, and embedEnabled.
Staff company-profile patch for the new booleans and origins, on the existing company profile API. Find that route by searching CompanyProfile writes and update the validator so unknown public flags cannot enable bank fields.
Public GET for the category page payload.
Public booking checkout on the company path that calls the existing booking payment creator with the embedded return URL.

Files you should expect to create if they do not already exist after your scan:

prisma migration for the new models and company profile columns
src/lib/publicCategory/resolve.ts
src/lib/publicCategory/slug.ts
src/lib/publicCategory/snippet.ts
src/lib/publicCategory/publicDto.ts
src/app/(company-site)/layout.tsx
src/app/(company-site)/[orgSlug]/[categorySlug]/page.tsx
src/app/(company-site)/[orgSlug]/[categorySlug]/p/[productId]/page.tsx
src/app/(company-site)/[orgSlug]/[categorySlug]/party/[productId]/page.tsx
src/app/(company-site)/[orgSlug]/[categorySlug]/checkout/page.tsx
src/app/(company-site)/[orgSlug]/[categorySlug]/payment/success/page.tsx
src/app/(company-site)/[orgSlug]/[categorySlug]/payment/cancel/page.tsx
src/app/embed/category.js/route.ts or public/embed/category.js
scripts/smoke-company-category-pages.mts

If a closer existing file should own one of these jobs, extend that file instead of duplicating it, and say which file you used.

Sync rules you must not break:

/book/{venueSlug} still resolves through loadPublicBookByVenueSlug, still uses the FECSYNC public layout, and still uses hosted Checkout.
Harewa /shop, /cart, and /checkout do not gain company menu items from this feature.
Membership sell, redeem, and guest self-serve billing stay on their current APIs.
Demo companies remain locked out of admin writes and their public category URL 404s.
Stripe webhook venue_booking remains the settlement path for both hosted and embedded sessions.
Park-locked staff still only manage categories their existing permissions allow. The public page is not filtered by the staff member’s park assignment. It shows the company’s published parks.
createCheckoutSession callers other than this company path keep the hosted behavior. Search every caller and update only the company booking path.

Testing you must run before you finish:

Add scripts/smoke-company-category-pages.mts in the style of scripts/smoke-ticketing-category.mts. It must create two organizations with the same category name and assert different public paths, assert a cross-tenant product id 404s, assert a Demo org 404s, assert rename keeps the slug, assert archive deactivates the page, assert the public payload has no bank, tax, or billing email fields, assert the company checkout session is embedded, and assert a /book checkout session still has a hosted url. Run that smoke. Run scripts/smoke-ticketing-category.mts. Fix anything that fails and run the failed check again.

Also verify in the browser if the dev server is running. Create or use a birthday booking category, copy the link, open it, confirm the grid and the company header, confirm the document title does not say FECSYNC, confirm the page has no marketing header, start checkout and cancel back to the company cancel page, and confirm the booking row is visible on the company bookings screen. Load the embed snippet in one wide container and one narrow container and confirm grid versus one card, and confirm a short container scrolls.

When something in the scan shows an existing function already does part of this, connect to it. When something is missing, implement it in this same run. Do not leave a TODO, a stub page, or a hosted Checkout redirect on the company path. Do not finish while menu pages can post to the shop cart, while membership cards can charge, or while any non-company route is framable by other websites.
```

---

## Prompt 2

```
Audit the company category pages, white-label links, and embeddable booking feature that was just implemented. Do not trust the previous completion notes. Scan the repository yourself and compare the running code to every requirement below. If anything is missing, partial, wrong, disconnected, duplicated, or out of sync with existing booking, shop, membership, permissions, or Stripe code, fix it, then retest that fix and the workflow it touches. Do not add a new product area. Do not start a different feature.

Scan these areas and every file that imports them:

prisma/schema.prisma for PublicCategoryPage, CompanyEmbedOrigin, and the CompanyProfile public-field columns.
src/lib/publicCategory/
src/lib/ticketing/categories.ts
src/lib/memberships/categories.ts
src/lib/categoryWrite.ts
src/lib/ticketing/publicBooking.ts
src/lib/ticketing/payments.ts
src/lib/stripe.ts
src/app/api/webhooks/stripe/route.ts
src/lib/auth/permissions.ts
src/lib/companyExport.ts
src/components/Protected/admin/pages/ticketing/BookingCategoriesPage.tsx
src/components/Protected/admin/pages/memberships/MembershipCategoriesPage.tsx
src/components/Protected/admin/pages/categories/CategoriesPage.tsx
src/components/Protected/admin/pages/company-profile/CompanyProfilePage.tsx
src/app/(company-site)/
src/app/(public)/book/
src/components/Public_C/Layout/public-layout/publiclayout.tsx
next.config.ts and any middleware or route headers that set X-Frame-Options or frame-ancestors
scripts/smoke-company-category-pages.mts
src/services clients that read booking categories, membership categories, product categories, and company profile

Confirm all of the following are true. Fix each one that is not, then recheck it.

The three category tables are still separate. Each one can own a PublicCategoryPage for its organization. The storefront default org has none. Slug generation happens on create. Rename does not change the slug. In-org collisions get a numeric suffix. Reserved first path segments cannot be used as a company or category slug. Unique constraint is orgId plus slug.

Staff with the existing read permission for that catalog can copy the absolute URL and the embed snippet from the booking category screen, the membership category screen, and the food category screen. Write permission saves layout and embedEnabled. Company profile write saves which of logo, phone, support email, website, and address are public, and saves embed origins. Client orgId is ignored. Demo lock still rejects the writes. Bank, tax, and billing email have no public switch and are absent from every public DTO and from the staff copy payload.

Guest routes live outside the public layout. Opening /{orgSlug}/{categorySlug} does not render VenueFlowHeader, VenueFlowFooter, the shop header, or the chatbot. The document title is the company and the category and does not say FECSYNC. The page shows a wrapping card grid of only that company’s products in that category. Booking cards are published products on parks with public booking enabled, and multi-park cards show the park name. Menu cards do not call cart or shop checkout APIs. Membership cards only include plans that are not hidden from online sales, and they do not charge.

Package, party, checkout, success, and cancel routes exist under the company and category prefix and reuse the existing booking services. Company checkout creates an embedded Stripe Checkout session whose return URL is the company path. /book and payment links still create a hosted session with session.url. The webhook still settles venue_booking, a replay does not double-confirm, and the booking is visible on the existing admin bookings and booking payments screens for that org. A Stripe session whose orgId belongs to another company cannot confirm on this slug. viewToken is not in the category or embed URL.

The embed snippet is unique per category, escapes slugs, and includes /embed/category.js. embed=1 renders the company page, scrolls both directions when the frame is smaller than the content, shows one card when narrow, shows a grid when wide, and obeys a forced stack or grid layout stored on the public page. Disabling embed makes embed=1 return 404 while the direct link still works. Success and cancel inside the embed keep embed=1. The loader measures a marked container and does not create a second iframe.

Only company-site responses are framable, and only by that company’s saved https origins plus a valid https CompanyProfile.website origin. Every other route still sends X-Frame-Options SAMEORIGIN. Embed payment from an unknown origin is rejected. A normal visit to the company URL still works.

The company URL 404s for the default storefront org, Demo, pending, and suspended orgs, for an inactive public page, for ticketing disabled on a booking page, and for memberships disabled on a membership page. The 404 body does not say FECSYNC. Archiving a category deactivates the public page. Unpublishing a product or turning off public booking removes only that card. A product id from another company 404s on this slug.

Existing /book/{venueSlug} still uses the public layout and hosted checkout. Harewa shop, cart, and checkout are unchanged. Membership sell and guest billing APIs are unchanged. Permissions for the old category routes still work.

Run scripts/smoke-company-category-pages.mts and scripts/smoke-ticketing-category.mts. If the dev server is up, open one company category link in the browser and one embed fixture with a wide box and a narrow box, and click through booking cancel. Fix every failure and run that check again.

When the audit is finished, report only the requirements that failed and what you changed, then state whether the full list above now passes. If any item still fails, do not call the feature complete.
```
