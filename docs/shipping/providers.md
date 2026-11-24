# Shipping providers — research + Phase 5 status (F10)

Provider comparison for Harewa’s Nigerian logistics integration.  
**Rule:** each capability is labeled **VERIFIED** (from official docs / our live integration) or **ASSUMPTION** (third-party summaries or inferred — re-check before building against it).

**Harewa recommendation (product):**

| Role | Provider | Why |
|------|----------|-----|
| **Primary** | Shipbubble | Multi-courier rates + labels + tracking + webhooks; live Phases 2–5 |
| **Fallback** | Fez | Corporate Nigeria API with sandbox; rates + orders + webhooks — **wired Phase 5** |
| **Lagos supplement** | Kwik | Same-day / on-demand last-mile in major cities — **deferred** (see §4) |

Do **not** commit secrets. Put keys only in `.env.local` / host secrets (never `NEXT_PUBLIC_*`). See also [`../shipping-env.md`](../shipping-env.md) and [`production-checklist.md`](./production-checklist.md).

---

## 1. Shipbubble (primary)

**Docs:** https://docs.shipbubble.com/  
**API base:** `https://api.shipbubble.com/v1` — **VERIFIED**  
**Harewa status:** Implemented (rates, book/cancel, webhook HMAC, admin Deliveries, customer tracking).

### Endpoints used in code

| Path | Use | Label |
|------|-----|-------|
| `POST /shipping/address/validate` | Origin/destination validation | **VERIFIED** (docs + live) |
| `POST /shipping/fetch_rates` | Multi-courier rate quotes | **VERIFIED** (docs + live) |
| `POST /shipping/labels` | Book / create label | **VERIFIED** (docs + live) |
| `POST /shipping/labels/cancel/{id}` | Cancel shipment | **VERIFIED** (docs + live) |

Do **not** invent endpoints beyond the official Shipbubble docs.

### Env (server-only)

| Variable | Used | Notes |
|----------|------|-------|
| `SHIPBUBBLE_API_KEY` | Yes | Bearer (`sb_sandbox_*` / `sb_prod_*`) — **not** `NEXT_PUBLIC_*` |
| `SHIPBUBBLE_WEBHOOK_SECRET` | Yes | HMAC-SHA512 for `x-ship-signature` |
| `SHIPBUBBLE_ENV` | Ops only | `sandbox` \| `production` |
| `SHIPBUBBLE_CATEGORY_ID` | Optional | Default `4` |
| `SHIPBUBBLE_SENDER_EMAIL` | Optional | Address validation |

**Webhook:** `POST /api/webhooks/shipping/shipbubble`

---

## 2. Fez (fallback — Phase 5 ✅)

**Docs:** https://fez-delivery-co.gitbook.io/fezcorporate-api-docs  
**Sandbox:** `https://apisandbox.fezdelivery.co/v1` — **VERIFIED** (docs)  
**Harewa status:** `src/lib/shipping/providers/fez/client.ts` + `providerRouter` + `POST /api/webhooks/shipping/fez`.

| Topic | Detail | Label |
|-------|--------|-------|
| Auth | Bearer + `secret-key` header | **VERIFIED** |
| Rates | `POST /order/cost` | **VERIFIED** |
| Book | `POST /order` with `thirdparty: "true"` | **VERIFIED** |
| Cancel | `DELETE /order/{id}` | **VERIFIED** |
| Webhook | HMAC-SHA256 of `orderNumber + status + timestamp` | **VERIFIED** |
| Public tracking portal URL | None documented — API track only | **ASSUMPTION** (no public URL in docs) |

| Variable | Notes |
|----------|-------|
| `FEZ_API_URL` | Default sandbox URL if unset |
| `FEZ_SECRET_KEY` / `FEZ_API_KEY` | Org secret-key header |
| `FEZ_BEARER_TOKEN` or `FEZ_USER_ID`+`FEZ_PASSWORD` | Auth |
| `FEZ_WEBHOOK_SECRET` | Required in production; optional locally |

---

## 3. GIG Logistics (GIGL)

Not integrated. Nationwide option only — **ASSUMPTION** pending product decision.

---

## 4. Kwik — future enhancement (deferred)

**Not shipped in Phase 5.** Do not block go-live.

When product wants same-day last-mile:

1. Add `src/lib/shipping/providers/kwik/client.ts` behind `enabledProviders` includes `'kwik'`.
2. Restrict destination city to **Lagos / Abuja / Port Harcourt** only (not nationwide) — **ASSUMPTION** pending Kwik contract.
3. Feature-flag via Admin → Shipping settings checkboxes once enum supports `kwik`.

Until then, Shipbubble partner couriers cover Lagos speed where available; Fez covers nationwide state cost fallback.

---

## 5. Master env

| Variable | Status |
|----------|--------|
| `SHIPPING_ENABLED` | Live (`false` → free shipping / no rate gate) |
| `SHIPBUBBLE_*` | Live |
| `FEZ_*` | Live (Phase 5) |
| `DEFAULT_ORG_ID` | Live — used by `ensureDefaultShippingSettings` / `seedDefaultShippingSettings` |

Admin UI: `/admin/shipping-settings` (`settings:manage`).

---

## 6. Capability matrix

| Capability | Shipbubble | Fez | Kwik |
|------------|------------|-----|------|
| Live rates | **VERIFIED** (Harewa) | **VERIFIED** (Harewa) | Deferred |
| Book | **VERIFIED** | **VERIFIED** | Deferred |
| Webhooks | **VERIFIED** | **VERIFIED** | Deferred |
| Nationwide NG | **VERIFIED** | **VERIFIED** | City-only (**ASSUMPTION**) |
