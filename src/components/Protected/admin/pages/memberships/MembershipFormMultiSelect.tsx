'use client';

/**
 * ROLLER-style multi-select form picker for Membership plan “Forms” option.
 * Live: polls + memberships cross-tab sync while warm so new Digital Waivers
 * form templates and catalog labels appear without a full refresh.
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
import { subscribeMembershipChange } from '@/lib/membershipsSync';
import { ADMIN_MEMBERSHIPS_MODAL_LIVE_MS } from '@/utils/adminLiveRefresh';
import {
  listAttachableForms,
  membershipKeys,
  type AttachableFormDto,
} from '@/services/memberships';

export function prefetchMembershipPlanFormPicker(queryClient: QueryClient) {
  void queryClient.prefetchQuery({
    queryKey: membershipKeys.attachableForms(),
    queryFn: () => listAttachableForms(),
    staleTime: ADMIN_LIST_STALE_MS,
  });
}

/** Starter catalog ids from MembershipSettings.other.formsCatalog. */
function isStarterFormId(id: string): boolean {
  return id.startsWith('form_');
}

type Props = {
  value: string[];
  onChange: (ids: string[]) => void;
  /** Show picker UI (Forms checked). */
  enabled?: boolean;
  /** Fetch in background while plan modal is open. */
  warm?: boolean;
  placeholder?: string;
};

