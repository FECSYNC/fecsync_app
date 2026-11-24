# FEC Operating System — Cursor Feature Catalog

> **Purpose:** Implementation-ready names + descriptions so Cursor (or any coding agent) knows exactly what to build when generating prompts.  
> **Source:** Client ROLLER-competitor brief — nothing omitted.  
> **Product north star:** One connected FEC operating system for ticketing, POS, waivers, memberships, payments, and reporting. Compete with “Everything an FEC needs. Nothing it doesn’t.” Compress ~1,000+ ROLLER inventory lines into ~60–80 customer-visible capabilities; keep complexity behind the scenes.  
> **Initial verticals:** FECs · Trampoline/Adventure Parks · Indoor Play Centers  
> **Underlying product types to support (simplify config, do not drop capability):** timed sessions, parties, passes, memberships, gift cards, stock, add-ons, packages, cashless game cards

**How to use with Cursor:** Copy one feature block into a prompt. Each block has a stable **Feature Name**, **Priority**, **Module**, and **Build description** stating what to implement.

---

## A. Core Keep Features (1–32)

### Feature 01 — Online Booking / Ticketing
- **Priority:** Critical  
- **Module:** BOOKINGS / SELL  
- **Feature Name:** `Online Booking / Ticketing`  
- **Build description:** Public and operator booking flow for venue admission products. Must support timed tickets (session-based entry), day passes, group bookings, camps/events, and sellable add-ons attached to a booking. Include online purchase, capacity-aware slot selection, and confirmation to the guest account/email/SMS pipeline.

### Feature 02 — POS (Point of Sale)
- **Priority:** Critical  
- **Module:** SELL  
- **Feature Name:** `POS`  
- **Build description:** Staff-facing point-of-sale for on-site sales. Must sell admissions, F&B, merchandise, party packages, memberships, and gift cards from one cart/checkout. Integrate with payments, discounts, till session, and guest profile attachment.

### Feature 03 — Integrated Payments
- **Priority:** Critical  
- **Module:** MONEY  
- **Feature Name:** `Integrated Payments`  
- **Build description:** Unified payment capture across online and POS. Must support card, cash, Apple Pay, Google Pay, stored cards on file, refunds, and split payments (multiple tenders / partial payments on one order). Persist payment method, status, and refund history against orders/bookings.

### Feature 04 — Party Management
- **Priority:** Critical  
- **Module:** PARTIES  
- **Feature Name:** `Party Management`  
- **Build description:** End-to-end birthday/event party operations. Must support party packages, room assignment, deposits, guest count, food orders for the party, invitations, and outstanding balances. This is the base party engine that the Party Command Center (Section D) elevates.

### Feature 05 — Digital Waivers
- **Priority:** Critical  
- **Module:** CHECK-IN / GUESTS  
- **Feature Name:** `Digital Waivers`  
- **Build description:** Digital liability waiver capture and verification. Must support online signing before visit, on-site signing, QR access to waiver forms, waiver expiration rules, minor/guardian signing, and staff verification that a guest’s waiver is valid at check-in.

### Feature 06 — Capacity Management
- **Priority:** Critical  
- **Module:** BOOKINGS  
- **Feature Name:** `Capacity Management`  
- **Build description:** Real-time inventory of bookable capacity. Must track capacity for attractions, timed sessions, rooms, lanes, and party rooms. Expose live availability to online booking, POS, and front desk so oversell is prevented unless an authorized override is used.

### Feature 07 — Check-In
- **Priority:** Critical  
- **Module:** CHECK-IN  
- **Feature Name:** `Check-In`  
- **Build description:** Arrival processing for guests. Must support QR/barcode scanning, bulk check-in for groups, membership validation at entry, and waiver-status gating (block or warn when waiver missing/expired). Update visit records and attendance reporting.

### Feature 08 — Memberships
- **Priority:** Critical  
- **Module:** GUESTS / SELL  
- **Feature Name:** `Memberships`  
- **Build description:** Full membership commerce and entitlement engine (do not oversimplify — see Section E for complete sub-capabilities). Must include recurring billing, membership perks/entitlements, family plans, and upgrade/cancellation flows. Ties into POS, check-in, CRM, and reporting.

