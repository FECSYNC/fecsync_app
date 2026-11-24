'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useToast } from '@/contexts/toast-context';
import {
  useAdminTaxSettingsQuery,
  useUpdateTaxSettingsMutation,
} from '@/hooks/useTaxSettings';
import { formatPrice } from '@/utils/currency';
import { calculateTaxBreakdown } from '@/utils/tax';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';
import { formatAuditDate, formatAuditName } from '@/utils/formatAudit';
import AdminHowToGuideModal, {
  AdminHowToGuideButton,
  TAX_SETTINGS_GUIDE_STEPS,
} from '@/components/Protected/admin/components/AdminHowToGuideModal';

export default function TaxSettingsPage() {
  const { addToast } = useToast();
  const { canManageTax } = useCatalogActionPermissions();
  const { data, isLoading, isError } = useAdminTaxSettingsQuery();
  const updateMutation = useUpdateTaxSettingsMutation();

  const [enabled, setEnabled] = useState(false);
  const [rate, setRate] = useState('0');
  const [label, setLabel] = useState('Tax');
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    if (!data) return;
    setEnabled(Boolean(data.enabled));
    setRate(String(data.rate ?? 0));
    setLabel(data.label?.trim() || 'Tax');
  }, [data]);

  const parsedPreviewRate = Number(rate) || 0;
  // Use an amount other than $100 so 10% does not look like "$10 added as dollars".
  const previewSubtotal = 80;
  const previewBreakdown = calculateTaxBreakdown(
    [{ subtotal: previewSubtotal }],
    {
      enabled,
      rate: parsedPreviewRate,
      label: label.trim() || 'Tax',
    },
    0
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageTax) {
      addToast('You do not have permission to save tax settings', 'error');
      return;
    }
    const parsedRate = Number(rate);
    if (!Number.isFinite(parsedRate) || parsedRate < 0 || parsedRate > 100) {
      addToast('Tax rate must be between 0 and 100', 'error');
      return;
    }

    try {
      await updateMutation.mutateAsync({
        enabled,
        rate: parsedRate,
        label: label.trim() || 'Tax',
      });
      addToast(
        'Tax settings saved. Checkout and new orders will use these rates automatically.',
        'success'
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to save tax settings';
      addToast(message, 'error');
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
        Could not load tax settings. Please refresh and try again.
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tax Settings</h1>
          <p className="text-sm text-gray-600 mt-2">
            Workspace-wide tax rate for checkout. Open the guide if you are
            doing this for the first time.
          </p>
        </div>
        <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
      </div>

      <AdminHowToGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Tax Settings"
        subtitle="Follow these steps in order — written for first-time admins."
        steps={TAX_SETTINGS_GUIDE_STEPS}
      />

      <form
        onSubmit={handleSave}
        className="bg-white rounded-2xl border border-gray-100 p-6 space-y-6"
      >
        <div className="flex items-start justify-between gap-4 rounded-xl border border-[#D4AF37]/20 bg-[#D4AF37]/5 p-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Enable tax</h2>
            <p className="text-xs text-gray-600 mt-1">
              When on, the rate below applies unless an item overrides or is
              exempt.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={!canManageTax}
            onClick={() => setEnabled((v) => !v)}
            className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 border-transparent transition-colors ${
              enabled ? 'bg-[#D4AF37]' : 'bg-gray-200'
            } ${canManageTax ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
          >
            <span
              className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ${
                enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <div>
          <label htmlFor="taxLabel" className="block text-sm font-medium text-gray-700 mb-1.5">
            Label on checkout
          </label>
          <input
            id="taxLabel"
            type="text"
            value={label}
            disabled={!canManageTax}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="VAT, Sales Tax, GST…"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37] disabled:opacity-60"
          />
        </div>

        <div>
          <label htmlFor="taxRate" className="block text-sm font-medium text-gray-700 mb-1.5">
            Global tax rate (%)
          </label>
          <input
            id="taxRate"
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={rate}
            disabled={!canManageTax}
            onChange={(e) => setRate(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40 focus:border-[#D4AF37] disabled:opacity-60"
          />
          <p className="text-xs text-gray-500 mt-1.5">
            Percentage added on top of listed prices at checkout.
          </p>
        </div>

        <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 text-sm">
          <p className="font-medium text-gray-900">Example checkout</p>
          <p className="text-xs text-gray-500 mt-1 mb-3">
            Sample cart only — real checkout uses the customer&apos;s subtotal.
          </p>
          <div className="flex justify-between text-gray-600">
            <span>Subtotal</span>
            <span>{formatPrice(previewSubtotal)}</span>
          </div>
          <div className="flex justify-between text-gray-600 mt-2">
            <span>
              {label || 'Tax'}
              {enabled && parsedPreviewRate > 0 ? ` (${parsedPreviewRate}%)` : ''}
            </span>
            <span>{formatPrice(previewBreakdown.taxAmount)}</span>
          </div>
          <div className="flex justify-between font-semibold text-gray-900 mt-2 pt-2 border-t border-gray-200">
            <span>Total</span>
            <span>{formatPrice(previewBreakdown.total)}</span>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            {!enabled
              ? 'Tax is off, so this example adds $0.00. Turn on Enable tax to apply the rate.'
              : parsedPreviewRate > 0
                ? `${parsedPreviewRate}% of ${formatPrice(previewSubtotal)} = ${formatPrice(previewBreakdown.taxAmount)}`
                : 'Enter a rate above 0 to see tax on this example.'}
          </p>
        </div>

        <button
          type="submit"
          disabled={!canManageTax || updateMutation.isPending}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#D4AF37] text-gray-900 font-semibold hover:bg-[#B8941F] disabled:opacity-60"
        >
          {updateMutation.isPending && <ButtonSpinner />}
          Save tax settings
        </button>
      </form>

      <p className="text-sm text-stone-600">
        Checkout tax here syncs to Accounting as the reserved <strong>SALES</strong> tax
        code when Accounting is initialized. Manage ledger tax codes under{' '}
        <Link href="/admin/accounting/tax-codes" className="text-[#B8941F] underline">
          Accounting → Tax codes
        </Link>
        .
      </p>

      {data && (
        <div className="rounded-xl border border-gray-100 bg-white p-4 text-sm text-gray-700">
          <h2 className="font-semibold text-gray-900 mb-3">Audit</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-gray-500">Created by</div>
              <div>{formatAuditName(data.createdByName)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Updated by</div>
              <div>{formatAuditName(data.updatedByName)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Created</div>
              <div>{formatAuditDate(data.createdAt, 'datetime')}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Updated</div>
              <div>{formatAuditDate(data.updatedAt, 'datetime')}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
