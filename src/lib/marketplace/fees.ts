/**
 * Marketplace platform application fee (server-side only).
 * Never accept fee / amount / currency from the client for settlement.
 */

export const MARKETPLACE_FEE_BPS_ENV = "MARKETPLACE_PLATFORM_FEE_BPS";
export const MARKETPLACE_FEE_FLAT_ENV = "MARKETPLACE_PLATFORM_FEE_FLAT_MINOR";
export const MARKETPLACE_CURRENCY_DEFAULT_ENV = "MARKETPLACE_CURRENCY_DEFAULT";

export const DEFAULT_PLATFORM_FEE_BPS = 500; // 5.00%
export const DEFAULT_PLATFORM_FEE_FLAT_MINOR = 0;
/** v1 primary settlement currency (USD). Multi-currency later. */
export const DEFAULT_MARKETPLACE_CURRENCY = "usd";

export function parseEnvInt(
  raw: string | undefined,
  fallback: number
): number {
  if (raw == null || !String(raw).trim()) return fallback;
  const n = Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function getDefaultPlatformFeeBps(): number {
  return Math.max(
    0,
    parseEnvInt(process.env[MARKETPLACE_FEE_BPS_ENV], DEFAULT_PLATFORM_FEE_BPS)
  );
}

export function getDefaultPlatformFeeFlatMinor(): number {
  return Math.max(
    0,
    parseEnvInt(
      process.env[MARKETPLACE_FEE_FLAT_ENV],
      DEFAULT_PLATFORM_FEE_FLAT_MINOR
    )
  );
}

export function getMarketplaceCurrencyDefault(): string {
  const raw = process.env[MARKETPLACE_CURRENCY_DEFAULT_ENV]?.trim();
  return (raw || DEFAULT_MARKETPLACE_CURRENCY).toLowerCase();
}

/**
 * Connect Express country for new accounts — must support the marketplace
 * settlement currency (v1 USD → US unless overridden).
 */
export function getMarketplaceConnectCountryDefault(
  profileCountry?: string | null
): string {
  const env = process.env.MARKETPLACE_CONNECT_COUNTRY_DEFAULT?.trim();
  if (env) return env.toUpperCase().slice(0, 2);
  const cur = getMarketplaceCurrencyDefault();
  if (cur === "usd") return "US";
  if (cur === "ngn") return "NG";
  if (cur === "gbp") return "GB";
  if (profileCountry?.trim()) {
    return profileCountry.trim().toUpperCase().slice(0, 2);
  }
  return "US";
}

/**
 * fee = floor(amountMinor * FEE_BPS / 10000) + FLAT
 * Assert fee >= 0 && fee < amountMinor (platform must not take 100%).
 */
export function computePlatformFeeMinor(opts: {
  amountMinor: number;
  /** Per-org ops override; when set, replaces env BPS (flat still applies). */
  platformFeeBpsOverride?: number | null;
  feeBps?: number;
  feeFlatMinor?: number;
}): number {
  const amount = Math.floor(Number(opts.amountMinor));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("amountMinor must be a positive integer");
  }

  const override = opts.platformFeeBpsOverride;
  const bps =
    typeof override === "number" && Number.isFinite(override) && override >= 0
      ? Math.floor(override)
      : typeof opts.feeBps === "number" && Number.isFinite(opts.feeBps)
        ? Math.max(0, Math.floor(opts.feeBps))
        : getDefaultPlatformFeeBps();

  const flat =
    typeof opts.feeFlatMinor === "number" && Number.isFinite(opts.feeFlatMinor)
      ? Math.max(0, Math.floor(opts.feeFlatMinor))
      : getDefaultPlatformFeeFlatMinor();

  const fee = Math.floor((amount * bps) / 10000) + flat;
  if (fee < 0) {
    throw new Error("platform fee cannot be negative");
  }
  if (fee >= amount) {
    throw new Error("platform fee must be less than charge amount");
  }
  return fee;
}
