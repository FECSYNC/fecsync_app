# Accounting environment variables

These keys configure Accounting (Growth and Enterprise). Missing optional keys degrade gracefully; missing required Stripe or cron secrets only affect the paths that need them.

ACCOUNTING_DEFAULT_BASE_CURRENCY — Fallback ISO currency when setup omits baseCurrency (default USD). Used only at first setup suggestion.

ACCOUNTING_POSTING_BATCH_SIZE — Max outbox rows claimed per processPostingQueue pass (default 200). Lower on small dynos if memory is tight.

ACCOUNTING_SMS_REMINDERS — `on` or `off` (default off). When off, invoice reminder SMS is skipped and logged as sms_skipped even if an SMS provider is configured.

ACCOUNTING_ATTACHMENT_MAX_MB — Max upload size for expense and bill attachments (default 10, capped at 25).

CRON_SECRET — Required for `/api/cron/accounting-maintenance` and the shared company subscription cron bearer. Missing → cron routes return 503 and maintenance is not run from HTTP (CLI scripts still work).

STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET — Required for public manual-invoice Checkout and webhook settle of `accounting_invoice`. Missing → invoice Pay now fails closed; booking/POS Stripe paths follow their own gates.

SMS provider keys (existing sms.ts) — When absent, accounting notifications log sms_skipped and continue. Email and in-app still send when mail is configured.

Mail keys (existing mailer) — When absent, email notifications are logged as failed in ActivityLog; the business action that triggered them still succeeds.

Yarn scripts: `accounting:backfill`, `accounting:rebuild-balances`, `accounting:maintenance`.

Step 2 connections use the same env keys — no extra vars. Cron maintenance drives period-close reminders, posting-digest, and bank unreconciled notices when mail/SMS are configured.
