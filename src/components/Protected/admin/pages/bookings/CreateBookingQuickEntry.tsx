'use client';

import {
  Suspense,
  useEffect,
  useState,
  type ComponentType,
  type MouseEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import { btnSecondaryClass } from '../ticketing/ticketingUi';
import { clearAdminInstantNav } from '@/lib/adminInstantNav';
import CreateBookingTabs from './CreateBookingTabs';
import {
  STAFF_CHANNELS,
  initialStaffChannel,
  type StaffChannel,
} from './BookingHolderForm';

/**
 * Tiny create-booking entry (almost no deps). Instant-nav paints this in
 * milliseconds; the heavy wizard chunk loads in the background.
 * Only origin channel is collected here (synced via ?channel=) so the wizard
 * mounts with the same selection — full Details form lives in the wizard.
 */
export default function CreateBookingQuickEntry() {
  const [Wizard, setWizard] = useState<ComponentType | null>(null);
  const [channel, setChannel] = useState<StaffChannel>(() => {
    if (typeof window === 'undefined') return 'walk_in';
    return initialStaffChannel(
      new URL(window.location.href).searchParams.get('channel')
    );
  });

  useEffect(() => {
    let cancelled = false;
    void import('./NewBookingWizardPage')
      .then((mod) => {
        if (!cancelled) setWizard(() => mod.default);
      })
      .catch(() => {
        /* soft-nav / route page will still recover */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('channel') === channel) return;
    url.searchParams.set('channel', channel);
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
  }, [channel]);

  if (Wizard) {
    return (
      <Suspense
        fallback={<OriginShell channel={channel} onChannel={setChannel} loading />}
      >
        <Wizard />
      </Suspense>
    );
  }

  return <OriginShell channel={channel} onChannel={setChannel} loading />;
}

function OriginShell({
  channel,
  onChannel,
  loading,
}: {
  channel: StaffChannel;
  onChannel: (c: StaffChannel) => void;
  loading?: boolean;
}) {
  const router = useRouter();

  const backToList = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    clearAdminInstantNav();
    router.push('/admin/bookings');
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[#D4AF37]">
            Bookings
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Create booking</h1>
          <p className="mt-1 text-sm text-stone-500">
            Details · staff at-venue entry
          </p>
          <p className="mt-2 text-sm text-stone-600">
            Choose origin, then booking holder, product, guests, and options.
          </p>
        </div>
        <button type="button" onClick={backToList} className={btnSecondaryClass}>
          Back to list
        </button>
      </div>

      <CreateBookingTabs
        active="details"
        maxReachableIndex={0}
        onSelect={() => {}}
      />

      <div className="rounded-lg border border-stone-200 bg-white p-5">
        <div className="space-y-2">
          <p className="text-sm font-medium text-stone-800">
            How was this booking taken?
          </p>
          {STAFF_CHANNELS.map((c) => (
            <label
              key={c.value}
              className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-3 text-sm ${
                channel === c.value
                  ? 'border-[#D4AF37] bg-[#D4AF37]/10'
                  : 'border-stone-200 hover:bg-stone-50'
              }`}
            >
              <input
                type="radio"
                className="mt-1"
                checked={channel === c.value}
                onChange={() => onChannel(c.value)}
              />
              <span>
                <span className="block font-medium text-stone-900">
                  {c.label}
                </span>
                <span className="mt-0.5 block text-xs text-stone-500">
                  {c.hint}
                </span>
              </span>
            </label>
          ))}
        </div>

        {loading ? (
          <p className="mt-4 flex items-center gap-2 text-xs text-stone-500">
            <span
              className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-stone-300 border-t-[#D4AF37]"
              aria-hidden
            />
            Preparing holder & product steps…
          </p>
        ) : null}
      </div>
    </div>
  );
}
