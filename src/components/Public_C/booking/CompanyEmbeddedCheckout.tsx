'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { StripeEmbeddedCheckout } from '@stripe/stripe-js';
import { cancelCompanyCardPayment } from '@/services/publicBooking';
import { guestSafeParkPayoutsMessage } from '@/lib/marketplace/guestParkPayoutsMessage';
import { bookBtnGhost } from './bookingUi';

// Stripe allows one Embedded Checkout instance per page; serialize mount/destroy.
let mountQueue: Promise<unknown> = Promise.resolve();

export default function CompanyEmbeddedCheckout({
  payment,
  cancelHref,
}: {
  payment: {
    clientSecret: string;
    publishableKey: string;
    cancel: { bookingId: string; paymentId: string; token: string };
  };
  cancelHref: string;
}) {
  const router = useRouter();
  const hostRef = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const { clientSecret, publishableKey } = payment;

  useEffect(() => {
    let checkout: StripeEmbeddedCheckout | null = null;
    let cancelled = false;
    mountQueue = mountQueue
      .then(async () => {
        if (cancelled || !hostRef.current) return;
        const { loadStripe } = await import('@stripe/stripe-js');
        const stripe = await loadStripe(publishableKey);
        if (!stripe) throw new Error('Card payments could not load');
        if (cancelled) return;
        const instance = await stripe.initEmbeddedCheckout({ clientSecret });
        if (cancelled || !hostRef.current) {
          instance.destroy();
          return;
        }
        checkout = instance;
        instance.mount(hostRef.current);
      })
      .catch((ex) => {
        if (!cancelled) {
          const raw =
            ex instanceof Error ? ex.message : 'Card payments could not load';
          setErr(guestSafeParkPayoutsMessage(raw));
        }
      });
    return () => {
      cancelled = true;
      checkout?.destroy();
      checkout = null;
    };
  }, [clientSecret, publishableKey]);

  async function onCancel() {
    setCancelling(true);
    try {
      await cancelCompanyCardPayment(payment.cancel);
    } catch {
      /* the hold still expires on its own */
    }
    router.push(cancelHref);
  }

  return (
    <div className="space-y-3">
      <div
        ref={hostRef}
        className="min-h-[420px] rounded-xl border border-stone-200 bg-white p-2"
      />
      {err ? <p className="text-sm text-red-700">{err}</p> : null}
      <button
        type="button"
        className={bookBtnGhost}
        onClick={onCancel}
        disabled={cancelling}
      >
        {cancelling ? 'Cancelling…' : 'Cancel payment'}
      </button>
    </div>
  );
}
