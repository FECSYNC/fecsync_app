'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import { AdminHowToGuideButton } from '@/components/Protected/admin/components/AdminHowToGuideButton';
import { DeferredMembershipsGuideModal } from '@/components/Protected/admin/pages/memberships/DeferredMembershipsGuideModal';
import { MEMBERSHIPS_SETTINGS_GUIDE_STEPS } from '@/components/Protected/admin/pages/memberships/membershipsGuides';
import {
  btnPrimaryClass,
  fieldClass,
} from '@/components/Protected/admin/pages/ticketing/ticketingUi';
import {
  listAdminVenueLocations,
  venueLocationKeys,
} from '@/services/venueLocations';
import { useHqLocationFilter } from '@/hooks/useHqLocationFilter';
import { ADMIN_MEMBERSHIPS_SETTINGS_LIVE_MS } from '@/utils/adminLiveRefresh';
import {
  getMembershipSettings,
  membershipKeys,
  putMembershipSettings,
  type MembershipSettingsDto,
} from '@/services/memberships';
import { MEMBERSHIP_GRACE_DAYS_WHEN_UNSET } from '@/lib/memberships/types';
import { notifyMembershipChange } from '@/lib/membershipsSync';
import { notifyMarketingChange } from '@/lib/marketingSync';
import dynamic from 'next/dynamic';

const CancelAlternativesPanel = dynamic(
  () => import('./CancelAlternativesPanel'),
  {
    ssr: false,
    loading: () => (
      <p className="text-sm text-stone-500">Loading cancel alternatives…</p>
    ),
  }
);

type SettingsForm = {
  requirePhotoOnRedeem: boolean;
  requireAgreementBeforeActive: boolean;
  dunningEnabled: boolean;
  clickToCancelEnabled: boolean;
  cancelAlternativesEnabled: boolean;
  allowPause: boolean;
  walletPassEnabled: boolean;
  allowPastDueRedeem: boolean;
  graceDays: string;
  defaultHomeLocationId: string;
};

function formFromSettings(s: MembershipSettingsDto): SettingsForm {
  return {
    requirePhotoOnRedeem: s.requirePhotoOnRedeem,
    requireAgreementBeforeActive: s.requireAgreementBeforeActive,
    dunningEnabled: s.dunningEnabled,
    clickToCancelEnabled: s.clickToCancelEnabled,
    cancelAlternativesEnabled: s.cancelAlternativesEnabled,
    allowPause: s.allowPause,
    walletPassEnabled: s.walletPassEnabled,
    allowPastDueRedeem: s.other?.allowPastDueRedeem === true,
    graceDays: s.graceDays != null ? String(s.graceDays) : '',
    defaultHomeLocationId: s.defaultHomeLocationId ?? '',
  };
}

function scopeOf(locationId: string): string | null {
  return locationId || null;
}

