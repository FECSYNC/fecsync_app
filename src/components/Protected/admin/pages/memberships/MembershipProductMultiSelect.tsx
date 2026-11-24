'use client';

/**
 * ROLLER-style multi-select product picker for Membership plan options
 * (Add-ons first; reusable for other checkbox-linked pickers).
 *
 * Performance: warm via `warm` / `prefetchMembershipPlanProductPicker` so the
 * list paints from React Query + admin list snapshot — never a cold wait on open.
 * Live: polls + catalog/membership cross-tab sync while warm/open so new ticket
 * products and sibling plans appear without a full page refresh.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { ADMIN_LIST_STALE_MS, adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';
import { subscribeCatalogChange } from '@/lib/catalogSync';
import { subscribeMembershipChange } from '@/lib/membershipsSync';
import { ADMIN_MEMBERSHIPS_MODAL_LIVE_MS } from '@/utils/adminLiveRefresh';
import {
  listTicketingProducts,
  ticketingKeys,
  type AdmissionProductDto,
} from '@/services/ticketing';
import {
  listMembershipPlans,
  membershipKeys,
  type MembershipPlanDto,
} from '@/services/memberships';
import { formatProductType } from '@/components/Protected/admin/pages/ticketing/ticketingUi';
import { ApiError } from '@/utils/api';

export type MembershipPickerProduct = {
  id: string;
  name: string;
  /** Accordion group label (category or type). */
  group: string;
  kind: 'ticketing' | 'membership';
  /** Secondary line (type / park). */
  meta?: string;
};

type Group = {
  name: string;
  products: MembershipPickerProduct[];
};

/** Shared list key — keep in sync with prefetch + warmer. */
export const MEMBERSHIP_PICKER_TICKETS_FILTERS = {
  includeArchived: false,
  /** API default is 100 — request the hard cap so large catalogs appear. */
  take: 200,
} as const;

export function membershipPickerTicketsKey() {
  return ticketingKeys.products(MEMBERSHIP_PICKER_TICKETS_FILTERS);
}

/** Warm React Query before Add-ons is checked / dropdown opens. */
export function prefetchMembershipPlanProductPicker(queryClient: QueryClient) {
  void queryClient.prefetchQuery({
    queryKey: membershipPickerTicketsKey(),
    queryFn: () => listTicketingProducts(MEMBERSHIP_PICKER_TICKETS_FILTERS),
    staleTime: ADMIN_LIST_STALE_MS,
  });
  void queryClient.prefetchQuery({
    queryKey: membershipKeys.plans(false),
    queryFn: () => listMembershipPlans({ includeArchived: false }),
    staleTime: ADMIN_LIST_STALE_MS,
  });
}

type Props = {
  /** Currently committed selection (plan form). */
  value: string[];
  onChange: (ids: string[]) => void;
  /** Show the select UI (Add-ons checked). */
  enabled?: boolean;
  /**
   * Fetch/cache in the background even when UI is hidden (plan modal open).
   * Makes the first open feel instant.
   */
  warm?: boolean;
  /** Exclude the plan being edited from the Memberships group. */
  excludePlanId?: string | null;
  placeholder?: string;
};

function groupLabelForTicket(p: AdmissionProductDto): string {
  const cat = p.category?.name?.trim();
  if (cat) return cat;
  return formatProductType(p.type);
}

function ticketMeta(p: AdmissionProductDto): string {
  const bits: string[] = [formatProductType(p.type)];
  const park = p.location?.name?.trim();
  if (park) bits.push(park);
  if (!p.published) bits.push('Draft');
  return bits.join(' · ');
}