### Feature 09 — Customer / Guest CRM
- **Priority:** Critical  
- **Module:** GUESTS  
- **Feature Name:** `Customer/Guest CRM`  
- **Build description:** Guest profile system as the hub for relationship data. Each profile must store identity, visit history, lifetime/period spend, birthdays, linked waivers, and memberships. Used by marketing segmentation, party guest lists, check-in, and owner analytics.

### Feature 10 — Gift Cards
- **Priority:** Critical  
- **Module:** SELL / MONEY  
- **Feature Name:** `Gift Cards`  
- **Build description:** Stored-value gift card product. Must support digital and physical cards; purchase online and at POS; redeem online and at POS; track remaining balance and liability.

### Feature 11 — Discounts & Promotions
- **Priority:** Critical  
- **Module:** MARKETING / SELL  
- **Feature Name:** `Discounts & Promotions`  
- **Build description:** Promotional pricing engine for online and POS. Must support promo codes, percentage discounts, fixed-dollar discounts, BOGO, and limited-time offers. Enforce eligibility rules and require manager approval when permission policy demands it.

### Feature 12 — F&B / Retail
- **Priority:** Critical  
- **Module:** SELL  
- **Feature Name:** `F&B / Retail`  
- **Build description:** Food & beverage and merchandise catalog + order flow. Must support products, modifiers (e.g. size/toppings), inventory decrement, kitchen ticket generation, and wastage logging. Feeds Kitchen Display and F&B reporting.

### Feature 13 — Cashless Arcade Integration
- **Priority:** Critical for FEC  
- **Module:** ARCADE  
- **Feature Name:** `Cashless Arcade Integration`  
- **Build description:** First-class integration with FEC cashless arcade card providers — **Intercard**, **Sacoa**, and **Amusement Connect**. Support card sales, reloads, redemption/play activity sync, and arcade reporting (see Section G). Do not bury this only under a generic Integrations settings page.

### Feature 14 — Staff Roles & Permissions
- **Priority:** Critical  
- **Module:** Admin (permissioned)  
- **Feature Name:** `Staff Roles & Permissions`  
- **Build description:** Role-based access control for venue staff. Ship simple presets: Owner, GM, Manager, Cashier/Front Desk, Party Host (and F&B preset). Keep granular permission bits underneath (see Section H). Allow Custom Role for advanced operators.

### Feature 15 — Cash / Till Management
- **Priority:** Critical  
- **Module:** MONEY  
- **Feature Name:** `Cash/Till Management`  
- **Build description:** Cash drawer / till lifecycle for POS stations. Must support open till, close till, reconciliation of expected vs counted cash, and cash variance recording (visible on Owner Dashboard).

### Feature 16 — Refund / Manager Controls
- **Priority:** Critical  
- **Module:** MONEY / SELL  
- **Feature Name:** `Refund/Manager Controls`  
- **Build description:** Privileged operational overrides protected by manager PIN (or equivalent auth). Must gate refunds, discretionary discounts, voids, and other manager overrides so front-desk staff cannot perform them without authorization.

### Feature 17 — Reporting
- **Priority:** Critical  
- **Module:** Reports (permissioned) / DASHBOARD  
- **Feature Name:** `Reporting`  
- **Build description:** Operational and financial reports for the venue. Must cover sales, attendance, parties, memberships, F&B, and labor/productivity. Prefer actionable FEC reports over obscure analytics; power the Owner Dashboard KPIs.

### Feature 18 — Owner Dashboard
- **Priority:** Critical  
- **Module:** DASHBOARD  
- **Feature Name:** `Owner Dashboard`  
- **Build description:** Mobile-first live KPI home for the venue owner (see Section F for exact metrics, ranges, and comparisons). Goal: make existing analytics useful at a glance — not collect more data for its own sake.

### Feature 19 — Self-Service Kiosk
- **Priority:** High  
- **Module:** SELL / CHECK-IN  
- **Feature Name:** `Self-Service Kiosk`  
- **Build description:** Guest-facing kiosk mode for unattended or semi-attended stations. Must allow guests to buy tickets, check in, and complete waivers without a staff POS session.

### Feature 20 — Mobile Check-In
- **Priority:** High  
- **Module:** CHECK-IN  
- **Feature Name:** `Mobile Check-In`  
- **Build description:** Staff check-in on phone/tablet. Camera or hardware scanning of QR/barcodes for tickets, memberships, and related entry credentials while roaming the floor.

