# Digital Waivers — production env

Server-only. Do **not** commit secrets to git.

Entitlement is Growth and Enterprise (`moduleHints` includes `waivers` or `all`). Demo, Starter, the public storefront, and unpaid, pending, or suspended companies cannot open the module.

## Email

| Variable | Purpose |
|---|---|
| `NOTIFICATION_EMAIL_USER` | SMTP user. Also the From address for waiver request and reminder mail. |
| `NOTIFICATION_EMAIL_PASS` | SMTP password used by the shared mailer. |

If `NOTIFICATION_EMAIL_USER` is unset, a signing link is still stored and staff can copy the URL. The request is marked failed instead of sent. A confirmation email after a signature is skipped the same way. The signature itself is kept.

**Per-venue staff copy address:** operators may save an optional `notifyEmail` on **Waivers → Settings** (org default or a specific venue). That value is stored on `WaiverSettings` in the database, not in an env var. After a successful sign, one staff email goes to the venue row when it is set, otherwise the org-default row. The message includes the signer, minors, accepted clause labels, fill method, public reference, and venue name. It does not include a signature image or an ID photo. A replay does not send a second staff email. If `notifyEmail` is empty, no staff copy is sent.

## Optional document reading

| Variable | Purpose |
|---|---|
| `WAIVER_EXTRACT_ENDPOINT` | Optional cloud extract URL. Both this and the key must be set before a cloud call is made. |
| `WAIVER_EXTRACT_API_KEY` | Bearer token for that endpoint. |

If either variable is missing, or the endpoint is not an `https` URL on a public host, `POST /api/public/waivers/sign/[token]/extract` and `POST /api/public/waivers/kiosk/[deviceToken]/extract` return a manual fallback and do not call a cloud API. Redirects are not followed. They do not store the photo. Local reading in the browser does not wait on these routes. When `allowDocumentExtract` is false, both routes respond **403**. Kiosk extract and walk-in revoke also require an entitled active company and an active park, the same as kiosk sign.

`POST /api/public/waivers/kiosk/[deviceToken]/walkin/revoke` sets `revokedAt` on a walk-in pass for that kiosk’s park. A pass for another park is not revoked. Kiosk continue (`action: walkin-continue` on the kiosk POST) checks the same park and the 90-minute window. Public emailed signing links do not create a pass.

## Optional SMS

| Variable | Purpose |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio account. All three values are required before an SMS link is sent. |
| `TWILIO_AUTH_TOKEN` | Twilio auth token. |
| `TWILIO_FROM` or `TWILIO_PHONE_NUMBER` | Sender number. `TWILIO_FROM` is used when both are set. |

If any of these is missing, an SMS waiver request returns **400** (`SMS is not configured`) and no request row is stored. Email links still work.

## Cron

| Variable | Purpose |
|---|---|
| `CRON_SECRET` | Bearer token for `GET /api/cron/remind-company-subscriptions` and `GET /api/cron/waivers-remind`. Missing secret returns 503. A wrong secret returns 401. |

Waiver expiry reminders run after company billing reminders inside the daily cron. A waiver reminder failure is logged and does not fail the billing reminder. There is no third Vercel cron. `yarn waivers:remind` runs the same job for one process and should be scoped in code with an org id when you do not intend to email every company.

## Signatures and files

Drawn signatures are stored on `WaiverSignature.drawnSignatureSvg`. They are not uploaded to Cloudinary. Cloudinary remains the shop and catalog image host and is not required to sign a waiver.

## Database

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres. Smokes use `scripts/prisma-env.mjs` so the URL is not passed through the shell. |

```bash
yarn smoke:waivers:p5
yarn smoke:waivers:all
```
