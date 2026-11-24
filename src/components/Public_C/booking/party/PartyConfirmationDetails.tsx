'use client';

import Link from 'next/link';
import { usePublicPartyConfirmationQuery } from '@/hooks/usePublicParties';
import { centsLabel, formatInZone } from '@/components/Protected/admin/pages/parties/partyFormat';

type PublicParty = {
  publicId: string;
  status: string;
  partyName: string;
  honoreeName: string | null;
  visitStartsAt: string | null;
  timezone: string | null;
  location: { name: string } | null;
  room: { name: string | null } | null;
  kidCount: number;
  adultCount: number;
  package: { name: string } | null;
  totalCents: number;
  amountPaidCents: number;
  amountDueCents: number;
  depositRequiredCents: number;
  depositPaidCents: number;
  depositDueAt: string | null;
  balanceDueAt: string | null;
};

/** Party block on the booking confirmation (view-token holders only; no guest contacts). */
export default function PartyConfirmationDetails({ bookingPublicId, viewToken }: { bookingPublicId: string; viewToken: string }) {
  const q = usePublicPartyConfirmationQuery(bookingPublicId, viewToken);
  const party = q.data?.party as PublicParty | undefined;
  if (!party) return null;
  const depositOwed = Math.max(0, party.depositRequiredCents - party.depositPaidCents);
  return (
    <section className="mb-6 space-y-3 rounded-xl border border-[#D4AF37]/40 bg-[#D4AF37]/5 p-5 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#D4AF37]">Party</p>
      <h2 className="text-xl font-semibold text-stone-900">{party.partyName}</h2>
      {party.honoreeName ? <p>Celebrating {party.honoreeName}</p> : null}
      <p>
        {formatInZone(party.visitStartsAt, party.timezone, { dateStyle: 'full', timeStyle: 'short' })}
        {party.location ? ` · ${party.location.name}` : ''}
        {party.room?.name ? ` · ${party.room.name}` : ''}
      </p>
      <p>
        {party.package?.name ? `${party.package.name} · ` : ''}
        {party.kidCount} kids, {party.adultCount} adults
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-md bg-white p-3">
          <p className="text-xs uppercase text-stone-500">Deposit paid</p>
          <p className="font-semibold">
            {centsLabel(party.depositPaidCents)} of {centsLabel(party.depositRequiredCents)}
          </p>
          {depositOwed > 0 && party.depositDueAt ? (
            <p className="text-xs text-amber-800">due {formatInZone(party.depositDueAt, party.timezone, { dateStyle: 'medium' })}</p>
          ) : null}
        </div>
        <div className="rounded-md bg-white p-3">
          <p className="text-xs uppercase text-stone-500">Paid</p>
          <p className="font-semibold">{centsLabel(party.amountPaidCents)}</p>
        </div>
        <div className="rounded-md bg-white p-3">
          <p className="text-xs uppercase text-stone-500">Amount due</p>
          <p className="font-semibold">{party.amountDueCents > 0 ? centsLabel(party.amountDueCents) : 'Paid in full'}</p>
          {party.amountDueCents > 0 && party.balanceDueAt ? (
            <p className="text-xs text-stone-500">due {formatInZone(party.balanceDueAt, party.timezone, { dateStyle: 'medium' })}</p>
          ) : null}
        </div>
      </div>
      <p>
        <Link href={`/booking/magic/${encodeURIComponent(viewToken)}`} className="font-semibold text-[#D4AF37] underline">
          Manage your party
        </Link>
        <span className="text-stone-500"> — add guests, see invitations, and pay the balance.</span>
      </p>
    </section>
  );
}
