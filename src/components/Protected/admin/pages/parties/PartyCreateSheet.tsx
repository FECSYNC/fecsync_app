'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarCheck, PartyPopper, Plus } from 'lucide-react';
import { navigateAdminRoute } from '@/lib/adminInstantNav';
import { adminPartyKeys, type PartyDetailDto } from '@/services/adminParties';
import PartiesSideSheet from './PartiesSideSheet';
import PartyCreateWizard from './PartyCreateWizard';
import { centsLabel, formatInZone } from './partyFormat';

/** Book a party (phone / walk-in) in a side sheet over the parties list — no route load. */
export default function PartyCreateSheet({
  initialLocationId,
  onClose,
}: {
  initialLocationId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const dirty = useRef(false);
  const [created, setCreated] = useState<PartyDetailDto | null>(null);
  const [round, setRound] = useState(0);
  const [opening, setOpening] = useState(false);

  const requestClose = useCallback(() => {
    if (!created && dirty.current && !window.confirm('Discard this party? Nothing has been booked yet.')) return;
    onClose();
  }, [created, onClose]);

  const onDirtyChange = useCallback((d: boolean) => {
    dirty.current = d;
  }, []);

  const onCreated = useCallback(
    (party: PartyDetailDto) => {
      dirty.current = false;
      // The detail page reads this key — seed it so "Open party" paints instantly.
      qc.setQueryData(adminPartyKeys.detail(party.bookingId), party);
      setCreated(party);
    },
    [qc]
  );

  const openParty = () => {
    if (!created) return;
    setOpening(true);
    navigateAdminRoute(router, `/admin/parties/${created.bookingId}`);
  };

  const createAnother = () => {
    setCreated(null);
    setRound((r) => r + 1);
  };

  return (
    <PartiesSideSheet
      eyebrow="Parties"
      title={created ? 'Party booked' : 'New party'}
      icon={created ? <CalendarCheck className="h-5 w-5" /> : <PartyPopper className="h-5 w-5" />}
      onRequestClose={requestClose}
      width="max-w-5xl"
    >
      {created ? (
        <div className="mx-auto max-w-lg space-y-5 py-6 text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
            <CalendarCheck className="h-8 w-8" />
          </span>
          <div className="space-y-1">
            <p className="text-xl font-semibold text-stone-900">{created.partyName}</p>
            <p className="text-sm text-stone-600">
              {formatInZone(created.visitStartsAt, created.timezone)}
              {created.location ? ` · ${created.location.name}` : ''}
            </p>
            <p className="text-xs text-stone-500">Booking {created.publicId}</p>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-stone-200 bg-white p-3 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-stone-500">Guests</p>
              <p className="font-semibold text-stone-900">
                {created.kidCount} kids · {created.adultCount} adults
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-stone-500">Total</p>
              <p className="font-semibold text-stone-900">{centsLabel(created.totalCents)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-stone-500">Deposit</p>
              <p className="font-semibold text-stone-900">{centsLabel(created.depositRequiredCents)}</p>
            </div>
          </div>
          <p className="text-sm text-stone-600">
            It is already on the parties list, the bookings calendar, balances and run sheets. Open it to add guests, food,
            or take the deposit.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={openParty}
              disabled={opening}
              className="inline-flex items-center gap-2 rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-stone-950 shadow-sm transition hover:bg-[#c4a030] disabled:opacity-70"
            >
              {opening ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
              {opening ? 'Opening…' : 'Open party'}
            </button>
            <button
              type="button"
              onClick={createAnother}
              className="inline-flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-800 shadow-sm transition hover:bg-stone-50"
            >
              <Plus className="h-4 w-4" />
              Book another
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-100 hover:text-stone-900"
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <PartyCreateWizard
          key={round}
          inModal
          initialLocationId={initialLocationId}
          onCreated={onCreated}
          onDirtyChange={onDirtyChange}
        />
      )}
    </PartiesSideSheet>
  );
}
