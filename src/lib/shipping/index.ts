export * from "./types";
export * from "./errors";
export * from "./address";
export * from "./parcelDefaults";
export * from "./providerAdapter";
export * from "./settings";
export * from "./seedDefaults";
export * from "./consistency";
export * from "./rateValidation";
export { fetchRatesForCheckout } from "./fetchRatesForCheckout";
export {
  resolveShippingSelectionForOrder,
  isShippingCheckoutRequired,
  refreshExpiredShippingMethodForBooking,
} from "./resolveSelection";

export { shipbubbleAdapter, getShipbubbleWebhookSecret } from "./providers/shipbubble/client";
export { SHIPBUBBLE_API_BASE_URL, SHIPBUBBLE_ENV_KEYS } from "./providers/shipbubble/constants";
export {
  fetchShipbubbleLiveRates,
  validateShipbubbleAddress,
  buildPackageItemsFromCart,
  nextPickupDateLagos,
} from "./providers/shipbubble/rates";
export {
  bookShipbubbleShipment,
  cancelShipbubbleShipment,
} from "./providers/shipbubble/book";
export { verifyShipbubbleWebhookSignature, parseShipbubbleWebhookEvent } from "./providers/shipbubble/webhook";
export {
  fezAdapter,
  isFezConfigured,
  verifyFezWebhookSignature,
  parseFezWebhookEvent,
  cancelFezShipment,
  FEZ_ENV_KEYS,
} from "./providers/fez/client";
export {
  getActiveProviders,
  fetchRatesWithFallback,
  bookShipmentWithFallback,
} from "./providerRouter";
export {
  validateShippingEnv,
  ensureShippingEnvValidated,
} from "./validateEnv";
export {
  bookShipmentForOrder,
  maybeAutoBookShipmentAfterPayment,
  cancelShipmentRecord,
} from "./booking";
export {
  applyShipmentWebhookEvent,
  alignShipmentWithManualOrderStatus,
  buildWebhookEventId,
  mapManualOrderStatusToShipmentStatus,
  mapShipmentStatusToOrderStatus,
  normalizeProviderShipmentStatus,
  shouldUpgradeOrderStatus,
} from "./statusSync";
export { serializeShipment } from "./serialize";
export { notifyCustomerShipmentStatus } from "./notifyShipmentStatus";

import type { ShippingProviderCode } from "@prisma/client";
import type { ShippingProviderRegistry } from "./providerAdapter";
import { shipbubbleAdapter } from "./providers/shipbubble/client";
import { fezAdapter } from "./providers/fez/client";

/** Registry of enabled provider adapters (Shipbubble primary + Fez fallback). */
export function createDefaultProviderRegistry(): ShippingProviderRegistry {
  return {
    shipbubble: shipbubbleAdapter,
    fez: fezAdapter,
  };
}

export function resolvePrimaryProvider(
  enabled: ShippingProviderCode[],
  primary: ShippingProviderCode
): ShippingProviderCode {
  if (enabled.includes(primary)) return primary;
  return enabled[0] ?? "manual";
}
