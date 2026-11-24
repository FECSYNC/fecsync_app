# ROLLER Competitor Product Brief (FEC-Focused)

> Source: Client strategy notes for building a direct competitor to ROLLER, aimed at Family Entertainment Centers (FECs).  
> Audience: Programming / product team  
> Principle: Keep the capabilities that make operators choose the platform, simplify them, and deliberately leave out enterprise/edge-case clutter.

---

## 1. Core proposition to attack

ROLLER’s fundamental proposition is **one connected system** for:

- Ticketing  
- POS  
- Waivers  
- Memberships  
- Payments  
- Reporting  

That connected operating system is the part to attack directly.

**Do not** try to copy all 38 sections and hundreds of functions.

**Compete on:**

> Everything an FEC needs. Nothing it doesn't.

The biggest differentiation is an **FEC-native workflow**, not generic attraction-management software.

**Strategy (not “build a cheaper ROLLER”):**

> Build the operating system specifically for FEC owners.

Compress the hundreds of ROLLER functions (from the 33-page document) into roughly **60–80 customer-visible capabilities**, while retaining more complexity behind the scenes. That is more realistic than reproducing all **1,000+** lines of the feature inventory.

---

## 2. Features to KEEP for a ROLLER competitor

ROLLER already covers core product types extremely well: timed sessions, parties, passes, memberships, gift cards, stock, add-ons, packages, and cashless game cards.

**Keep that underlying capability**, but dramatically simplify how operators configure it.

| # | Feature | Priority | What to include |
|---|---------|----------|-----------------|
| 1 | Online Booking / Ticketing | Critical | Timed tickets, day passes, groups, camps/events, add-ons |
| 2 | POS | Critical | Admissions, F&B, merchandise, parties, memberships, gift cards |
| 3 | Integrated Payments | Critical | Card, cash, Apple/Google Pay, stored cards, refunds, split payments |
| 4 | Party Management | Critical | Packages, rooms, deposits, guest count, food, invitations, balances |
| 5 | Digital Waivers | Critical | Online/on-site signing, QR, expiration, minors, waiver verification |
| 6 | Capacity Management | Critical | Attractions, sessions, rooms, lanes, party rooms, real-time availability |
| 7 | Check-In | Critical | QR/barcode scanning, bulk groups, memberships, waiver status |
| 8 | Memberships | Critical | Recurring billing, perks, family plans, upgrades/cancellation |
| 9 | Customer/Guest CRM | Critical | Profiles, visits, spend, birthdays, waivers, memberships |
| 10 | Gift Cards | Critical | Digital/physical, online/POS purchase and redemption |
| 11 | Discounts & Promotions | Critical | Codes, %, $, BOGO, limited-time offers |
| 12 | F&B / Retail | Critical | Products, modifiers, inventory, kitchen tickets, wastage |
| 13 | Cashless Arcade Integration | Critical for FEC | Intercard, Sacoa, Amusement Connect |
| 14 | Staff Roles & Permissions | Critical | Owner, GM, manager, cashier, party host |
| 15 | Cash/Till Management | Critical | Open/close, reconciliation, cash variance |
| 16 | Refund/Manager Controls | Critical | Manager PIN, refunds, discounts, voids, overrides |
| 17 | Reporting | Critical | Sales, attendance, parties, memberships, F&B, labor/productivity |
| 18 | Owner Dashboard | Critical | Live KPIs and comparisons |
| 19 | Self-Service Kiosk | High | Buy tickets, check-in, waiver |
| 20 | Mobile Check-In | High | Staff phone/tablet scanning |
| 21 | Online Customer Account | High | Manage bookings, passes and memberships |
| 22 | Upselling | High | Socks, food, arcade, extra time, upgrades |
| 23 | Dynamic Pricing | High | Peak/off-peak, weekday/weekend |
| 24 | Automated Email/SMS | High | Confirmation, reminders, waiver, party balance |
| 25 | Guest Segmentation | High | Members, birthdays, lapsed customers, frequent visitors |
| 26 | Marketing Tracking | High | Meta, TikTok, Google |
| 27 | Guest Feedback | High | Surveys/reviews |
| 28 | Accounting Integration | High | QuickBooks/Xero + GL mapping |
| 29 | Kitchen Display | High | F&B order routing |
| 30 | Multi-Location/HQ | High | Central control for growing operators |
| 31 | API/Webhooks | High | Third-party integrations |
| 32 | AI Assistant | Later | Owner/manager intelligence rather than gimmicks |

