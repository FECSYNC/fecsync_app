'use client';

/**
 * Tax override picker for membership plans.
 * Options stay live with Tax Settings (workspace default) while the plan modal is open.
 */
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ADMIN_LIST_STALE_MS, adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';
import { ADMIN_MEMBERSHIPS_MODAL_LIVE_MS } from '@/utils/adminLiveRefresh';
import { getAdminTaxSettings } from '@/services/tax';
import { taxSettingsKeys } from '@/hooks/useTaxSettings';
import { normalizeTaxRate } from '@/utils/tax';

type Props = {
  /** `default` follows Tax Settings. `0` is no tax. Other values are a saved %. */
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** Poll Tax Settings while the plan modal is open. */
  live?: boolean;
};

function formatPercent(rate: number): string {
  const n = Math.round(normalizeTaxRate(rate) * 100) / 100;
  return Number.isInteger(n) ? String(n) : String(n);
}

type Mode = 'default' | 'none' | 'custom';

function modeFromValue(value: string): Mode {
  if (value === 'default' || !value.trim()) return 'default';
  if (value === '0') return 'none';
  return 'custom';
}

export default function MembershipOverrideTaxField(props: Props) {
  const { value, onChange, disabled, live = true } = props;
  const mode = modeFromValue(value);

  const taxQuery = useQuery({
    queryKey: taxSettingsKeys.admin,
    queryFn: getAdminTaxSettings,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(taxSettingsKeys.admin),
    placeholderData: (prev) => prev,
    staleTime: live ? 0 : ADMIN_LIST_STALE_MS,
    refetchInterval: live ? ADMIN_MEMBERSHIPS_MODAL_LIVE_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: live,
  });

  const settings = taxQuery.data;
  const label = settings?.label?.trim() || 'Tax';
  const settingsEnabled = Boolean(settings?.enabled);
  const appliedRate = settingsEnabled
    ? normalizeTaxRate(settings?.rate ?? 0)
    : 0;
  const defaultPct = formatPercent(appliedRate);

  const [customDraft, setCustomDraft] = useState(() =>
    mode === 'custom' ? formatPercent(Number(value)) : ''
  );

  useEffect(() => {
    if (mode === 'custom') {
      setCustomDraft(formatPercent(Number(value)));
    }
  }, [mode, value]);

  const preview = useMemo(() => {
    if (mode === 'none') return { title: 'No tax', detail: '0% on this membership' };
    if (mode === 'custom') {
      const n = Number(customDraft || value);
      const pct = Number.isFinite(n) ? formatPercent(normalizeTaxRate(n)) : '—';
      return { title: `${pct}%`, detail: 'Custom rate for this plan only' };
    }
    if (!settingsEnabled) {
      return {
        title: `${label} · off`,
        detail: 'Tax Settings is disabled — guests are charged 0% until you enable tax',
      };
    }
    return {
      title: `${label} · ${defaultPct}%`,
      detail: 'Follows Store settings → Tax (updates live)',
    };
  }, [mode, customDraft, value, label, defaultPct, settingsEnabled]);

  function setMode(next: Mode) {
    if (disabled) return;
    if (next === 'default') onChange('default');
    else if (next === 'none') onChange('0');
    else {
      const seed =
        mode === 'custom' && value !== '0' && value !== 'default'
          ? formatPercent(Number(value))
          : defaultPct !== '0'
            ? defaultPct
            : '10';
      setCustomDraft(seed);
      onChange(seed);
    }
  }

  function commitCustom(raw: string) {
    const cleaned = raw.replace(/[^\d.]/g, '');
    setCustomDraft(cleaned);
    if (cleaned === '' || cleaned === '.') return;
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return;
    const clamped = Math.min(100, Math.max(0, n));
    onChange(formatPercent(clamped));
  }

  const optionClass = (active: boolean) =>
    `flex w-full flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
      active
        ? 'border-[#D4AF37] bg-[#D4AF37]/10 ring-1 ring-[#D4AF37]/35'
        : 'border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50'
    }`;

  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-stone-100 bg-stone-50/80 px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
            Tax for this plan
          </p>
          <p className="mt-0.5 text-sm font-semibold text-stone-900">
            {preview.title}
          </p>
          <p className="mt-0.5 text-xs text-stone-500">{preview.detail}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {taxQuery.isFetching ? (
            <span className="text-[11px] text-stone-400">Syncing tax…</span>
          ) : null}
          <Link
            href="/admin/tax-settings"
            className="text-[11px] font-medium text-[#8a7020] underline-offset-2 hover:underline"
          >
            Tax Settings
          </Link>
        </div>
      </div>

      <div className="space-y-2 p-3.5">
        <button
          type="button"
          disabled={disabled}
          className={optionClass(mode === 'default')}
          onClick={() => setMode('default')}
        >
          <span className="text-sm font-medium text-stone-900">
            Follow Tax Settings
          </span>
          <span className="text-xs text-stone-500">
            {settingsEnabled
              ? `${label} at ${defaultPct}% (workspace default)`
              : 'Tax is currently off in Tax Settings (0%)'}
          </span>
        </button>

        <button
          type="button"
          disabled={disabled}
          className={optionClass(mode === 'none')}
          onClick={() => setMode('none')}
        >
          <span className="text-sm font-medium text-stone-900">No tax</span>
          <span className="text-xs text-stone-500">
            Force 0% on this membership even if Tax Settings is on
          </span>
        </button>

        <button
          type="button"
          disabled={disabled}
          className={optionClass(mode === 'custom')}
          onClick={() => setMode('custom')}
        >
          <span className="text-sm font-medium text-stone-900">
            Custom rate
          </span>
          <span className="text-xs text-stone-500">
            Set a percent that applies only to this plan
          </span>
        </button>

        {mode === 'custom' ? (
          <label className="mt-1 block text-sm">
            <span className="text-stone-600">Percent</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                className="w-28 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold tabular-nums text-stone-900 outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/25 disabled:opacity-50"
                value={customDraft}
                disabled={disabled}
                placeholder="e.g. 7.5"
                onChange={(e) => commitCustom(e.target.value)}
                onBlur={() => {
                  if (!customDraft.trim()) {
                    onChange('0');
                    setCustomDraft('0');
                  }
                }}
              />
              <span className="text-sm text-stone-500">%</span>
            </div>
          </label>
        ) : null}
      </div>
    </div>
  );
}
