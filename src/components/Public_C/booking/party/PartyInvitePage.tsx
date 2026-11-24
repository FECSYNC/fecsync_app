'use client';

import { FormEvent, useState } from 'react';
import { usePublicPartyInvitationQuery, usePublicPartyRsvpMutation } from '@/hooks/usePublicParties';
import { bookBtn, bookBtnGhost, bookField } from '../bookingUi';
import { formatInZone, partyErrorMessage } from '@/components/Protected/admin/pages/parties/partyFormat';

const CLOSED_COPY: Record<string, string> = {
  party_cancelled: 'This party was cancelled, so RSVPs are closed.',
  invite_cancelled: 'This invitation was withdrawn by the host.',
  invite_expired: 'This invitation has expired.',
};

/** Canonical invitation landing (/party/invite/[token]). No account needed. */
export default function PartyInvitePage({ token }: { token: string }) {
  const q = usePublicPartyInvitationQuery(token);
  const rsvp = usePublicPartyRsvpMutation(token);
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [err, setErr] = useState<string | null>(null);

  if (q.isPending) return <main className="mx-auto max-w-lg px-4 py-10 text-sm text-stone-500">Loading invitation…</main>;
  if (q.isError || !q.data) {
    return (
      <main className="mx-auto max-w-lg space-y-2 px-4 py-10">
        <h1 className="text-2xl font-semibold">Invitation not found</h1>
        <p className="text-sm text-stone-600">{partyErrorMessage('PARTY_INVITE_INVALID')} Check the link in your message.</p>
      </main>
    );
  }
  const inv = q.data;
  const answered = inv.rsvpStatus === 'accepted' || inv.rsvpStatus === 'declined';

  const submit = (accept: boolean) => {
    setErr(null);
    rsvp.mutate(
      { accept, name: name.trim() || undefined, age: age === '' ? null : Number(age) },
      { onError: (e) => setErr(partyErrorMessage(e, 'Could not save your RSVP')) }
    );
  };
  const onAccept = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErr('Please enter the guest’s name.');
      return;
    }
    submit(true);
  };

  return (
    <main className="mx-auto max-w-lg space-y-5 px-4 py-10">
      <div className="space-y-1 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#D4AF37]">You&apos;re invited</p>
        <h1 className="text-3xl font-semibold text-stone-900">{inv.partyName}</h1>
        {inv.honoreeName ? <p className="text-stone-700">Celebrating {inv.honoreeName}</p> : null}
        <p className="text-sm text-stone-600">
          {formatInZone(inv.visitStartsAt, inv.timezone, { dateStyle: 'full', timeStyle: 'short' })}
          {inv.venueName ? ` · ${inv.venueName}` : ''}
        </p>
      </div>
      {answered ? (
        <p className="rounded-xl border border-stone-200 bg-white p-5 text-center text-sm">
          {inv.rsvpStatus === 'accepted' ? 'Your RSVP is saved — see you at the party!' : 'You declined this invitation.'}
          {inv.respondedAt ? (
            <span className="mt-1 block text-xs text-stone-500">
              Answered {formatInZone(inv.respondedAt, inv.timezone, { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          ) : null}
        </p>
      ) : !inv.open ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-center text-sm text-amber-900">
          {CLOSED_COPY[inv.closedReason ?? ''] ?? 'RSVPs for this party are closed.'}
        </p>
      ) : (
        <form onSubmit={onAccept} className="space-y-3 rounded-xl border border-stone-200 bg-white p-5 text-sm">
          <label className="block">
            <span className="mb-1 block text-xs uppercase text-stone-500">Guest name</span>
            <input className={bookField} value={name} onChange={(e) => setName(e.target.value)} placeholder="Who is coming?" />
          </label>
          <label className="block w-32">
            <span className="mb-1 block text-xs uppercase text-stone-500">Age (optional)</span>
            <input className={bookField} inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, ''))} />
          </label>
          {err ? <p className="text-red-700">{err}</p> : null}
          <div className="flex gap-2">
            <button type="submit" className={bookBtn} disabled={rsvp.isPending}>
              Accept
            </button>
            <button type="button" className={bookBtnGhost} disabled={rsvp.isPending} onClick={() => submit(false)}>
              Decline
            </button>
          </div>
          <p className="text-xs text-stone-500">No account needed.</p>
        </form>
      )}
    </main>
  );
}
