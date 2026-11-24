'use client';

import { FormEvent, useState } from 'react';
import { useToast } from '@/contexts/toast-context';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import {
  useAddPartyGuestMutation,
  useDeletePartyGuestMutation,
  usePatchPartyGuestMutation,
} from '@/hooks/useParties';
import type { PartyDetailDto, PartyGuestDto } from '@/services/adminParties';
import { btnPrimaryClass, btnSecondaryClass, fieldClass } from './partiesUi';
import { GUEST_KIND_LABELS, partyErrorMessage } from './partyFormat';

type Draft = { kind: PartyGuestDto['kind']; name: string; age: string; email: string; phone: string };

const EMPTY: Draft = { kind: 'kid', name: '', age: '', email: '', phone: '' };

function toPayload(d: Draft) {
  return {
    kind: d.kind,
    name: d.name.trim(),
    age: d.age.trim() === '' ? null : Number(d.age),
    email: d.email.trim() || null,
    phone: d.phone.trim() || null,
  };
}

function GuestFields({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  return (
    <>
      <select
        className={`${fieldClass} w-auto`}
        value={draft.kind}
        onChange={(e) => onChange({ ...draft, kind: e.target.value as Draft['kind'] })}
        aria-label="Guest kind"
      >
        {Object.entries(GUEST_KIND_LABELS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <input className={fieldClass} placeholder="Name" value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
      <input
        className={`${fieldClass} w-20`}
        placeholder="Age"
        inputMode="numeric"
        value={draft.age}
        onChange={(e) => onChange({ ...draft, age: e.target.value.replace(/\D/g, '') })}
      />
      <input className={fieldClass} placeholder="Email" type="email" value={draft.email} onChange={(e) => onChange({ ...draft, email: e.target.value })} />
      <input className={fieldClass} placeholder="Phone" value={draft.phone} onChange={(e) => onChange({ ...draft, phone: e.target.value })} />
    </>
  );
}

export default function PartyGuestsTab({ party, canWrite }: { party: PartyDetailDto; canWrite: boolean }) {
  const { addToast } = useToast();
  const add = useAddPartyGuestMutation();
  const patch = usePatchPartyGuestMutation();
  const remove = useDeletePartyGuestMutation();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | null>(null);

  const kids = party.guests.filter((g) => g.kind === 'kid' || g.kind === 'honoree').length;
  const adults = party.guests.filter((g) => g.kind === 'adult' || g.kind === 'chaperone').length;
  const live = !['cancelled', 'expired', 'refunded'].includes(party.status);

  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.name.trim()) return;
    add.mutate(
      { bookingId: party.bookingId, guest: toPayload(draft) },
      {
        onSuccess: () => {
          setDraft(EMPTY);
          addToast('Guest added', 'success');
        },
        onError: (err) => addToast(partyErrorMessage(err, 'Could not add guest'), 'error'),
      }
    );
  };

  return (
    <div className="space-y-4 rounded-lg border border-stone-200 bg-white p-4 text-sm">
      <p className="text-stone-600">
        Named kids (incl. guest of honor) <strong>{kids}</strong> / {party.kidCount} · Named adults (incl. chaperones){' '}
        <strong>{adults}</strong> / {party.adultCount}
      </p>
      {party.guests.length === 0 ? (
        <p className="text-stone-500">No named guests yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="text-xs uppercase text-stone-500">
              <tr>
                <th className="py-2 pr-3">Kind</th>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Age</th>
                <th className="py-2 pr-3">Email</th>
                <th className="py-2 pr-3">Phone</th>
                <th className="py-2 pr-3">RSVP</th>
                <th className="py-2 pr-3">Waiver</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {party.guests.map((g) =>
                editing?.id === g.id ? (
                  <tr key={g.id}>
                    <td colSpan={8} className="py-2">
                      <div className="flex flex-wrap gap-2">
                        <GuestFields draft={editing.draft} onChange={(d) => setEditing({ id: g.id, draft: d })} />
                        <button
                          type="button"
                          className={btnPrimaryClass}
                          disabled={patch.isPending || !editing.draft.name.trim()}
                          onClick={() =>
                            patch.mutate(
                              { bookingId: party.bookingId, guestId: g.id, guest: toPayload(editing.draft) },
                              {
                                onSuccess: () => {
                                  setEditing(null);
                                  addToast('Guest updated', 'success');
                                },
                                onError: (err) => addToast(partyErrorMessage(err, 'Could not update guest'), 'error'),
                              }
                            )
                          }
                        >
                          {patch.isPending ? <ButtonSpinner /> : null}
                          Save
                        </button>
                        <button type="button" className={btnSecondaryClass} onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={g.id}>
                    <td className="py-2 pr-3">{GUEST_KIND_LABELS[g.kind] ?? g.kind}</td>
                    <td className="py-2 pr-3 font-medium">{g.name ?? 'Guest'}</td>
                    <td className="py-2 pr-3">{g.age ?? '—'}</td>
                    <td className="py-2 pr-3">{g.email ?? '—'}</td>
                    <td className="py-2 pr-3">{g.phone ?? '—'}</td>
                    <td className="py-2 pr-3">{g.rsvpStatus}</td>
                    <td className="py-2 pr-3">{g.waiverStatus}</td>
                    <td className="py-2 text-right">
                      {canWrite && live ? (
                        <span className="flex justify-end gap-2">
                          <button
                            type="button"
                            className="text-xs font-medium text-stone-700 hover:text-[#D4AF37]"
                            onClick={() =>
                              setEditing({
                                id: g.id,
                                draft: {
                                  kind: g.kind,
                                  name: g.name ?? '',
                                  age: g.age == null ? '' : String(g.age),
                                  email: g.email ?? '',
                                  phone: g.phone ?? '',
                                },
                              })
                            }
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="text-xs font-medium text-red-700"
                            disabled={remove.isPending}
                            onClick={() => {
                              if (!window.confirm(`Remove ${g.name ?? 'this guest'}?`)) return;
                              remove.mutate(
                                { bookingId: party.bookingId, guestId: g.id },
                                {
                                  onSuccess: () => addToast('Guest removed', 'success'),
                                  onError: (err) => addToast(partyErrorMessage(err, 'Could not remove guest'), 'error'),
                                }
                              );
                            }}
                          >
                            Remove
                          </button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
      {canWrite && live ? (
        <form onSubmit={onAdd} className="flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
          <GuestFields draft={draft} onChange={setDraft} />
          <button type="submit" className={btnPrimaryClass} disabled={add.isPending || !draft.name.trim()}>
            {add.isPending ? <ButtonSpinner /> : null}
            Add guest
          </button>
        </form>
      ) : null}
    </div>
  );
}
