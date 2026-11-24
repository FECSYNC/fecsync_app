'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import { AdminHowToGuideButton } from '@/components/Protected/admin/components/AdminHowToGuideButton';
import { DeferredMembershipsGuideModal } from '@/components/Protected/admin/pages/memberships/DeferredMembershipsGuideModal';
import { MEMBERSHIPS_ELIGIBILITY_GUIDE_STEPS } from '@/components/Protected/admin/pages/memberships/membershipsGuides';
import {
  btnPrimaryClass,
  fieldClass,
} from '@/components/Protected/admin/pages/ticketing/ticketingUi';
import {
  listAdminVenueLocations,
  venueLocationKeys,
} from '@/services/venueLocations';
import { ADMIN_LIST_STALE_MS } from '@/lib/adminListCache';
import {
  listMembershipEligibility,
  listMembershipPlans,
  membershipKeys,
  putMembershipEligibility,
} from '@/services/memberships';
import { notifyMembershipChange } from '@/lib/membershipsSync';

type VenuePerkState = {
  eligible: boolean;
  localPerksAdd: string;
  localPerksRemove: string;
};

function parsePerkCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function perkFlagsFromJson(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    if (Array.isArray(raw)) {
      return raw.filter((x): x is string => typeof x === 'string').join(', ');
    }
    return '';
  }
  const flags = (raw as { perkFlags?: unknown }).perkFlags;
  if (Array.isArray(flags)) {
    return flags.filter((x): x is string => typeof x === 'string').join(', ');
  }
  return '';
}

function perkJsonFromCsv(csv: string): { perkFlags: string[] } | undefined {
  const flags = parsePerkCsv(csv);
  return flags.length ? { perkFlags: flags } : undefined;
}