### Feature 21 — Online Customer Account
- **Priority:** High  
- **Module:** GUESTS (customer-facing)  
- **Feature Name:** `Online Customer Account`  
- **Build description:** Guest self-service portal/account where customers manage bookings, passes, and memberships (including card update / self-service actions supported by the membership engine).

### Feature 22 — Upselling
- **Priority:** High  
- **Module:** SELL / BOOKINGS  
- **Feature Name:** `Upselling`  
- **Build description:** Prompted attach-rate sales during booking and POS. Suggest and sell add-ons such as socks, food, arcade credit/cards, extra time, and product upgrades.

### Feature 23 — Dynamic Pricing
- **Priority:** High  
- **Module:** BOOKINGS / SELL  
- **Feature Name:** `Dynamic Pricing`  
- **Build description:** Time-based price rules for products/sessions. Must support peak vs off-peak and weekday vs weekend pricing applied consistently online and at POS.

### Feature 24 — Automated Email / SMS
- **Priority:** High  
- **Module:** MARKETING  
- **Feature Name:** `Automated Email/SMS`  
- **Build description:** Transactional and operational messaging automation. Must send booking confirmations, visit reminders, waiver requests/links, and party balance reminders via email and SMS.

### Feature 25 — Guest Segmentation
- **Priority:** High  
- **Module:** MARKETING / GUESTS  
- **Feature Name:** `Guest Segmentation`  
- **Build description:** Audience lists derived from CRM data. Segments must include members, birthdays, lapsed customers, and frequent visitors for campaigns and targeting.

### Feature 26 — Marketing Tracking
- **Priority:** High  
- **Module:** MARKETING  
- **Feature Name:** `Marketing Tracking`  
- **Build description:** Attribution / conversion tracking hooks for paid acquisition. Integrate tracking for Meta, TikTok, and Google (pixels/events or equivalent conversion APIs as appropriate).

### Feature 27 — Guest Feedback
- **Priority:** High  
- **Module:** MARKETING / GUESTS  
- **Feature Name:** `Guest Feedback`  
- **Build description:** Post-visit or in-venue feedback collection via surveys and/or reviews, linked back to guest/visit context where possible.

### Feature 28 — Accounting Integration
- **Priority:** High  
- **Module:** MONEY  
- **Feature Name:** `Accounting Integration`  
- **Build description:** Sync financial activity to QuickBooks and/or Xero with GL mapping so venue sales, payments, and related accounts post correctly for bookkeeping. **Shipped in-product (Steps 1–2):** native GL, auto-posting, AR/AP, banking, and reports under `/admin/accounting` — external QBO/Xero sync remains a future integration layer, not a stub in v1.

### Feature 29 — Kitchen Display
- **Priority:** High  
- **Module:** SELL (F&B)  
- **Feature Name:** `Kitchen Display`  
- **Build description:** Kitchen Display System (KDS) that routes F&B orders from POS/party food to kitchen stations, showing ticket status and fulfillment progress.

### Feature 30 — Multi-Location / HQ
- **Priority:** High  
- **Module:** DASHBOARD / Admin  
- **Feature Name:** `Multi-Location/HQ`  
- **Build description:** Central control for operators with multiple venues. HQ view for growing multi-park operators: switch/compare locations, roll up key metrics, and manage shared configuration where appropriate — without becoming a generic enterprise suite in V1.

### Feature 31 — API / Webhooks
- **Priority:** High  
- **Module:** Integrations (permissioned)  
- **Feature Name:** `API/Webhooks`  
- **Build description:** Outbound/inbound integration surface for third parties: documented APIs and webhooks for bookings, guests, payments, and other core events. Enough for partners; advanced developer platform features are postponed (Section I).

### Feature 32 — AI Assistant
- **Priority:** Later  
- **Module:** DASHBOARD  
- **Feature Name:** `AI Assistant`  
- **Build description:** Owner/manager intelligence assistant (not gimmicks). Elevated later as **AI Owner Intelligence** (Section K.4): proactive insights about revenue, attach rate, and operational anomalies — not a generic chatbot bolted onto reports.

---

## B. Underlying Product Types (capability to retain)

These are not separate menu apps; they are catalog/booking building blocks. Keep the capability; simplify operator configuration.