export default function MembershipFormMultiSelect(props: Props) {
  const {
    value,
    onChange,
    enabled = true,
    warm = false,
    placeholder = 'Select one or more forms',
  } = props;

  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(value);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const fetchEnabled = Boolean(warm || enabled);
  const live = fetchEnabled;
  const formsKey = membershipKeys.attachableForms();

  const formsQuery = useQuery({
    queryKey: formsKey,
    queryFn: () => listAttachableForms(),
    enabled: fetchEnabled,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot<AttachableFormDto[]>(formsKey),
    placeholderData: (prev) => prev,
    staleTime: live ? 0 : ADMIN_LIST_STALE_MS,
    refetchInterval: live ? ADMIN_MEMBERSHIPS_MODAL_LIVE_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: live,
  });

  useEffect(() => {
    if (!fetchEnabled) return;
    prefetchMembershipPlanFormPicker(qc);
  }, [fetchEnabled, qc]);

  // Plan / settings / catalog edits (incl. other tabs) refresh this picker.
  useEffect(() => {
    if (!fetchEnabled) return;
    return subscribeMembershipChange((msg) => {
      if (
        msg.kind === 'plan' ||
        msg.kind === 'settings' ||
        msg.kind === 'all'
      ) {
        void qc.invalidateQueries({
          queryKey: formsKey,
          refetchType: 'active',
        });
      }
    });
  }, [fetchEnabled, qc, formsKey]);

  // Same-tab: Digital Waivers template publishes also invalidate attachable forms.
  useEffect(() => {
    if (!fetchEnabled || typeof window === 'undefined') return;
    const onWaivers = () => {
      void qc.invalidateQueries({
        queryKey: formsKey,
        refetchType: 'active',
      });
    };
    window.addEventListener('harewa:waivers-changed', onWaivers);
    return () => window.removeEventListener('harewa:waivers-changed', onWaivers);
  }, [fetchEnabled, qc, formsKey]);

  const forms = formsQuery.data ?? [];
  const byId = useMemo(
    () => new Map(forms.map((f) => [f.id, f])),
    [forms]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return forms;
    return forms.filter(
      (f) =>
        f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q)
    );
  }, [forms, search]);

  const selectedRows = useMemo(() => {
    return value.map((id) => {
      const row = byId.get(id);
      return {
        id,
        name: row?.name ?? 'Form',
        missing: !row,
      };
    });
  }, [value, byId]);

  useEffect(() => {
    if (!open) return;
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

  function selectAll() {
    setDraft((prev) => {
      const set = new Set(prev);
      for (const f of filtered) set.add(f.id);
      return Array.from(set);
    });
  }

  function clearAll() {
    setDraft([]);
  }

  function removeCommitted(id: string) {
    onChange(value.filter((x) => x !== id));
  }

  function onApply() {
    onChange(draft);
    setOpen(false);
  }

  function onCancel() {
    setDraft(value);
    setOpen(false);
  }

  if (!enabled) return null;

  const showBlockingLoad =
    forms.length === 0 &&
    formsQuery.isLoading &&
    formsQuery.data === undefined;

  const loadError =
    formsQuery.isError && formsQuery.error instanceof Error
      ? formsQuery.error.message
      : formsQuery.isError
        ? 'Could not load forms'
        : null;

  const draftCount = draft.length;
  const isFetching = formsQuery.isFetching && !showBlockingLoad;

  return (
    <div ref={rootRef} className="relative space-y-2">
      {selectedRows.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected forms">
          {selectedRows.map((item) => (
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
        <span className="flex min-w-0 flex-1 items-center gap-2">
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
          {selectedRows.length === 0 ? (
            <span className="text-stone-400">{placeholder}</span>
          ) : (
            <span className="font-medium text-stone-800">
              {selectedRows.length} form
              {selectedRows.length === 1 ? '' : 's'} selected
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
                placeholder="Search forms…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search ? (
                <button
                  type="button"
                  className="text-xs text-stone-500 hover:text-stone-800"
                  onClick={() => setSearch('')}
                >
                  Clear search
                </button>
              ) : null}
            </label>
            <div className="mt-2 flex items-center justify-end gap-3 text-xs">
              <button
                type="button"
                className="font-medium text-stone-500 hover:text-stone-800"
                onClick={clearAll}
              >
                Clear
              </button>
              <button
                type="button"
                className="font-medium text-stone-500 hover:text-stone-800"
                onClick={selectAll}
                disabled={filtered.length === 0}
              >
                Select all
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 bg-stone-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-white">
            <span className="flex items-center gap-2">
              Form
              <span className="rounded bg-white/15 px-1.5 py-0.5 font-normal normal-case tracking-normal text-stone-200">
                {forms.length}
              </span>
            </span>
            <span className="font-normal normal-case tracking-normal text-stone-300">
              {isFetching ? 'Updating…' : null}
              {draftCount > 0 && !isFetching ? `${draftCount} selected` : null}
            </span>
          </div>

          <div className="max-h-64 overflow-y-auto overscroll-contain">
            {showBlockingLoad ? (
              <div className="space-y-2 px-3 py-5">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-9 animate-pulse rounded-md bg-stone-100"
                  />
                ))}
              </div>
            ) : loadError ? (
              <div className="space-y-3 px-4 py-6 text-center">
                <p className="text-sm text-red-700">{loadError}</p>
                <button
                  type="button"
                  className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50"
                  onClick={() => void formsQuery.refetch()}
                >
                  Try again
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-6 text-center">
                {search.trim() ? (
                  <p className="text-sm text-stone-600">
                    No forms match “{search.trim()}”.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-stone-800">
                      No forms available yet
                    </p>
                    <p className="text-xs leading-relaxed text-stone-500">
                      Starter guest-info forms appear automatically. Publish a
                      Digital Waivers <em>form</em> template to offer more.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <Link
                        href="/admin/waivers/templates"
                        className="rounded-md bg-[#D4AF37] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#c4a030]"
                        onClick={() => setOpen(false)}
                      >
                        Open waiver forms
                      </Link>
                      <button
                        type="button"
                        className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50"
                        onClick={() => void formsQuery.refetch()}
                      >
                        Refresh
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <ul className="divide-y divide-stone-100">
                {filtered.map((f) => {
                  const checked = draft.includes(f.id);
                  const starter = isStarterFormId(f.id);
                  return (
                    <li key={f.id}>
                      <label
                        className={`flex cursor-pointer items-center gap-2.5 px-3 py-2.5 text-sm transition-colors ${
                          checked
                            ? 'bg-[#D4AF37]/10 text-stone-900'
                            : 'text-stone-800 hover:bg-stone-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="shrink-0 accent-[#D4AF37]"
                          checked={checked}
                          onChange={() => toggleId(f.id)}
                        />
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {f.name}
                        </span>
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                            starter
                              ? 'bg-stone-100 text-stone-500'
                              : 'bg-[#D4AF37]/15 text-[#8a7020]'
                          }`}
                        >
                          {starter ? 'Catalog' : 'Waiver'}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-stone-100 bg-stone-50/80 px-3 py-2 text-[11px] leading-relaxed text-stone-500">
            <span className="font-medium text-stone-600">Catalog</span> = starter
            labels seeded for this company (not a separate Forms app).{' '}
            <span className="font-medium text-[#8a7020]">Waiver</span> = published
            Digital Waivers form templates — those appear here automatically when
            you publish or archive them.{' '}
            <Link
              href="/admin/waivers/templates"
              className="font-medium text-[#8a7020] underline-offset-2 hover:underline"
              onClick={() => setOpen(false)}
            >
              Manage waiver forms
            </Link>
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
              onClick={onApply}
            >
              Apply{draftCount > 0 ? ` (${draftCount})` : ''}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
