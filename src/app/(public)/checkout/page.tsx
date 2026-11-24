'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useProfileQuery } from '@/hooks/useProfile';
import { useRouter } from 'next/navigation';
import { currentReturnTo, signInHref } from '@/utils/authRedirect';
import AddressSection from '@/components/Public_C/checkout/address-section';
import CartSummary from '@/components/Public_C/checkout/cart-summary';
import PaymentMethodSelector from '@/components/Public_C/checkout/payment-method-selector';
import ShippingMethodSection, {
  type ShippingRatesState,
} from '@/components/Public_C/checkout/shipping-method-section';
import type { Address } from '@/services/profile';
import type { ShippingSelectionInput } from '@/services/order';

function isBaseAddressReady(address?: Address | null): boolean {
  if (!address) return false;
  return Boolean(
    address.line1?.trim() && address.city?.trim() && address.state?.trim()
  );
}

function hasDeliveryPhone(address?: Address | null): boolean {
  return Boolean(address?.phone?.trim());
}

export default function CheckoutPage() {
  const { isAuthenticated, hasHydratedAuth } = useAuthStore();
  const { data: profileData } = useProfileQuery();
  const router = useRouter();

  const [selectedAddress, setSelectedAddress] = useState<Address | undefined>();
  const [selectedShipping, setSelectedShipping] =
    useState<ShippingSelectionInput | null>(null);
  const [ratesRefreshNonce, setRatesRefreshNonce] = useState(0);
  const [ratesState, setRatesState] = useState<ShippingRatesState>({
    ratesAvailable: false,
    shippingRequired: false,
    loading: false,
    error: null,
    options: [],
    quoteSessionId: null,
  });

  const shippingFee = Math.max(0, Number(selectedShipping?.fee) || 0);

  // Server SSOT via rates API shippingRequired; options.length still required to pay.
  const shippingRequired = Boolean(ratesState.shippingRequired);
  const ratesUnavailableForAddress =
    shippingRequired &&
    ratesState.options.length === 0 &&
    !ratesState.loading;
  const shippingReady =
    !ratesState.loading &&
    (!shippingRequired || Boolean(selectedShipping?.optionId));

  // Phone is required for courier rates / live shipping — not when rates are unavailable.
  const phoneRequired =
    shippingRequired ||
    ratesUnavailableForAddress ||
    ratesState.loading ||
    Boolean(ratesState.error);
  const baseAddressValid = isBaseAddressReady(selectedAddress);
  const isAddressValid =
    baseAddressValid && (!phoneRequired || hasDeliveryPhone(selectedAddress));

  // Block pay on rate-fetch failures — error must not look like "shipping off".
  const canPay =
    isAddressValid &&
    shippingReady &&
    !ratesState.loading &&
    !ratesUnavailableForAddress &&
    !ratesState.error;

  useEffect(() => {
    if (hasHydratedAuth && !isAuthenticated) {
      router.push(signInHref(currentReturnTo()));
    }
  }, [isAuthenticated, hasHydratedAuth, router]);

  useEffect(() => {
    if (profileData?.addresses && profileData.addresses.length > 0) {
      const defaultAddr = profileData.addresses.find((addr) => addr.isDefault);
      const firstAddr = profileData.addresses[0];
      const chosen = defaultAddr || firstAddr;
      if (chosen) {
        setSelectedAddress(chosen);
      }
    }
  }, [profileData?.addresses]);

  const handleAddressSelect = useCallback((address: Address) => {
    setSelectedAddress(address);
    setSelectedShipping(null);
  }, []);

  const handleAddressChange = useCallback(() => {
    setSelectedShipping(null);
  }, []);

  const handleShippingSelect = useCallback(
    (selection: ShippingSelectionInput | null) => {
      setSelectedShipping(selection);
    },
    []
  );

  const handleRatesStateChange = useCallback((state: ShippingRatesState) => {
    setRatesState(state);
  }, []);

  if (!hasHydratedAuth) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-[#D4AF37] rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-[#D4AF37] rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Redirecting to sign in...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b ">
        <div className="max-w-7xl mx-auto px-4 py-6 pt-24">
          <h1 className="text-3xl font-bold text-gray-900 mt-2">Checkout</h1>
          <p className="text-sm text-gray-600 mt-2">
            Review your items — products and fabric bundles checkout together.
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          <div className="lg:col-span-3">
            <AddressSection
              selectedAddress={selectedAddress}
              onAddressSelect={handleAddressSelect}
              onAddressChange={handleAddressChange}
            />
            {selectedAddress && !selectedAddress.phone?.trim() && (
              <p className="mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Use the phone field under your address above so shipping rates can load.
              </p>
            )}
            <ShippingMethodSection
              address={selectedAddress}
              selectedShipping={selectedShipping}
              onShippingSelect={handleShippingSelect}
              onRatesStateChange={handleRatesStateChange}
              refreshNonce={ratesRefreshNonce}
            />
          </div>

          <div className="lg:col-span-2">
            <CartSummary
              shippingFee={shippingFee}
              shippingRatesLoading={ratesState.loading}
              shippingRatesError={Boolean(ratesState.error) && !ratesState.loading}
              shippingSelectionPending={
                shippingRequired && !selectedShipping && !ratesState.loading
              }
            />
          </div>
        </div>

        <div className="mt-8">
          <PaymentMethodSelector
            isEnabled={canPay}
            deliveryAddress={selectedAddress}
            shippingSelection={selectedShipping}
            shippingRequired={shippingRequired}
            onShippingInvalid={() => {
              setSelectedShipping(null);
              setRatesRefreshNonce((n) => n + 1);
            }}
          />
          {ratesState.error && !ratesState.loading && (
            <p className="mt-3 text-center text-sm text-amber-700">
              Fix shipping rates above before paying.
            </p>
          )}
          {shippingRequired && !selectedShipping && !ratesState.loading && !ratesState.error && (
            <p className="mt-3 text-center text-sm text-amber-700">
              Select a delivery method to continue to payment.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
