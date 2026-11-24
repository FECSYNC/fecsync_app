/**
 * Notify other open tabs (shop, homepage, admin) when the catalog changes.
 * Same-tab React Query invalidation still happens in the mutation hooks.
 */

import type { QueryClient } from "@tanstack/react-query";

export type CatalogKind =
  | "product"
  | "fabric"
  | "category"
  /** Category link counts / ticketing+public embeds — does NOT wipe shop product caches. */
  | "category-counts"
  /** Workspace slug changed — refresh staff copies of /{orgSlug}/{categorySlug}. */
  | "public-category-links"
  | "homepage"
  | "banner";

export type CatalogChangeMessage = {
  type: "catalog-changed";
  kind: CatalogKind;
  action: "create" | "update" | "delete";
  id?: string;
  tabId?: string;
};

const CHANNEL = "harewa-catalog";
const STORAGE_KEY = "harewa-catalog-tick";
/** Prefer active queries so background tabs don't stampede Mongo on catalog edits. */
const refetchActive = { refetchType: "active" as const };

let tabId = "";
function getTabId() {
  if (tabId) return tabId;
  if (typeof window === "undefined") return "";
  tabId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `tab_${Math.random().toString(36).slice(2)}`;
  return tabId;
}

export function broadcastCatalogChange(
  msg: Omit<CatalogChangeMessage, "type" | "tabId">
) {
  if (typeof window === "undefined") return;
  const payload: CatalogChangeMessage = {
    type: "catalog-changed",
    tabId: getTabId(),
    ...msg,
  };
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(CHANNEL);
      channel.postMessage(payload);
      channel.close();
    }
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...payload, at: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function subscribeCatalogChange(
  handler: (msg: CatalogChangeMessage) => void
): () => void {
  if (typeof window === "undefined") return () => {};

  let lastSig = "";
  let lastAt = 0;
  const deliver = (msg: CatalogChangeMessage) => {
    if (msg.tabId && msg.tabId === getTabId()) return;
    const sig = `${msg.kind}:${msg.action}:${msg.id ?? ""}`;
    const now = Date.now();
    if (sig === lastSig && now - lastAt < 400) return;
    lastSig = sig;
    lastAt = now;
    handler(msg);
  };

  let channel: BroadcastChannel | null = null;
  const onMessage = (event: MessageEvent<CatalogChangeMessage>) => {
    if (event.data?.type === "catalog-changed") deliver(event.data);
  };
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(CHANNEL);
      channel.addEventListener("message", onMessage);
    }
  } catch {
    channel = null;
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      const parsed = JSON.parse(event.newValue) as CatalogChangeMessage;
      if (parsed?.type === "catalog-changed") deliver(parsed);
    } catch {
      /* ignore */
    }
  };
  window.addEventListener("storage", onStorage);

  return () => {
    channel?.removeEventListener("message", onMessage);
    channel?.close();
    window.removeEventListener("storage", onStorage);
  };
}

function invalidatePrefix(queryClient: QueryClient, queryKey: readonly string[]) {
  void queryClient.invalidateQueries({
    queryKey: [...queryKey],
    ...refetchActive,
  });
}

/** Product lists, details, wishlist, dashboard popular items, and cart prices. */
function invalidateProductSurfaces(queryClient: QueryClient) {
  invalidatePrefix(queryClient, ["admin-products"]);
  invalidatePrefix(queryClient, ["homepage-products"]);
  invalidatePrefix(queryClient, ["shop-products"]);
  invalidatePrefix(queryClient, ["product"]);
  invalidatePrefix(queryClient, ["products"]);
  invalidatePrefix(queryClient, ["wishlist"]);
  invalidatePrefix(queryClient, ["dashboard"]);
  invalidatePrefix(queryClient, ["cart"]);
  // Category / fabric productCount aggregates depend on product rows
  invalidatePrefix(queryClient, ["categories"]);
  invalidatePrefix(queryClient, ["fabrics"]);
}

/**
 * Single source of truth for catalog cache refresh (same tab + other tabs).
 * Keep query-key prefixes in sync with the hooks that own them.
 */
