"use client";

/**
 * Account mappings — map products, tenders, and defaults to ledger accounts.
 * Empty query key matches desk prefetch; location scope is applied client-side.
 */

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Link2,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { isAdminQueryBlockingLoad } from "@/lib/adminListCache";
import {
  useAccountingLocationFilter,
  useAccountingMappingsQuery,
  usePutAccountingMappingsMutation,
} from "@/hooks/useAccounting";
import {
  AccountPicker,
  AccountingErrorMessage,
  AccountingGate,
  LocationPicker,
  accountingErrorMessage,
  asRecord,
} from "../shared";
import { useAccountingDesk } from "../accountingDesk";

type MappingRow = {
  kind: string;
  matchKey: string;
  locationId?: string | null;
  ledgerAccountId?: string | null;
};

type DraftRow = {
  kind: string;
  matchKey: string;
  label: string;
  ledgerAccountId: string;
  locationId: string | null;
};

const KIND_LABELS: Record<string, string> = {
  admission_product_type: "Admission product types",
  admission_product: "Admission products",
  pos_product_kind: "POS product kinds",
  pos_product: "POS products",
  pos_line_kind: "POS line kinds",
  booking_tender: "Booking tenders",
  pos_tender: "POS tenders",
  membership_plan: "Membership plans",
  shop_category: "Shop categories",
  expense_category: "Expense categories",
  stripe_account: "Stripe accounts",
  location_default: "Location defaults",
};