| Feature Name | Build description |
|--------------|-------------------|
| `Timed Sessions` | Bookable time-boxed attraction/session products with capacity slots. |
| `Parties (product type)` | Party package products that reserve rooms, include guest counts, and attach food/add-ons. |
| `Passes` | Day passes and multi-use/period passes redeemable at check-in. |
| `Memberships (product type)` | Sellable membership SKUs tied to the membership engine. |
| `Gift Cards (product type)` | Stored-value SKUs (digital/physical). |
| `Stock` | Inventory-tracked retail/F&B/merchandise items. |
| `Add-ons` | Attachable extras (socks, upgrades, arcade, food) on bookings/POS carts. |
| `Packages` | Bundled sellable packages combining multiple products/services. |
| `Cashless Game Cards` | Arcade card products integrated with Intercard / Sacoa / Amusement Connect. |

---

## C. Front Desk UX + Booking Engine (keep underneath, simplify UI)

### Feature — Front Desk Primary Actions
- **Feature Name:** `Front Desk Primary Actions`  
- **Build description:** Staff home screen exposes exactly seven primary actions — no ~40-control clutter for average employees:

  1. `CHECK IN`  
  2. `SELL TICKETS`  
  3. `PARTY`  
  4. `MEMBERSHIP`  
  5. `WAIVER`  
  6. `FOOD`  
  7. `REFUND`  

  Full booking power lives underneath these entry points.

### Feature — Booking Engine (full capability retained)
- **Feature Name:** `Booking Engine (Full Capability)`  
- **Build description:** Retain complete booking operations capability even if UI is simplified. Must support:

| Sub-feature Name | Build description |
|------------------|-------------------|
| `Phone Bookings` | Staff create bookings for guests who call in. |
| `Walk-In Bookings` | Same-day / on-site booking at front desk. |
| `Online Bookings` | Guest self-serve bookings from the public web flow. |
| `Booking Holds` | Temporary capacity holds before payment/confirmation. |
| `Reservations` | Confirmed reservations against capacity. |
| `Booking Editing` | Modify existing bookings (time, guests, products, add-ons). |
| `Booking Payments` | Take payment against a booking. |
| `Payment Links` | Send payable links for remote payment of balances. |
| `Invoicing` | Generate invoices for bookings/parties/groups as needed. |
| `Booking Refunds` | Refund booking payments under manager controls. |
| `Party Operations (booking layer)` | Party create/edit/pay flows tied to rooms, guests, and balances. |

---

## D. Parties Differentiator — Party Command Center

ROLLER already has the following — **keep them**:

| Feature Name | Build description |
|--------------|-------------------|
| `Party Guest Lists` | Manage named guests invited/attending a party. |
| `Party Invitations` | Send/manage invitations to party guests. |
| `Party Run Sheets` | Operational run-of-show for party hosts/staff. |
| `Party Summaries` | Post/summary view of party performance and details. |
| `Party Online Account Management` | Guest manages party details via online customer account. |

### Feature — Party Command Center
- **Priority:** Major differentiator  
- **Module:** PARTIES  
- **Feature Name:** `Party Command Center`  
- **Build description:** Dedicated FEC party operations HQ. Show **Today’s Parties** as an actionable list with time, family/party name, kid count, room, and status chips such as `PAID`, `$BALANCE`, `WAIVERS MISSING`.

**Example list rows (behavior to implement):**

| Time | Party | Kids | Room | Status |
|------|-------|------|------|--------|
| 11:00 AM | Johnson | 15 kids | Room 1 | PAID |
| 12:30 PM | Williams | 22 kids | Room 3 | $184 BALANCE |
| 2:00 PM | Smith | 18 kids | Room 2 | 4 WAIVERS MISSING |

**On party click — detail tabs (each is a feature surface):**

| Feature Name | Build description |
|--------------|-------------------|
| `Party Tab: Guests` | View/edit party guest list and headcount. |
| `Party Tab: Waivers` | See waiver completion status per guest; chase missing waivers. |
| `Party Tab: Food` | Party F&B orders, modifiers, kitchen routing. |
| `Party Tab: Room` | Assigned party room and room timeline conflicts. |
| `Party Tab: Host` | Assigned party host staff and host notes. |
| `Party Tab: Add-ons` | Extra sellable party add-ons. |
| `Party Tab: Arcade Cards` | Cashless arcade cards issued/reloaded for the party. |
| `Party Tab: Balance` | Deposits, payments, outstanding balance, collect payment. |
| `Party Tab: Timeline` | Chronological party operational timeline / run events. |

