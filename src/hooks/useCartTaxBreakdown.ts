'use client';

import { useMemo } from 'react';
import { useCartStore, type CartLine } from '@/store/cartStore';
import { dedupeCartLines } from '@/utils/cartDisplay';
import { estimateCartTaxBreakdown } from '@/utils/cartTax';
import type { TaxBreakdown, TaxSettingsLike } from '@/utils/tax';
import { useTaxSettingsQuery } from '@/hooks/useTaxSettings';

const FALLBACK_SETTINGS: TaxSettingsLike = {
  enabled: false,
  rate: 0,
  label: 'Tax',
};

export function useCartTaxBreakdown(shipping = 0): {
  breakdown: TaxBreakdown;
  settings: TaxSettingsLike;
  isLoading: boolean;
  items: CartLine[];
} {
  const items = useCartStore((s) => s.items);
  const { data: settings, isLoading } = useTaxSettingsQuery();
  const resolvedSettings = settings ?? FALLBACK_SETTINGS;

  const { breakdown, uniqueItems } = useMemo(() => {
    const uniqueItems = dedupeCartLines(items);
    return {
      uniqueItems,
      breakdown: estimateCartTaxBreakdown(uniqueItems, resolvedSettings, shipping),
    };
  }, [items, resolvedSettings, shipping]);

  return {
    breakdown,
    settings: resolvedSettings,
    isLoading,
    items: uniqueItems,
  };
}