export default function MembershipEligibilityPage() {
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.MembershipsWrite) || can(P.MembershipsAdmin);
  const canRead = can(P.MembershipsRead) || canWrite;
  const qc = useQueryClient();
  const [planId, setPlanId] = useState('');
  const [venueState, setVenueState] = useState<Record<string, VenuePerkState>>(
    {}
  );
  const [guideOpen, setGuideOpen] = useState(false);

  const plansQuery = useQuery({
    queryKey: membershipKeys.plans(false),
    queryFn: () => listMembershipPlans({ includeArchived: false }),
    enabled: canRead,
    staleTime: ADMIN_LIST_STALE_MS,
  });

  const venuesQuery = useQuery({
    // Respect HQ / park preference — scope=all would show parks the PUT rejects.
    queryKey: venueLocationKeys.list('hq'),
    queryFn: () => listAdminVenueLocations(),
    enabled: canRead,
    staleTime: ADMIN_LIST_STALE_MS,
  });

  const eligibilityQuery = useQuery({
    queryKey: membershipKeys.eligibility(planId || null),
    queryFn: () => listMembershipEligibility(planId || null),
    enabled: canRead && Boolean(planId),
  });

  useEffect(() => {
    if (!planId) {
      setVenueState({});
      return;
    }
    // Soft-archived parks drop eligibility on archive — do not re-create rows for them.
    const venues = (venuesQuery.data ?? []).filter((v) => v.status === 'active');
    const rows = eligibilityQuery.data ?? [];
    const byLoc = new Map(rows.map((r) => [r.locationId, r]));
    const next: Record<string, VenuePerkState> = {};
    for (const v of venues) {
      const row = byLoc.get(v.id);
      next[v.id] = {
        eligible: row?.eligible === true,
        localPerksAdd: perkFlagsFromJson(row?.localPerksAdd ?? null),
        localPerksRemove: perkFlagsFromJson(row?.localPerksRemove ?? null),
      };
    }
    setVenueState(next);
  }, [planId, eligibilityQuery.data, venuesQuery.data]);

  useEffect(() => {
    const plans = plansQuery.data ?? [];
    if (!planId && plans.length > 0) setPlanId(plans[0]!.id);
  }, [plansQuery.data, planId]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!planId) throw new Error('Select a plan');
      const venues = (venuesQuery.data ?? []).filter((v) => v.status === 'active');
      return putMembershipEligibility({
        planId,
        rows: venues.map((v) => {
          const state = venueState[v.id] ?? {
            eligible: false,
            localPerksAdd: '',
            localPerksRemove: '',
          };
          return {
            locationId: v.id,
            eligible: state.eligible,
            localPerksAdd: perkJsonFromCsv(state.localPerksAdd),
            localPerksRemove: perkJsonFromCsv(state.localPerksRemove),
          };
        }),
      });
    },
    onSuccess: () => {
      addToast('Eligibility saved', 'success');
      notifyMembershipChange(qc, {
        kind: 'eligibility',
        action: 'update',
        id: planId || undefined,
      });
    },
    onError: (err: Error) => addToast(err.message || 'Save failed', 'error'),
  });

  function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (!canWrite) return;
    saveMutation.mutate();
  }

  function patchVenue(id: string, patch: Partial<VenuePerkState>) {
    setVenueState((prev) => ({
      ...prev,
      [id]: {
        eligible: prev[id]?.eligible ?? false,
        localPerksAdd: prev[id]?.localPerksAdd ?? '',
        localPerksRemove: prev[id]?.localPerksRemove ?? '',
        ...patch,
      },
    }));
  }

  if (!canRead) {
    return (
      <div className="p-6 text-sm text-stone-600">
        You do not have permission to view Memberships eligibility.
      </div>
    );
  }

  const plans = plansQuery.data ?? [];
  const venues = (venuesQuery.data ?? []).filter((v) => v.status === 'active');

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#D4AF37]">
            Memberships
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-stone-900">
            Multi-venue eligibility
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Choose which parks a plan may redeem at. Per-venue local perk add /
            remove customizes base plan perks. Redeem desk enforces CURRENT /
            VISITING / INELIGIBLE from this matrix. Soft-archived parks are
            omitted (cleared on archive).
          </p>
        </div>
        <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
      </header>

      {guideOpen ? (
        <DeferredMembershipsGuideModal
          open={guideOpen}
          onClose={() => setGuideOpen(false)}
          title="Membership eligibility"
          subtitle="Plan × park matrix — CURRENT / VISITING / INELIGIBLE at redeem."
          steps={MEMBERSHIPS_ELIGIBILITY_GUIDE_STEPS}
        />
      ) : null}

      {plans.length === 0 ? (
        <p className="text-sm text-stone-500">
          Create a membership plan first, then configure eligibility.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block max-w-md text-sm">
            <span className="text-stone-700">Plan</span>
            <select
              className={fieldClass}
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.categoryName ? `${p.categoryName} · ` : ''}
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <ul className="divide-y divide-stone-200 border border-stone-200 bg-white">
            {venues.map((v) => {
              const state = venueState[v.id] ?? {
                eligible: false,
                localPerksAdd: '',
                localPerksRemove: '',
              };
              return (
                <li key={v.id} className="space-y-3 px-4 py-3 text-sm">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={state.eligible}
                      disabled={!canWrite}
                      onChange={(e) =>
                        patchVenue(v.id, { eligible: e.target.checked })
                      }
                    />
                    <span className="font-medium text-stone-800">
                      {v.name}
                    </span>
                  </label>
                  {state.eligible ? (
                    <div className="grid gap-2 sm:grid-cols-2 sm:pl-7">
                      <label className="block text-xs text-stone-600">
                        Local perks add (comma-separated)
                        <input
                          className={fieldClass}
                          disabled={!canWrite}
                          value={state.localPerksAdd}
                          placeholder="e.g. free_locker"
                          onChange={(e) =>
                            patchVenue(v.id, {
                              localPerksAdd: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="block text-xs text-stone-600">
                        Local perks remove (comma-separated)
                        <input
                          className={fieldClass}
                          disabled={!canWrite}
                          value={state.localPerksRemove}
                          placeholder="e.g. skip_line"
                          onChange={(e) =>
                            patchVenue(v.id, {
                              localPerksRemove: e.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                  ) : null}
                </li>
              );
            })}
            {venues.length === 0 ? (
              <li className="px-4 py-3 text-sm text-stone-500">
                No venues yet — create a park under Workspace settings → Venues.
              </li>
            ) : null}
          </ul>

          {canWrite ? (
            <button
              type="submit"
              className={btnPrimaryClass}
              disabled={saveMutation.isPending || !planId}
            >
              {saveMutation.isPending ? <ButtonSpinner /> : null}
              Save eligibility
            </button>
          ) : null}
        </form>
      )}
    </div>
  );
}