---

## E. Membership Engine (keep almost entirely — do not weaken)

| Feature Name | Build description |
|--------------|-------------------|
| `Recurring Billing` | Automatic periodic membership charges on a billing schedule. |
| `Fixed Memberships` | Non-family / individual fixed membership plans. |
| `Family Memberships` | Multi-member family plans with shared/linked entitlements. |
| `Member Photos` | Capture and display member photos for identification at check-in. |
| `Benefits / Entitlements` | Define and enforce what memberships grant (entries, discounts, perks). |
| `Membership Discounts` | Automatic or rule-based discounts for members. |
| `Membership Upgrade` | Move member to a higher plan with proration/rules as designed. |
| `Membership Downgrade` | Move member to a lower plan with effective-date rules. |
| `Membership Pause` | Temporarily pause billing/benefits. |
| `Membership Cancel` | Cancel membership with appropriate end-of-period or immediate rules. |
| `Card Update` | Update stored payment method for recurring billing (staff + self-service). |
| `Failed-Payment Recovery` | Dunning/retry flows when recurring charges fail. |
| `Digital Membership Card` | Mobile/digital membership credential for check-in. |
| `Membership Reporting` | Reports on sales, active members, churn, failed payments, etc. |
| `Membership Customer Self-Service` | Guests manage membership via Online Customer Account. |

---

## F. Owner Dashboard (competitive weapon)

### Feature — Owner Dashboard Live KPIs
- **Feature Name:** `Owner Dashboard Live KPIs`  
- **Build description:** Phone-first dashboard for a venue (example label: `FECSYNC PARK — TODAY`) showing these metrics:

| KPI Feature Name | Build description |
|------------------|-------------------|
| `KPI: Revenue` | Total revenue for selected period, with % change indicator (e.g. ↑ 12.4%). |
| `KPI: Guests` | Guest/visit count for selected period. |
| `KPI: Revenue / Guest` | Average revenue per guest. |
| `KPI: Parties` | Party count and party revenue (e.g. 14 / $8,940). |
| `KPI: F&B` | Food & beverage revenue. |
| `KPI: Arcade` | Arcade/cashless revenue. |
| `KPI: Memberships Sold` | New memberships sold in period. |
| `KPI: Active Members` | Current active member count. |
| `KPI: Labor` | Labor cost amount and labor cost % of revenue (e.g. $4,020 / 14.4%). |
| `KPI: Refunds` | Refund totals. |
| `KPI: Discounts` | Discount totals. |
| `KPI: Cash Variance` | Till reconciliation variance (can be negative). |

### Feature — Owner Dashboard Time Ranges
- **Feature Name:** `Owner Dashboard Time Ranges`  
- **Build description:** Toggle metrics across `TODAY | WEEK | MONTH | YEAR`.

### Feature — Owner Dashboard Comparisons
- **Feature Name:** `Owner Dashboard Comparisons`  
- **Build description:** Compare selected period against `vs Yesterday | Last Week | Last Year | Budget`.

### Feature — Analytics Data Already Expected (make useful, don’t just collect more)
| Feature Name | Build description |
|--------------|-------------------|
| `Analytics: Party Value` | Revenue value of parties. |
| `Analytics: Party Size` | Guest/kid counts per party. |
| `Analytics: Ancillary Spend` | Non-admission spend (F&B, arcade, retail, etc.). |
| `Analytics: Revenue by Hour` | Hourly revenue curves for staffing/ops. |
| `Analytics: Membership Metrics` | Membership funnel and health metrics. |
| `Analytics: Staff Sales` | Sales attributed to staff/sellers. |
| `Analytics: YOY Revenue` | Year-over-year revenue comparison. |

---

## G. Arcade Module (first-class)

### Integrations (must keep)
| Feature Name | Build description |
|--------------|-------------------|
| `Arcade Integration: Intercard` | Integrate Intercard cashless arcade cards. |
| `Arcade Integration: Amusement Connect` | Integrate Amusement Connect cashless arcade cards. |
| `Arcade Integration: Sacoa` | Integrate Sacoa cashless arcade cards. |

### Feature — Arcade Owner KPIs
- **Feature Name:** `Arcade Module KPIs`  
- **Module:** ARCADE  
- **Build description:** First-class Arcade module (not buried under Integrations) showing:

