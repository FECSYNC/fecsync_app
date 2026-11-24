"use client";

import { useEffect, useRef, useState } from "react";
import { confirmPosCardPayment } from "@/services/pos";
import {
  clearPosCardConfirmSale,
  rememberPosCardConfirmSale,
} from "./posCardReturn";

export type CardClientSecret = {
  paymentIntentId: string;
  clientSecret: string;
};

type Props = {
  open: boolean;
  saleId: string;
  publicId: string;
  secrets: CardClientSecret[];
  onClose: () => void;
  onSettled: (message: string) => void;
};

/**
 * In-browser Stripe Elements confirm for POS card tenders (fallback when no
 * Terminal reader is linked, or reader collect fails).
 * Card details go to Stripe only — never to this app's API.
 */
export default function PosCardConfirmModal({
  open,
  saleId,
  publicId,
  secrets,
  onClose,
  onSettled,
}: Props) {
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stripeRef = useRef<{
    confirmPayment: (opts: {
      elements: unknown;
      confirmParams: { return_url: string };
      redirect: "if_required";
    }) => Promise<{ error?: { message?: string }; paymentIntent?: { status?: string } }>;
  } | null>(null);
  const elementsRef = useRef<unknown>(null);

  const current = secrets[index] ?? null;

  useEffect(() => {
    if (!open) {
      setIndex(0);
      setReady(false);
      setError("");
      setPending(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !current) return;
    let cancelled = false;
    setReady(false);
    setError("");
    void (async () => {
      const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();
      if (!pk) {
        setError("Stripe publishable key is not configured — use cash or payment link.");
        return;
      }
      try {
        const { loadStripe } = await import("@stripe/stripe-js");
        const stripe = await loadStripe(pk);
        if (!stripe || cancelled) return;
        if (!hostRef.current) {
          if (!cancelled) {
            setError("Card form container missing — close and try Confirm card again.");
          }
          return;
        }
        const elements = stripe.elements({ clientSecret: current.clientSecret });
        const paymentElement = elements.create("payment");
        hostRef.current.innerHTML = "";
        paymentElement.mount(hostRef.current);
        stripeRef.current = stripe as typeof stripeRef.current;
        elementsRef.current = elements;
        if (!cancelled) setReady(true);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load card form");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, current]);

  if (!open || !current) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!stripeRef.current || !elementsRef.current || !current) {
      setError("Card form is not ready");
      return;
    }
    setPending(true);
    setError("");
    try {
      // If Stripe redirects for 3DS, page reloads — settle via posCardReturn on return.
      rememberPosCardConfirmSale(current.paymentIntentId, saleId);
      const result = await stripeRef.current.confirmPayment({
        elements: elementsRef.current,
        confirmParams: { return_url: window.location.href },
        redirect: "if_required",
      });
      if (result.error) {
        clearPosCardConfirmSale(current.paymentIntentId);
        setError(result.error.message || "Card confirmation failed");
        return;
      }
      if (result.paymentIntent?.status && result.paymentIntent.status !== "succeeded") {
        clearPosCardConfirmSale(current.paymentIntentId);
        setError(`Payment is ${result.paymentIntent.status}`);
        return;
      }
      const settled = await confirmPosCardPayment(saleId, {
        paymentIntentId: current.paymentIntentId,
      });
      clearPosCardConfirmSale(current.paymentIntentId);
      const next = index + 1;
      if (next < secrets.length) {
        setIndex(next);
        return;
      }
      onSettled(
        settled.sale.status === "completed"
          ? `Sale complete: ${publicId}`
          : `Card captured for ${publicId} (${settled.sale.status}).`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Card confirmation failed";
      // Stripe may already have captured funds when our settle step fails (void race, etc.).
      setError(
        /cancel|void|settle|Stripe/i.test(message)
          ? `${message} If the card was charged, refresh the sale or wait for the webhook — do not charge again.`
          : message
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-5 shadow-lg"
      >
        <h2 className="text-lg font-semibold text-stone-900">Confirm card payment</h2>
        <p className="mt-1 text-sm text-stone-600">
          Sale {publicId}
          {secrets.length > 1 ? ` — card ${index + 1} of ${secrets.length}` : ""}. No Terminal
          reader on this device — enter the card here, or cancel and use cash / payment link.
        </p>
        <div ref={hostRef} className="mt-4 min-h-[120px] rounded-md border border-stone-300 px-3 py-2" />
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-700"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!ready || pending}
            className="rounded-md bg-[#D4AF37] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Confirming…" : ready ? "Confirm payment" : "Loading form…"}
          </button>
        </div>
      </form>
    </div>
  );
}
