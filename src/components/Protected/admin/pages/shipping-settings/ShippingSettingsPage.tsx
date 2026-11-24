'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/contexts/toast-context';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';
import {
  useAdminShippingSettingsQuery,
  useUpdateShippingSettingsMutation,
  useTestShippingConnectionMutation,
} from '@/hooks/useShippingSettings';

type OriginForm = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  lga: string;
  zip: string;
  country: string;
  phone: string;
  contactName: string;
};

const PROVIDER_OPTIONS = [
  { code: 'shipbubble', label: 'Shipbubble (primary multi-courier)' },
  { code: 'fez', label: 'Fez Delivery (fallback)' },
] as const;

export default function ShippingSettingsPage() {
  const { addToast } = useToast();
  const { canWriteShipping } = useCatalogActionPermissions();
  const canManage = canWriteShipping;
  const { data, isLoading, isError } = useAdminShippingSettingsQuery();
  const updateMutation = useUpdateShippingSettingsMutation();
  const testMutation = useTestShippingConnectionMutation();

  const [origin, setOrigin] = useState<OriginForm>({
    line1: '',
    line2: '',
    city: 'Lagos',
    state: 'Lagos',
    lga: '',
    zip: '',
    country: 'NG',
    phone: '',
    contactName: 'FECSYNC',
  });
  const [defaultWeightKg, setDefaultWeightKg] = useState('1');
  const [length, setLength] = useState('30');
  const [width, setWidth] = useState('20');
  const [height, setHeight] = useState('10');
  const [autoBookOnPaid, setAutoBookOnPaid] = useState(true);
  const [enabledProviders, setEnabledProviders] = useState<string[]>([
    'shipbubble',
  ]);
  const [primaryProvider, setPrimaryProvider] = useState('shipbubble');

  useEffect(() => {
    if (!data) return;
    const o = data.originAddress || {};
    setOrigin({
      line1: o.line1 || '',
      line2: o.line2 || '',
      city: o.city || 'Lagos',
      state: o.state || 'Lagos',
      lga: o.lga || '',
      zip: o.zip || '',
      country: o.country || 'NG',
      phone: o.phone || '',
      contactName: o.contactName || 'FECSYNC',
    });
    setDefaultWeightKg(String(data.defaultWeightKg ?? 1));
    setLength(String(data.defaultDimensions?.length ?? 30));
    setWidth(String(data.defaultDimensions?.width ?? 20));
    setHeight(String(data.defaultDimensions?.height ?? 10));
    setAutoBookOnPaid(Boolean(data.autoBookOnPaid));
    setEnabledProviders(
      data.enabledProviders?.length
        ? data.enabledProviders
        : [data.primaryProvider || 'shipbubble']
    );
    setPrimaryProvider(data.primaryProvider || 'shipbubble');
  }, [data]);

  const toggleProvider = (code: string) => {
    setEnabledProviders((prev) => {
      const next = prev.includes(code)
        ? prev.filter((c) => c !== code)
        : [...prev, code];
      if (!next.length) return prev;
      if (!next.includes(primaryProvider)) {
        setPrimaryProvider(next[0]);
      }
      return next;
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) {
      addToast('You do not have permission to save shipping settings', 'error');
      return;
    }
    const weight = Number(defaultWeightKg);
    const L = Number(length);
    const W = Number(width);
    const H = Number(height);
    if (!Number.isFinite(weight) || weight <= 0) {
      addToast('Default weight must be a positive number', 'error');
      return;
    }
    if (![L, W, H].every((n) => Number.isFinite(n) && n > 0)) {
      addToast('Dimensions must be positive numbers', 'error');
      return;
    }
    if (!origin.line1.trim() || !origin.phone.trim()) {
      addToast('Origin street address and phone are required', 'error');
      return;
    }
    if (!enabledProviders.includes(primaryProvider)) {
      addToast('Primary provider must be enabled', 'error');
      return;
    }

    try {
      await updateMutation.mutateAsync({
        originAddress: {
          ...origin,
          line1: origin.line1.trim(),
          line2: origin.line2.trim() || undefined,
          city: origin.city.trim() || 'Lagos',
          state: origin.state.trim() || 'Lagos',
          lga: origin.lga.trim() || undefined,
          zip: origin.zip.trim() || undefined,
          country: origin.country.trim() || 'NG',
          phone: origin.phone.trim(),
          contactName: origin.contactName.trim() || 'FECSYNC',
        },
        defaultWeightKg: weight,
        defaultDimensions: { length: L, width: W, height: H },
        autoBookOnPaid,
        primaryProvider,
        enabledProviders,
      });
      addToast(
        'Shipping settings saved. Checkout rates and booking use these values.',
        'success'
      );
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to save shipping settings',
        'error'
      );
    }
  };

  const handleTest = async () => {
    if (!canManage) return;
    try {
      const result = await testMutation.mutateAsync({
        destinationState: origin.state || 'Lagos',
      });
      addToast(result.message || 'Connection test finished', 'success');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Connection test failed',
        'error'
      );
    }
  };

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-10 h-10 border-4 border-[#D4AF37] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isError && !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Could not load shipping settings. Please refresh and try again.
      </div>
    );
  }

  const fieldClass =
    'w-full px-3 py-2.5 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37] disabled:opacity-60';

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Shipping Settings</h1>
        <p className="text-sm text-gray-600 mt-2">
          Origin warehouse, default parcel, auto-book after payment, and courier
          providers (Shipbubble primary, Fez fallback).
        </p>
      </div>

      <form
        onSubmit={handleSave}
        className="bg-white rounded-2xl border border-gray-100 p-6 space-y-6"
      >
        <div className="flex items-start justify-between gap-4 rounded-xl border border-[#D4AF37]/20 bg-[#D4AF37]/5 p-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              Auto-book on paid
            </h2>
            <p className="text-xs text-gray-600 mt-1">
              When on, a courier label is requested after successful payment.
              Failures never roll back payment.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoBookOnPaid}
            disabled={!canManage}
            onClick={() => setAutoBookOnPaid((v) => !v)}
            className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 border-transparent transition-colors ${
              autoBookOnPaid ? 'bg-[#D4AF37]' : 'bg-gray-200'
            } ${canManage ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
          >
            <span
              className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ${
                autoBookOnPaid ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-gray-900">
            Origin address
          </legend>
          {(
            [
              ['contactName', 'Contact name'],
              ['line1', 'Street address'],
              ['line2', 'Line 2 (optional)'],
              ['city', 'City'],
              ['state', 'State'],
              ['lga', 'LGA (optional)'],
              ['zip', 'Postal code'],
              ['country', 'Country'],
              ['phone', 'Phone'],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <label
                htmlFor={`origin-${key}`}
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                {label}
              </label>
              <input
                id={`origin-${key}`}
                type="text"
                value={origin[key]}
                disabled={!canManage}
                onChange={(e) =>
                  setOrigin((prev) => ({ ...prev, [key]: e.target.value }))
                }
                className={fieldClass}
              />
            </div>
          ))}
        </fieldset>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <label
              htmlFor="defaultWeightKg"
              className="block text-sm font-medium text-gray-700 mb-1.5"
            >
              Default weight (kg)
            </label>
            <input
              id="defaultWeightKg"
              type="number"
              min="0.1"
              step="0.1"
              value={defaultWeightKg}
              disabled={!canManage}
              onChange={(e) => setDefaultWeightKg(e.target.value)}
              className={fieldClass}
            />
          </div>
          {(
            [
              ['length', length, setLength],
              ['width', width, setWidth],
              ['height', height, setHeight],
            ] as const
          ).map(([name, value, setValue]) => (
            <div key={name}>
              <label
                htmlFor={`dim-${name}`}
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                {name} (cm)
              </label>
              <input
                id={`dim-${name}`}
                type="number"
                min="1"
                step="1"
                value={value}
                disabled={!canManage}
                onChange={(e) => setValue(e.target.value)}
                className={fieldClass}
              />
            </div>
          ))}
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-gray-900">
            Enabled providers
          </legend>
          {PROVIDER_OPTIONS.map((p) => (
            <label
              key={p.code}
              className="flex items-start gap-3 text-sm text-gray-800"
            >
              <input
                type="checkbox"
                checked={enabledProviders.includes(p.code)}
                disabled={!canManage}
                onChange={() => toggleProvider(p.code)}
                className="mt-0.5 rounded border-gray-300 text-[#D4AF37] focus:ring-[#D4AF37]"
              />
              <span>{p.label}</span>
            </label>
          ))}
        </fieldset>

        <div>
          <label
            htmlFor="primaryProvider"
            className="block text-sm font-medium text-gray-700 mb-1.5"
          >
            Primary provider
          </label>
          <select
            id="primaryProvider"
            value={primaryProvider}
            disabled={!canManage}
            onChange={(e) => setPrimaryProvider(e.target.value)}
            className={fieldClass}
          >
            {enabledProviders.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="submit"
            disabled={!canManage || updateMutation.isPending}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#D4AF37] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#c4a030] disabled:opacity-60"
          >
            {updateMutation.isPending ? <ButtonSpinner /> : null}
            Save settings
          </button>
          <button
            type="button"
            disabled={!canManage || testMutation.isPending}
            onClick={handleTest}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-60"
          >
            {testMutation.isPending ? <ButtonSpinner /> : null}
            Test connection
          </button>
        </div>
      </form>
    </div>
  );
}