---

## 3. Where to beat ROLLER (positioning & UX)

Do **not** compete by saying “we have more features.”

Compete by saying: **Everything an FEC needs. Nothing it doesn't.**

### 3.1 Simplify the front desk (keep capability, hide complexity)

ROLLER’s booking system already supports:

- Phone / walk-in / online bookings  
- Holds  
- Reservations  
- Editing  
- Payments  
- Payment links  
- Invoicing  
- Refunds  
- Party operations  

**Keep all of that capability underneath** — but do **not** expose ~40 controls to the average employee.

**Front desk screen should simply be:**

```
CHECK IN | SELL TICKETS | PARTY | MEMBERSHIP | WAIVER | FOOD | REFUND
```

That’s it.

---

## 4. Make Parties MUCH better (major differentiator)

This could be one of the biggest competitive differentiators.

ROLLER already has:

- Party guest lists  
- Invitations  
- Run sheets  
- Summaries  
- Online account management  

**Keep those** and build a dedicated **Party Command Center**.

### Example: Today’s Parties

| Time | Party | Kids | Room | Status |
|------|-------|------|------|--------|
| 11:00 AM | Johnson | 15 kids | Room 1 | PAID |
| 12:30 PM | Williams | 22 kids | Room 3 | $184 BALANCE |
| 2:00 PM | Smith | 18 kids | Room 2 | 4 WAIVERS MISSING |

### Click a party → detail tabs

```
Guests | Waivers | Food | Room | Host | Add-ons | Arcade Cards | Balance | Timeline
```

For FEC operators, that is far more valuable than another obscure analytics report.

---

## 5. Keep ROLLER’s membership engine almost entirely

This is one area where you **should not oversimplify**.

Recurring revenue is too important to an FEC to build a weak membership system.

### Keep

- Recurring billing  
- Fixed memberships  
- Family memberships  
- Member photos  
- Benefits / entitlements  
- Membership discounts  
- Upgrade / downgrade  
- Pause  
- Cancel  
- Card update  
- Failed-payment recovery  
- Digital membership card  
- Membership reporting  

ROLLER already includes recurring billing, entitlements, upgrades/downgrades, failed-payment recovery, and customer self-service.

---

## 6. Make the Owner Dashboard a competitive weapon

Go beyond simply copying ROLLER.

### Example phone view

**FECSYNC PARK — TODAY**

| Metric | Value |
|--------|--------|
| Revenue | $27,842 ↑ 12.4% |
| Guests | 683 |
| Revenue / Guest | $40.76 |
| Parties | 14 / $8,940 |
| F&B | $4,281 |
| Arcade | $3,770 |
| Memberships Sold | 18 |
| Active Members | 1,482 |
| Labor | $4,020 / 14.4% |
| Refunds | $382 |
| Discounts | $714 |
| Cash Variance | -$17 |

### Time ranges

```
TODAY | WEEK | MONTH | YEAR
```

### Comparisons

```
vs Yesterday | Last Week | Last Year | Budget
```

ROLLER already collects extensive analytics:

- Party value  
- Party size  
- Ancillary spend  
- Revenue by hour  
- Membership metrics  
- Staff sales  
- YOY revenue  

**Do not necessarily collect more data. Make the data more useful.**

---

## 7. Keep Cashless / Arcade integrations (first-class)

Absolutely keep these. For a true FEC competitor, this should **not** be buried under Integrations.

ROLLER supports:

- Intercard  
- Amusement Connect  
- Sacoa  

…for cashless arcade cards.

### Elevate to a first-class module: ARCADE

Owner sees:

| Arcade KPI |
|------------|
| Arcade Revenue |
| Card Sales |
| Reloads |
| Average Spend |
| Outstanding Card Liability |
| Top Games |

That is much more FEC-specific.

---

## 8. Keep Permissions — but simplify the presentation

ROLLER has extremely granular permissions covering:

- Bookings  
- Refunds  
- Overbooking  
- Stored-card charges  
- POS cash access  
- Discount approval  
- Wastage  
- Staff configuration  
- And more  

