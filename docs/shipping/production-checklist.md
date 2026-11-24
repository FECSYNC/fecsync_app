# Shipping — production checklist (F10)

Complete before flipping Shipbubble / Fez to production keys.

## 1. Environment

- [ ] `SHIPPING_ENABLED=true`
- [ ] `SHIPBUBBLE_API_KEY` = **production** key (`sb_prod_*`)
- [ ] `SHIPBUBBLE_ENV=production` (ops clarity; host stays `api.shipbubble.com/v1`)
- [ ] `SHIPBUBBLE_WEBHOOK_SECRET` set (never reuse API key)
- [ ] Optional: `SHIPBUBBLE_CATEGORY_ID`, `SHIPBUBBLE_SENDER_EMAIL`
- [ ] Fez (if enabled): `FEZ_API_URL` (production host from Fez portal), `FEZ_SECRET_KEY`, `FEZ_BEARER_TOKEN` or `FEZ_USER_ID`+`FEZ_PASSWORD`, `FEZ_WEBHOOK_SECRET`
- [ ] `DEFAULT_ORG_ID` points at storefront org with `ShippingSettings`
- [ ] Run Admin → Store settings → **Shipping**: origin line1 + phone, enabled providers, auto-book toggle
- [ ] Use **Test connection** (sandbox first) before production keys

Runtime soft-check: `src/lib/shipping/validateEnv.ts` (logs on first rates/book call).

## 2. Register webhooks

Replace `{BASE_URL}` with your public HTTPS origin (no trailing slash).

| Provider | Method | URL |
|----------|--------|-----|
| Shipbubble | POST | `{BASE_URL}/api/webhooks/shipping/shipbubble` |
| Fez | POST | `{BASE_URL}/api/webhooks/shipping/fez` |

**Shipbubble:** Dashboard → API keys & Webhook → set URL + secret matching `SHIPBUBBLE_WEBHOOK_SECRET`. Must return 200 within 15s.

**Fez:** B2B portal → Developers → register webhook via `POST /webhooks/store` (or UI) to the Fez URL above. Signature: HMAC-SHA256 of `orderNumber + status + timestamp` (`X-Signature`, `X-Timestamp`).

## 3. Shipbubble wallet & KYC

- [ ] Fund Shipbubble wallet for label creation
- [ ] Complete account KYC / production API access as required by Shipbubble
- [ ] Confirm origin country matches Shipbubble account country
- [ ] Place a low-value sandbox order end-to-end (rate → pay → book → webhook → profile tracking)

## 4. Fez B2B portal (when enabling fallback)

- [ ] Sign up sandbox, then production B2B
- [ ] Developers → Manage Keys → copy `secret-key`
- [ ] Authenticate once; store bearer or use `FEZ_USER_ID`/`FEZ_PASSWORD` for refresh
- [ ] Enable Fez under Admin → Shipping (`enabledProviders` includes `fez`)
- [ ] Register webhook URL; verify a status event updates Admin Deliveries + customer profile

## 5. Smoke test

```bash
yarn smoke:shipping
```

Skips live courier calls when keys are missing; still validates address + HMAC helpers.

### Manual Shipbubble webhook curl (Phase 3)

Replace `{BASE_URL}` and `{SECRET}` with your public origin and `SHIPBUBBLE_WEBHOOK_SECRET`.

**Invalid signature → 401**

```bash
curl -sS -X POST "{BASE_URL}/api/webhooks/shipping/shipbubble" \
  -H "Content-Type: application/json" \
  -H "x-ship-signature: deadbeef" \
  -d '{"event":"shipment.status.changed","order_id":"REPLACE_WITH_PROVIDER_SHIPMENT_ID","status":"in_transit","event_id":"manual-test-1"}'
```

**Valid signature → 200** (requires a Shipment row whose `providerShipmentId` matches `order_id`):

```bash
BODY='{"event":"shipment.status.changed","order_id":"REPLACE_WITH_PROVIDER_SHIPMENT_ID","status":"in_transit","event_id":"manual-test-2","date":"2026-09-03T12:00:00Z"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha512 -hmac "{SECRET}" | awk '{print $2}')
curl -sS -X POST "{BASE_URL}/api/webhooks/shipping/shipbubble" \
  -H "Content-Type: application/json" \
  -H "x-ship-signature: $SIG" \
  -d "$BODY"
```

On Windows PowerShell:

```powershell
$body = '{"event":"shipment.status.changed","order_id":"REPLACE_WITH_PROVIDER_SHIPMENT_ID","status":"in_transit","event_id":"manual-test-2"}'
$hmac = New-Object System.Security.Cryptography.HMACSHA512
$hmac.Key = [Text.Encoding]::UTF8.GetBytes("{SECRET}")
$sig = -join ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($body)) | ForEach-Object { $_.ToString("x2") })
Invoke-RestMethod -Method POST -Uri "{BASE_URL}/api/webhooks/shipping/shipbubble" `
  -Headers @{ "x-ship-signature" = $sig } `
  -ContentType "application/json" -Body $body
```

Re-send the same payload with the same `event_id` — response should include `"skipped":"duplicate_event"` and order status must not regress.

## 6. Go-live gate

- [ ] Checkout requires rate selection when shipping required
- [ ] Paid order auto-books (or failed shipment + staff notify if courier down)
- [ ] Webhooks move status: booked → in_transit → delivered
- [ ] Admin Deliveries + profile tracking + email stay aligned
- [ ] Analytics revenue uses `order.amount` (includes shipping)