export default function MembershipSettingsPage() {
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.MembershipsWrite) || can(P.MembershipsAdmin);
  const canRead = can(P.MembershipsRead) || canWrite;
  const qc = useQueryClient();
  const { locationId, setLocationId, parkLocked } = useHqLocationFilter();
  const [guideOpen, setGuideOpen] = useState(false);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [dirty, setDirty] = useState(false);
  const [appliedScope, setAppliedScope] = useState<string | null>(null);
  const [appliedUpdatedAt, setAppliedUpdatedAt] = useState('');

  const venuesQuery = useQuery({
    queryKey: venueLocationKeys.list('hq'),
    queryFn: () => listAdminVenueLocations(),
    enabled: canRead,
    staleTime: 0,
    refetchInterval: ADMIN_MEMBERSHIPS_SETTINGS_LIVE_MS,
    refetchIntervalInBackground: false,
    refetchOnMount: 'always',
  });

  const settingsEnabled = canRead && (!parkLocked || Boolean(locationId));
  const settingsQuery = useQuery({
    queryKey: membershipKeys.settings(scopeOf(locationId)),
    queryFn: () => getMembershipSettings(scopeOf(locationId)),
    enabled: settingsEnabled,
    staleTime: 0,
    refetchInterval: settingsEnabled ? ADMIN_MEMBERSHIPS_SETTINGS_LIVE_MS : false,
    refetchIntervalInBackground: false,
    refetchOnMount: 'always',
  });

  const dataMatches =
    settingsQuery.data != null &&
    (settingsQuery.data.locationId ?? '') === locationId;

  useEffect(() => {
    if (!dataMatches || !settingsQuery.data) return;
    const sameScope = appliedScope === locationId;
    if (dirty && sameScope) return;
    setForm(formFromSettings(settingsQuery.data));
    setAppliedScope(locationId);
    setAppliedUpdatedAt(settingsQuery.data.updatedAt);
    setDirty(false);
  }, [appliedScope, dataMatches, dirty, locationId, settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!form) throw new Error('Settings are still loading');
      const rawGrace = form.graceDays.trim();
      let graceDays: number | null = null;
      if (rawGrace) {
        const n = Number(rawGrace);
        if (!Number.isInteger(n) || n < 0 || n > 90) {
          throw new Error('Grace days must be a whole number from 0 to 90');
        }
        graceDays = n;
      }
      const sourceOther =
        dataMatches &&
        settingsQuery.data?.other &&
        typeof settingsQuery.data.other === 'object'
          ? settingsQuery.data.other
          : {};
      return putMembershipSettings({
        locationId: scopeOf(locationId),
        requirePhotoOnRedeem: form.requirePhotoOnRedeem,
        requireAgreementBeforeActive: form.requireAgreementBeforeActive,
        dunningEnabled: form.dunningEnabled,
        clickToCancelEnabled: form.clickToCancelEnabled,
        cancelAlternativesEnabled: form.cancelAlternativesEnabled,
        allowPause: form.allowPause,
        walletPassEnabled: form.walletPassEnabled,
        graceDays,
        defaultHomeLocationId: form.defaultHomeLocationId || null,
        other: {
          ...sourceOther,
          allowPastDueRedeem: form.allowPastDueRedeem,
        },
      });
    },
    onSuccess: (settings) => {
      addToast('Settings saved', 'success');
      qc.setQueryData(membershipKeys.settings(scopeOf(locationId)), settings);
      setForm(formFromSettings(settings));
      setAppliedScope(settings.locationId ?? '');
      setAppliedUpdatedAt(settings.updatedAt);
      setDirty(false);
      notifyMembershipChange(qc, {
        kind: 'settings',
        action: 'update',
        id: settings.id || undefined,
      });
      // Marketing overview Memberships bridge (dunning / past-due) stays live.
      notifyMarketingChange(qc);
    },
    onError: (err: Error) => addToast(err.message || 'Save failed', 'error'),
  });

  function patch(partial: Partial<SettingsForm>) {
    setForm((prev) => (prev ? { ...prev, ...partial } : prev));
    setDirty(true);
  }

  function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (!canWrite || !form || (parkLocked && !locationId)) return;
    saveMutation.mutate();
  }

  function loadLatest() {
    if (!settingsQuery.data || !dataMatches) return;
    setDirty(false);
    setForm(formFromSettings(settingsQuery.data));
    setAppliedScope(locationId);
    setAppliedUpdatedAt(settingsQuery.data.updatedAt);
  }

  if (!canRead) {
    return (
      <div className="p-6 text-sm text-stone-600">
        You do not have permission to view Memberships settings.
      </div>
    );
  }

  const venues = (venuesQuery.data ?? []).filter((v) => v.status === 'active');
  const remoteNewer =
    dirty &&
    dataMatches &&
    settingsQuery.data != null &&
    settingsQuery.data.updatedAt !== appliedUpdatedAt;
  const settings = dataMatches ? settingsQuery.data : undefined;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#D4AF37]">
            Memberships
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-stone-900">Settings</h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Org default or per-venue overrides. Smart dunning, pause (beta),
            guest click-to-cancel, cancel alternatives (beta), and the agreement
            gate enforce from these toggles. Soft-archived parks are omitted
            (cleared on archive).
          </p>
        </div>
        <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
      </header>

      {guideOpen ? (
        <DeferredMembershipsGuideModal
          open={guideOpen}
          onClose={() => setGuideOpen(false)}
          title="Membership settings"
          subtitle="Org default and per-venue policy — dunning/pause live where toggled."
          steps={MEMBERSHIPS_SETTINGS_GUIDE_STEPS}
        />
      ) : null}

      <label className="block max-w-md text-sm">
        <span className="text-stone-700">Venue scope</span>
        <select
          className={fieldClass}
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
        >
          {parkLocked ? null : <option value="">Org default</option>}
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </label>

      {parkLocked && !locationId ? (
        <p className="text-sm text-stone-500">
          This seat is park-locked. Choose an assigned park to view and save its
          membership settings.
        </p>
      ) : settingsQuery.isError && (!form || appliedScope !== locationId) ? (
        <div className="space-y-2 text-sm text-stone-600">
          <p>Could not load membership settings.</p>
          <button
            type="button"
            className="underline"
            onClick={() => void settingsQuery.refetch()}
          >
            Try again
          </button>
        </div>
      ) : !form || appliedScope !== locationId ? (
        <p className="text-sm text-stone-500">Loading settings…</p>
      ) : (
        <form
          onSubmit={onSubmit}
          className="max-w-xl space-y-3 border border-stone-200 bg-white p-4 sm:p-5"
        >
          {settings?.inherited ? (
            <p className="text-xs text-stone-500">
              This park has no saved override yet. Fields show the company
              default. Saving stores a copy for this park only.
            </p>
          ) : settings?.persisted && locationId ? (
            <p className="text-xs text-stone-500">
              Park override. Redeem, billing, dunning, and guest cancel use
              these values at this park.
            </p>
          ) : (
            <p className="text-xs text-stone-500">
              Company default. A park uses these values until it has its own
              saved override.
            </p>
          )}

          {remoteNewer ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <span>Settings changed elsewhere while you were editing.</span>
              <button type="button" className="underline" onClick={loadLatest}>
                Load latest
              </button>
            </div>
          ) : null}

          {(
            [
              ['requirePhotoOnRedeem', 'Require photo on redeem'],
              ['requireAgreementBeforeActive', 'Require agreement before active'],
              ['dunningEnabled', 'Smart dunning enabled'],
              ['clickToCancelEnabled', 'US click-to-cancel enabled'],
              [
                'cancelAlternativesEnabled',
                'Cancel alternatives (beta)',
              ],
              ['allowPause', 'Allow pause (beta)'],
              [
                'walletPassEnabled',
                'Digital wallet passes (signed issuance not shipped — API always not_configured; QR/print still work)',
              ],
              [
                'allowPastDueRedeem',
                'Allow redeem while past_due (warn only)',
              ],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                checked={form[key]}
                disabled={!canWrite}
                onChange={(e) => patch({ [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
          <label className="block text-sm">
            <span className="text-stone-700">Grace days</span>
            <input
              className={fieldClass}
              type="number"
              min="0"
              max="90"
              step="1"
              value={form.graceDays}
              placeholder={String(MEMBERSHIP_GRACE_DAYS_WHEN_UNSET)}
              disabled={!canWrite}
              onChange={(e) => patch({ graceDays: e.target.value })}
            />
            <span className="mt-1 block text-xs text-stone-500">
              Blank uses {MEMBERSHIP_GRACE_DAYS_WHEN_UNSET} days for dunning
              retries and guest cancel.
            </span>
          </label>
          <label className="block text-sm">
            <span className="text-stone-700">Default home venue</span>
            <select
              className={fieldClass}
              value={form.defaultHomeLocationId}
              disabled={!canWrite}
              onChange={(e) => patch({ defaultHomeLocationId: e.target.value })}
            >
              <option value="">None</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-stone-500">
              Create member prefills Home venue from this value until you change
              it. POS product upgrades use it when no home park is passed.
            </span>
          </label>
          {canWrite ? (
            <button
              type="submit"
              className={btnPrimaryClass}
              disabled={saveMutation.isPending || !dataMatches}
            >
              {saveMutation.isPending ? <ButtonSpinner /> : null}
              Save settings
            </button>
          ) : null}
        </form>
      )}

      <CancelAlternativesPanel
        canWrite={canWrite}
        venues={venues}
        scopeLocationId={locationId}
        alternativesEnabled={form?.cancelAlternativesEnabled ?? true}
      />
    </div>
  );
}
