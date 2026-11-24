'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, Truck } from 'lucide-react';
import { formatPrice } from '@/utils/currency';
import { useCartStore } from '@/store/cartStore';
import {
  fetchShippingRates,
  toShippingSelection,
  type PublicShippingRateOption,
} from '@/services/shipping';
import type { ShippingSelectionInput } from '@/services/order';
import type { Address } from '@/services/profile';

export type ShippingRatesState = {
  ratesAvailable: boolean;
  /** From rates API — mirrors server isShippingCheckoutRequired. */
  shippingRequired: boolean;
  loading: boolean;
  error: string | null;
  options: PublicShippingRateOption[];
  quoteSessionId: string | null;
};

interface ShippingMethodSectionProps {
  address?: Address | null;
  selectedShipping: ShippingSelectionInput | null;
  onShippingSelect: (selection: ShippingSelectionInput | null) => void;
  onRatesStateChange?: (state: ShippingRatesState) => void;
  /** Bump to force a fresh rates fetch (e.g. after expired rematch failure). */
  refreshNonce?: number;
}

function addressReadyForRates(address?: Address | null): boolean {
  return Boolean(
    address?.line1?.trim() &&
      address?.city?.trim() &&
      address?.state?.trim() &&
      address?.phone?.trim()
  );
}

function addressKey(address?: Address | null): string {
  if (!address) return '';
  return [
    address._id,
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.lga,
    address.zip,
    address.country,
    address.phone,
  ]
    .map((v) => String(v ?? '').trim().toLowerCase())
    .join('|');
}

/** Mirror server cart fingerprint — line type + id + qty (not cartId alone). */
function cartContentsKey(
  cartId: string | null | undefined,
  items: Array<{ id: string; lineType?: string; quantity?: number }>
): string {
  const parts = items
    .map((item) => {
      const type = item.lineType === 'fabric' ? 'fabric' : 'product';
      const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
      return `${type}:${item.id}:${qty}`;
    })
    .sort();
  return `${cartId || ''}|${parts.join(',')}`;
}

