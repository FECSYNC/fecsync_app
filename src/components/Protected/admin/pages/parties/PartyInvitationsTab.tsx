'use client';

import { FormEvent, useState } from 'react';
import { useToast } from '@/contexts/toast-context';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import {
  useCancelPartyInvitationMutation,
  useCreatePartyInvitationMutation,
  useMarkPartyInvitationBouncedMutation,
} from '@/hooks/useParties';
import type { PartyDetailDto, PartyInvitationDto } from '@/services/adminParties';
import { btnPrimaryClass, btnSecondaryClass, fieldClass } from './partiesUi';
import { formatInZone, partyErrorMessage } from './partyFormat';

function inviteState(inv: PartyInvitationDto): { label: string; className: string } {
  const expired =
    ['pending', 'sent'].includes(inv.status) && inv.expiresAt != null && new Date(inv.expiresAt).getTime() <= Date.now();
  if (expired) return { label: 'expired', className: 'bg-stone-100 text-stone-500' };
  switch (inv.status) {
    case 'accepted':
      return { label: 'accepted', className: 'bg-emerald-100 text-emerald-900' };
    case 'declined':
      return { label: 'declined', className: 'bg-stone-200 text-stone-700' };
    case 'bounced':
      return { label: 'bounced', className: 'bg-red-100 text-red-800' };
    case 'cancelled':
      return { label: 'cancelled', className: 'bg-stone-100 text-stone-500' };
    case 'sent':
      return { label: 'sent', className: 'bg-sky-100 text-sky-900' };
    default:
      return { label: 'not sent', className: 'bg-amber-50 text-amber-800' };
  }
}

export default function PartyInvitationsTab({
  party,
  canInvite,
}: {
  party: PartyDetailDto;
  canInvite: boolean;
}) {
  const { addToast } = useToast();
  const create = useCreatePartyInvitationMutation();
  const cancel = useCancelPartyInvitationMutation();
  const bounce = useMarkPartyInvitationBouncedMutation();
  const smsAvailable = party.capabilities?.smsAvailable ?? false;
  const [channel, setChannel] = useState<'email' | 'sms' | 'link'>('email');
  const [guestId, setGuestId] = useState('');
  const [toEmail, setToEmail] = useState('');
  const [toPhone, setToPhone] = useState('');
  const [send, setSend] = useState(true);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const live = !['cancelled', 'expired', 'refunded'].includes(party.status);
  const guestsWithoutInvite = party.guests.filter((g) => !g.invitationId);

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        bookingId: party.bookingId,
        input: {
          channel,
          guestId: guestId || null,
          toEmail: channel === 'email' ? toEmail.trim() || null : null,
          toPhone: channel === 'sms' ? toPhone.trim() || null : null,
          send: channel !== 'link' && send,
        },
      },
      {
        onSuccess: (inv) => {
          const url = inv?.rsvpUrl ?? null;
          setLastLink(url);
          setToEmail('');
          setToPhone('');
          setGuestId('');
          addToast(inv?.status === 'sent' ? 'Invitation sent' : 'Invitation created', 'success');
        },
        onError: (err) => addToast(partyErrorMessage(err, 'Could not create invitation'), 'error'),
      }
    );
  };

  return (
    <div className="space-y-4 rounded-lg border border-stone-200 bg-white p-4 text-sm">
      {canInvite && live ? (
        <form onSubmit={onCreate} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select className={`${fieldClass} w-auto`} value={guestId} onChange={(e) => setGuestId(e.target.value)} aria-label="For guest">
              <option value="">Blank invitation (new guest RSVPs)</option>
              {guestsWithoutInvite.map((g) => (
                <option key={g.id} value={g.id}>
                  For {g.name ?? 'guest'}
                </option>
              ))}
            </select>
            <select
              className={`${fieldClass} w-auto`}
              value={channel}
              onChange={(e) => setChannel(e.target.value as typeof channel)}
              aria-label="Channel"
            >
              <option value="email">Email</option>
              <option value="sms" disabled={!smsAvailable}>
                SMS{smsAvailable ? '' : ' (unavailable)'}
              </option>
              <option value="link">Link only (copy)</option>
            </select>
            {channel === 'email' ? (
              <input className={fieldClass} type="email" placeholder="guest@example.com" value={toEmail} onChange={(e) => setToEmail(e.target.value)} required />
            ) : null}
            {channel === 'sms' ? (
              <input className={fieldClass} placeholder="Mobile number" value={toPhone} onChange={(e) => setToPhone(e.target.value)} required />
            ) : null}
            {channel !== 'link' ? (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} />
                Send now
              </label>
            ) : null}
            <button type="submit" className={btnPrimaryClass} disabled={create.isPending}>
              {create.isPending ? <ButtonSpinner /> : null}
              Create invitation
            </button>
          </div>
          {!smsAvailable ? <p className="text-xs text-stone-500">SMS invitations need an SMS provider (PARTY_SMS_PROVIDER or BOOKING_SMS_PROVIDER).</p> : null}
        </form>
      ) : null}
      {lastLink ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#D4AF37]/40 bg-[#D4AF37]/10 p-2">
          <span className="break-all text-xs">{lastLink}</span>
          <button
            type="button"
            className={btnSecondaryClass}
            onClick={() => {
              void navigator.clipboard?.writeText(lastLink).then(() => addToast('Link copied', 'success'));
            }}
          >
            Copy link
          </button>
          <span className="text-xs text-stone-500">Shown once — invitation links are not stored in the list.</span>
        </div>
      ) : null}
      {party.invitations.length === 0 ? (
        <p className="text-stone-500">No invitations yet.</p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {party.invitations.map((inv) => {
            const state = inviteState(inv);
            const guest = party.guests.find((g) => g.id === inv.guestId);
            return (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{inv.sentTo ?? (inv.channel === 'link' ? 'Link' : '—')}</span>
                  <span className="text-stone-500">
                    {' '}
                    · {inv.channel}
                    {guest ? ` · for ${guest.name ?? 'guest'}` : ''}
                    {inv.expiresAt ? ` · expires ${formatInZone(inv.expiresAt, party.timezone, { dateStyle: 'medium' })}` : ''}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${state.className}`}>{state.label}</span>
                  {canInvite && ['pending', 'sent'].includes(inv.status) && inv.channel !== 'link' ? (
                    <button
                      type="button"
                      className="text-xs font-medium text-stone-600 hover:text-red-700"
                      disabled={bounce.isPending}
                      onClick={() =>
                        bounce.mutate(
                          { bookingId: party.bookingId, inviteId: inv.id },
                          {
                            onSuccess: () => addToast('Marked bounced', 'success'),
                            onError: (err) => addToast(partyErrorMessage(err), 'error'),
                          }
                        )
                      }
                    >
                      Mark bounced
                    </button>
                  ) : null}
                  {canInvite && ['pending', 'sent', 'bounced'].includes(inv.status) ? (
                    <button
                      type="button"
                      className="text-xs font-medium text-red-700"
                      disabled={cancel.isPending}
                      onClick={() =>
                        cancel.mutate(
                          { bookingId: party.bookingId, inviteId: inv.id },
                          {
                            onSuccess: () => addToast('Invitation cancelled', 'success'),
                            onError: (err) => addToast(partyErrorMessage(err), 'error'),
                          }
                        )
                      }
                    >
                      Cancel
                    </button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-stone-500">
        Email bounces are not reported back automatically. If a guest says the invite never arrived, mark it bounced and send a new one to a corrected address.
      </p>
    </div>
  );
}
