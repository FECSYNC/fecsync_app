'use client';

import { useMemo, useState } from 'react';
import { useToast } from '@/contexts/toast-context';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import { useMovePartyRoomMutation, usePartyRoomAvailabilityQuery } from '@/hooks/useParties';
import type { PartyDetailDto } from '@/services/adminParties';
import { btnPrimaryClass, fieldClass } from './partiesUi';
import { formatInZone, partyErrorMessage, timeInZone, zonedLocalToIso } from './partyFormat';

function dayWindow(iso: string | null, timezone: string | null) {
  if (!iso) return null;
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
  const start = zonedLocalToIso(`${ymd}T00:00`, timezone);
  const end = start ? new Date(new Date(start).getTime() + 24 * 3600_000).toISOString() : null;
  return start && end ? { start, end } : null;
}

export default function PartyRoomTab({
  party,
  canWrite,
  canOverbook,
}: {
  party: PartyDetailDto;
  canWrite: boolean;
  canOverbook: boolean;
}) {
  const { addToast } = useToast();
  const move = useMovePartyRoomMutation();
  const day = dayWindow(party.visitStartsAt, party.timezone);
  const dayQ = usePartyRoomAvailabilityQuery(
    day ? { locationId: party.locationId, startsAt: day.start, endsAt: day.end } : null
  );
  const slotQ = usePartyRoomAvailabilityQuery(
    party.visitStartsAt && party.visitEndsAt
      ? {
          locationId: party.locationId,
          startsAt: party.visitStartsAt,
          endsAt: party.visitEndsAt,
          excludeBookingId: party.bookingId,
        }
      : null
  );
  const [roomId, setRoomId] = useState('');
  const [overbook, setOverbook] = useState(false);
  const [reason, setReason] = useState('');
  const live = !['cancelled', 'expired', 'refunded'].includes(party.status);

  const assigned = dayQ.data?.rooms.find((r) => r.id === party.room?.id) ?? null;
  const timeline = useMemo(
    () =>
      [
        ...(assigned?.conflicts ?? []),
      ].sort((a, b) => (a.visitStartsAt ?? '').localeCompare(b.visitStartsAt ?? '')),
    [assigned]
  );
  const target = slotQ.data?.rooms.find((r) => r.id === roomId) ?? null;
  const conflict = Boolean(target && !target.available);

  return (
    <div className="space-y-4 rounded-lg border border-stone-200 bg-white p-4 text-sm">
      <p>
        Assigned room: <strong>{party.room?.name ?? 'Unassigned'}</strong>
        {party.visitStartsAt ? (
          <span className="text-stone-500">
            {' '}
            · {timeInZone(party.visitStartsAt, party.timezone)}–{timeInZone(party.visitEndsAt, party.timezone)}
          </span>
        ) : null}
      </p>
      {party.room ? (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
            {party.room.name} on {formatInZone(party.visitStartsAt, party.timezone, { dateStyle: 'medium' })}
          </h3>
          {dayQ.isPending ? (
            <p className="text-stone-500">Loading room day…</p>
          ) : timeline.length === 0 ? (
            <p className="text-stone-500">No other parties in this room today.</p>
          ) : (
            <ol className="space-y-1">
              {timeline.map((c) => (
                <li
                  key={c.bookingId}
                  className={`rounded-md px-3 py-2 ${
                    c.bookingId === party.bookingId ? 'bg-[#D4AF37]/15 ring-1 ring-[#D4AF37]/50' : 'bg-stone-50'
                  }`}
                >
                  <span className="font-medium">
                    {timeInZone(c.visitStartsAt, party.timezone)}–{timeInZone(c.visitEndsAt, party.timezone)}
                  </span>{' '}
                  {c.partyName} <span className="text-xs text-stone-500">{c.publicId}</span>
                  {c.bookingId === party.bookingId ? <span className="ml-1 text-xs font-semibold">(this party)</span> : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}

      {canWrite && live ? (
        <div className="space-y-2 border-t border-stone-100 pt-3">
          <h3 className="font-semibold text-stone-800">Change room</h3>
          <div className="flex flex-wrap items-center gap-2">
            <select className={`${fieldClass} w-auto`} value={roomId} onChange={(e) => setRoomId(e.target.value)} aria-label="New room">
              <option value="">Choose a room…</option>
              {(slotQ.data?.rooms ?? [])
                .filter((r) => r.id !== party.room?.id)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.available ? '' : ' (booked)'}
                  </option>
                ))}
            </select>
            {party.room ? (
              <button
                type="button"
                className="text-xs text-stone-600 underline"
                onClick={() =>
                  move.mutate(
                    { bookingId: party.bookingId, roomResourceId: null },
                    {
                      onSuccess: () => addToast('Room cleared', 'success'),
                      onError: (err) => addToast(partyErrorMessage(err), 'error'),
                    }
                  )
                }
              >
                Clear room
              </button>
            ) : null}
          </div>
          {conflict ? (
            <p className="text-amber-800">
              That room has an overlapping party.
              {canOverbook ? ' You can overbook with a reason.' : ' Choose another room.'}
            </p>
          ) : null}
          {conflict && canOverbook ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={overbook} onChange={(e) => setOverbook(e.target.checked)} />
                Overbook
              </label>
              {overbook ? (
                <input className={`${fieldClass} w-72`} placeholder="Reason (logged)" value={reason} onChange={(e) => setReason(e.target.value)} />
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            className={btnPrimaryClass}
            disabled={!roomId || move.isPending || (conflict && !(overbook && reason.trim()))}
            onClick={() =>
              move.mutate(
                {
                  bookingId: party.bookingId,
                  roomResourceId: roomId,
                  ...(conflict ? { overbook: true, overbookReason: reason.trim() } : {}),
                },
                {
                  onSuccess: () => {
                    setRoomId('');
                    setOverbook(false);
                    setReason('');
                    addToast('Room changed', 'success');
                  },
                  onError: (err) => addToast(partyErrorMessage(err, 'Could not change room'), 'error'),
                }
              )
            }
          >
            {move.isPending ? <ButtonSpinner /> : null}
            Move party
          </button>
        </div>
      ) : null}
    </div>
  );
}
