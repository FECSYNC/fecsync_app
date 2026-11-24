/**
 * Soft env validation for shipping (F10).
 * Logs warnings; does not throw in development.
 * When SHIPPING_ENABLED=true, requires SHIPBUBBLE_API_KEY at minimum.
 */

export type ShippingEnvValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

let validatedOnce = false;

export function validateShippingEnv(
  env: NodeJS.ProcessEnv = process.env
): ShippingEnvValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const shippingFlag = env.SHIPPING_ENABLED?.trim().toLowerCase();
  const shippingExplicit =
    shippingFlag === "true" || shippingFlag === "1" || shippingFlag === "yes";
  const shippingOn = shippingFlag !== "false";

  if (shippingExplicit && !env.SHIPBUBBLE_API_KEY?.trim()) {
    errors.push(
      "SHIPPING_ENABLED=true requires SHIPBUBBLE_API_KEY (primary courier)"
    );
  }

  if (shippingOn && env.NODE_ENV === "production") {
    if (!env.SHIPBUBBLE_WEBHOOK_SECRET?.trim()) {
      warnings.push(
        "SHIPBUBBLE_WEBHOOK_SECRET missing in production — Shipbubble webhooks will be rejected"
      );
    }
    const fezConfigured = Boolean(
      env.FEZ_SECRET_KEY?.trim() || env.FEZ_API_KEY?.trim()
    );
    if (fezConfigured && !env.FEZ_WEBHOOK_SECRET?.trim()) {
      warnings.push(
        "FEZ_WEBHOOK_SECRET missing in production — Fez webhooks will be rejected (API secret is not accepted as webhook secret in production)"
      );
    }
  }

  if (
    (env.FEZ_SECRET_KEY?.trim() || env.FEZ_API_KEY?.trim()) &&
    !env.FEZ_BEARER_TOKEN?.trim() &&
    !(env.FEZ_USER_ID?.trim() && env.FEZ_PASSWORD?.trim())
  ) {
    warnings.push(
      "Fez secret set but missing FEZ_BEARER_TOKEN or FEZ_USER_ID+FEZ_PASSWORD"
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Call once per process from rates/book paths. Logs; never crashes the request.
 */
export function ensureShippingEnvValidated(): void {
  if (validatedOnce) return;
  validatedOnce = true;
  const result = validateShippingEnv();
  for (const w of result.warnings) {
    console.warn(`[shipping:env] ${w}`);
  }
  for (const e of result.errors) {
    console.warn(`[shipping:env] ${e}`);
  }
}
