'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { useToast } from '@/contexts/toast-context';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import { useHqLocationFilter } from '@/hooks/useHqLocationFilter';
import {
  useCreatePartyMutation,
  usePartyMenuQuery,
  usePartyPackageSessionsQuery,
  usePartyPackagesQuery,
  usePartyRoomAvailabilityQuery,
} from '@/hooks/useParties';
import {
  adminPartyKeys,
  quoteAdminParty,
  searchAdminPartyContacts,
  type PartyContactDto,
  type PartyDetailDto,
} from '@/services/adminParties';
import {
  PartiesPageHeader,
  PartyScopeBanner,
  btnPrimaryClass,
  btnSecondaryClass,
  fieldClass,
  useActiveVenues,
} from './partiesUi';
import { centsLabel, formatInZone, partyErrorMessage, todayInZone, zonedLocalToIso } from './partyFormat';

const STEPS = [
  'Channel',
  'Venue',
  'Package',
  'Date & room',
  'Guests',
  'Add-ons',
  'Party details',
  'Contact',
  'Deposit',
  'Food',
  'Notes',
  'Booking mode',
  'Review',
] as const;

type FoodPick = { menuItemId: string; qty: number };

function useDebounced<T>(value: T, ms = 400) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function PartyCreateWizard({
  inModal = false,
  initialLocationId,
  onCreated,
  onDirtyChange,
}: {
  /** Rendered inside the create-party side sheet: no page header; URL params belong to the page underneath. */
  inModal?: boolean;
  initialLocationId?: string;
  /** Sheet flow: hand the new party back instead of routing to it. */
  onCreated?: (party: PartyDetailDto) => void;
  onDirtyChange?: (dirty: boolean) => void;
} = {}) {
  const router = useRouter();
  const sp = useSearchParams();
  const can = useAuthStore((s) => s.can);
  const canCreate = can(P.PartiesWrite);
  const canOverbook = can(P.BookingsOverbook);
  const { addToast } = useToast();
  const startLocationId = inModal ? (initialLocationId ?? '') : (sp?.get('locationId') ?? '');
  const { locationId: hqLocation, scopedLocationId, scopedLocationName, locationScoped } =
    useHqLocationFilter(startLocationId);
  const { venues } = useActiveVenues(scopedLocationId);
  const create = useCreatePartyMutation();

  const [step, setStep] = useState(0);
  const [channel, setChannel] = useState<'phone' | 'walk_in'>(
    !inModal && sp?.get('channel') === 'walk_in' ? 'walk_in' : 'phone'
  );
  const [locationId, setLocationId] = useState(startLocationId);
  useEffect(() => {
    if (scopedLocationId) setLocationId(scopedLocationId);
    else if (!locationId && hqLocation) setLocationId(hqLocation);
    else if (!locationId && venues.length === 1) setLocationId(venues[0]!.id);
  }, [scopedLocationId, hqLocation, venues, locationId]);
  const venue = venues.find((v) => v.id === locationId) ?? null;
  const tz = venue?.timezone ?? null;

  const [productId, setProductId] = useState('');
  const [dateTouched, setDateTouched] = useState(false);
  const [date, setDateRaw] = useState(() => todayInZone(null));
  const setDate = (v: string) => {
    setDateTouched(true);
    setDateRaw(v);
  };
  useEffect(() => {
    if (!dateTouched) setDateRaw(todayInZone(tz));
  }, [tz, dateTouched]);
  const [sessionId, setSessionId] = useState('');
  const [customTime, setCustomTime] = useState('');
  const [roomResourceId, setRoomResourceId] = useState('');
  const [kidCount, setKidCount] = useState(10);
  const [adultCount, setAdultCount] = useState(2);
  const [addOns, setAddOns] = useState<Record<string, number>>({});
  const [partyName, setPartyName] = useState('');
  const [honoreeName, setHonoreeName] = useState('');
  const [honoreeAge, setHonoreeAge] = useState('');
  const [honoreeBirthDate, setHonoreeBirthDate] = useState('');
  const [contact, setContact] = useState({ name: '', email: '', phone: '' });
  const [contactQ, setContactQ] = useState('');
  const [food, setFood] = useState<FoodPick[]>([]);
  const [foodPick, setFoodPick] = useState('');
  const [notes, setNotes] = useState('');
  const [createMode, setCreateMode] = useState<'hold' | 'reserve' | ''>('');
  const [overbook, setOverbook] = useState(false);
  const [overbookReason, setOverbookReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const dirty = Boolean(
    productId ||
      partyName.trim() ||
      honoreeName.trim() ||
      contact.name.trim() ||
      contact.email.trim() ||
      contact.phone.trim() ||
      notes.trim() ||
      food.length ||
      Object.keys(addOns).length
  );
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const packagesQ = usePartyPackagesQuery({ locationId: locationId || undefined, status: 'published' });
  const pkg = (packagesQ.data ?? []).find((p) => p.id === productId) ?? null;
  const sessionsQ = usePartyPackageSessionsQuery(productId || null);
  const menuQ = usePartyMenuQuery({ locationId: locationId || undefined });
  const menu = (menuQ.data ?? []).filter((m) => m.available && !m.archivedAt);

  const daySessions = useMemo(
    () =>
      (sessionsQ.data ?? []).filter(
        (s) =>
          !s.isClosed &&
          new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
            new Date(s.startsAt)
          ) === date
      ),
    [sessionsQ.data, date, tz]
  );
  const session = daySessions.find((s) => s.id === sessionId) ?? null;
  const startsAt = session?.startsAt ?? (customTime ? zonedLocalToIso(`${date}T${customTime}`, tz) : null);
  const durationMin = pkg?.config.durationMinutes ?? 120;
  const endsAt = session?.endsAt ?? (startsAt ? new Date(new Date(startsAt).getTime() + durationMin * 60_000).toISOString() : null);

  const roomsQ = usePartyRoomAvailabilityQuery(
    locationId && startsAt && endsAt ? { locationId, startsAt, endsAt } : null
  );
  useEffect(() => {
    if (pkg && !pkg.config.roomAssignedAtBooking && pkg.config.roomResourceId && !roomResourceId) {
      setRoomResourceId(pkg.config.roomResourceId);
    }
    if (pkg) {
      setKidCount((k) => (k === 10 ? Math.max(1, pkg.config.includedKids || 1) : k));
      setAdultCount((a) => (a === 2 ? pkg.config.includedAdults : a));
    }
  }, [pkg, roomResourceId]);
  const room = roomsQ.data?.rooms.find((r) => r.id === roomResourceId) ?? null;
  const roomConflict = Boolean(room && !room.available);

  const payload = useMemo(
    () => ({
      channel,
      locationId,
      productId,
      ...(sessionId ? { sessionId } : startsAt ? { startsAt } : {}),
      roomResourceId: roomResourceId || null,
      kidCount,
      adultCount,
      partyName: partyName.trim() || 'Party',
      honoreeName: honoreeName.trim() || null,
      honoreeAge: honoreeAge === '' ? null : Number(honoreeAge),
      honoreeBirthDate: honoreeBirthDate || null,
      contact: { name: contact.name.trim() || null, email: contact.email.trim() || null, phone: contact.phone.trim() || null },
      addOns: Object.entries(addOns)
        .filter(([, q]) => q > 0)
        .map(([pid, qty]) => ({ productId: pid, qty })),
      foodLines: food.map((f) => ({ menuItemId: f.menuItemId, qty: f.qty })),
      notes: notes.trim() || null,
      ...(createMode ? { createMode } : {}),
      ...(overbook ? { overbook: true, overbookReason: overbookReason.trim() } : {}),
    }),
    [channel, locationId, productId, sessionId, startsAt, roomResourceId, kidCount, adultCount, partyName, honoreeName, honoreeAge, honoreeBirthDate, contact, addOns, food, notes, createMode, overbook, overbookReason]
  );
  const quoteInput = useDebounced(
    productId && locationId && startsAt
      ? {
          channel,
          locationId,
          productId,
          ...(sessionId ? { sessionId } : { startsAt }),
          roomResourceId: roomResourceId || null,
          kidCount,
          adultCount,
          addOns: payload.addOns,
          foodLines: payload.foodLines,
        }
      : null
  );
  const quoteQ = useQuery({
    queryKey: [...adminPartyKeys.all, 'quote', quoteInput],
    queryFn: () => quoteAdminParty(quoteInput as Record<string, unknown>),
    enabled: Boolean(quoteInput),
    retry: false,
  });
  const quote = quoteQ.data ?? null;
  const blocked = Boolean(quote?.soldOut || quote?.roomConflict || roomConflict);

  const contactSearch = useDebounced(contactQ.trim(), 350);
  const contactsQ = useQuery({
    queryKey: [...adminPartyKeys.all, 'contacts', contactSearch],
    queryFn: () => searchAdminPartyContacts(contactSearch),
    enabled: contactSearch.length >= 2,
  });

  const stepValid = (i: number): string | null => {
    switch (STEPS[i]) {
      case 'Venue':
        return locationId ? null : 'Choose a venue';
      case 'Package':
        return productId ? null : 'Choose a published party package';
      case 'Date & room':
        if (!startsAt) return 'Choose a time slot or a start time';
        if (blocked && !(canOverbook && overbook && overbookReason.trim())) {
          return canOverbook ? 'This slot or room is taken — tick overbook and give a reason' : 'This slot or room is taken — pick another';
        }
        return null;
      case 'Guests':
        return quoteQ.error ? partyErrorMessage(quoteQ.error) : kidCount + adultCount > 0 ? null : 'Add at least one guest';
      case 'Party details':
        return partyName.trim() ? null : 'Party name is required';
      case 'Contact':
        return contact.name.trim() && (contact.email.trim() || contact.phone.trim()) ? null : 'Add a contact name and an email or phone';
      default:
        return null;
    }
  };

  const visible = STEPS.map((s, i) => ({ s, i })).filter(
    ({ s }) => !(s === 'Venue' && scopedLocationId) && !(s === 'Booking mode' && !quote?.createModePrompt)
  );
  const pos = visible.findIndex((v) => v.i === step);
  const go = (d: 1 | -1) => {
    if (d === 1) {
      const msg = stepValid(step);
      if (msg) {
        setError(msg);
        return;
      }
    }
    setError(null);
    const next = visible[Math.min(visible.length - 1, Math.max(0, pos + d))];
    if (next) setStep(next.i);
  };

  const submit = () => {
    for (const v of visible) {
      const msg = stepValid(v.i);
      if (msg) {
        setStep(v.i);
        setError(msg);
        return;
      }
    }
    setError(null);
    create.mutate(payload, {
      onSuccess: (party) => {
        addToast('Party created', 'success');
        if (onCreated) onCreated(party);
        else router.push(`/admin/parties/${party.bookingId}`);
      },
      onError: (err) => setError(partyErrorMessage(err, 'Could not create the party')),
    });
  };

  if (!canCreate) {
    return (
      <div className="space-y-4">
        {inModal ? null : <PartiesPageHeader title="New party" />}
        <p className="text-sm text-stone-600">You need parties:write to create parties.</p>
      </div>
    );
  }

  const current = STEPS[step];
  return (
    <div className="space-y-5">
      {inModal ? (
        <p className="text-sm text-stone-600">Book a party by phone or for a walk-in. Online parties come from the public booking page.</p>
      ) : (
        <PartiesPageHeader title="New party" description="Book a party by phone or for a walk-in. Online parties come from the public booking page." />
      )}
      <PartyScopeBanner locationScoped={locationScoped} locationName={scopedLocationName} />
      <ol className="flex flex-wrap gap-1 text-xs">
        {visible.map((v, n) => (
          <li key={v.s}>
            <button
              type="button"
              onClick={() => (v.i < step ? setStep(v.i) : undefined)}
              className={`rounded-full px-2.5 py-1 ${
                v.i === step ? 'bg-stone-900 text-white' : v.i < step ? 'bg-[#D4AF37]/20 text-stone-800' : 'bg-stone-100 text-stone-500'
              }`}
            >
              {n + 1}. {v.s}
            </button>
          </li>
        ))}
      </ol>

      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        <section className="space-y-4 rounded-lg border border-stone-200 bg-white p-5 text-sm">
          <h2 className="text-lg font-semibold">{current}</h2>

          {current === 'Channel' ? (
            <div className="flex gap-3">
              {(['phone', 'walk_in'] as const).map((c) => (
                <label key={c} className={`flex cursor-pointer items-center gap-2 rounded-md border px-4 py-3 ${channel === c ? 'border-[#D4AF37] bg-[#D4AF37]/10' : 'border-stone-200'}`}>
                  <input type="radio" checked={channel === c} onChange={() => setChannel(c)} />
                  {c === 'phone' ? 'Phone booking' : 'Walk-in'}
                </label>
              ))}
            </div>
          ) : null}

          {current === 'Venue' ? (
            <select className={fieldClass} value={locationId} onChange={(e) => { setLocationId(e.target.value); setProductId(''); setRoomResourceId(''); }}>
              <option value="">Choose a venue…</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          ) : null}

          {current === 'Package' ? (
            packagesQ.isPending ? (
              <p className="text-stone-500">Loading packages…</p>
            ) : (packagesQ.data ?? []).length === 0 ? (
              <p className="text-stone-600">
                No published party packages at this venue.{' '}
                <Link href="/admin/parties/packages/new" className="text-[#D4AF37] underline">
                  Create one
                </Link>
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {(packagesQ.data ?? []).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { setProductId(p.id); setSessionId(''); setRoomResourceId(''); setAddOns({}); }}
                    className={`rounded-lg border p-3 text-left ${productId === p.id ? 'border-[#D4AF37] bg-[#D4AF37]/10' : 'border-stone-200 hover:border-stone-300'}`}
                  >
                    <span className="block font-semibold">{p.name}</span>
                    <span className="block text-xs text-stone-500">
                      {centsLabel(p.config.basePriceCents)} · {p.config.includedKids} kids + {p.config.includedAdults} adults included ·{' '}
                      {p.config.durationMinutes} min
                    </span>
                  </button>
                ))}
              </div>
            )
          ) : null}

          {current === 'Date & room' ? (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs uppercase text-stone-500">Date ({tz ?? 'venue time'})</span>
                <input type="date" className={`${fieldClass} w-auto`} value={date} onChange={(e) => { setDate(e.target.value); setSessionId(''); }} />
              </label>
              <div>
                <span className="mb-1 block text-xs uppercase text-stone-500">Time slot</span>
                {daySessions.length === 0 ? (
                  <p className="text-stone-500">No slots on this date. Enter a start time below.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {daySessions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => { setSessionId(s.id); setCustomTime(''); }}
                        className={`rounded-md border px-3 py-1.5 ${sessionId === s.id ? 'border-[#D4AF37] bg-[#D4AF37]/10' : 'border-stone-200'} ${s.remaining < 1 ? 'text-stone-400 line-through' : ''}`}
                      >
                        {formatInZone(s.startsAt, tz, { hour: 'numeric', minute: '2-digit' })} · {s.remaining} left
                      </button>
                    ))}
                  </div>
                )}
                <label className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-stone-500">or start at</span>
                  <input type="time" className={`${fieldClass} w-auto`} value={customTime} onChange={(e) => { setCustomTime(e.target.value); setSessionId(''); }} />
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs uppercase text-stone-500">Room</span>
                <select className={fieldClass} value={roomResourceId} onChange={(e) => setRoomResourceId(e.target.value)} disabled={!startsAt}>
                  <option value="">{pkg?.config.roomAssignedAtBooking ? 'Assign later' : 'No room'}</option>
                  {(roomsQ.data?.rooms ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {r.available ? ' · free' : ' · booked'}
                    </option>
                  ))}
                </select>
              </label>
              {quote?.soldOut ? <p className="font-medium text-amber-800">This slot is sold out.</p> : null}
              {roomConflict || quote?.roomConflict ? (
                <p className="font-medium text-amber-800">
                  {room?.name ?? 'That room'} already has an overlapping party
                  {room?.conflicts?.[0] ? ` (${room.conflicts[0].partyName} ${room.conflicts[0].publicId})` : ''}.
                </p>
              ) : null}
              {blocked && canOverbook ? (
                <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={overbook} onChange={(e) => setOverbook(e.target.checked)} />
                    Overbook anyway
                  </label>
                  {overbook ? (
                    <input className={fieldClass} placeholder="Reason (required, logged)" value={overbookReason} onChange={(e) => setOverbookReason(e.target.value)} />
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {current === 'Guests' ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className="mb-1 block text-xs uppercase text-stone-500">Kids</span>
                  <input type="number" min={0} className={fieldClass} value={kidCount} onChange={(e) => setKidCount(Math.max(0, Number(e.target.value) || 0))} />
                </label>
                <label>
                  <span className="mb-1 block text-xs uppercase text-stone-500">Adults</span>
                  <input type="number" min={0} className={fieldClass} value={adultCount} onChange={(e) => setAdultCount(Math.max(0, Number(e.target.value) || 0))} />
                </label>
              </div>
              {pkg ? (
                <p className="text-stone-600">
                  Included: {pkg.config.includedKids} kids, {pkg.config.includedAdults} adults. Guests {pkg.minGuests ?? 0}–{pkg.maxGuests ?? '∞'}.
                </p>
              ) : null}
              {quote ? (
                <p className="text-stone-700">
                  {quote.extraKids > 0 ? `${quote.extraKids} extra kids × ${centsLabel(quote.extraKidUnitCents)}. ` : ''}
                  {quote.extraAdults > 0 ? `${quote.extraAdults} extra adults × ${centsLabel(quote.extraAdultUnitCents)}. ` : ''}
                  {quote.extraKids === 0 && quote.extraAdults === 0 ? 'No extra-guest charges.' : ''}
                </p>
              ) : null}
              {quoteQ.error ? <p className="font-medium text-red-700">{partyErrorMessage(quoteQ.error)}</p> : null}
            </div>
          ) : null}

          {current === 'Add-ons' ? (
            (pkg?.addOns ?? []).filter((a) => a.published && !a.archived).length === 0 ? (
              <p className="text-stone-500">This package has no add-ons.</p>
            ) : (
              <ul className="space-y-2">
                {(pkg?.addOns ?? [])
                  .filter((a) => a.published && !a.archived)
                  .map((a) => (
                    <li key={a.productId} className="flex items-center justify-between gap-2">
                      <span>
                        {a.name} <span className="text-stone-500">{centsLabel(a.priceCents)}</span>
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={a.maxQty ?? undefined}
                        className={`${fieldClass} w-20`}
                        value={addOns[a.productId] ?? 0}
                        onChange={(e) => setAddOns((p) => ({ ...p, [a.productId]: Math.max(0, Number(e.target.value) || 0) }))}
                        aria-label={`${a.name} quantity`}
                      />
                    </li>
                  ))}
              </ul>
            )
          ) : null}

          {current === 'Party details' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="mb-1 block text-xs uppercase text-stone-500">Party name</span>
                <input className={fieldClass} value={partyName} onChange={(e) => setPartyName(e.target.value)} placeholder="Maya's 7th birthday" />
              </label>
              <label>
                <span className="mb-1 block text-xs uppercase text-stone-500">Honoree name</span>
                <input className={fieldClass} value={honoreeName} onChange={(e) => setHonoreeName(e.target.value)} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label>
                  <span className="mb-1 block text-xs uppercase text-stone-500">Age</span>
                  <input className={fieldClass} inputMode="numeric" value={honoreeAge} onChange={(e) => setHonoreeAge(e.target.value.replace(/\D/g, ''))} />
                </label>
                <label>
                  <span className="mb-1 block text-xs uppercase text-stone-500">Birth date</span>
                  <input type="date" className={fieldClass} value={honoreeBirthDate} onChange={(e) => setHonoreeBirthDate(e.target.value)} />
                </label>
              </div>
            </div>
          ) : null}

          {current === 'Contact' ? (
            <div className="space-y-3">
              <input className={fieldClass} placeholder="Search previous guests by name, email or phone" value={contactQ} onChange={(e) => setContactQ(e.target.value)} />
              {(contactsQ.data ?? []).length ? (
                <ul className="divide-y divide-stone-100 rounded-md border border-stone-200">
                  {(contactsQ.data ?? []).map((c: PartyContactDto, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left hover:bg-stone-50"
                        onClick={() => setContact({ name: c.name ?? '', email: c.email ?? '', phone: c.phone ?? '' })}
                      >
                        <span className="font-medium">{c.name ?? '—'}</span>{' '}
                        <span className="text-stone-500">{[c.email, c.phone].filter(Boolean).join(' · ')}</span>
                        {c.hasAccount ? <span className="ml-2 rounded-full bg-emerald-50 px-2 text-xs text-emerald-800">has account</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-3">
                <input className={fieldClass} placeholder="Name" value={contact.name} onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))} />
                <input className={fieldClass} placeholder="Email" type="email" value={contact.email} onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))} />
                <input className={fieldClass} placeholder="Phone" value={contact.phone} onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))} />
              </div>
              <p className="text-xs text-stone-500">If the email matches an existing account, the party is linked to it. No new account is created.</p>
            </div>
          ) : null}

          {current === 'Deposit' ? (
            quote ? (
              <div className="space-y-1">
                <p>
                  Deposit required: <strong>{centsLabel(quote.depositRequiredCents)}</strong>
                </p>
                <p>Deposit due: {formatInZone(quote.depositDueAt, quote.timezone)}</p>
                <p>Balance due: {formatInZone(quote.balanceDueAt, quote.timezone)}</p>
              </div>
            ) : (
              <p className="text-stone-500">{quoteQ.isFetching ? 'Calculating…' : 'Choose a package, time, and guests first.'}</p>
            )
          ) : null}

          {current === 'Food' ? (
            <div className="space-y-2">
              {food.map((f, i) => (
                <div key={`${f.menuItemId}-${i}`} className="flex items-center gap-2">
                  <span className="min-w-[10rem]">{menu.find((m) => m.id === f.menuItemId)?.name ?? 'Item'}</span>
                  <input type="number" min={1} className={`${fieldClass} w-20`} value={f.qty} onChange={(e) => setFood((p) => p.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x)))} />
                  <button type="button" className="text-xs text-red-700" onClick={() => setFood((p) => p.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <select className={`${fieldClass} w-auto`} value={foodPick} onChange={(e) => setFoodPick(e.target.value)}>
                  <option value="">Add a menu item (optional)…</option>
                  {menu.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} · {centsLabel(m.priceCents)}
                    </option>
                  ))}
                </select>
                <button type="button" className={btnSecondaryClass} disabled={!foodPick} onClick={() => { setFood((p) => [...p, { menuItemId: foodPick, qty: 1 }]); setFoodPick(''); }}>
                  Add
                </button>
              </div>
              <p className="text-xs text-stone-500">Food is saved as a draft. Submit it to the kitchen from the party page.</p>
            </div>
          ) : null}

          {current === 'Notes' ? <textarea className={fieldClass} rows={4} placeholder="Staff notes" value={notes} onChange={(e) => setNotes(e.target.value)} /> : null}

          {current === 'Booking mode' ? (
            <div className="flex gap-3">
              {(['hold', 'reserve'] as const).map((m) => (
                <label key={m} className={`flex items-center gap-2 rounded-md border px-4 py-3 ${createMode === m ? 'border-[#D4AF37] bg-[#D4AF37]/10' : 'border-stone-200'}`}>
                  <input type="radio" checked={createMode === m} onChange={() => setCreateMode(m)} />
                  {m === 'hold' ? 'Hold (expires if unpaid)' : 'Reserve (keeps the slot)'}
                </label>
              ))}
            </div>
          ) : null}

          {current === 'Review' ? (
            quote ? (
              <div className="space-y-2">
                <p className="font-medium">
                  {partyName || 'Party'} · {pkg?.name} · {formatInZone(quote.visitStartsAt, quote.timezone)} · {quote.room?.name ?? 'no room'}
                </p>
                <table className="min-w-full">
                  <tbody className="divide-y divide-stone-100">
                    <tr><td className="py-1">Package</td><td className="py-1 text-right">{centsLabel(quote.packageCents)}</td></tr>
                    {quote.extraKids ? (<tr><td className="py-1">{quote.extraKids} extra kids</td><td className="py-1 text-right">{centsLabel(quote.extraKids * quote.extraKidUnitCents)}</td></tr>) : null}
                    {quote.extraAdults ? (<tr><td className="py-1">{quote.extraAdults} extra adults</td><td className="py-1 text-right">{centsLabel(quote.extraAdults * quote.extraAdultUnitCents)}</td></tr>) : null}
                    {quote.addOnCents ? (<tr><td className="py-1">Add-ons</td><td className="py-1 text-right">{centsLabel(quote.addOnCents)}</td></tr>) : null}
                    {quote.foodCents ? (<tr><td className="py-1">Food</td><td className="py-1 text-right">{centsLabel(quote.foodCents)}</td></tr>) : null}
                    <tr><td className="py-1">Subtotal</td><td className="py-1 text-right">{centsLabel(quote.subtotalCents)}</td></tr>
                    <tr><td className="py-1">Tax</td><td className="py-1 text-right">{centsLabel(quote.taxCents)}</td></tr>
                    <tr className="font-semibold"><td className="py-1">Total</td><td className="py-1 text-right">{centsLabel(quote.totalCents)}</td></tr>
                    <tr><td className="py-1">Deposit</td><td className="py-1 text-right">{centsLabel(quote.depositRequiredCents)}</td></tr>
                  </tbody>
                </table>
                <p className="text-stone-600">
                  Contact {contact.name} {[contact.email, contact.phone].filter(Boolean).join(' · ')} · {channel === 'phone' ? 'Phone' : 'Walk-in'}
                </p>
              </div>
            ) : (
              <p className="text-stone-500">{quoteQ.isFetching ? 'Calculating…' : partyErrorMessage(quoteQ.error, 'Complete the earlier steps first.')}</p>
            )
          ) : null}

          {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">{error}</p> : null}

          <div className="flex justify-between border-t border-stone-100 pt-3">
            <button type="button" className={btnSecondaryClass} disabled={pos <= 0} onClick={() => go(-1)}>
              Back
            </button>
            {current === 'Review' ? (
              <button type="button" className={btnPrimaryClass} disabled={create.isPending || !quote} onClick={submit}>
                {create.isPending ? <ButtonSpinner /> : null}
                Create party
              </button>
            ) : (
              <button type="button" className={btnPrimaryClass} onClick={() => go(1)}>
                Next
              </button>
            )}
          </div>
        </section>

        <aside className="h-fit space-y-2 rounded-lg border border-stone-200 bg-white p-4 text-sm">
          <h3 className="font-semibold">Summary</h3>
          <p className="text-stone-600">{venue?.name ?? 'No venue'}</p>
          <p className="text-stone-600">{pkg?.name ?? 'No package'}</p>
          <p className="text-stone-600">{startsAt ? formatInZone(startsAt, tz) : 'No time'}</p>
          <p className="text-stone-600">{kidCount} kids · {adultCount} adults</p>
          {quote ? (
            <>
              <p className="pt-2 text-lg font-semibold">{centsLabel(quote.totalCents)}</p>
              <p className="text-xs text-stone-500">incl. tax {centsLabel(quote.taxCents)} · deposit {centsLabel(quote.depositRequiredCents)}</p>
            </>
          ) : quoteQ.isFetching ? (
            <p className="text-xs text-stone-500">Calculating…</p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
