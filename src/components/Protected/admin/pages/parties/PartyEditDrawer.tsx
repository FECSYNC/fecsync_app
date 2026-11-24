'use client';

import { FormEvent, useState } from 'react';
import { useToast } from '@/contexts/toast-context';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import { usePartyPackageSessionsQuery, usePatchPartyMutation } from '@/hooks/useParties';
import type { PartyDetailDto } from '@/services/adminParties';
import { btnPrimaryClass, btnSecondaryClass, fieldClass } from './partiesUi';
import { formatInZone, partyErrorMessage } from './partyFormat';

/** The one edit surface for party bookings (bookings Edit routes here via ?edit=1). */
export default function PartyEditDrawer({
  party,
  canOverbook,
  onClose,
}: {
  party: PartyDetailDto;
  canOverbook: boolean;
  onClose: () => void;
}) {
  const { addToast } = useToast();
  const patch = usePatchPartyMutation();
  const sessionsQ = usePartyPackageSessionsQuery(party.package?.id ?? null);
  const [f, setF] = useState({
    partyName: party.partyName,
    honoreeName: party.honoreeName ?? '',
    honoreeAge: party.honoreeAge == null ? '' : String(party.honoreeAge),
    honoreeBirthDate: party.honoreeBirthDate?.slice(0, 10) ?? '',
    kidCount: String(party.kidCount),
    adultCount: String(party.adultCount),
    sessionId: party.sessionId ?? '',
    contactName: party.primaryContactName ?? '',
    contactEmail: party.primaryContactEmail ?? '',
    contactPhone: party.primaryContactPhone ?? '',
    notes: party.notes ?? '',
    foodNotes: party.foodNotes ?? '',
  });
  const [overbook, setOverbook] = useState(false);
  const [overbookReason, setOverbookReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const sessions = (sessionsQ.data ?? []).filter(
    (s) => s.id === party.sessionId || (!s.isClosed && new Date(s.startsAt).getTime() > Date.now())
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const payload: Record<string, unknown> = {};
    if (f.partyName.trim() !== party.partyName) payload.partyName = f.partyName.trim();
    if ((f.honoreeName.trim() || null) !== party.honoreeName) payload.honoreeName = f.honoreeName.trim() || null;
    const age = f.honoreeAge === '' ? null : Number(f.honoreeAge);
    if (age !== party.honoreeAge) payload.honoreeAge = age;
    if ((f.honoreeBirthDate || null) !== (party.honoreeBirthDate?.slice(0, 10) ?? null)) payload.honoreeBirthDate = f.honoreeBirthDate || null;
    if (Number(f.kidCount) !== party.kidCount) payload.kidCount = Number(f.kidCount);
    if (Number(f.adultCount) !== party.adultCount) payload.adultCount = Number(f.adultCount);
    if (f.sessionId && f.sessionId !== party.sessionId) payload.sessionId = f.sessionId;
    const contact: Record<string, string | null> = {};
    if ((f.contactName.trim() || null) !== party.primaryContactName) contact.name = f.contactName.trim() || null;
    if ((f.contactEmail.trim().toLowerCase() || null) !== (party.primaryContactEmail?.toLowerCase() ?? null)) contact.email = f.contactEmail.trim() || null;
    if ((f.contactPhone.trim() || null) !== party.primaryContactPhone) contact.phone = f.contactPhone.trim() || null;
    if (Object.keys(contact).length) payload.contact = contact;
    if ((f.notes.trim() || null) !== party.notes) payload.notes = f.notes.trim() || null;
    if ((f.foodNotes.trim() || null) !== party.foodNotes) payload.foodNotes = f.foodNotes.trim() || null;
    if (overbook) {
      payload.overbook = true;
      payload.overbookReason = overbookReason.trim();
    }
    if (!Object.keys(payload).filter((k) => !k.startsWith('overbook')).length) {
      onClose();
      return;
    }
    patch.mutate(
      { bookingId: party.bookingId, payload },
      {
        onSuccess: () => {
          addToast('Party updated', 'success');
          onClose();
        },
        onError: (err) => setError(partyErrorMessage(err, 'Could not update party')),
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-label="Edit party">
      <form onSubmit={onSubmit} className="h-full w-full max-w-lg space-y-4 overflow-y-auto bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Edit party</h2>
          <button type="button" className={btnSecondaryClass} onClick={onClose}>
            Close
          </button>
        </div>
        {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase text-stone-500">Party name</span>
          <input className={fieldClass} value={f.partyName} onChange={set('partyName')} required />
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="col-span-3 block text-sm sm:col-span-1">
            <span className="mb-1 block text-xs uppercase text-stone-500">Honoree</span>
            <input className={fieldClass} value={f.honoreeName} onChange={set('honoreeName')} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs uppercase text-stone-500">Age</span>
            <input className={fieldClass} inputMode="numeric" value={f.honoreeAge} onChange={set('honoreeAge')} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs uppercase text-stone-500">Birth date</span>
            <input className={fieldClass} type="date" value={f.honoreeBirthDate} onChange={set('honoreeBirthDate')} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm">
            <span className="mb-1 block text-xs uppercase text-stone-500">Kids</span>
            <input className={fieldClass} type="number" min={0} value={f.kidCount} onChange={set('kidCount')} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs uppercase text-stone-500">Adults</span>
            <input className={fieldClass} type="number" min={0} value={f.adultCount} onChange={set('adultCount')} />
          </label>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase text-stone-500">Date & time</span>
          <select className={fieldClass} value={f.sessionId} onChange={set('sessionId')}>
            {!party.sessionId ? <option value="">Keep current time</option> : null}
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {formatInZone(s.startsAt, party.timezone)}
                {s.id === party.sessionId ? ' (current)' : ` · ${s.remaining} left`}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="space-y-2 text-sm">
          <legend className="text-xs uppercase text-stone-500">Contact</legend>
          <input className={fieldClass} placeholder="Name" value={f.contactName} onChange={set('contactName')} />
          <input className={fieldClass} placeholder="Email" type="email" value={f.contactEmail} onChange={set('contactEmail')} />
          <input className={fieldClass} placeholder="Phone" value={f.contactPhone} onChange={set('contactPhone')} />
        </fieldset>
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase text-stone-500">Staff notes</span>
          <textarea className={fieldClass} rows={2} value={f.notes} onChange={set('notes')} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase text-stone-500">Food notes</span>
          <textarea className={fieldClass} rows={2} value={f.foodNotes} onChange={set('foodNotes')} />
        </label>
        {canOverbook ? (
          <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={overbook} onChange={(e) => setOverbook(e.target.checked)} />
              Allow overbook (sold-out slot or booked room)
            </label>
            {overbook ? (
              <input
                className={fieldClass}
                placeholder="Reason (required, logged)"
                value={overbookReason}
                onChange={(e) => setOverbookReason(e.target.value)}
                required
              />
            ) : null}
          </div>
        ) : null}
        <p className="text-xs text-stone-500">
          Changing counts, time, or add-ons reprices the party and re-holds the room through the booking engine. Edits are locked
          once the party has started.
        </p>
        <button type="submit" className={btnPrimaryClass} disabled={patch.isPending}>
          {patch.isPending ? <ButtonSpinner /> : null}
          Save changes
        </button>
      </form>
    </div>
  );
}
