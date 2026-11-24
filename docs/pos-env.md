# POS environment

Honest env for the park POS terminal (Growth / Enterprise). Shop ecommerce Stripe keys are separate only where noted.

| Variable | Required | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | For card / payment-link / Terminal | One PaymentIntent per card tender on POS sales; payment links; tab preauth (beta). |
| `STRIPE_WEBHOOK_SECRET` | For live card settle | Existing Stripe webhook route handles `metadata.type = pos_sale` via `settlePosSalePayment` (row-locked, idempotent). |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Required for in-browser card | Card checkout always returns `client_secret` today; sell pad / sale detail / tabs confirm via Stripe Elements. Payment-link-only parks may omit it. |
| Stripe Terminal connection token | Uses `STRIPE_SECRET_KEY` | `POST /api/pos/terminal/connection-token` + Terminal JS (CDN). Devices with `stripeTerminalId` (`tmr_…`) create `card_present` PaymentIntents; the terminal tries reader collect first. If the reader is offline, card-secrets converts the PI for in-browser Elements. |
| `NOTIFICATION_EMAIL` / mailer SMTP | For email receipts | Same mailer as `sendReceiptMail` / existing receipt settings. |
| Per-device `printAgentUrl` | Optional | Stored on `PosDevice`. Drawer kick returns `NO_DRAWER_AGENT` when unset — UI must not fake a kick. |
| Booking SMS | Unchanged | Still the ticketing SMS provider (`docs/ticketing-env.md`). POS does not add a second SMS path. |
| `POS_SMOKE=1` | Tests only | Allows simulated card tenders in smoke scripts. Ignored when `NODE_ENV=production` even if set. |

Rate limits stay on manager PIN verify, payment link create, refund, and offline sync (existing `rateLimit` helpers where wired).

Plan meter: `posTerminals` in `src/lib/subscriptionPlans.ts` / `planLimits.ts` (Demo/Starter 0, Growth 5, Enterprise unlimited).
