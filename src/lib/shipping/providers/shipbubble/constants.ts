/** Verified Shipbubble API base (v1). */
export const SHIPBUBBLE_API_BASE_URL = "https://api.shipbubble.com/v1";

export const SHIPBUBBLE_ENV_KEYS = {
  apiKey: "SHIPBUBBLE_API_KEY",
  webhookSecret: "SHIPBUBBLE_WEBHOOK_SECRET",
  /** sandbox | production — Shipbubble uses key prefix; host stays v1. */
  env: "SHIPBUBBLE_ENV",
} as const;