function buildGroups(
  tickets: AdmissionProductDto[],
  plans: MembershipPlanDto[],
  excludePlanId?: string | null
): Group[] {
  const map = new Map<string, MembershipPickerProduct[]>();

  for (const p of tickets) {
    if (p.archivedAt) continue;
    const group = groupLabelForTicket(p);
    const row: MembershipPickerProduct = {
      id: p.id,
      name: p.name,
      group,
      kind: 'ticketing',
      meta: ticketMeta(p),
    };
    const list = map.get(group) ?? [];
    list.push(row);
    map.set(group, list);
  }

  const membershipRows: MembershipPickerProduct[] = plans
    .filter((p) => !p.archivedAt && p.id !== excludePlanId)
    .map((p) => ({
      id: `membership:${p.id}`,
      name: p.name,
      group: 'Memberships',
      kind: 'membership' as const,
      meta: 'Membership plan',
    }));
  if (membershipRows.length) {
    map.set('Memberships', [
      ...(map.get('Memberships') ?? []),
      ...membershipRows,
    ]);
  }

  return Array.from(map.entries())
    .map(([name, products]) => ({
      name,
      products: products.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => {
      if (a.name === 'Memberships') return 1;
      if (b.name === 'Memberships') return -1;
      return a.name.localeCompare(b.name);
    });
}

export default function MembershipProductMultiSelect(props: Props) {
  const {
    value,
    onChange,
    enabled = true,
    warm = false,
    excludePlanId = null,
    placeholder = 'Select one or more products...',
  } = props;

  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(value);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const expandedSeeded = useRef(false);

  const fetchEnabled = Boolean(warm || enabled);
  const live = fetchEnabled;
  const ticketsKey = membershipPickerTicketsKey();

  const ticketsQuery = useQuery({
    queryKey: ticketsKey,
    queryFn: () => listTicketingProducts(MEMBERSHIP_PICKER_TICKETS_FILTERS),
    enabled: fetchEnabled,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot<AdmissionProductDto[]>(ticketsKey),
    placeholderData: (prev) => prev,
    staleTime: live ? 0 : ADMIN_LIST_STALE_MS,
    refetchInterval: live ? ADMIN_MEMBERSHIPS_MODAL_LIVE_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: live,
    // Memberships staff may lack TicketingRead — still offer sibling plans.
    retry: (count, err) => {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        return false;
      }
      return count < 1;
    },
  });

  const ticketsForbidden =
    ticketsQuery.isError &&
    ticketsQuery.error instanceof ApiError &&
    (ticketsQuery.error.status === 401 || ticketsQuery.error.status === 403);

  const plansQuery = useQuery({
    queryKey: membershipKeys.plans(false),
    queryFn: () => listMembershipPlans({ includeArchived: false }),
    enabled: fetchEnabled,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot<MembershipPlanDto[]>(membershipKeys.plans(false)),
    placeholderData: (prev) => prev,
    staleTime: live ? 0 : ADMIN_LIST_STALE_MS,
    refetchInterval: live ? ADMIN_MEMBERSHIPS_MODAL_LIVE_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: live,
  });

  // Ensure cache is warm as soon as the plan modal wants data.
  useEffect(() => {
    if (!fetchEnabled) return;
    prefetchMembershipPlanProductPicker(qc);
  }, [fetchEnabled, qc]);

  // Cross-tab / same-session: ticket products + membership plans stay aligned.
  useEffect(() => {
    if (!fetchEnabled) return;
    const unsubCatalog = subscribeCatalogChange((msg) => {
      if (
        msg.kind === 'category-counts' ||
        msg.kind === 'category' ||
        msg.kind === 'public-category-links'
      ) {
        void qc.invalidateQueries({
          queryKey: ticketsKey,
          refetchType: 'active',
        });
      }
    });
    const unsubMembership = subscribeMembershipChange((msg) => {
      if (msg.kind === 'plan' || msg.kind === 'all' || msg.kind === 'category') {
        void qc.invalidateQueries({
          queryKey: membershipKeys.plans(false),
          refetchType: 'active',
        });
      }
    });
    return () => {
      unsubCatalog();
      unsubMembership();
    };
  }, [fetchEnabled, qc, ticketsKey]);

  const groups = useMemo(
    () =>
      buildGroups(
        ticketsQuery.data ?? [],
        plansQuery.data ?? [],
        excludePlanId
      ),
    [ticketsQuery.data, plansQuery.data, excludePlanId]
  );

  const allProducts = useMemo(
    () => groups.flatMap((g) => g.products),
    [groups]
  );

  const byId = useMemo(
    () => new Map(allProducts.map((p) => [p.id, p])),
    [allProducts]
  );

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        products: g.products.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            g.name.toLowerCase().includes(q) ||
            (p.meta?.toLowerCase().includes(q) ?? false)
        ),
      }))
      .filter((g) => g.products.length > 0);
  }, [groups, search]);

  const selectedLabels = useMemo(() => {
    return value.map((id) => {
      const row = byId.get(id);
      return {
        id,
        name: row?.name ?? (id.startsWith('membership:') ? 'Membership plan' : 'Product'),
        missing: !row,
      };
    });
  }, [value, byId]);

  const ticketCount = ticketsQuery.data?.filter((p) => !p.archivedAt).length ?? 0;
  const siblingPlanCount =
    plansQuery.data?.filter((p) => !p.archivedAt && p.id !== excludePlanId)
      .length ?? 0;
  const hasAnyCatalog = ticketCount > 0 || siblingPlanCount > 0;

  // Seed accordion open so the first paint shows products, not empty headers.
  useEffect(() => {
    if (!open || expandedSeeded.current || groups.length === 0) return;
    const next: Record<string, boolean> = {};
    for (const g of groups) next[g.name] = true;
    setExpanded(next);
    expandedSeeded.current = true;
  }, [open, groups]);

  useEffect(() => {
    if (!open) {
      expandedSeeded.current = false;
      return;
    }
    setDraft(value);
    setSearch('');
    const t = window.setTimeout(() => searchRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setDraft(value);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        setDraft(value);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, value]);

  function toggleId(id: string) {
    setDraft((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function toggleGroup(group: Group) {
    const ids = group.products.map((p) => p.id);
    const allOn = ids.every((id) => draft.includes(id));
    setDraft((prev) => {
      if (allOn) return prev.filter((id) => !ids.includes(id));
      const set = new Set(prev);
      for (const id of ids) set.add(id);
      return Array.from(set);
    });
  }

  function removeCommitted(id: string) {
    onChange(value.filter((x) => x !== id));
  }

  function onDone() {
    onChange(draft);
    setOpen(false);
  }

  function onCancel() {
    setDraft(value);
    setOpen(false);
  }

  // Warm-only mode: keep queries alive, render nothing.
  if (!enabled) return null;

  const showBlockingLoad =
    filteredGroups.length === 0 &&
    (ticketsQuery.isLoading || plansQuery.isLoading) &&
    ticketsQuery.data === undefined &&
    plansQuery.data === undefined;

  const loadError = (() => {
    if (plansQuery.isError) {
      return plansQuery.error instanceof Error
        ? plansQuery.error.message
        : 'Could not load membership plans';
    }
    if (ticketsQuery.isError && !ticketsForbidden) {
      return ticketsQuery.error instanceof Error
        ? ticketsQuery.error.message
        : 'Could not load ticket products';
    }
    return null;
  })();

  const draftCount = draft.length;
  const isFetching =
    (ticketsQuery.isFetching || plansQuery.isFetching) && !showBlockingLoad;

  return (
    <div ref={rootRef} className="relative space-y-2">
      {selectedLabels.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected add-ons">
          {selectedLabels.map((item) => (
            <li key={item.id}>
              <span
                className={`inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-xs ${
                  item.missing
                    ? 'border-amber-200 bg-amber-50 text-amber-900'
                    : 'border-stone-200 bg-stone-50 text-stone-800'
                }`}
              >
                <span className="truncate">{item.name}</span>
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 text-stone-400 hover:bg-stone-200 hover:text-stone-700"
                  aria-label={`Remove ${item.name}`}
                  onClick={() => removeCommitted(item.id)}
                >
                  <svg
                    className="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        className="flex w-full min-h-[44px] items-center justify-between gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-left text-sm shadow-sm transition-colors hover:border-[#D4AF37]/60 hover:bg-stone-50/80 focus:border-[#D4AF37] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/30"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="min-w-0 flex-1">
          {selectedLabels.length === 0 ? (
            <span className="text-stone-400">{placeholder}</span>
          ) : (
            <span className="font-medium text-stone-800">
              {selectedLabels.length} add-on
              {selectedLabels.length === 1 ? '' : 's'} selected
            </span>
          )}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-stone-400 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {open ? (
        <div
          className="absolute left-0 right-0 z-40 mt-1 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xl ring-1 ring-black/5"
          role="listbox"
          aria-multiselectable
        >
          <div className="border-b border-stone-100 bg-gradient-to-b from-stone-50 to-white p-2.5">
            <label className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 shadow-sm focus-within:border-[#D4AF37] focus-within:ring-1 focus-within:ring-[#D4AF37]/40">
              <svg
                className="h-4 w-4 shrink-0 text-stone-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z"
                />
              </svg>
              <input
                ref={searchRef}
                type="search"
                className="min-w-0 flex-1 bg-transparent text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none"
                placeholder="Search products or plans…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search ? (
                <button
                  type="button"
                  className="text-xs text-stone-500 hover:text-stone-800"
                  onClick={() => setSearch('')}
                >
                  Clear
                </button>
              ) : null}
            </label>
          </div>

          <div className="flex items-center justify-between gap-2 bg-stone-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-white">
            <span className="flex items-center gap-2">
              All products
              <span className="rounded bg-white/15 px-1.5 py-0.5 font-normal normal-case tracking-normal text-stone-200">
                {allProducts.length}
              </span>
            </span>
            <span className="flex items-center gap-2 font-normal normal-case tracking-normal">
              {isFetching ? (
                <span className="text-stone-300">Updating…</span>
              ) : null}
              {draftCount > 0 ? (
                <button
                  type="button"
                  className="text-amber-200 hover:text-white"
                  onClick={() => setDraft([])}
                >
                  Clear {draftCount}
                </button>
              ) : null}
            </span>
          </div>

          {ticketsForbidden ? (
            <p className="border-b border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Ticket products need Ticketing read permission. You can still
              attach other membership plans.
            </p>
          ) : null}

          <div className="max-h-72 overflow-y-auto overscroll-contain">
            {showBlockingLoad ? (
              <div className="space-y-2 px-3 py-5">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-9 animate-pulse rounded-md bg-stone-100"
                  />
                ))}
                <p className="text-center text-xs text-stone-500">
                  Loading Online Booking products…
                </p>
              </div>
            ) : loadError ? (
              <div className="space-y-3 px-4 py-6 text-center">
                <p className="text-sm text-red-700">{loadError}</p>
                <button
                  type="button"
                  className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50"
                  onClick={() => {
                    void ticketsQuery.refetch();
                    void plansQuery.refetch();
                  }}
                >
                  Try again
                </button>
              </div>
            ) : filteredGroups.length === 0 ? (
              <div className="px-4 py-6 text-center">
                {search.trim() ? (
                  <p className="text-sm text-stone-600">
                    No products match “{search.trim()}”.
                  </p>
                ) : hasAnyCatalog ? (
                  <p className="text-sm text-stone-600">
                    Nothing to show for this filter.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[#D4AF37]/15 text-[#8a7020]">
                      <svg
                        className="h-5 w-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.75}
                          d="M12 6v12m6-6H6"
                        />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-stone-800">
                        No add-ons available yet
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-stone-500">
                        Create Online Booking ticket products (or another
                        membership plan) to offer them at checkout with this
                        membership.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                      <Link
                        href="/admin/ticketing/products/new"
                        className="rounded-md bg-[#D4AF37] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#c4a030]"
                        onClick={() => setOpen(false)}
                      >
                        Create ticket product
                      </Link>
                      <button
                        type="button"
                        className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50"
                        onClick={() => {
                          void ticketsQuery.refetch();
                          void plansQuery.refetch();
                        }}
                      >
                        Refresh list
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <ul className="divide-y divide-stone-100">
                {filteredGroups.map((group) => {
                  const isOpen = search.trim()
                    ? true
                    : expanded[group.name] !== false;
                  const groupIds = group.products.map((p) => p.id);
                  const selectedCount = groupIds.filter((id) =>
                    draft.includes(id)
                  ).length;
                  const allOn =
                    groupIds.length > 0 && selectedCount === groupIds.length;
                  const someOn = selectedCount > 0 && !allOn;

                  return (
                    <li key={group.name}>
                      <div className="flex items-center gap-2 px-3 py-2.5 hover:bg-stone-50">
                        <input
                          type="checkbox"
                          className="shrink-0 accent-[#D4AF37]"
                          checked={allOn}
                          ref={(el) => {
                            if (el) el.indeterminate = someOn;
                          }}
                          onChange={() => toggleGroup(group)}
                          aria-label={`Select all in ${group.name}`}
                        />
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-stone-800"
                          onClick={() =>
                            setExpanded((prev) => ({
                              ...prev,
                              [group.name]: !isOpen,
                            }))
                          }
                        >
                          <span
                            className={`inline-block text-[10px] text-stone-500 transition-transform ${
                              isOpen ? 'rotate-90' : ''
                            }`}
                            aria-hidden
                          >
                            ▶
                          </span>
                          <span className="truncate font-semibold">
                            {group.name}
                          </span>
                          <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-500">
                            {group.products.length}
                          </span>
                          {selectedCount > 0 ? (
                            <span className="text-[10px] font-medium text-[#8a7020]">
                              {selectedCount} selected
                            </span>
                          ) : null}
                        </button>
                      </div>
                      {isOpen ? (
                        <ul className="border-t border-stone-50 bg-stone-50/70 pb-1">
                          {group.products.map((p) => {
                            const checked = draft.includes(p.id);
                            return (
                              <li key={p.id}>
                                <label
                                  className={`flex cursor-pointer items-start gap-2.5 py-2 pl-9 pr-3 text-sm transition-colors ${
                                    checked
                                      ? 'bg-[#D4AF37]/10 text-stone-900'
                                      : 'text-stone-700 hover:bg-stone-100'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    className="mt-0.5 shrink-0 accent-[#D4AF37]"
                                    checked={checked}
                                    onChange={() => toggleId(p.id)}
                                  />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate font-medium">
                                      {p.name}
                                    </span>
                                    {p.meta ? (
                                      <span className="mt-0.5 block truncate text-[11px] text-stone-500">
                                        {p.meta}
                                      </span>
                                    ) : null}
                                  </span>
                                  {p.kind === 'membership' ? (
                                    <span className="mt-0.5 shrink-0 rounded bg-stone-200/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-stone-600">
                                      Plan
                                    </span>
                                  ) : null}
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-stone-200 bg-stone-50/90 px-3 py-2.5">
            <button
              type="button"
              className="rounded-lg border border-stone-300 bg-white px-3.5 py-1.5 text-sm text-stone-700 hover:bg-white"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-lg bg-[#D4AF37] px-5 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-[#c4a030] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40"
              onClick={onDone}
            >
              Done{draftCount > 0 ? ` (${draftCount})` : ''}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
