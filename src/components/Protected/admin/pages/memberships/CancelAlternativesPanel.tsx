'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import {
  btnPrimaryClass,
  fieldClass,
} from '@/components/Protected/admin/pages/ticketing/ticketingUi';
import { ADMIN_MEMBERSHIPS_SETTINGS_LIVE_MS } from '@/utils/adminLiveRefresh';
import { notifyMembershipChange } from '@/lib/membershipsSync';
import {
  listCancelAlternatives,
  listMembershipPlans,
  membershipKeys,
  membershipP4Keys,
  upsertCancelAlternative,
  type CancelAlternative,
  type CancelAlternativeKind,
} from '@/services/memberships';

const KIND_LABELS: Record<CancelAlternativeKind, string> = {
  pause_offer: 'Offer a pause',
  discount: 'Offer account credit',
  downgrade: 'Offer a cheaper plan',
  message: 'Show a retention message',
};

type Draft = {
  id?: string;
  name: string;
  kind: CancelAlternativeKind;
  locationId: string;
  creditMajor: string;
  newPlanId: string;
  message: string;
  sortOrder: string;
  active: boolean;
};

const EMPTY_DRAFT: Draft = {
  name: '',
  kind: 'pause_offer',
  locationId: '',
  creditMajor: '',
  newPlanId: '',
  message: '',
  sortOrder: '0',
  active: true,
};

function draftFrom(alt: CancelAlternative): Draft {
  const c = alt.config;
  return {
    id: alt.id,
    name: alt.name,
    kind: alt.kind,
    locationId: alt.locationId ?? '',
    creditMajor: c.creditMajor != null ? String(c.creditMajor) : '',
    newPlanId: typeof c.newPlanId === 'string' ? c.newPlanId : '',
    message: typeof c.message === 'string' ? c.message : '',
    sortOrder: String(alt.sortOrder),
    active: alt.active,
  };
}

function configFor(d: Draft): Record<string, unknown> {
  if (d.kind === 'discount') return { creditMajor: Number(d.creditMajor) };
  if (d.kind === 'downgrade') return { newPlanId: d.newPlanId };
  if (d.kind === 'message') return { message: d.message.trim() };
  return {};
}

