'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/contexts/toast-context';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import { usePutPartyRunSheetMutation } from '@/hooks/useParties';
import type { PartyDetailDto } from '@/services/adminParties';
import { btnPrimaryClass, btnSecondaryClass, fieldClass } from './partiesUi';
import { partyErrorMessage, zonedLocalToIso } from './partyFormat';

type Row = { key: string; title: string; notes: string; local: string };

/** ISO → "YYYY-MM-DDTHH:mm" wall clock in the venue timezone. */
function isoToZonedLocal(iso: string | null, timezone: string | null): string {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || undefined,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export default function PartyRunSheetTab({ party, canWrite }: { party: PartyDetailDto; canWrite: boolean }) {
  const { addToast } = useToast();
  const save = usePutPartyRunSheetMutation();
  const [rows, setRowsRaw] = useState<Row[]>([]);
  const live = !['cancelled', 'expired', 'refunded'].includes(party.status);
  // Background refetches must not overwrite unsaved edits.
  const dirty = useRef(false);
  const setRows: typeof setRowsRaw = (v) => {
    dirty.current = true;
    setRowsRaw(v);
  };

  useEffect(() => {
    if (dirty.current) return;
    setRowsRaw(
      [...party.runSheet]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((i) => ({ key: i.id, title: i.title, notes: i.notes ?? '', local: isoToZonedLocal(i.startsAt, party.timezone) }))
    );
  }, [party.runSheet, party.timezone]);

  const editable = canWrite && live;
  const move = (i: number, d: -1 | 1) =>
    setRows((prev) => {
      const j = i + d;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  function onSave() {
    if (rows.some((r) => !r.title.trim())) {
      addToast('Each timeline item needs a title', 'error');
      return;
    }
    save.mutate(
      {
        bookingId: party.bookingId,
        items: rows.map((r, i) => ({
          title: r.title.trim(),
          notes: r.notes.trim() || null,
          startsAt: r.local ? zonedLocalToIso(r.local, party.timezone) : null,
          sortOrder: i,
        })),
      },
      {
        onSuccess: () => {
          dirty.current = false;
          addToast('Run sheet saved', 'success');
        },
        onError: (err) => addToast(partyErrorMessage(err, 'Could not save run sheet'), 'error'),
      }
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-stone-600">Times are in the venue&apos;s timezone{party.timezone ? ` (${party.timezone})` : ''}.</p>
        <Link
          href={`/admin/parties/run-sheets?bookingId=${party.bookingId}&date=${isoToZonedLocal(party.visitStartsAt, party.timezone).slice(0, 10)}&locationId=${party.locationId}&print=1`}
          target="_blank"
          className={btnSecondaryClass}
        >
          Print run sheet
        </Link>
      </div>
      {rows.length === 0 ? <p className="text-stone-500">No timeline items yet.</p> : null}
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.key} className="grid gap-2 rounded-md border border-stone-200 p-3 sm:grid-cols-[1fr_12rem_auto]">
            <div className="space-y-2">
              <input
                className={fieldClass}
                placeholder="Title (required)"
                value={r.title}
                disabled={!editable}
                onChange={(e) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
              />
              <input
                className={fieldClass}
                placeholder="Notes for staff"
                value={r.notes}
                disabled={!editable}
                onChange={(e) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))}
              />
            </div>
            <input
              type="datetime-local"
              className={fieldClass}
              value={r.local}
              disabled={!editable}
              onChange={(e) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, local: e.target.value } : x)))}
              aria-label="Time"
            />
            {editable ? (
              <div className="flex flex-wrap items-start gap-1">
                <button type="button" className={btnSecondaryClass} disabled={i === 0} onClick={() => move(i, -1)}>
                  Up
                </button>
                <button type="button" className={btnSecondaryClass} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                  Down
                </button>
                <button
                  type="button"
                  className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700"
                  onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {editable ? (
        <div className="flex gap-2">
          <button
            type="button"
            className={btnSecondaryClass}
            onClick={() => setRows((prev) => [...prev, { key: `new-${Date.now()}`, title: '', notes: '', local: '' }])}
          >
            Add item
          </button>
          <button type="button" className={btnPrimaryClass} disabled={save.isPending} onClick={onSave}>
            {save.isPending ? <ButtonSpinner /> : null}
            Save run sheet
          </button>
        </div>
      ) : null}
    </div>
  );
}