export function invalidateCatalogQueries(
  queryClient: QueryClient,
  kind: CatalogKind
) {
  switch (kind) {
    case "product":
      invalidateProductSurfaces(queryClient);
      return;
    case "fabric":
      invalidateProductSurfaces(queryClient);
      invalidatePrefix(queryClient, ["fabrics"]);
      return;
    case "category":
      invalidateProductSurfaces(queryClient);
      invalidatePrefix(queryClient, ["categories"]);
      // Embedded category.name on ticketing admin + public book caches
      invalidatePrefix(queryClient, ["admin", "ticketing"]);
      invalidatePrefix(queryClient, ["public", "booking"]);
      return;
    case "category-counts":
      // Admission product ↔ category assignment changed — refresh counts +
      // booking surfaces only (do not invalidate shop products/cart/wishlist).
      invalidatePrefix(queryClient, ["categories"]);
      invalidatePrefix(queryClient, ["admin", "ticketing"]);
      invalidatePrefix(queryClient, ["public", "booking"]);
      return;
    case "public-category-links":
      // Absolute public URLs embed the workspace slug. Refresh staff copies only.
      invalidatePrefix(queryClient, ["categories", "admin-list"]);
      invalidatePrefix(queryClient, ["categories", "admin-detail"]);
      invalidatePrefix(queryClient, ["admin", "ticketing", "categories"]);
      invalidatePrefix(queryClient, ["admin", "memberships", "categories"]);
      return;
    case "homepage":
      invalidatePrefix(queryClient, ["homepage-content"]);
      return;
    case "banner":
      invalidatePrefix(queryClient, ["ad-banners"]);
      return;
  }
}

/**
 * Other tabs (and guest carts) keep line name/price/image in sync when a
 * catalog product or fabric changes. Authenticated carts also refetch via
 * the `cart` query prefix above.
 */
export async function syncOpenCartWithCatalogChange(msg: CatalogChangeMessage) {
  if (typeof window === "undefined") return;
  if ((msg.kind !== "product" && msg.kind !== "fabric") || !msg.id) return;

  try {
    const { useCartStore } = await import("@/store/cartStore");
    const { items, setItems } = useCartStore.getState();
    if (!items.some((line) => line.id === msg.id)) return;

    if (msg.action === "delete") {
      setItems(items.filter((line) => line.id !== msg.id));
      return;
    }

    if (msg.kind === "product") {
      const { getProductById } = await import("@/services/products");
      const { slimCatalogImages } = await import("@/lib/catalogImages");
      const product = await getProductById(msg.id);
      if (!product) return;
      const priceNum =
        typeof product.price === "number" ? product.price : Number(product.price);
      setItems(
        items.map((line) =>
          line.id === msg.id
            ? {
                ...line,
                name: product.name || line.name,
                image:
                  slimCatalogImages(product.images, 720)[0] || line.image,
                price: Number.isFinite(priceNum) ? priceNum : line.price,
                taxRate:
                  product.taxRate !== undefined ? product.taxRate : line.taxRate,
                taxExempt:
                  product.taxExempt !== undefined
                    ? Boolean(product.taxExempt)
                    : line.taxExempt,
              }
            : line
        )
      );
      return;
    }

    const { getFabricById } = await import("@/services/fabric");
    const fabric = await getFabricById(msg.id);
    if (!fabric) return;
    const bundlePrice = Number(
      (fabric as { bundlePrice?: number }).bundlePrice ?? fabric.pricePerMeter
    );
    setItems(
      items.map((line) =>
        line.id === msg.id
          ? {
              ...line,
              name: fabric.name || line.name,
              image: fabric.image || line.image,
              price: Number.isFinite(bundlePrice) ? bundlePrice : line.price,
              taxRate:
                fabric.taxRate !== undefined ? fabric.taxRate : line.taxRate,
              taxExempt:
                fabric.taxExempt !== undefined
                  ? Boolean(fabric.taxExempt)
                  : line.taxExempt,
            }
          : line
      )
    );
  } catch {
    /* cart store optional during SSR / missing catalog row */
  }
}