| KPI Feature Name | Build description |
|------------------|-------------------|
| `Arcade KPI: Arcade Revenue` | Total arcade revenue. |
| `Arcade KPI: Card Sales` | New cashless card sales. |
| `Arcade KPI: Reloads` | Card reload volume/value. |
| `Arcade KPI: Average Spend` | Average arcade spend per guest/card as defined. |
| `Arcade KPI: Outstanding Card Liability` | Unredeemed stored value liability on cards. |
| `Arcade KPI: Top Games` | Highest-performing games by play/revenue. |

---

## H. Permissions Model

### Feature — Granular Permissions (retain underneath)
- **Feature Name:** `Granular Permissions Engine`  
- **Build description:** Fine-grained permission bits covering at least: bookings, refunds, overbooking, stored-card charges, POS cash access, discount approval, wastage, staff configuration, and related sensitive ops. Presets map onto these bits; Custom Role edits them directly.

### Feature — Role Presets (present first)
| Feature Name | Build description |
|--------------|-------------------|
| `Role Preset: OWNER` | Everything. |
| `Role Preset: GENERAL MANAGER` | Everything except ownership / banking / account settings. |
| `Role Preset: MANAGER` | Operations + refunds + discounts + staff. |
| `Role Preset: FRONT DESK` | Sell + check-in + waivers. |
| `Role Preset: PARTY HOST` | Parties + guests + food + waivers. |
| `Role Preset: F&B` | Orders + inventory. |
| `Role Preset: Custom Role` | Advanced operators compose custom permission sets from granular bits. |

---

## I. Explicitly NOT Version 1 (postpone — still document for Cursor so it does not build these now)

| Feature Name | Status | Build description (do NOT implement in V1) |
|--------------|--------|-----------------------------------------------|
| `OTA / Channel Management` | Postpone | Do not build OTA/channel manager distribution in V1. |
| `Viator Integration` | Postpone | Do not integrate Viator in V1. |
| `Klook Integration` | Postpone | Do not integrate Klook in V1. |
| `GetYourGuide Integration` | Postpone | Do not integrate GetYourGuide in V1. |
| `Trip.com Integration` | Postpone | Do not integrate Trip.com in V1. |
| `Complex External BI` | Postpone | Do not build complex external BI pipelines in V1. |
| `BigQuery Export` | Postpone | Do not build BigQuery export in V1. |
| `Power BI Integration` | Postpone | Do not build Power BI integration in V1. |
| `Salesforce Integration` | Postpone | Do not build Salesforce CRM sync in V1. |
| `International Fiscal Systems` | Postpone | Do not build country-specific fiscalization in V1. |
| `Cash Recyclers` | Postpone | Do not integrate cash recycler hardware in V1. |
| `Sophisticated Loyalty` | Postpone | Do not build advanced loyalty program complexity in V1. |
| `Advanced Developer Functionality` | Postpone | Keep API/webhooks basic; no advanced developer platform in V1. |
| `Specialized Regional Features` | Postpone | Do not prioritize region-specific edge features in V1. |

**Focus note for agents:** ROLLER serves trampoline parks, water parks, climbing gyms, bowling, karting, wildlife attractions, and international venues (3,000+ venues). This product initially builds only for **FECs + Trampoline/Adventure Parks + Indoor Play Centers**.

---

## J. Nine Launch Modules (IA / navigation)

| Module Feature Name | Build description |
|---------------------|-------------------|
| `Module: DASHBOARD` | Owner’s entire business at a glance (KPIs, comparisons, AI insights later). |
| `Module: SELL` | POS for tickets, F&B, merchandise, gift cards, memberships, admissions. |
| `Module: BOOKINGS` | Sessions, parties, groups, events, capacity management. |
| `Module: CHECK-IN` | Tickets, memberships, waivers, wristbands scanning/redemption. |
| `Module: PARTIES` | Complete party operations + Party Command Center. |
| `Module: GUESTS` | CRM, memberships, visits, birthdays. |
| `Module: ARCADE` | Cashless cards + arcade reporting KPIs. |
| `Module: MONEY` | Payments, refunds, tills, payouts, accounting. |
| `Module: MARKETING` | Promotions, customer segments, SMS/email automation. |