export default function CancelAlternativesPanel({
  canWrite,
  venues,
  scopeLocationId = '',
  alternativesEnabled = true,
}: {
  canWrite: boolean;
  venues: Array<{ id: string; name: string }>;
  /** Current settings venue scope — new offers start on this park. */
  scopeLocationId?: string;
  /** Mirrors the Cancel alternatives toggle on the settings form. */
  alternativesEnabled?: boolean;
}) {
  const { addToast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  const listQuery = useQuery({
    queryKey: membershipP4Keys.alternatives(),
    queryFn: listCancelAlternatives,
    staleTime: 0,
    refetchInterval: ADMIN_MEMBERSHIPS_SETTINGS_LIVE_MS,
    refetchIntervalInBackground: false,
    refetchOnMount: 'always',
  });
  const plansQuery = useQuery({
    queryKey: membershipKeys.plans(false),
    queryFn: () => listMembershipPlans(),
    enabled: canWrite,
    staleTime: 0,
    refetchInterval: canWrite ? ADMIN_MEMBERSHIPS_SETTINGS_LIVE_MS : false,
    refetchIntervalInBackground: false,
    refetchOnMount: 'always',
  });

  useEffect(() => {
    setDraft((d) => {
      if (d.id || d.name.trim()) return d;
      if (d.locationId === scopeLocationId) return d;
      return { ...d, locationId: scopeLocationId };
    });
  }, [scopeLocationId]);

  const saveMutation = useMutation({
    mutationFn: (d: Draft) =>
      upsertCancelAlternative({
        ...(d.id ? { id: d.id } : {}),
        name: d.name.trim(),
        kind: d.kind,
        locationId: d.locationId || null,
        config: configFor(d),
        sortOrder: Number(d.sortOrder) || 0,
        active: d.active,
      }),
    onSuccess: () => {
      addToast('Cancel alternative saved', 'success');
      setDraft({ ...EMPTY_DRAFT, locationId: scopeLocationId });
      notifyMembershipChange(qc, {
        kind: 'settings',
        action: 'update',
      });
    },
    onError: (err: Error) => addToast(err.message || 'Save failed', 'error'),
  });

  const alternatives = listQuery.data ?? [];
  const plans = plansQuery.data ?? [];
  const venueName = (id: string | null) =>
    id ? venues.find((v) => v.id === id)?.name ?? 'Park' : 'All parks';

  function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (!canWrite || !draft.name.trim()) return;
    saveMutation.mutate(draft);
  }

  return (
    <section className="max-w-3xl space-y-4 border border-stone-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-stone-800">Cancel alternatives</h2>
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
          Beta
        </span>
      </div>
      <p className="text-xs text-stone-500">
        Offers shown to guests before they confirm an online cancellation (when
        &quot;Cancel alternatives&quot; is enabled above). Guests can always decline
        and continue to cancel.
      </p>
      {!alternativesEnabled ? (
        <p className="text-xs text-amber-800">
          These offers stay hidden for guests until Cancel alternatives is
          turned on and saved for this scope.
        </p>
      ) : null}

      {listQuery.isLoading ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : alternatives.length === 0 ? (
        <p className="text-sm text-stone-500">No cancel alternatives yet.</p>
      ) : (
        <ul className="divide-y divide-stone-100 border border-stone-200">
          {alternatives.map((alt) => (
            <li key={alt.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <div>
                <p className="font-medium text-stone-900">
                  {alt.name}
                  {!alt.active ? (
                    <span className="ml-2 text-xs font-normal text-stone-400">inactive</span>
                  ) : null}
                </p>
                <p className="text-xs text-stone-500">
                  {KIND_LABELS[alt.kind] ?? alt.kind} · {venueName(alt.locationId)} · order {alt.sortOrder}
                </p>
              </div>
              {canWrite ? (
                <div className="flex gap-3">
                  <button
                    type="button"
                    className="text-xs text-[#D4AF37] underline"
                    onClick={() => setDraft(draftFrom(alt))}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-xs text-stone-600 underline"
                    disabled={saveMutation.isPending}
                    onClick={() => saveMutation.mutate({ ...draftFrom(alt), active: !alt.active })}
                  >
                    {alt.active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canWrite ? (
        <form onSubmit={onSubmit} className="grid gap-3 border-t border-stone-100 pt-3 sm:grid-cols-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500 sm:col-span-2">
            {draft.id ? 'Edit alternative' : 'New alternative'}
          </p>
          <label className="block text-sm">
            <span className="text-stone-700">Name (shown to guest)</span>
            <input
              className={fieldClass}
              value={draft.name}
              maxLength={120}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </label>
          <label className="block text-sm">
            <span className="text-stone-700">Type</span>
            <select
              className={fieldClass}
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as CancelAlternativeKind })}
            >
              {(Object.keys(KIND_LABELS) as CancelAlternativeKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          {draft.kind === 'discount' ? (
            <label className="block text-sm">
              <span className="text-stone-700">Credit amount</span>
              <input
                className={fieldClass}
                type="number"
                min="0.01"
                step="0.01"
                value={draft.creditMajor}
                onChange={(e) => setDraft({ ...draft, creditMajor: e.target.value })}
                required
              />
            </label>
          ) : null}
          {draft.kind === 'downgrade' ? (
            <label className="block text-sm">
              <span className="text-stone-700">Downgrade to plan</span>
              <select
                className={fieldClass}
                value={draft.newPlanId}
                onChange={(e) => setDraft({ ...draft, newPlanId: e.target.value })}
                required
              >
                <option value="">Select plan…</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.categoryName ? `${p.categoryName} · ` : ''}
                    {p.name} — {p.price} {p.currency}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {draft.kind === 'message' ? (
            <label className="block text-sm sm:col-span-2">
              <span className="text-stone-700">Message</span>
              <textarea
                className={fieldClass}
                rows={2}
                maxLength={500}
                value={draft.message}
                onChange={(e) => setDraft({ ...draft, message: e.target.value })}
                required
              />
            </label>
          ) : null}
          <label className="block text-sm">
            <span className="text-stone-700">Park</span>
            <select
              className={fieldClass}
              value={draft.locationId}
              onChange={(e) => setDraft({ ...draft, locationId: e.target.value })}
            >
              <option value="">All parks</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-stone-700">Sort order</span>
            <input
              className={fieldClass}
              type="number"
              value={draft.sortOrder}
              onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
            />
            Active
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" className={btnPrimaryClass} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <ButtonSpinner /> : null}
              {draft.id ? 'Save changes' : 'Add alternative'}
            </button>
            {draft.id ? (
              <button type="button" className="text-sm underline" onClick={() => setDraft(EMPTY_DRAFT)}>
                Cancel edit
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}
