# Online Booking / Ticketing — production env

Server-only. Do **not** commit secrets to git.

## Required for card payments

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe API key for venue booking Checkout / PaymentIntents **and** marketplace Connect (platform key) |
| `STRIPE_WEBHOOK_SECRET` | Verifies `/api/webhooks/stripe` (company billing, `venue_booking`, **and** `marketplace_booking` + Connect `account.updated`) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Client Stripe.js (if/when Elements used) |

### Marketplace Connect (BookingPackage destination charges)

| Variable | Purpose |
|---|---|
| `MARKETPLACE_PLATFORM_FEE_BPS` | Application fee basis points (default `500` = 5%) |
| `MARKETPLACE_PLATFORM_FEE_FLAT_MINOR` | Optional flat fee in minor units (default `0`) |
| `MARKETPLACE_CURRENCY_DEFAULT` | Primary currency for new Connect accounts / packages (v1: `usd`) |
| `STRIPE_CONNECT_RETURN_URL` | Account Link return (default `/admin/payouts?connect=return`) |
| `STRIPE_CONNECT_REFRESH_URL` | Account Link refresh (default `/admin/payouts?connect=refresh`) |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Optional — v1 uses the same endpoint + `STRIPE_WEBHOOK_SECRET`; add Connect events there |

Company SaaS (`company_subscription`) and marketplace (`marketplace_booking`) share the platform Stripe account but **must not** share Customer/Subscription vs Connect account ids. See `docs/marketplace-payouts-implementation.md`.

Without `STRIPE_SECRET_KEY`, staff cash/gift/invoice and stub payment-link smoke still work; live card Checkout is refused.

## Optional SMS

| Variable | Purpose |
|---|---|
| `BOOKING_SMS_PROVIDER` | When **unset**, confirmation / payment-link SMS is a safe no-op (`sms_skipped`) |
| `PARTY_SMS_PROVIDER` | Party confirmation / invitation / cancellation SMS. Falls back to `BOOKING_SMS_PROVIDER`. Unset (both) → party SMS is skipped and logged; staff see “SMS unavailable” |
| Provider credentials | Residual — adapter currently stubs when provider is set (logs + skip). Wire a real adapter in a follow-up |

## Optional email

| Variable | Purpose |
|---|---|
| `NOTIFICATION_EMAIL_USER` (+ mailer secrets already used by shop receipts) | Booking confirmation / payment-link email. Unset → skip with activity note |
| `NOTIFICATION_EMAIL_USER` or `TEAM_EMAIL_USER` | Party confirmation, invitation, balance reminder, and cancellation email (org-branded guest mailer). Unset → skipped and logged to BookingActivity; the booking / payment / RSVP still succeeds. No bounce webhook is wired — staff mark invitations bounced manually |

## Party maintenance (no extra Vercel cron)

| Item | Purpose |
|---|---|
| `CRON_SECRET` | Bearer for `/api/cron/reconcile-company-subscriptions` (hourly; also runs party maintenance) and `/api/cron/parties-maintenance` (optional external scheduler) |
| `yarn parties:maintenance` | CLI: party hold expiry, invitation expiry, balance reminders (sent once / skipped with reason), no-show overlay |

## Smoke / local

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres (prefer local for `yarn smoke:ticketing:*`) |
| `TICKETING_PAYMENT_LINK_STUB=1` | Allows payment-link settle without Stripe (**non-production only**; ignored when `NODE_ENV=production`) |
| `SMOKE_FAST=1` or `--fast` | Lean Phase 3–5 smokes |
| `SMOKE_BASE_URL` | Optional HTTP probes (signup 410 / shop) in Phase 3 |

## Scripts

```bash
yarn smoke:ticketing:p1
yarn smoke:ticketing:p2
yarn smoke:ticketing:p3:fast
yarn smoke:ticketing:p4:fast
yarn smoke:ticketing:p5:fast
yarn smoke:ticketing:all   # sequential p1→p5:fast — do not parallelize on shared pools
yarn smoke:parties:all     # Party Management step 1 → step 2
```

## Residual backlog (honest non-goals)

Not faked in this epic:

- Full POS terminal UI (thin `/api/pos/bookings*` adapter only)
- Digital Waivers (separate Growth+ module; see `docs/waivers-env.md`)
- Check-in scanners / access control hardware
- OTAs / channel managers
- Intercard / Sacoa
- Dynamic pricing engine
- Promo codes
- Gift card storefront merchandising
- Manager PIN
- Optional hold/reserve reminder emails (confirmation pipeline works without them)
- Real SMS provider adapter beyond env-gated stub