### Permission-gated secondary areas (hide from default staff nav)
| Feature Name | Build description |
|--------------|-------------------|
| `Nav: Settings` | Configuration area; visible only with appropriate permissions. |
| `Nav: Integrations` | Third-party connectors; permissioned (Arcade remains first-class module). |
| `Nav: Reports` | Full report library; permissioned (Dashboard remains primary for owners). |
| `Nav: Admin` | Staff, roles, account/ownership settings; permissioned. |

### Feature — Check-In Wristbands
- **Feature Name:** `Wristbands`  
- **Module:** CHECK-IN  
- **Build description:** Support wristband issuance/scan as an entry credential alongside tickets, memberships, and waivers (listed in CHECK-IN module scope).

### Feature — Money Payouts
- **Feature Name:** `Payouts`  
- **Module:** MONEY  
- **Build description:** Operator payout visibility/management as part of MONEY (payments, refunds, tills, payouts, accounting).

---

## K. Competitive Additions (elevate beyond ROLLER list)

These are recommended competitive additions — not claims they are universally missing from ROLLER.

### K.1 Labor Management
| Feature Name | Build description |
|--------------|-------------------|
| `Labor: Scheduling` | Staff shift scheduling for the venue. |
| `Labor: Clock-In / Clock-Out` | Timeclock for staff attendance. |
| `Labor: Labor Cost %` | Labor cost as percent of revenue (feeds Owner Dashboard). |
| `Labor: Sales per Labor Hour` | Productivity metric: sales ÷ labor hours. |
| `Labor: Recommended Staffing` | Suggest staffing levels from future bookings/demand. |

### K.2 Maintenance & Attraction Inspections
| Feature Name | Build description |
|--------------|-------------------|
| `Maintenance: Daily Opening Inspections` | Checklist inspections before venue/attraction open. |
| `Maintenance: Equipment Maintenance` | Track equipment service tasks. |
| `Maintenance: Incidents` | Log safety/ops incidents. |
| `Maintenance: Attraction Downtime` | Record when attractions are down and unavailable. |
| `Maintenance: Maintenance History` | Historical log of inspections, service, incidents, downtime. |

### K.3 Purchasing / Vendor Management
| Feature Name | Build description |
|--------------|-------------------|
| `Purchasing: Inventory Purchasing` | Buy stock to replenish inventory. |
| `Purchasing: Purchase Orders (POs)` | Create and manage POs. |
| `Purchasing: Vendors` | Vendor directory and purchasing relationships. |
| `Purchasing: Cost Changes` | Track vendor/item cost changes over time. |

### K.4 AI Owner Intelligence
- **Feature Name:** `AI Owner Intelligence`  
- **Priority:** Later / competitive elevate  
- **Build description:** Proactive owner insights engine. Do not limit to Q&A on reports. Push explanations such as: “Saturday revenue is up 14%, but revenue per guest fell 6% because F&B attachment dropped.”

### K.5 Forecasting
| Feature Name | Build description |
|--------------|-------------------|
| `Forecast: Attendance` | Predict attendance (e.g. Saturday) from history + existing bookings. |
| `Forecast: Parties` | Predict party volume/demand. |
| `Forecast: Staffing` | Predict staffing need from demand forecasts. |
| `Forecast: F&B Demand` | Predict F&B demand for prep/purchasing. |
| `Forecast: Revenue` | Predict revenue for upcoming periods. |

**Forecast inputs required:** historical sales + existing bookings.

---

## L. Strategy Constraints (for every Cursor implementation prompt)

| Constraint Name | Rule for the agent |
|-----------------|--------------------|
| `Constraint: Connected System` | Build ticketing, POS, waivers, memberships, payments, and reporting as one connected system — not siloed apps. |
| `Constraint: FEC-Native Workflow` | Prefer FEC operator workflows over generic attraction-management sprawl. |
| `Constraint: Simplify Configuration` | Retain underlying capability; dramatically simplify how operators configure it. |
| `Constraint: ~60–80 Visible Capabilities` | Prefer compressing surface area; hide complexity behind presets and progressive disclosure. |
| `Constraint: Do Not Clone All ROLLER` | Do not try to reproduce all 38 sections / hundreds of functions / 1,000+ inventory lines. |
| `Constraint: Not a Cheaper ROLLER` | Strategy is “operating system for FEC owners,” not feature-parity discount clone. |
| `Constraint: Memberships Not Oversimplified` | Membership engine stays deep (Section E). |
| `Constraint: Arcade First-Class` | Arcade is a module, not a buried integration-only footnote. |
| `Constraint: Parties Are a Weapon` | Party Command Center is a primary differentiator. |
| `Constraint: Dashboard Usefulness > More Data` | Improve presentation/actionability of analytics before inventing new metrics. |

