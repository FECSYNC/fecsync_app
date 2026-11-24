/** Stable per tab+package so cancel/retry and double-click reuse one pending seat. */

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `mp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function marketplaceIdempotencyStorageKey(
  orgSlug: string,
  packageSlug: string
): string {
  return `mkt-checkout-idem:${orgSlug}:${packageSlug}`;
}

export function getOrCreateMarketplaceCheckoutIdempotencyKey(
  orgSlug: string,
  packageSlug: string
): string {
  const storageKey = marketplaceIdempotencyStorageKey(orgSlug, packageSlug);
  try {
    const existing = sessionStorage.getItem(storageKey)?.trim() || "";
    if (existing.length >= 8 && existing.length <= 128) return existing;
    const next = newIdempotencyKey();
    sessionStorage.setItem(storageKey, next);
    return next;
  } catch {
    return newIdempotencyKey();
  }
}

export function clearMarketplaceCheckoutIdempotencyKey(
  orgSlug: string,
  packageSlug: string
): void {
  try {
    sessionStorage.removeItem(
      marketplaceIdempotencyStorageKey(orgSlug, packageSlug)
    );
  } catch {
    /* private mode / SSR */
  }
}
