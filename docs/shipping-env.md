# Shipping integration — environment variables

Canonical **provider research**: [`docs/shipping/providers.md`](./shipping/providers.md).  
**Go-live steps:** [`docs/shipping/production-checklist.md`](./shipping/production-checklist.md).

Runtime soft validation: `src/lib/shipping/validateEnv.ts` (logs on first rates/book; does not crash dev).  
**Never commit** `.env.local` or real API/webhook secrets.

## Shipbubble (primary)

| Variable | Required | Description |
|----------|----------|-------------|
| `SHIPBUBBLE_API_KEY` | When `SHIPPING_ENABLED=true` | Bearer for `https://api.shipbubble.com/v1` |
| `SHIPBUBBLE_ENV` | Optional | `sandbox` \| `production` |
| `SHIPBUBBLE_WEBHOOK_SECRET` | Production | HMAC-SHA512 for `x-ship-signature` |
| `SHIPBUBBLE_CATEGORY_ID` | Optional | Package category (default `4`) |
| `SHIPBUBBLE_SENDER_EMAIL` | Optional | Origin email for address validation |

## Fez (fallback)

| Variable | Required | Description |
|----------|----------|-------------|
| `FEZ_API_URL` | Optional | Default `https://apisandbox.fezdelivery.co/v1` |
| `FEZ_SECRET_KEY` | To enable Fez | Org `secret-key` header |
| `FEZ_BEARER_TOKEN` | Or user/pass | Cached bearer |
| `FEZ_USER_ID` / `FEZ_PASSWORD` | Or bearer | `/user/authenticate` |
| `FEZ_WEBHOOK_SECRET` | Optional | Falls back to `FEZ_SECRET_KEY` |
| `FEZ_API_KEY` | Legacy alias | Prefer `FEZ_SECRET_KEY` |

## Master / application

| Variable | Notes |
|----------|-------|
| `SHIPPING_ENABLED` | `false` forces free-shipping checkout. Default enabled when unset. |
| `DEFAULT_ORG_ID` | Storefront org for `ShippingSettings` |
| `DATABASE_URL` / `DIRECT_URL` | Prisma |

## Local development

```bash
SHIPPING_ENABLED=true
SHIPBUBBLE_ENV=sandbox
SHIPBUBBLE_API_KEY=
SHIPBUBBLE_WEBHOOK_SECRET=
# FEZ_API_URL=https://apisandbox.fezdelivery.co/v1
# FEZ_SECRET_KEY=
# FEZ_BEARER_TOKEN=
# FEZ_WEBHOOK_SECRET=
```

Webhook URLs:

- `{BASE_URL}/api/webhooks/shipping/shipbubble`
- `{BASE_URL}/api/webhooks/shipping/fez`

Admin: `/admin/shipping-settings` — origin, defaults, providers, **Test connection**.

Smoke: `yarn smoke:shipping`

## Security

- Never commit API keys or webhook secrets.
- Webhooks verify with dedicated secrets (`SHIPBUBBLE_WEBHOOK_SECRET`, `FEZ_WEBHOOK_SECRET` in production). Do not use API keys as webhook secrets in production.
- Fez: non-production may fall back to `FEZ_SECRET_KEY` for local sandbox only.
- Never return `rateToken` / `requestToken` to clients.
- Payment settlement never rolls back if auto-book fails.
