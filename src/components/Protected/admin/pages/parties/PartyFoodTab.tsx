'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/contexts/toast-context';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import {
  useCancelPartyFoodMutation,
  usePartyMenuQuery,
  usePutPartyFoodMutation,
  useSubmitPartyFoodMutation,
} from '@/hooks/useParties';
import type { PartyDetailDto } from '@/services/adminParties';
import { btnPrimaryClass, btnSecondaryClass, fieldClass } from './partiesUi';
import { centsLabel, formatInZone, partyErrorMessage } from './partyFormat';

type DraftLine = { menuItemId: string; qty: number; notes: string };

export default function PartyFoodTab({ party, canFood }: { party: PartyDetailDto; canFood: boolean }) {
  const { addToast } = useToast();
  const menuQ = usePartyMenuQuery({ locationId: party.locationId });
  const put = usePutPartyFoodMutation();
  const submit = useSubmitPartyFoodMutation();
  const cancel = useCancelPartyFoodMutation();
  const menu = (menuQ.data ?? []).filter((m) => m.available && !m.archivedAt);
  const draft = party.foodOrders.find((o) => o.status === 'draft') ?? null;
  const sentOrders = party.foodOrders.filter((o) => o.status !== 'draft');
  const cutoffPassed = party.capabilities?.foodCutoffPassed ?? false;
  const cutoffMinutes = party.capabilities?.foodOrderCutoffMinutes ?? 60;
  const live = !['cancelled', 'expired', 'refunded'].includes(party.status);

  const [lines, setLinesRaw] = useState<DraftLine[]>([]);
  const [notes, setNotesRaw] = useState('');
  const [pick, setPick] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  // Background refetches must not overwrite unsaved edits.
  const dirty = useRef(false);
  const [isDirty, setIsDirty] = useState(false);
  const markDirty = (v: boolean) => {
    dirty.current = v;
    setIsDirty(v);
  };
  const setLines: typeof setLinesRaw = (v) => {
    markDirty(true);
    setLinesRaw(v);
  };
  const setNotes = (v: string) => {
    markDirty(true);
    setNotesRaw(v);
  };

  useEffect(() => {
    if (dirty.current) return;
    setLinesRaw((draft?.lines ?? []).filter((l) => l.menuItemId).map((l) => ({ menuItemId: l.menuItemId!, qty: l.qty, notes: l.notes ?? '' })));
    setNotesRaw(draft?.notes ?? '');
  }, [draft?.id, draft?.lines, draft?.notes]);

  const priceOf = useMemo(() => new Map(menu.map((m) => [m.id, m.priceCents])), [menu]);
  const nameOf = useMemo(() => new Map((menuQ.data ?? []).map((m) => [m.id, m.name])), [menuQ.data]);
  const draftTotal = lines.reduce((s, l) => s + (priceOf.get(l.menuItemId) ?? 0) * l.qty, 0);

  function saveDraft(then?: () => void) {
    put.mutate(
      {
        bookingId: party.bookingId,
        lines: lines.map((l) => ({ menuItemId: l.menuItemId, qty: l.qty, notes: l.notes.trim() || null })),
        notes: notes.trim() || null,
      },
      {
        onSuccess: () => {
          markDirty(false);
          if (then) then();
          else addToast('Food draft saved', 'success');
        },
        onError: (err) => addToast(partyErrorMessage(err, 'Could not save food'), 'error'),
      }
    );
  }

  function submitToKitchen() {
    const send = () =>
      submit.mutate(
        { bookingId: party.bookingId, overrideReason: cutoffPassed ? overrideReason.trim() : undefined },
        {
          onSuccess: () => {
            setOverrideReason('');
            addToast('Sent to the kitchen', 'success');
          },
          onError: (err) => addToast(partyErrorMessage(err, 'Could not submit food'), 'error'),
        }
      );
    if (isDirty) saveDraft(send);
    else send();
  }

  return (
    <div className="space-y-4 rounded-lg border border-stone-200 bg-white p-4 text-sm">
      <p className={cutoffPassed ? 'font-medium text-amber-800' : 'text-stone-600'}>
        Kitchen cutoff: {cutoffMinutes} minutes before the party starts
        {party.visitStartsAt ? ` (${formatInZone(party.visitStartsAt, party.timezone)})` : ''}.
        {cutoffPassed ? ' The cutoff has passed — submitting needs an override reason.' : ''}
      </p>

      {canFood && live ? (
        <div className="space-y-3">
          <h3 className="font-semibold text-stone-800">Draft order</h3>
          {lines.length === 0 ? <p className="text-stone-500">No items yet.</p> : null}
          <ul className="space-y-2">
            {lines.map((l, i) => (
              <li key={`${l.menuItemId}-${i}`} className="flex flex-wrap items-center gap-2">
                <span className="min-w-[10rem] font-medium">{nameOf.get(l.menuItemId) ?? 'Item'}</span>
                <input
                  className={`${fieldClass} w-20`}
                  type="number"
                  min={1}
                  value={l.qty}
                  onChange={(e) =>
                    setLines((prev) => prev.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x)))
                  }
                  aria-label="Quantity"
                />
                <input
                  className={fieldClass}
                  placeholder="Notes / modifiers"
                  value={l.notes}
                  onChange={(e) => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))}
                />
                <span className="text-stone-500">{centsLabel((priceOf.get(l.menuItemId) ?? 0) * l.qty)}</span>
                <button type="button" className="text-xs text-red-700" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <select className={`${fieldClass} w-auto`} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Menu item">
              <option value="">Add a menu item…</option>
              {menu.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {centsLabel(m.priceCents)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={btnSecondaryClass}
              disabled={!pick}
              onClick={() => {
                setLines((prev) => [...prev, { menuItemId: pick, qty: 1, notes: '' }]);
                setPick('');
              }}
            >
              Add
            </button>
          </div>
          {menu.length === 0 && !menuQ.isPending ? (
            <p className="text-xs text-stone-500">This venue has no available menu items. Add them under Parties → Menu.</p>
          ) : null}
          <textarea className={fieldClass} rows={2} placeholder="Order notes for the kitchen" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Draft total {centsLabel(draftTotal)}</span>
            <button type="button" className={btnSecondaryClass} disabled={put.isPending} onClick={() => saveDraft()}>
              {put.isPending ? <ButtonSpinner /> : null}
              Save draft
            </button>
            {isDirty ? <span className="text-xs text-amber-800">Unsaved changes</span> : null}
            {draft ? (
              <>
                {cutoffPassed ? (
                  <input
                    className={`${fieldClass} w-64`}
                    placeholder="Override reason (required after cutoff)"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                  />
                ) : null}
                <button
                  type="button"
                  className={btnPrimaryClass}
                  disabled={submit.isPending || put.isPending || lines.length === 0 || (cutoffPassed && !overrideReason.trim())}
                  onClick={submitToKitchen}
                >
                  {submit.isPending ? <ButtonSpinner /> : null}
                  Submit to kitchen
                </button>
              </>
            ) : (
              <span className="text-xs text-stone-500">Save the draft, then submit it to the kitchen.</span>
            )}
          </div>
        </div>
      ) : null}

      <div className="space-y-2 border-t border-stone-100 pt-3">
        <h3 className="font-semibold text-stone-800">Kitchen orders</h3>
        {sentOrders.length === 0 ? (
          <p className="text-stone-500">Nothing sent to the kitchen yet.</p>
        ) : (
          sentOrders.map((o) => (
            <div key={o.id} className="rounded-md border border-stone-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium">{o.status.replace(/_/g, ' ')}</span>
                  {o.kitchenTicketId ? <span className="ml-2 text-xs text-stone-500">Kitchen ticket {o.kitchenTicketId.slice(-8)}</span> : null}
                  {o.submittedAt ? <span className="ml-2 text-xs text-stone-500">sent {formatInZone(o.submittedAt, party.timezone)}</span> : null}
                </span>
                {canFood && ['submitted', 'sent_to_kitchen'].includes(o.status) ? (
                  <button
                    type="button"
                    className="text-xs font-medium text-red-700"
                    disabled={cancel.isPending}
                    onClick={() => {
                      const reason = window.prompt('Why cancel this food order?') ?? '';
                      if (!reason.trim()) return;
                      cancel.mutate(
                        { bookingId: party.bookingId, foodOrderId: o.id, reason: reason.trim() },
                        {
                          onSuccess: () => addToast('Food order cancelled', 'success'),
                          onError: (err) => addToast(partyErrorMessage(err), 'error'),
                        }
                      );
                    }}
                  >
                    Cancel order
                  </button>
                ) : null}
              </div>
              <ul className="mt-2 list-disc pl-5">
                {o.lines.map((l) => (
                  <li key={l.id}>
                    {l.qty} × {l.nameSnapshot} · {centsLabel(l.unitPriceCents * l.qty)}
                    {l.notes ? <span className="text-stone-500"> — {l.notes}</span> : null}
                  </li>
                ))}
              </ul>
              {o.cutoffOverrideReason ? <p className="mt-1 text-xs text-amber-800">Cutoff override: {o.cutoffOverrideReason}</p> : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
