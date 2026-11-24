'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import {
  listAdminVenueLocations,
  venueLocationKeys,
} from '@/services/venueLocations';
import {
  useTicketingSettingsQuery,
  usePatchTicketingSettingsMutation,
} from '@/hooks/useTicketing';
import type { BookingCreateMode, TimeClockFormat } from '@/services/ticketing';
import { useHqLocationFilter } from '@/hooks/useHqLocationFilter';
import AdminHowToGuideModal, {
  AdminHowToGuideButton,
  TICKETING_SETTINGS_GUIDE_STEPS,
} from '@/components/Protected/admin/components/AdminHowToGuideModal';
import { btnPrimaryClass, fieldClass } from './ticketingUi';
import { ADMIN_LIST_STALE_MS } from '@/lib/adminListCache';

export default function TicketingSettingsPage() {
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canManage =
    can(P.TicketingSettingsWrite) || can(P.TicketingManage);
  const canRead =
    can(P.TicketingSettingsRead) ||
    can(P.TicketingRead) ||
    canManage;
  const [guideOpen, setGuideOpen] = useState(false);

  const {
    locationId,
    setLocationId,
    scopedLocationId,
  } = useHqLocationFilter();

  const venuesQuery = useQuery({
    queryKey: venueLocationKeys.list('all'),
    queryFn: () => listAdminVenueLocations({ scope: 'all' }),
    enabled: canRead,
    staleTime: ADMIN_LIST_STALE_MS,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
  });

  const settingsQuery = useTicketingSettingsQuery(
    locationId || null,
    canRead
  );
  const patchMutation = usePatchTicketingSettingsMutation();

  const [defaultCreateMode, setDefaultCreateMode] =
    useState<BookingCreateMode>('hold');
  const [holdTtlMinutes, setHoldTtlMinutes] = useState('15');
  const [reserveTtlHours, setReserveTtlHours] = useState('24');
  const [requireReviewBeforeConfirm, setRequireReviewBeforeConfirm] =
    useState(false);
  const [allowOnlinePayLater, setAllowOnlinePayLater] = useState(false);
  const [payLaterMarksConfirmed, setPayLaterMarksConfirmed] = useState(false);
  const [pastEditGraceMinutes, setPastEditGraceMinutes] = useState('0');
  const [cancelCutoffMinutes, setCancelCutoffMinutes] = useState('');
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [defaultTaxExempt, setDefaultTaxExempt] = useState(false);
  const [timeFormat, setTimeFormat] = useState<TimeClockFormat>('twelve_hour');

  useEffect(() => {
    const s = settingsQuery.data;
    if (!s) return;
    setDefaultCreateMode(s.defaultCreateMode);
    setHoldTtlMinutes(String(s.holdTtlMinutes));
    setReserveTtlHours(String(s.reserveTtlHours));
    setRequireReviewBeforeConfirm(s.requireReviewBeforeConfirm);
    setAllowOnlinePayLater(s.allowOnlinePayLater);
    setPayLaterMarksConfirmed(s.payLaterMarksConfirmed);
    setPastEditGraceMinutes(String(s.pastEditGraceMinutes));
    setCancelCutoffMinutes(
      s.cancelCutoffMinutes == null ? '' : String(s.cancelCutoffMinutes)
    );
    setSmsEnabled(s.smsEnabled);
    setDefaultTaxExempt(s.defaultTaxExempt);
    setTimeFormat(s.timeFormat === 'twenty_four_hour' ? 'twenty_four_hour' : 'twelve_hour');
  }, [settingsQuery.data]);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!canManage) {
      addToast('You need ticketing:manage to save settings', 'error');
      return;
    }
    try {
      await patchMutation.mutateAsync({
        locationId: locationId || null,
        defaultCreateMode,
        holdTtlMinutes: Number(holdTtlMinutes),
        reserveTtlHours: Number(reserveTtlHours),
        requireReviewBeforeConfirm,
        allowOnlinePayLater,
        payLaterMarksConfirmed,
        pastEditGraceMinutes: Number(pastEditGraceMinutes),
        cancelCutoffMinutes:
          cancelCutoffMinutes === '' ? null : Number(cancelCutoffMinutes),
        smsEnabled,
        defaultTaxExempt,
        timeFormat,
      });
      addToast('Ticketing settings saved', 'success');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Could not save settings',
        'error'
      );
    }
  };

  if (!canRead) {
    return (
      <p className="text-sm text-stone-600">
        You do not have permission to view ticketing settings.
      </p>
    );
  }

  const venues = (venuesQuery.data ?? []).filter((v) => {
    if (v.status === 'archived') return false;
    if (scopedLocationId) return v.id === scopedLocationId;
    return true;
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href="/admin/ticketing"
            className="text-sm text-stone-500 hover:text-[#D4AF37]"
          >
            ← Products
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-stone-900">
            Ticketing settings
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            Default hold / reserve / prompt behavior, clock format, TTLs, and
            booking defaults. Open the guide if you are doing this for the first
            time.
          </p>
        </div>
        <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
      </div>

      <AdminHowToGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Ticketing settings"
        subtitle="Follow these steps in order — written for first-time admins."
        steps={TICKETING_SETTINGS_GUIDE_STEPS}
      />

      <label className="block max-w-sm space-y-1">
        <span className="text-xs font-semibold uppercase text-stone-500">
          Venue
        </span>
        <select
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          disabled={Boolean(scopedLocationId)}
          className={fieldClass}
        >
          {scopedLocationId ? null : <option value="">Org default</option>}
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </label>

      {settingsQuery.isLoading && !settingsQuery.data ? (
        <p className="py-10 text-sm text-stone-500">Loading settings…</p>
      ) : (
      <form
        onSubmit={onSave}
        className="space-y-4 rounded-lg border border-stone-200 bg-white p-5"
      >
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase text-stone-500">
            Default create mode
          </span>
          <select
            value={defaultCreateMode}
            onChange={(e) =>
              setDefaultCreateMode(e.target.value as BookingCreateMode)
            }
            className={fieldClass}
            disabled={!canManage}
          >
            <option value="hold">Hold</option>
            <option value="reserve">Reserve</option>
            <option value="prompt">Prompt</option>
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase text-stone-500">
            Time format
          </span>
          <select
            value={timeFormat}
            onChange={(e) =>
              setTimeFormat(e.target.value as TimeClockFormat)
            }
            className={fieldClass}
            disabled={!canManage}
          >
            <option value="twelve_hour">12-hour (AM / PM)</option>
            <option value="twenty_four_hour">24-hour</option>
          </select>
          <span className="block text-xs text-stone-500">
            Used on calendars, session times, date/time pickers, and booking
            wizards for this venue (or the company default).
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-stone-500">
              Hold TTL (minutes)
            </span>
            <input
              type="number"
              min={1}
              value={holdTtlMinutes}
              onChange={(e) => setHoldTtlMinutes(e.target.value)}
              className={fieldClass}
              disabled={!canManage}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-stone-500">
              Reserve TTL (hours)
            </span>
            <input
              type="number"
              min={1}
              value={reserveTtlHours}
              onChange={(e) => setReserveTtlHours(e.target.value)}
              className={fieldClass}
              disabled={!canManage}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-stone-500">
              Past-edit grace (minutes)
            </span>
            <input
              type="number"
              min={0}
              value={pastEditGraceMinutes}
              onChange={(e) => setPastEditGraceMinutes(e.target.value)}
              className={fieldClass}
              disabled={!canManage}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-stone-500">
              Cancel cutoff (minutes)
            </span>
            <input
              type="number"
              min={0}
              value={cancelCutoffMinutes}
              onChange={(e) => setCancelCutoffMinutes(e.target.value)}
              className={fieldClass}
              disabled={!canManage}
              placeholder="Optional"
            />
          </label>
        </div>

        <div className="space-y-2 text-sm text-stone-800">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={requireReviewBeforeConfirm}
              onChange={(e) => setRequireReviewBeforeConfirm(e.target.checked)}
              disabled={!canManage}
            />
            Require review before confirm
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={allowOnlinePayLater}
              onChange={(e) => setAllowOnlinePayLater(e.target.checked)}
              disabled={!canManage}
            />
            Allow online pay later
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={payLaterMarksConfirmed}
              onChange={(e) => setPayLaterMarksConfirmed(e.target.checked)}
              disabled={!canManage}
            />
            Pay later marks confirmed
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={smsEnabled}
              onChange={(e) => setSmsEnabled(e.target.checked)}
              disabled={!canManage}
            />
            SMS enable
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={defaultTaxExempt}
              onChange={(e) => setDefaultTaxExempt(e.target.checked)}
              disabled={!canManage}
            />
            Default tax exempt
          </label>
        </div>

        {canManage ? (
          <button
            type="submit"
            disabled={patchMutation.isPending}
            className={btnPrimaryClass}
          >
            {patchMutation.isPending ? <ButtonSpinner /> : null}
            Save settings
          </button>
        ) : (
          <p className="text-xs text-stone-500">
            Read-only — needs <code>ticketing:manage</code> to save.
          </p>
        )}
      </form>
      )}
    </div>
  );
}