export default function ShippingMethodSection({
  address,
  selectedShipping,
  onShippingSelect,
  onRatesStateChange,
  refreshNonce = 0,
}: ShippingMethodSectionProps) {
  const cartId = useCartStore((s) => s.cartId);
  const cartItems = useCartStore((s) => s.items);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ratesAvailable, setRatesAvailable] = useState(false);
  const [options, setOptions] = useState<PublicShippingRateOption[]>([]);
  const [quoteSessionId, setQuoteSessionId] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const fetchGen = useRef(0);
  const lastKey = useRef('');

  const publishState = useCallback(
    (next: ShippingRatesState) => {
      onRatesStateChange?.(next);
    },
    [onRatesStateChange]
  );

  const quoteScopeKey = `${addressKey(address)}|${cartContentsKey(cartId, cartItems)}`;
  const fetchKey = `${quoteScopeKey}|r${refreshNonce}|t${retryNonce}`;

  useEffect(() => {
    if (quoteScopeKey !== lastKey.current) {
      lastKey.current = quoteScopeKey;
      onShippingSelect(null);
      setOptions([]);
      setQuoteSessionId(null);
      setError(null);
      setRatesAvailable(false);
      // Keep pay disabled while rates refresh after address/cart changes.
      setLoading(addressReadyForRates(address));
      publishState({
        ratesAvailable: false,
        shippingRequired: false,
        loading: addressReadyForRates(address),
        error: null,
        options: [],
        quoteSessionId: null,
      });
    }
  }, [quoteScopeKey, address, onShippingSelect, publishState]);

  useEffect(() => {
    if (!addressReadyForRates(address)) {
      setLoading(false);
      setError(null);
      setOptions([]);
      setQuoteSessionId(null);
      setRatesAvailable(false);
      publishState({
        ratesAvailable: false,
        shippingRequired: false,
        loading: false,
        error: null,
        options: [],
        quoteSessionId: null,
      });
      return;
    }

    const gen = ++fetchGen.current;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      onShippingSelect(null);
      setOptions([]);
      setQuoteSessionId(null);
      publishState({
        ratesAvailable: false,
        shippingRequired: false,
        loading: true,
        error: null,
        options: [],
        quoteSessionId: null,
      });
      try {
        const res = await fetchShippingRates({
          address: {
            line1: address!.line1,
            line2: address!.line2,
            city: address!.city,
            state: address!.state,
            lga: address!.lga,
            zip: address!.zip,
            country: address!.country,
            phone: address!.phone,
            contactName: address!.contactName,
          },
          cartId: cartId || undefined,
        });
        if (cancelled || gen !== fetchGen.current) return;

        const required =
          typeof res.shippingRequired === 'boolean'
            ? res.shippingRequired
            : Boolean(res.ratesAvailable);
        setRatesAvailable(Boolean(res.ratesAvailable));
        setOptions(res.options ?? []);
        setQuoteSessionId(res.quoteSessionId);
        setError(
          required && (res.options?.length ?? 0) === 0
            ? res.message || 'No courier rates available for this address'
            : null
        );
        publishState({
          ratesAvailable: Boolean(res.ratesAvailable),
          shippingRequired: required,
          loading: false,
          error:
            required && (res.options?.length ?? 0) === 0
              ? res.message || 'No courier rates available for this address'
              : null,
          options: res.options ?? [],
          quoteSessionId: res.quoteSessionId,
        });
      } catch (err) {
        if (cancelled || gen !== fetchGen.current) return;
        const message =
          err instanceof Error ? err.message : 'Failed to load shipping rates';
        setRatesAvailable(false);
        setOptions([]);
        setQuoteSessionId(null);
        setError(message);
        publishState({
          ratesAvailable: false,
          shippingRequired: false,
          loading: false,
          error: message,
          options: [],
          quoteSessionId: null,
        });
      } finally {
        if (!cancelled && gen === fetchGen.current) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    fetchKey,
    address,
    cartId,
    onShippingSelect,
    publishState,
  ]);

  const handleSelect = (option: PublicShippingRateOption) => {
    if (!quoteSessionId) return;
    onShippingSelect(toShippingSelection(quoteSessionId, option));
  };

  if (!addressReadyForRates(address)) {
    return (
      <div className="bg-white rounded-lg border p-6 mt-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Delivery method</h2>
        <p className="text-sm text-gray-600">
          Add a delivery address with a phone number to see shipping rates.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border p-6 mt-6">
      <div className="flex items-center gap-2 mb-4">
        <Truck size={20} className="text-[#B8941F]" />
        <h2 className="text-xl font-semibold text-gray-900">Delivery method</h2>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-600 py-4">
          <Loader2 size={16} className="animate-spin text-[#D4AF37]" />
          Fetching courier rates…
        </div>
      )}

      {!loading && error && (
        <div className="mb-3 space-y-2">
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {error}
          </p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="text-sm font-medium text-[#B8941F] hover:underline"
          >
            Try again
          </button>
        </div>
      )}

      {!loading && !ratesAvailable && !error && (
        <p className="text-sm text-gray-600">
          Live courier rates are not configured for this store. Checkout continues
          without a delivery fee until shipping is enabled.
        </p>
      )}

      {!loading && options.length > 0 && (
        <div className="space-y-3">
          {options.map((option) => {
            const selected = selectedShipping?.optionId === option.optionId;
            return (
              <button
                key={option.optionId}
                type="button"
                onClick={() => handleSelect(option)}
                className={`w-full text-left border rounded-lg p-4 transition-all cursor-pointer ${
                  selected
                    ? 'border-[#D4AF37] bg-[#D4AF37]/10'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 ${
                        selected
                          ? 'border-[#D4AF37] bg-[#D4AF37]'
                          : 'border-gray-300'
                      }`}
                    >
                      {selected && <Check size={12} className="text-white" />}
                    </div>
                    <div>
                      <div className="font-medium text-gray-900">
                        {option.courierName || option.serviceCode}
                      </div>
                      {option.estimatedDaysLabel && (
                        <div className="text-sm text-gray-600 mt-0.5">
                          {option.estimatedDaysLabel}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="font-semibold text-gray-900 whitespace-nowrap">
                    {formatPrice(option.fee)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
