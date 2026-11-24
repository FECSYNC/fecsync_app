'use client';

/**
 * Plan “Waiver” status — live against Digital Waivers requirements.
 * Checkbox → entitlements.waiverRequired. Desk evaluate also needs a
 * WaiverRequirement on /admin/waivers/forms → Required before entry.
 */
import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AdminPendingLink from '@/components/Protected/admin/components/AdminPendingLink';
import { ADMIN_LIST_STALE_MS, adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';
import { useHqLocationFilter } from '@/hooks/useHqLocationFilter';
import { ADMIN_MEMBERSHIPS_MODAL_LIVE_MS } from '@/utils/adminLiveRefresh';
import {
  listWaiverRequirements,
  waiverKeys,
} from '@/services/waivers';

/** Deep-link to Forms → Required before entry (not Templates create wizard). */
export const WAIVER_SETTINGS_HREF = '/admin/waivers/forms#requirements';

type RequirementRow = {
  id: string;
  templateId: string;
  templateName: string;
  targetType: string;
  targetId: string | null;
  enforcement: string;
  locationId: string | null;
};

type Props = {
  /** Saved plan id when editing; null while creating. */
  planId: string | null;
  planName?: string;
  disabled?: boolean;
  /** Poll requirements while the plan modal is open. */
  live?: boolean;
};

function matchesPlan(req: RequirementRow, planId: string | null): boolean {
  if (req.targetType !== 'membership_plan') return false;
  if (!planId || !req.targetId) return false;
  return req.targetId === planId;
}

export default function MembershipWaiverField(props: Props) {
  const { planId, planName, live = true } = props;
  const qc = useQueryClient();
  const { locationId } = useHqLocationFilter();
  const parkKey = locationId || 'all';
  const reqKey = [...waiverKeys.requirements(), parkKey] as const;

  const reqQuery = useQuery({
    queryKey: reqKey,
    queryFn: listWaiverRequirements,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot<RequirementRow[]>(reqKey),
    placeholderData: (prev) => prev,
    // Prefer cached snapshot; soft-refresh while modal open (avoid perpetual Syncing).
    staleTime: live ? ADMIN_MEMBERSHIPS_MODAL_LIVE_MS : ADMIN_LIST_STALE_MS,
    refetchInterval: live ? ADMIN_MEMBERSHIPS_MODAL_LIVE_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: live,
    retry: 1,
  });

  useEffect(() => {
    if (!live) return;
    const onWaivers = () => {
      void qc.invalidateQueries({ queryKey: waiverKeys.requirements() });
    };
    window.addEventListener('harewa:waivers-changed', onWaivers);
    return () => window.removeEventListener('harewa:waivers-changed', onWaivers);
  }, [live, qc]);

  const linked = useMemo(() => {
    const rows = (reqQuery.data ?? []) as RequirementRow[];
    return rows.filter((r) => matchesPlan(r, planId));
  }, [reqQuery.data, planId]);

  const loadError = reqQuery.isError;
  const blockingLoad = reqQuery.isLoading && !reqQuery.data;
  // Only flash Syncing on the first fetch without cache — not every 15s poll.
  const showSyncing = blockingLoad || (reqQuery.isFetching && !reqQuery.data);

  let statusTitle = 'Not linked yet';
  let statusDetail =
    'This plan flag is saved here. Attach a published form under Waiver settings → Required before entry so the desk can enforce it.';
  let statusTone: 'ok' | 'warn' | 'muted' | 'error' = 'warn';

  if (loadError) {
    statusTitle = 'Waivers unavailable';
    statusDetail =
      'Digital Waivers may be off for this package, or you need Waivers permission. The plan flag still saves.';
    statusTone = 'error';
  } else if (blockingLoad) {
    statusTitle = 'Checking Waiver settings…';
    statusDetail = 'Looking up required-before-entry links for membership plans.';
    statusTone = 'muted';
  } else if (!planId) {
    statusTitle = 'Save the plan first';
    statusDetail =
      'Create/save this plan, then open Waiver settings and require a published form for this membership. Status updates here live.';
    statusTone = 'muted';
  } else if (linked.length > 0) {
    statusTitle =
      linked.length === 1
        ? 'Linked to 1 waiver form'
        : `Linked to ${linked.length} waiver forms`;
    statusDetail =
      'Desk evaluate and guest signing use these requirements. Changes on Forms update here automatically.';
    statusTone = 'ok';
  }

  const toneClass =
    statusTone === 'ok'
      ? 'border-emerald-200 bg-emerald-50/80'
      : statusTone === 'warn'
        ? 'border-amber-200 bg-amber-50/80'
        : statusTone === 'error'
          ? 'border-rose-200 bg-rose-50/70'
          : 'border-stone-200 bg-stone-50/80';

  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
      <div
        className={`flex flex-wrap items-start justify-between gap-2 border-b px-3.5 py-2.5 ${toneClass}`}
      >
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
            Digital Waivers
          </p>
          <p className="mt-0.5 text-sm font-semibold text-stone-900">
            {statusTitle}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-stone-600">
            {statusDetail}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {showSyncing ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-stone-400">
              <span
                className="h-3 w-3 animate-spin rounded-full border-2 border-stone-300 border-t-[#D4AF37]"
                aria-hidden
              />
              Syncing…
            </span>
          ) : null}
          <AdminPendingLink
            href={WAIVER_SETTINGS_HREF}
            className="text-[11px] font-medium text-[#8a7020] underline-offset-2 hover:underline"
            title="Open Forms → Required before entry"
          >
            Waiver settings
          </AdminPendingLink>
        </div>
      </div>

      <div className="space-y-3 p-3.5">
        {linked.length > 0 ? (
          <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
            {linked.map((req) => (
              <li
                key={req.id}
                className="flex items-start justify-between gap-2 px-3 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-stone-900">
                    {req.templateName}
                  </p>
                  <p className="mt-0.5 text-[11px] text-stone-500">
                    {planName
                      ? `Required for “${planName}”`
                      : 'Required for this plan'}
                    {req.enforcement === 'warn' ? ' · warn' : ' · block'}
                  </p>
                </div>
                <span className="shrink-0 rounded bg-[#D4AF37]/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#8a7020]">
                  Linked
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="text-[11px] leading-relaxed text-stone-500">
          Separate from{' '}
          <span className="font-medium text-stone-600">Forms</span> on this plan
          (guest-info catalog). Configure signing under{' '}
          <AdminPendingLink
            href={WAIVER_SETTINGS_HREF}
            className="inline font-medium text-[#8a7020] underline-offset-2 hover:underline"
          >
            Waiver settings
          </AdminPendingLink>
          {planId && planName ? (
            <>
              {' '}
              → Required before entry → A membership → “{planName}”.
            </>
          ) : (
            <> → Required before entry → A membership.</>
          )}
        </p>

        {loadError ? (
          <button
            type="button"
            className="text-xs font-medium text-[#8a7020] underline-offset-2 hover:underline"
            onClick={() => void reqQuery.refetch()}
          >
            Retry sync
          </button>
        ) : null}
      </div>
    </div>
  );
}
