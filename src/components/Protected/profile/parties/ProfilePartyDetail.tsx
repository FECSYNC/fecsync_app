'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelMyParty,
  createMyPartyInvitation,
  createMyPartyPayLink,
  getMyParty,
  mePartyKeys,
  patchMyPartyGuests,
  putMyPartyFood,
  type MyPartyGuest,
} from '@/services/meParties';
import { meBookingKeys } from '@/services/meBookings';
import { bookBtn, bookBtnGhost, bookField } from '@/components/Public_C/booking/bookingUi';
import {
  GUEST_KIND_LABELS,
  centsLabel,
  formatInZone,
  partyErrorMessage,
} from '@/components/Protected/admin/pages/parties/partyFormat';
import ProfileBookingBilling from '@/components/Protected/profile/billing/ProfileBookingBilling';

/** `id` keeps existing rows (RSVP, invitation, signed waivers) — the replace API matches by id. */
type GuestDraft = {
  id?: string;
  kind: MyPartyGuest['kind'];
  name: string;
  age: string;
  email: string;
  phone: string;
  rsvpStatus?: string;
};
const HOST_KINDS: Array<MyPartyGuest['kind']> = ['honoree', 'kid', 'adult', 'chaperone'];

/** Host party page. Never shows POS / staff notes, overbook, invoices, refunds, or host staff. */
export default function ProfilePartyDetail({ bookingId }: { bookingId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: mePartyKeys.detail(bookingId),
    queryFn: () => getMyParty(bookingId),
    retry: false,
    // RSVPs, venue edits and payments land from other sessions.
    staleTime: 15_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [guests, setGuestsRaw] = useState<GuestDraft[]>([]);
  const [food, setFoodRaw] = useState<Array<{ menuItemId: string; qty: number }>>([]);
  const [foodPick, setFoodPick] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  // Refetches (polling, invites, payments) must not overwrite unsaved edits.
  const guestsDirty = useRef(false);
  const foodDirty = useRef(false);
  const setGuests: typeof setGuestsRaw = (v) => {
    guestsDirty.current = true;
    setGuestsRaw(v);
  };
  const setFood: typeof setFoodRaw = (v) => {
    foodDirty.current = true;
    setFoodRaw(v);
  };

  const data = q.data;
  const serverGuests = data?.party.guests;
  const serverFoodOrders = data?.party.foodOrders;
  useEffect(() => {
    if (!serverGuests || guestsDirty.current) return;
    setGuestsRaw(
      serverGuests.map((g) => ({
        id: g.id,
        kind: g.kind,
        name: g.name ?? '',
        age: g.age == null ? '' : String(g.age),
        email: g.email ?? '',
        phone: g.phone ?? '',
        rsvpStatus: g.rsvpStatus,
      }))
    );
  }, [serverGuests]);
  useEffect(() => {
    if (!serverFoodOrders || foodDirty.current) return;
    const draft = serverFoodOrders.find((o) => o.status === 'draft');
    setFoodRaw((draft?.lines ?? []).filter((l) => l.menuItemId).map((l) => ({ menuItemId: l.menuItemId!, qty: l.qty })));
  }, [serverFoodOrders]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: mePartyKeys.all });
    void qc.invalidateQueries({ queryKey: meBookingKeys.all });
  };
  const onErr = (e: unknown) => setMsg({ ok: false, text: partyErrorMessage(e) });

  const saveGuests = useMutation({
    mutationFn: () =>
      patchMyPartyGuests(
        bookingId,
        guests
          .filter((g) => g.name.trim())
          .map((g) => ({
            ...(g.id ? { id: g.id } : {}),
            kind: g.kind,
            name: g.name.trim(),
            age: g.age === '' ? null : Number(g.age),
            email: g.email.trim() || null,
            phone: g.phone.trim() || null,
          }))
      ),
    onSuccess: () => {
      guestsDirty.current = false;
      setMsg({ ok: true, text: 'Guest list saved' });
      refresh();
    },
    onError: onErr,
  });
  const saveFood = useMutation({
    mutationFn: () => putMyPartyFood(bookingId, { lines: food.map((f) => ({ menuItemId: f.menuItemId, qty: f.qty })) }),
    onSuccess: () => {
      foodDirty.current = false;
      setMsg({ ok: true, text: 'Food order saved — the venue will send it to the kitchen' });
      refresh();
    },
    onError: onErr,
  });
  const invite = useMutation({
    mutationFn: (channel: 'email' | 'link') =>
      createMyPartyInvitation(bookingId, channel === 'email' ? { channel, toEmail: inviteEmail.trim(), send: true } : { channel }),
    onSuccess: (inv) => {
      setInviteLink(inv.rsvpUrl ?? null);
      setInviteEmail('');
      setMsg({ ok: true, text: inv.status === 'sent' ? 'Invitation sent' : 'Invitation link created' });
      refresh();
    },
    onError: onErr,
  });
  const pay = useMutation({
    mutationFn: () => createMyPartyPayLink(bookingId),
    onSuccess: (r) => {
      window.location.assign(r.payPath);
    },
    onError: onErr,
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => cancelMyParty(bookingId, reason),
    onSuccess: () => {
      setMsg({ ok: true, text: 'Party cancelled. The venue will contact you about any refund.' });
      refresh();
    },
    onError: onErr,
  });

  if (q.isLoading) return <div className="px-6 py-10 text-sm text-stone-500">Loading party…</div>;
  if (!data) {
    return (
      <div className="space-y-2 px-6 py-10">
        <h1 className="text-xl font-semibold">Party not found</h1>
        <Link href="/profile?tab=parties" className="text-sm text-[#D4AF37]">
          Back to my parties
        </Link>
      </div>
    );
  }
  const { party, capabilities: caps, menu } = data;
  const tz = party.timezone;
  const live = !['cancelled', 'expired', 'refunded'].includes(party.status);
  const foodTotal = food.reduce((s, f) => s + (menu.find((m) => m.id === f.menuItemId)?.priceCents ?? 0) * f.qty, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div>
        <Link href="/profile?tab=parties" className="text-sm text-stone-500 hover:text-[#D4AF37]">
          ← My parties
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-stone-900">{party.partyName}</h1>
        <p className="text-sm text-stone-600">
          {formatInZone(party.visitStartsAt, tz, { dateStyle: 'full', timeStyle: 'short' })} · {party.location?.name}
          {party.room?.name ? ` · ${party.room.name}` : ''} · {party.publicId}
        </p>
        <p className="mt-1 text-sm text-stone-600">
          {party.package?.name ? `${party.package.name} · ` : ''}
          {party.kidCount} kids, {party.adultCount} adults · {party.status.replace(/_/g, ' ')}
        </p>
      </div>

      {msg ? (
        <p className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-800'}`}>
          {msg.text}
        </p>
      ) : null}

      <section className="space-y-2 rounded-xl border border-stone-200 bg-white p-5 text-sm">
        <h2 className="font-semibold">Payment</h2>
        <p>
          Total {centsLabel(party.totalCents)} · Paid {centsLabel(party.amountPaidCents)} · Due{' '}
          <strong>{party.amountDueCents > 0 ? centsLabel(party.amountDueCents) : 'nothing'}</strong>
        </p>
        {party.depositRequiredCents > 0 ? (
          <p className="text-stone-600">
            Deposit {centsLabel(party.depositPaidCents)} of {centsLabel(party.depositRequiredCents)} paid
            {party.balanceDueAt ? ` · balance due ${formatInZone(party.balanceDueAt, tz, { dateStyle: 'medium' })}` : ''}
          </p>
        ) : null}
        {caps.canPay ? (
          <button type="button" className={bookBtn} disabled={pay.isPending} onClick={() => pay.mutate()}>
            {pay.isPending ? 'Opening…' : `Pay ${centsLabel(party.amountDueCents)}`}
          </button>
        ) : null}
      </section>

      <ProfileBookingBilling bookingId={bookingId} />

      <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-5 text-sm">
        <h2 className="font-semibold">Guest list</h2>
        {guests.length === 0 ? <p className="text-stone-500">No named guests yet.</p> : null}
        <ul className="space-y-2">
          {guests.map((g, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              {caps.canEditGuests ? (
                <>
                  <select
                    className={`${bookField} w-auto`}
                    value={g.kind}
                    onChange={(e) => setGuests((p) => p.map((x, j) => (j === i ? { ...x, kind: e.target.value as GuestDraft['kind'] } : x)))}
                  >
                    {HOST_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {GUEST_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                  <input className={`${bookField} w-40`} placeholder="Name" value={g.name} onChange={(e) => setGuests((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <input className={`${bookField} w-16`} placeholder="Age" value={g.age} onChange={(e) => setGuests((p) => p.map((x, j) => (j === i ? { ...x, age: e.target.value.replace(/\D/g, '') } : x)))} />
                  <input className={`${bookField} w-48`} placeholder="Email" value={g.email} onChange={(e) => setGuests((p) => p.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
                  <button type="button" className="text-xs text-red-700" onClick={() => setGuests((p) => p.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </>
              ) : (
                <span>
                  {g.name || 'Guest'} · {GUEST_KIND_LABELS[g.kind] ?? g.kind}
                  {g.age ? ` · ${g.age}` : ''}
                </span>
              )}
              <span className="text-xs text-stone-500">{g.rsvpStatus ?? ''}</span>
            </li>
          ))}
        </ul>
        {caps.canEditGuests ? (
          <div className="flex gap-2">
            <button type="button" className={bookBtnGhost} onClick={() => setGuests((p) => [...p, { kind: 'kid', name: '', age: '', email: '', phone: '' }])}>
              Add guest
            </button>
            <button type="button" className={bookBtn} disabled={saveGuests.isPending} onClick={() => saveGuests.mutate()}>
              Save guest list
            </button>
          </div>
        ) : live ? (
          <p className="text-xs text-stone-500">The venue manages the guest list for this party.</p>
        ) : null}
      </section>

      {caps.canInvite ? (
        <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-5 text-sm">
          <h2 className="font-semibold">Invitations</h2>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (inviteEmail.trim()) invite.mutate('email');
            }}
          >
            <input className={`${bookField} w-64`} type="email" placeholder="Guest email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            <button type="submit" className={bookBtn} disabled={invite.isPending || !inviteEmail.trim()}>
              Send invite
            </button>
            <button type="button" className={bookBtnGhost} disabled={invite.isPending} onClick={() => invite.mutate('link')}>
              Create shareable link
            </button>
          </form>
          {inviteLink ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-stone-50 p-2">
              <span className="break-all text-xs">{inviteLink}</span>
              <button type="button" className="text-xs font-semibold text-[#D4AF37]" onClick={() => void navigator.clipboard?.writeText(inviteLink)}>
                Copy link
              </button>
            </div>
          ) : null}
          {party.invitations.length ? (
            <ul className="divide-y divide-stone-100">
              {party.invitations.map((inv) => (
                <li key={inv.id} className="flex justify-between py-1">
                  <span>{inv.channel}</span>
                  <span className="text-stone-600">{inv.status}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {caps.canEditFood ? (
        <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-5 text-sm">
          <h2 className="font-semibold">Food</h2>
          <p className="text-xs text-stone-500">Changes close {caps.foodOrderCutoffMinutes} minutes before the party.</p>
          {food.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="min-w-[10rem]">{menu.find((m) => m.id === f.menuItemId)?.name ?? 'Item'}</span>
              <input type="number" min={1} className={`${bookField} w-20`} value={f.qty} onChange={(e) => setFood((p) => p.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x)))} />
              <button type="button" className="text-xs text-red-700" onClick={() => setFood((p) => p.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <select className={`${bookField} w-auto`} value={foodPick} onChange={(e) => setFoodPick(e.target.value)}>
              <option value="">Add an item…</option>
              {menu.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {centsLabel(m.priceCents)}
                </option>
              ))}
            </select>
            <button type="button" className={bookBtnGhost} disabled={!foodPick} onClick={() => { setFood((p) => [...p, { menuItemId: foodPick, qty: 1 }]); setFoodPick(''); }}>
              Add
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span>Food total {centsLabel(foodTotal)}</span>
            <button type="button" className={bookBtn} disabled={saveFood.isPending} onClick={() => saveFood.mutate()}>
              Save food
            </button>
          </div>
        </section>
      ) : null}

      {caps.canCancel ? (
        <section className="space-y-2 rounded-xl border border-red-100 bg-white p-5 text-sm">
          <h2 className="font-semibold">Cancel party</h2>
          <p className="text-stone-600">
            You can cancel online until {caps.hostCancelCutoffHours} hours before the party. Refunds are not automatic — the venue will contact you.
          </p>
          <button
            type="button"
            className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700"
            disabled={cancel.isPending}
            onClick={() => {
              const reason = window.prompt('Why are you cancelling?') ?? '';
              if (reason.trim()) cancel.mutate(reason.trim());
            }}
          >
            Cancel party
          </button>
        </section>
      ) : null}
    </div>
  );
}