**Keep the underlying granularity.**

**Initially present operators with simple presets:**

| Role | Access |
|------|--------|
| **OWNER** | Everything |
| **GENERAL MANAGER** | Everything except ownership / banking / account settings |
| **MANAGER** | Operations + refunds + discounts + staff |
| **FRONT DESK** | Sell + check-in + waivers |
| **PARTY HOST** | Parties + guests + food + waivers |
| **F&B** | Orders + inventory |

Then allow **Custom Role** for advanced operators.

---

## 9. What NOT to prioritize for Version 1

This is just as important as what to build.

### Postpone

- OTA / channel management  
- Viator  
- Klook  
- GetYourGuide  
- Trip.com  
- Complex external BI  
- BigQuery  
- Power BI  
- Salesforce  
- International fiscal systems  
- Cash recyclers  
- Sophisticated loyalty  
- Advanced developer functionality  
- Specialized regional features  

### Why focus helps

ROLLER has to serve trampoline parks, water parks, climbing gyms, bowling, karting, wildlife attractions, and international venues — so its scope naturally becomes huge. The document itself lists **3,000+ venues** across many attraction categories.

A competitor does **not** have to start that way.

### Initial target verticals

1. FECs  
2. Trampoline / Adventure Parks  
3. Indoor Play Centers  

That focus is an advantage.

---

## 10. Product structure: nine launch modules

Instead of ROLLER’s large administrative menu structure, launch with **nine modules**:

| Module | Purpose |
|--------|---------|
| **DASHBOARD** | Owner’s entire business at a glance |
| **SELL** | POS, tickets, F&B, merchandise, gift cards |
| **BOOKINGS** | Sessions, parties, groups, events, capacity |
| **CHECK-IN** | Tickets, memberships, waivers, wristbands |
| **PARTIES** | Complete party operations |
| **GUESTS** | CRM, memberships, visits, birthdays |
| **ARCADE** | Cashless cards and arcade reporting |
| **MONEY** | Payments, refunds, tills, payouts, accounting |
| **MARKETING** | Promotions, customer segments, SMS/email |

### Hide behind permissions

```
Settings | Integrations | Reports | Admin
```

---

## 11. Five capabilities to ADD or elevate beyond the ROLLER list

These matter if seriously building a competitor. They are recommended **competitive additions**, not claims that they are missing from ROLLER universally (they are not all supported as core capabilities in the ROLLER document).

### 1. Labor management

- Scheduling  
- Clock-in / clock-out  
- Labor cost %  
- Sales per labor hour  
- Recommended staffing based on future bookings  

### 2. Maintenance & attraction inspections

- Daily opening inspections  
- Equipment maintenance  
- Incidents  
- Attraction downtime  
- Maintenance history  

### 3. Purchasing / vendor management

- Inventory purchasing  
- POs  
- Vendors  
- Cost changes  

### 4. AI Owner Intelligence

Instead of merely asking questions about reports, **proactively** tell the owner, e.g.:

> “Saturday revenue is up 14%, but revenue per guest fell 6% because F&B attachment dropped.”

### 5. Forecasting

Predict, using historical sales + existing bookings:

- Saturday attendance  
- Parties  
- Staffing  
- F&B demand  
- Revenue  

---

## 12. Summary for the team

| Theme | Direction |
|-------|-----------|
| Core attack | One connected system: ticketing, POS, waivers, memberships, payments, reporting |
| Scope | ~60–80 customer-visible capabilities; complexity behind the scenes |
| UX | FEC-native workflows; front desk reduced to 7 primary actions |
| Differentiator #1 | Party Command Center |
| Differentiator #2 | Owner Dashboard as a competitive weapon (useful data, not more data) |
| Differentiator #3 | Arcade as a first-class module |
| Do not weaken | Membership engine |
| Permissions | Granular under the hood; simple presets + Custom Role |
| V1 focus | FECs + trampoline/adventure + indoor play |
| V1 postpone | OTAs, heavy BI, Salesforce, fiscal/regional edge cases, cash recyclers, advanced loyalty/dev |
| Competitive adds | Labor, maintenance/inspections, purchasing/vendors, AI owner intelligence, forecasting |

**North star:** Build the operating system specifically for FEC owners — not a feature-for-feature clone of ROLLER.