function titleCase(raw: string) {
  return raw
    .replace(/[_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function kindLabel(kind: string) {
  return KIND_LABELS[kind] ?? titleCase(kind);
}

function serializeDrafts(rows: DraftRow[]) {
  return JSON.stringify(
    rows.map((r) => ({
      kind: r.kind,
      matchKey: r.matchKey,
      ledgerAccountId: r.ledgerAccountId,
      locationId: r.locationId,
    }))
  );
}

function LivePulse({ mode }: { mode: "first" | "manual" | "idle" }) {
  const active = mode !== "idle";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
        active
          ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/80"
          : "bg-stone-50 text-stone-500 ring-1 ring-stone-200/80"
      }`}
      title="Quiet live sync in the background — does not block the page"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          active ? "animate-pulse bg-emerald-500" : "bg-emerald-400"
        }`}
      />
      {mode === "first"
        ? "Loading…"
        : mode === "manual"
          ? "Updating…"
          : "Live"}
    </span>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse overflow-hidden rounded-2xl border border-stone-200/80 bg-white"
        >
          <div className="h-11 bg-stone-100" />
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((__, j) => (
              <div key={j} className="h-12 rounded-xl bg-stone-50" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function asNamedList(value: unknown): Array<{
  id: string;
  name?: string;
  label?: string;
  locationId?: string | null;
}> {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (typeof row === "string") {
        return { id: row, name: titleCase(row) };
      }
      const r = asRecord(row);
      const id = String(r.id ?? r.matchKey ?? "");
      if (!id) return null;
      return {
        id,
        name: r.name != null ? String(r.name) : undefined,
        label: r.label != null ? String(r.label) : undefined,
        locationId:
          r.locationId == null || r.locationId === ""
            ? null
            : String(r.locationId),
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    name?: string;
    label?: string;
    locationId?: string | null;
  }>;
}

/** Flatten API `{ catalog: { … } }` into editable mapping rows. */
function catalogToDrafts(
  catalogRaw: unknown,
  mappingsRaw: unknown,
  scopeLocationId: string | null
): DraftRow[] {
  const catalog = asRecord(catalogRaw);
  const mappings = Array.isArray(mappingsRaw)
    ? (mappingsRaw as MappingRow[])
    : [];

  const byKey = new Map(
    mappings.map((m) => [
      `${m.kind}|${m.matchKey}|${m.locationId ?? ""}`,
      m,
    ])
  );

  const pick = (kind: string, matchKey: string): string => {
    const scoped = scopeLocationId
      ? byKey.get(`${kind}|${matchKey}|${scopeLocationId}`)
      : undefined;
    const company = byKey.get(`${kind}|${matchKey}|`);
    return String(
      scoped?.ledgerAccountId ?? company?.ledgerAccountId ?? ""
    );
  };

  const rows: DraftRow[] = [];
  const push = (kind: string, matchKey: string, label: string) => {
    rows.push({
      kind,
      matchKey,
      label,
      ledgerAccountId: pick(kind, matchKey),
      locationId: scopeLocationId,
    });
  };

  for (const key of asNamedList(catalog.admissionProductTypes)) {
    push("admission_product_type", key.id, key.name ?? titleCase(key.id));
  }
  for (const p of asNamedList(catalog.admissionProducts)) {
    push("admission_product", p.id, p.name ?? p.label ?? p.id);
  }
  for (const key of asNamedList(catalog.posProductKinds)) {
    push("pos_product_kind", key.id, key.name ?? titleCase(key.id));
  }
  for (const p of asNamedList(catalog.posProducts)) {
    push("pos_product", p.id, p.name ?? p.label ?? p.id);
  }
  for (const key of asNamedList(catalog.posLineKinds)) {
    push("pos_line_kind", key.id, key.name ?? titleCase(key.id));
  }
  for (const key of asNamedList(catalog.bookingTenders)) {
    push("booking_tender", key.id, key.name ?? titleCase(key.id));
  }
  for (const key of asNamedList(catalog.posTenders)) {
    push("pos_tender", key.id, key.name ?? titleCase(key.id));
  }
  for (const p of asNamedList(catalog.membershipPlans)) {
    push("membership_plan", p.id, p.name ?? p.label ?? p.id);
  }
  for (const p of asNamedList(catalog.shopCategories)) {
    push("shop_category", p.id, p.name ?? p.label ?? p.id);
  }
  for (const p of asNamedList(catalog.expenseCategories)) {
    push("expense_category", p.id, p.name ?? p.label ?? p.id);
  }
  for (const p of asNamedList(catalog.stripeAccounts)) {
    push("stripe_account", p.id, p.label ?? p.name ?? p.id);
  }
  for (const key of asNamedList(catalog.locationDefaultKeys)) {
    push("location_default", key.id, key.name ?? titleCase(key.id));
  }

  if (rows.length === 0 && Array.isArray(catalogRaw)) {
    for (const row of catalogRaw as MappingRow[]) {
      if (!row?.kind || !row?.matchKey) continue;
      push(
        String(row.kind),
        String(row.matchKey),
        String((row as { label?: string }).label ?? row.matchKey)
      );
    }
  }

  return rows;
}

export default function AccountingMappingsPage() {
  const desk = useAccountingDesk();
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canManage = can(P.AccountingManage);
  const canRead = canManage || can(P.AccountingRead);

  const loc = useAccountingLocationFilter();
  const scopeLocationId = loc.effectiveLocationId || null;

  /** Empty key matches desk prefetch for split-second open. */
  const mappingsQuery = useAccountingMappingsQuery({}, canRead);
  const putMutation = usePutAccountingMappingsMutation();

  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [baseline, setBaseline] = useState("");
  const [manualRefresh, setManualRefresh] = useState(false);
  const [filterBusy, setFilterBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [q, setQ] = useState("");
  const [unmappedOnly, setUnmappedOnly] = useState(false);
  const [kindFilter, setKindFilter] = useState("");
  const [busyKind, setBusyKind] = useState<string | null>(null);

  const dirty = baseline !== "" && serializeDrafts(drafts) !== baseline;

  const applyServerData = (force: boolean) => {
    if (!mappingsQuery.data) return;
    if (!force && dirty) return;
    const data = asRecord(mappingsQuery.data);
    const next = catalogToDrafts(
      data.catalog,
      data.mappings,
      scopeLocationId
    );
    setDrafts(next);
    setBaseline(serializeDrafts(next));
  };

  useEffect(() => {
    // Location scope change always rebuilds from cached server payload.
    if (!mappingsQuery.data) return;
    setFilterBusy(true);
    const data = asRecord(mappingsQuery.data);
    const next = catalogToDrafts(
      data.catalog,
      data.mappings,
      scopeLocationId
    );
    setDrafts(next);
    setBaseline(serializeDrafts(next));
    setFilterBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- location-driven rebuild only
  }, [scopeLocationId]);

  useEffect(() => {
    if (mappingsQuery.isFetching) return;
    setManualRefresh(false);
    setFilterBusy(false);
    applyServerData(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dirty-aware apply
  }, [mappingsQuery.dataUpdatedAt, mappingsQuery.isFetching]);

  const blocking = isAdminQueryBlockingLoad(
    mappingsQuery.isLoading,
    drafts.length > 0 || mappingsQuery.isFetched
  );

  const liveMode: "first" | "manual" | "idle" = blocking
    ? "first"
    : manualRefresh || filterBusy || saveBusy || putMutation.isPending
      ? "manual"
      : "idle";

  const kindOptions = useMemo(() => {
    const set = new Set(drafts.map((d) => d.kind));
    return [...set];
  }, [drafts]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return drafts.filter((d) => {
      if (unmappedOnly && d.ledgerAccountId) return false;
      if (kindFilter && d.kind !== kindFilter) return false;
      if (!needle) return true;
      return (
        d.label.toLowerCase().includes(needle) ||
        d.matchKey.toLowerCase().includes(needle) ||
        kindLabel(d.kind).toLowerCase().includes(needle)
      );
    });
  }, [drafts, q, unmappedOnly, kindFilter]);

  const sections = useMemo(() => {
    const map = new Map<string, DraftRow[]>();
    for (const d of filtered) {
      const list = map.get(d.kind) ?? [];
      list.push(d);
      map.set(d.kind, list);
    }
    return [...map.entries()];
  }, [filtered]);

  const unmapped = drafts.filter((d) => !d.ledgerAccountId).length;
  const mapped = drafts.length - unmapped;

  const onRefresh = () => {
    setManualRefresh(true);
    void mappingsQuery.refetch().then(() => {
      // Force overwrite local drafts after explicit refresh.
      if (!mappingsQuery.data) return;
    });
  };

  useEffect(() => {
    if (!manualRefresh || mappingsQuery.isFetching) return;
    applyServerData(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualRefresh, mappingsQuery.isFetching, mappingsQuery.dataUpdatedAt]);

  const onLocationChange = (id: string) => {
    setFilterBusy(true);
    loc.setLocationId(id);
  };

  const onKindFilter = (next: string) => {
    setBusyKind(next || "all");
    setKindFilter(next);
    window.setTimeout(() => setBusyKind(null), 180);
  };

  const onUnmappedToggle = () => {
    setBusyKind("unmapped");
    setUnmappedOnly((v) => !v);
    window.setTimeout(() => setBusyKind(null), 180);
  };

  const save = async () => {
    if (!canManage) return;
    setSaveBusy(true);
    try {
      await putMutation.mutateAsync({
        rows: drafts
          .filter((d) => d.ledgerAccountId)
          .map((d) => ({
            kind: d.kind,
            matchKey: d.matchKey,
            ledgerAccountId: d.ledgerAccountId,
            locationId: d.locationId,
          })),
      });
      const data = asRecord(mappingsQuery.data);
      const next = catalogToDrafts(
        data.catalog,
        // Optimistic: keep current drafts as baseline until refetch lands.
        drafts.map((d) => ({
          kind: d.kind,
          matchKey: d.matchKey,
          locationId: d.locationId,
          ledgerAccountId: d.ledgerAccountId,
        })),
        scopeLocationId
      );
      setDrafts(next);
      setBaseline(serializeDrafts(next));
      addToast("Mappings saved", "success");
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    } finally {
      setSaveBusy(false);
    }
  };

  const openSuspense = () => {
    desk?.warmPanel("ledger");
    desk?.openLedger({ systemKey: "suspense" });
  };

  return (
    <AccountingGate>
      <div className="space-y-5">
        <header className="relative overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(212,175,55,0.16),_transparent_55%),linear-gradient(180deg,#fff_0%,#fafaf9_100%)]"
          />
          <div className="relative flex flex-col gap-4 px-4 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
                  Account mappings
                </h1>
                <LivePulse mode={liveMode} />
                {dirty ? (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200">
                    Unsaved changes
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Point products, tenders, and defaults at ledger accounts.
                Unmapped items post to suspense until you save a mapping.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold">
                <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 tabular-nums text-stone-600 ring-1 ring-stone-200">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  {mapped} mapped
                </span>
                {unmapped > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 tabular-nums text-amber-900 ring-1 ring-amber-200">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {unmapped} → suspense
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-800 ring-1 ring-emerald-200">
                    All mapped
                  </span>
                )}
              </div>
            </div>
            <div className="relative z-10 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onRefresh}
                disabled={manualRefresh || blocking}
                className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:border-stone-300 hover:bg-stone-50 disabled:opacity-60"
              >
                {manualRefresh ? (
                  <Loader2 className="h-4 w-4 animate-spin text-[#D4AF37]" />
                ) : (
                  <RefreshCw className="h-4 w-4 text-stone-500" />
                )}
                {manualRefresh ? "Refreshing…" : "Refresh"}
              </button>
              {unmapped > 0 ? (
                <button
                  type="button"
                  onClick={openSuspense}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-semibold text-[#8a7318] shadow-sm transition hover:bg-stone-50"
                >
                  <Link2 className="h-4 w-4" />
                  Open suspense
                </button>
              ) : null}
              <button
                type="button"
                disabled={
                  !canManage || saveBusy || putMutation.isPending || !dirty
                }
                onClick={() => void save()}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#D4AF37] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-50"
              >
                {saveBusy || putMutation.isPending ? <ButtonSpinner /> : null}
                {saveBusy || putMutation.isPending
                  ? "Saving…"
                  : "Save mappings"}
              </button>
            </div>
          </div>
        </header>

        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-stone-900">Filters</h2>
              <p className="text-xs text-stone-500">
                Narrow by location, category, or name — stays live as the
                catalog changes
              </p>
            </div>
            {filterBusy ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#D4AF37]" />
                Applying…
              </span>
            ) : null}
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <LocationPicker
                value={loc.locationId}
                onChange={onLocationChange}
                label="Location override"
                syncHqPreference
                className="min-w-[14rem]"
              />
              <label className="block min-w-[12rem] flex-1 text-sm sm:max-w-xs">
                <span className="mb-1 block font-medium text-stone-700">
                  Category
                </span>
                <select
                  value={kindFilter}
                  onChange={(e) => onKindFilter(e.target.value)}
                  className="w-full cursor-pointer rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
                >
                  <option value="">All categories</option>
                  {kindOptions.map((k) => (
                    <option key={k} value={k}>
                      {kindLabel(k)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block min-w-[12rem] flex-1 text-sm sm:max-w-sm">
                <span className="mb-1 block font-medium text-stone-700">
                  Search
                </span>
                <span className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Name or product…"
                    className="w-full rounded-xl border border-stone-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
                  />
                </span>
              </label>
              <button
                type="button"
                onClick={onUnmappedToggle}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-medium shadow-sm transition ${
                  unmappedOnly
                    ? "border-amber-300 bg-amber-50 text-amber-900"
                    : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                }`}
              >
                {busyKind === "unmapped" ? <ButtonSpinner /> : null}
                Unmapped only
              </button>
            </div>
          </div>
        </div>

        <AccountingErrorMessage error={mappingsQuery.error} />

        {blocking ? (
          <TableSkeleton />
        ) : sections.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-stone-200 bg-white px-4 py-16 text-center">
            <Link2 className="h-10 w-10 text-stone-300" />
            <p className="text-sm font-medium text-stone-800">
              No mappings match these filters
            </p>
            <p className="max-w-sm text-xs text-stone-500">
              Clear search or category filters, or finish accounting setup so
              catalog items appear.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {sections.map(([kind, rows]) => (
              <section
                key={kind}
                className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-3 sm:px-5">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-stone-900">
                      {kindLabel(kind)}
                    </h2>
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-stone-200">
                      {rows.length}
                    </span>
                    {busyKind === kind ? <ButtonSpinner /> : null}
                  </div>
                  <p className="text-[11px] text-stone-500">
                    {rows.filter((r) => !r.ledgerAccountId).length} unmapped
                  </p>
                </div>
                <ul className="divide-y divide-stone-100">
                  {rows.map((row) => (
                    <li
                      key={`${row.kind}:${row.matchKey}`}
                      className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-stone-900">
                          {row.label}
                        </p>
                        {!row.ledgerAccountId ? (
                          <p className="mt-0.5 text-[11px] font-medium text-amber-800">
                            Posts to suspense until mapped
                          </p>
                        ) : null}
                      </div>
                      <AccountPicker
                        value={row.ledgerAccountId}
                        disabled={!canManage || saveBusy}
                        label=""
                        className="sm:w-80"
                        lazy
                        onChange={(id) =>
                          setDrafts((all) =>
                            all.map((d) =>
                              d.kind === row.kind &&
                              d.matchKey === row.matchKey
                                ? { ...d, ledgerAccountId: id }
                                : d
                            )
                          )
                        }
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </AccountingGate>
  );
}
