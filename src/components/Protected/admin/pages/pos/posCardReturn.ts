/**
 * After Stripe Elements redirect (3DS), the page reloads and the confirm modal
 * is gone. Stash saleId before confirmPayment; on return settle via confirm-card.
 * Webhook settle remains the safety net if this client step is skipped.
 */
import { confirmPosCardPayment } from "@/services/pos";

const KEY_PREFIX = "pos_card_confirm:";

export function rememberPosCardConfirmSale(paymentIntentId: string, saleId: string) {
  if (typeof window === "undefined") return;
  if (!paymentIntentId.startsWith("pi_") || !saleId) return;
  try {
    sessionStorage.setItem(`${KEY_PREFIX}${paymentIntentId}`, saleId);
  } catch {
    // private mode / quota — webhook still settles
  }
}

export function clearPosCardConfirmSale(paymentIntentId: string) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(`${KEY_PREFIX}${paymentIntentId}`);
  } catch {
    /* ignore */
  }
}

function stripStripeReturnParams() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("payment_intent") && !url.searchParams.has("redirect_status")) {
    return;
  }
  url.searchParams.delete("payment_intent");
  url.searchParams.delete("payment_intent_client_secret");
  url.searchParams.delete("redirect_status");
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

/**
 * If the URL is a Stripe redirect return with a succeeded PaymentIntent,
 * settle the POS sale and return a cashier message. Idempotent with webhook.
 */
export async function settlePosCardFromStripeReturn(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const paymentIntentId = params.get("payment_intent")?.trim() || "";
  const redirectStatus = params.get("redirect_status")?.trim() || "";
  if (!paymentIntentId.startsWith("pi_")) return null;
  if (redirectStatus && redirectStatus !== "succeeded") {
    stripStripeReturnParams();
    clearPosCardConfirmSale(paymentIntentId);
    return `Card redirect returned ${redirectStatus} — sale stays unpaid until paid.`;
  }
  let saleId = "";
  try {
    saleId = sessionStorage.getItem(`${KEY_PREFIX}${paymentIntentId}`) || "";
  } catch {
    saleId = "";
  }
  if (!saleId) {
    // No stashed sale — leave params for a moment; webhook may still complete.
    stripStripeReturnParams();
    return null;
  }
  try {
    const settled = await confirmPosCardPayment(saleId, { paymentIntentId });
    clearPosCardConfirmSale(paymentIntentId);
    stripStripeReturnParams();
    return settled.sale.status === "completed"
      ? `Sale complete after card redirect: ${settled.sale.publicId}`
      : `Card captured after redirect (${settled.sale.status}): ${settled.sale.publicId}`;
  } catch (err) {
    stripStripeReturnParams();
    return err instanceof Error
      ? `${err.message} If charged, wait for webhook or open the sale and Confirm card.`
      : "Card return settle failed — check the sale or wait for webhook.";
  }
}