---

## M. Master checklist (nothing skipped)

Use this list to verify coverage when writing Cursor prompts:

**Keep 1–32:** Online Booking/Ticketing · POS · Integrated Payments · Party Management · Digital Waivers · Capacity Management · Check-In · Memberships · Customer/Guest CRM · Gift Cards · Discounts & Promotions · F&B/Retail · Cashless Arcade Integration (Intercard, Sacoa, Amusement Connect) · Staff Roles & Permissions · Cash/Till Management · Refund/Manager Controls · Reporting · Owner Dashboard · Self-Service Kiosk · Mobile Check-In · Online Customer Account · Upselling · Dynamic Pricing · Automated Email/SMS · Guest Segmentation · Marketing Tracking (Meta, TikTok, Google) · Guest Feedback · Accounting Integration (QuickBooks/Xero + GL mapping) · Kitchen Display · Multi-Location/HQ · API/Webhooks · AI Assistant (Later)

**Product types:** timed sessions · parties · passes · memberships · gift cards · stock · add-ons · packages · cashless game cards

**Booking engine underneath:** phone · walk-in · online · holds · reservations · editing · payments · payment links · invoicing · refunds · party operations

**Front desk actions:** CHECK IN · SELL TICKETS · PARTY · MEMBERSHIP · WAIVER · FOOD · REFUND

**Party keep + Command Center:** guest lists · invitations · run sheets · summaries · online account management · Today’s Parties list · tabs Guests/Waivers/Food/Room/Host/Add-ons/Arcade Cards/Balance/Timeline

**Membership keep:** recurring billing · fixed · family · photos · benefits/entitlements · discounts · upgrade · downgrade · pause · cancel · card update · failed-payment recovery · digital card · reporting · self-service

**Dashboard:** Revenue · Guests · Revenue/Guest · Parties · F&B · Arcade · Memberships Sold · Active Members · Labor · Refunds · Discounts · Cash Variance · TODAY/WEEK/MONTH/YEAR · vs Yesterday/Last Week/Last Year/Budget · party value · party size · ancillary spend · revenue by hour · membership metrics · staff sales · YOY revenue

**Arcade KPIs:** Arcade Revenue · Card Sales · Reloads · Average Spend · Outstanding Card Liability · Top Games

**Permission presets:** OWNER · GENERAL MANAGER · MANAGER · FRONT DESK · PARTY HOST · F&B · Custom Role (+ granular bits)

**V1 postpone:** OTA/channel · Viator · Klook · GetYourGuide · Trip.com · complex external BI · BigQuery · Power BI · Salesforce · international fiscal · cash recyclers · sophisticated loyalty · advanced developer functionality · specialized regional features

**Nine modules:** DASHBOARD · SELL · BOOKINGS · CHECK-IN · PARTIES · GUESTS · ARCADE · MONEY · MARKETING (+ hide Settings/Integrations/Reports/Admin)

**Competitive adds:** Labor (scheduling, clock in/out, labor cost %, sales per labor hour, recommended staffing) · Maintenance (daily opening inspections, equipment maintenance, incidents, attraction downtime, history) · Purchasing (inventory purchasing, POs, vendors, cost changes) · AI Owner Intelligence · Forecasting (attendance, parties, staffing, F&B demand, revenue)

---

## N. Sample Cursor prompt template

```text
Implement feature: <Feature Name>
Priority: <Critical | High | Later | Postpone>
Module: <DASHBOARD | SELL | BOOKINGS | CHECK-IN | PARTIES | GUESTS | ARCADE | MONEY | MARKETING | Admin>
Vertical focus: FEC / trampoline-adventure / indoor play only.

Build description:
<paste Build description from this catalog>

Constraints:
- Connected FEC OS (ticketing, POS, waivers, memberships, payments, reporting)
- Simplify operator UX; keep capability underneath
- Do not implement Section I postpone items
- Follow existing multi-tenant orgId + optional locationId patterns in this repo
```
