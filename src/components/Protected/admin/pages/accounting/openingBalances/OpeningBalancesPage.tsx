"use client";

/**
 * Opening balances at go-live — accounts, AR, AP, and inventory.
 * Empty accounts query key matches desk prefetch; postable rows filtered here.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Scale,
  Search,
  Trash2,
} from "lucide-react";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import { isAdminQueryBlockingLoad } from "@/lib/adminListCache";
import {
  useOpeningBalancesQuery,
  usePutOpeningBalancesMutation,
  useAccountingInitialized,
  useAccountingAccountsQuery,
  useAccountingSuppliersQuery,
} from "@/hooks/useAccounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  MoneyInput,
  PartyPicker,
  StatusChip,
  accountingErrorMessage,
  asItems,
  asRecord,
} from "../shared";

type AccountRow = {
  accountId: string;
  code?: string;
  name?: string;
  debit: string;
  credit: string;
  locationId?: string | null;
};

type CustomerRow = {
  partyKey: string;
  label: string;
  amount: string;
  locationId?: string | null;
};
type SupplierRow = {
  supplierId: string;
  name: string;
  amount: string;
  locationId?: string | null;
};
type InventoryRow = {
  key: string;
  name: string;
  locationId: string | null;
  qty: string;
  unitCost: string;
  productRef: { posProductId?: string; shopProductId?: string };
};

/** Fixed-point ×10_000 (4dp) — browser-safe, no Prisma/Decimal client import. */
const SCALE = 10_000n;

function toScaled(v: string): bigint {
  const s = (v || "0").trim();
  if (!s || !/^-?\d+(\.\d{1,4})?$/.test(s)) return 0n;
  const neg = s.startsWith("-");
  const [w, f = ""] = s.replace("-", "").split(".");
  const whole = BigInt(w || "0");
  const frac = BigInt((f + "0000").slice(0, 4));
  const scaled = whole * SCALE + frac;
  return neg ? -scaled : scaled;
}

function scaledToMoney(scaled: bigint): string {
  const neg = scaled < 0n;
  const abs = neg ? -scaled : scaled;
  const rounded = (abs + 50n) / 100n;
  const whole = rounded / 100n;
  const cents = rounded % 100n;
  const s = `${whole}.${cents.toString().padStart(2, "0")}`;
  return neg && rounded !== 0n ? `-${s}` : s;
}

function isPositive(v: string): boolean {
  return toScaled(v) > 0n;
}

function inventoryLineTotal(qty: string, unitCost: string): string {
  const product = toScaled(qty) * toScaled(unitCost);
  const neg = product < 0n;
  const abs = neg ? -product : product;
  const moneyScaled4 = (abs + 5_000n) / 10_000n;
  return scaledToMoney(neg ? -moneyScaled4 : moneyScaled4);
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
    <div className="animate-pulse space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white"
        >
          <div className="h-11 bg-stone-100" />
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((__, j) => (
              <div key={j} className="h-10 rounded-xl bg-stone-50" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function serializeDraft(input: {
  accounts: AccountRow[];
  customers: CustomerRow[];
  suppliers: SupplierRow[];
  inventory: InventoryRow[];
}) {
  return JSON.stringify({
    accounts: input.accounts.map((a) => ({
      accountId: a.accountId,
      debit: a.debit,
      credit: a.credit,
    })),
    customers: input.customers.map((c) => ({
      partyKey: c.partyKey,
      amount: c.amount,
    })),
    suppliers: input.suppliers.map((s) => ({
      supplierId: s.supplierId,
      amount: s.amount,
    })),
    inventory: input.inventory.map((r) => ({
      key: r.key,
      qty: r.qty,
      unitCost: r.unitCost,
    })),
  });
}

export default function OpeningBalancesPage() {
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canManage = can(P.AccountingManage);
  const { settings } = useAccountingInitialized(canManage);

  const query = useOpeningBalancesQuery(canManage);
  /** Empty key matches desk prefetch — filter postable client-side. */
  const accountsQuery = useAccountingAccountsQuery({}, canManage);
  const suppliersQuery = useAccountingSuppliersQuery({}, canManage);
  const saveMutation = usePutOpeningBalancesMutation();

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [baseline, setBaseline] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(false);
  const [q, setQ] = useState("");
  const [busyAdd, setBusyAdd] = useState<null | "customer" | "supplier">(null);
  const appliedAtRef = useRef(0);

  const dirty =
    baseline !== "" &&
    serializeDraft({ accounts, customers, suppliers, inventory }) !== baseline;

  const applyFromServer = (force: boolean) => {
    const chart = accountsQuery.data ?? [];
    if (!chart.length || !query.data) return;
    if (!force && dirty) return;
    if (
      !force &&
      query.dataUpdatedAt === appliedAtRef.current &&
      accounts.length > 0
    ) {
      return;
    }
    appliedAtRef.current = query.dataUpdatedAt;

    const data = asRecord(query.data);
    const current = asRecord(data.current);
    const lines = asItems<Record<string, unknown>>(current.lines ?? data.lines);

    const byId = new Map(
      lines.map((l) => [String(l.accountId ?? ""), l] as const)
    );

    const nextAccounts = chart
      .filter((a) => a.isActive && !a.isHeader)
      .filter((a) => {
        const subtype = String((a as { subtype?: string }).subtype ?? "");
        const postable =
          a.allowManualPosting !== false &&
          !["receivable", "payable", "inventory"].includes(subtype);
        return postable;
      })
      .map((a) => {
        const line = byId.get(a.id);
        return {
          accountId: a.id,
          code: a.code,
          name: a.name,
          debit: String(line?.debit ?? "0.00"),
          credit: String(line?.credit ?? "0.00"),
          locationId:
            line?.locationId == null ? null : String(line.locationId),
        };
      });

    const cust: CustomerRow[] = [];
    const supp: SupplierRow[] = [];
    for (const l of lines) {
      if (l.guestProfileId) {
        cust.push({
          partyKey: `guest:${String(l.guestProfileId)}`,
          label: String(l.description || `guest:${l.guestProfileId}`),
          amount:
            l.debit && String(l.debit) !== "0.00"
              ? String(l.debit)
              : "0.00",
          locationId:
            l.locationId == null ? null : String(l.locationId),
        });
      } else if (l.bookingAccountId) {
        cust.push({
          partyKey: `account:${String(l.bookingAccountId)}`,
          label: String(l.description || `account:${l.bookingAccountId}`),
          amount:
            l.debit && String(l.debit) !== "0.00"
              ? String(l.debit)
              : "0.00",
          locationId:
            l.locationId == null ? null : String(l.locationId),
        });
      } else if (l.customerUserId) {
        cust.push({
          partyKey: `user:${String(l.customerUserId)}`,
          label: String(l.description || `user:${l.customerUserId}`),
          amount:
            l.debit && String(l.debit) !== "0.00"
              ? String(l.debit)
              : "0.00",
          locationId:
            l.locationId == null ? null : String(l.locationId),
        });
      } else if (l.supplierId) {
        supp.push({
          supplierId: String(l.supplierId),
          name: String(l.description || l.supplierId),
          amount:
            l.credit && String(l.credit) !== "0.00"
              ? String(l.credit)
              : "0.00",
          locationId:
            l.locationId == null ? null : String(l.locationId),
        });
      }
    }

    const candidates = asItems<Record<string, unknown>>(
      data.inventoryCandidates
    );
    const nextInv = candidates.map((c) => {
      const ref = asRecord(c.productRef);
      const key = ref.posProductId
        ? `pos:${String(ref.posProductId)}`
        : `shop:${String(ref.shopProductId)}`;
      return {
        key,
        name: String(c.name ?? key),
        locationId:
          c.locationId == null ? null : String(c.locationId),
        qty: String(c.onHand ?? "0"),
        unitCost: String(c.avgCost ?? "0"),
        productRef: {
          ...(ref.posProductId
            ? { posProductId: String(ref.posProductId) }
            : {}),
          ...(ref.shopProductId
            ? { shopProductId: String(ref.shopProductId) }
            : {}),
        },
      };
    });

    setAccounts(nextAccounts);
    setCustomers(cust);
    setSuppliers(supp);
    setInventory(nextInv);
    setBaseline(
      serializeDraft({
        accounts: nextAccounts,
        customers: cust,
        suppliers: supp,
        inventory: nextInv,
      })
    );
  };

  useEffect(() => {
    if (query.isFetching || accountsQuery.isFetching) return;
    setManualRefresh(false);
    applyFromServer(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dirty-aware apply
  }, [
    query.dataUpdatedAt,
    query.isFetching,
    accountsQuery.dataUpdatedAt,
    accountsQuery.isFetching,
  ]);

  const supplierOptions = useMemo(() => {
    return asItems<{ id: string; name: string }>(suppliersQuery.data, [
      "items",
      "suppliers",
    ]);
  }, [suppliersQuery.data]);

  const totals = useMemo(() => {
    let debit = 0n;
    let credit = 0n;
    for (const a of accounts) {
      debit += toScaled(scaledToMoney(toScaled(a.debit)));
      credit += toScaled(scaledToMoney(toScaled(a.credit)));
    }
    for (const c of customers) debit += toScaled(scaledToMoney(toScaled(c.amount)));
    for (const s of suppliers) credit += toScaled(scaledToMoney(toScaled(s.amount)));
    for (const row of inventory) {
      debit += toScaled(inventoryLineTotal(row.qty, row.unitCost));
    }
    return {
      debit: scaledToMoney(debit),
      credit: scaledToMoney(credit),
      diff: scaledToMoney(debit - credit),
    };
  }, [accounts, customers, suppliers, inventory]);

  const balanced = totals.diff === "0.00";

  const history = useMemo(() => {
    return asItems<{
      id: string;
      number: string;
      status: string;
      createdAt: string;
      sourceEvent?: string | null;
    }>(asRecord(query.data).history);
  }, [query.data]);

  const goLive =
    settings?.goLiveDate?.slice?.(0, 10) ??
    String(asRecord(query.data).goLiveDate ?? "").slice(0, 10) ??
    "—";

  const filteredAccounts = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return accounts;
    return accounts.filter(
      (a) =>
        (a.code ?? "").toLowerCase().includes(needle) ||
        (a.name ?? "").toLowerCase().includes(needle)
    );
  }, [accounts, q]);

  const blocking = isAdminQueryBlockingLoad(
    (query.isLoading || accountsQuery.isLoading) && accounts.length === 0,
    accounts.length > 0 ||
      (query.isFetched && accountsQuery.isFetched)
  );

  const liveMode: "first" | "manual" | "idle" = blocking
    ? "first"
    : manualRefresh || saveMutation.isPending
      ? "manual"
      : "idle";

  const onRefresh = () => {
    setManualRefresh(true);
    void Promise.all([query.refetch(), accountsQuery.refetch()]).then(() => {
      appliedAtRef.current = 0;
      // Force after refetch settles via effect + force path:
    });
  };

  useEffect(() => {
    if (!manualRefresh || query.isFetching || accountsQuery.isFetching) return;
    applyFromServer(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualRefresh, query.isFetching, accountsQuery.isFetching]);

  const addCustomer = () => {
    setBusyAdd("customer");
    setCustomers((rows) => [
      ...rows,
      { partyKey: "", label: "", amount: "0.00", locationId: null },
    ]);
    window.setTimeout(() => setBusyAdd(null), 180);
  };

  const addSupplier = () => {
    setBusyAdd("supplier");
    setSuppliers((rows) => [
      ...rows,
      { supplierId: "", name: "", amount: "0.00", locationId: null },
    ]);
    window.setTimeout(() => setBusyAdd(null), 180);
  };

  const save = async () => {
    if (!canManage || !confirm) return;
    try {
      await saveMutation.mutateAsync({
        accounts: accounts
          .filter((a) => isPositive(a.debit) || isPositive(a.credit))
          .map((a) => ({
            accountId: a.accountId,
            debit: a.debit,
            credit: a.credit,
            locationId: a.locationId ?? null,
          })),
        customers: customers
          .filter((c) => c.partyKey && isPositive(c.amount))
          .map((c) => ({
            partyKey: c.partyKey,
            amount: c.amount,
            locationId: c.locationId ?? null,
          })),
        suppliers: suppliers
          .filter((s) => s.supplierId && isPositive(s.amount))
          .map((s) => ({
            supplierId: s.supplierId,
            amount: s.amount,
            locationId: s.locationId ?? null,
          })),
        inventory: inventory
          .filter((row) => isPositive(row.qty))
          .map((row) => ({
            productRef: row.productRef,
            qty: row.qty,
            unitCost: row.unitCost,
          })),
      });
      setBaseline(
        serializeDraft({ accounts, customers, suppliers, inventory })
      );
      addToast("Opening balances saved", "success");
      setConfirm(false);
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    }
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
                  Opening balances
                </h1>
                <LivePulse mode={liveMode} />
                {dirty ? (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200">
                    Unsaved changes
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-stone-600">
                Enter balances as of go-live{" "}
                <span className="font-semibold text-stone-800">{goLive}</span>.
                Debits must equal credits — any difference posts to opening
                balance equity on save.
              </p>
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
            </div>
          </div>
        </header>

        <AccountingErrorMessage error={query.error ?? accountsQuery.error} />

        {blocking ? (
          <TableSkeleton />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                  Total debit
                </p>
                <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-stone-900">
                  {totals.debit}
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                  Total credit
                </p>
                <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-stone-900">
                  {totals.credit}
                </p>
              </div>
              <div
                className={`rounded-2xl border p-4 shadow-sm ${
                  balanced
                    ? "border-emerald-200/80 bg-emerald-50/50"
                    : "border-amber-200/80 bg-amber-50/50"
                }`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                  To opening equity
                </p>
                <p
                  className={`mt-1 flex items-center gap-1.5 font-mono text-lg font-semibold tabular-nums ${
                    balanced ? "text-emerald-800" : "text-amber-900"
                  }`}
                >
                  {balanced ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <AlertTriangle className="h-5 w-5" />
                  )}
                  {totals.diff}
                </p>
              </div>
            </div>

            <section className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-3 sm:px-5">
                <div className="flex items-center gap-2">
                  <Scale className="h-4 w-4 text-[#D4AF37]" />
                  <h2 className="text-sm font-semibold text-stone-900">
                    Accounts
                  </h2>
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-stone-600 ring-1 ring-stone-200">
                    {filteredAccounts.length}
                  </span>
                </div>
                <label className="relative block w-full max-w-xs text-sm sm:w-56">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search accounts…"
                    className="w-full rounded-xl border border-stone-200 bg-white py-1.5 pl-8 pr-3 text-sm outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20"
                  />
                </label>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-stone-50/80 text-left text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                      <th className="px-4 py-3 sm:px-5">Account</th>
                      <th className="px-3 py-3">Debit</th>
                      <th className="px-3 py-3">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAccounts.length === 0 ? (
                      <tr>
                        <td
                          colSpan={3}
                          className="px-4 py-8 text-center text-sm text-stone-500"
                        >
                          No postable accounts match.
                        </td>
                      </tr>
                    ) : (
                      filteredAccounts.map((row) => {
                        const idx = accounts.findIndex(
                          (a) => a.accountId === row.accountId
                        );
                        return (
                          <tr
                            key={row.accountId}
                            className="border-t border-stone-100 hover:bg-stone-50/50"
                          >
                            <td className="px-4 py-2.5 sm:px-5">
                              <span className="mr-1.5 rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] text-stone-500">
                                {row.code}
                              </span>
                              <span className="font-medium text-stone-900">
                                {row.name}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <MoneyInput
                                value={row.debit}
                                disabled={!canManage || saveMutation.isPending}
                                onChange={(v) => {
                                  if (idx < 0) return;
                                  const next = [...accounts];
                                  next[idx] = {
                                    ...row,
                                    debit: v,
                                    credit: "0.00",
                                  };
                                  setAccounts(next);
                                }}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <MoneyInput
                                value={row.credit}
                                disabled={!canManage || saveMutation.isPending}
                                onChange={(v) => {
                                  if (idx < 0) return;
                                  const next = [...accounts];
                                  next[idx] = {
                                    ...row,
                                    credit: v,
                                    debit: "0.00",
                                  };
                                  setAccounts(next);
                                }}
                              />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-3 sm:px-5">
                <h2 className="text-sm font-semibold text-stone-900">
                  Accounts receivable
                </h2>
                {canManage ? (
                  <button
                    type="button"
                    disabled={busyAdd === "customer"}
                    onClick={addCustomer}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#8a7318] shadow-sm transition hover:bg-stone-50 disabled:opacity-70"
                  >
                    {busyAdd === "customer" ? (
                      <ButtonSpinner />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    Add customer
                  </button>
                ) : null}
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-stone-50/80 text-left text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                      <th className="px-4 py-3 sm:px-5">Customer</th>
                      <th className="px-3 py-3">Amount</th>
                      <th className="px-4 py-3 text-right sm:px-5" />
                    </tr>
                  </thead>
                  <tbody>
                    {customers.length === 0 ? (
                      <tr>
                        <td
                          colSpan={3}
                          className="px-4 py-6 text-center text-sm text-stone-500"
                        >
                          No opening receivables.
                        </td>
                      </tr>
                    ) : (
                      customers.map((row, idx) => (
                        <tr
                          key={`${row.partyKey}-${idx}`}
                          className="border-t border-stone-100"
                        >
                          <td className="min-w-[220px] px-4 py-2 sm:px-5">
                            <PartyPicker
                              value={row.partyKey}
                              kinds={["customer"]}
                              disabled={!canManage || saveMutation.isPending}
                              onChange={(partyKey, option) => {
                                const next = [...customers];
                                next[idx] = {
                                  ...row,
                                  partyKey: partyKey ?? "",
                                  label: option?.label ?? partyKey ?? "",
                                };
                                setCustomers(next);
                              }}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <MoneyInput
                              value={row.amount}
                              disabled={!canManage || saveMutation.isPending}
                              onChange={(v) => {
                                const next = [...customers];
                                next[idx] = { ...row, amount: v };
                                setCustomers(next);
                              }}
                            />
                          </td>
                          <td className="px-4 py-2 text-right sm:px-5">
                            {canManage ? (
                              <button
                                type="button"
                                disabled={saveMutation.isPending}
                                onClick={() =>
                                  setCustomers((rows) =>
                                    rows.filter((_, i) => i !== idx)
                                  )
                                }
                                className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Remove
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-3 sm:px-5">
                <h2 className="text-sm font-semibold text-stone-900">
                  Accounts payable
                </h2>
                {canManage ? (
                  <button
                    type="button"
                    disabled={busyAdd === "supplier"}
                    onClick={addSupplier}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#8a7318] shadow-sm transition hover:bg-stone-50 disabled:opacity-70"
                  >
                    {busyAdd === "supplier" ? (
                      <ButtonSpinner />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    Add supplier
                  </button>
                ) : null}
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-stone-50/80 text-left text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                      <th className="px-4 py-3 sm:px-5">Supplier</th>
                      <th className="px-3 py-3">Amount</th>
                      <th className="px-4 py-3 text-right sm:px-5" />
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.length === 0 ? (
                      <tr>
                        <td
                          colSpan={3}
                          className="px-4 py-6 text-center text-sm text-stone-500"
                        >
                          No opening payables.
                        </td>
                      </tr>
                    ) : (
                      suppliers.map((row, idx) => (
                        <tr
                          key={`${row.supplierId}-${idx}`}
                          className="border-t border-stone-100"
                        >
                          <td className="px-4 py-2 sm:px-5">
                            <select
                              className="w-full cursor-pointer rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20 disabled:bg-stone-50"
                              disabled={!canManage || saveMutation.isPending}
                              value={row.supplierId}
                              onChange={(e) => {
                                const id = e.target.value;
                                const hit = supplierOptions.find(
                                  (s) => s.id === id
                                );
                                const next = [...suppliers];
                                next[idx] = {
                                  ...row,
                                  supplierId: id,
                                  name: hit?.name ?? id,
                                };
                                setSuppliers(next);
                              }}
                            >
                              <option value="">Select supplier…</option>
                              {supplierOptions.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <MoneyInput
                              value={row.amount}
                              disabled={!canManage || saveMutation.isPending}
                              onChange={(v) => {
                                const next = [...suppliers];
                                next[idx] = { ...row, amount: v };
                                setSuppliers(next);
                              }}
                            />
                          </td>
                          <td className="px-4 py-2 text-right sm:px-5">
                            {canManage ? (
                              <button
                                type="button"
                                disabled={saveMutation.isPending}
                                onClick={() =>
                                  setSuppliers((rows) =>
                                    rows.filter((_, i) => i !== idx)
                                  )
                                }
                                className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Remove
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
              <div className="border-b border-stone-100 px-4 py-3 sm:px-5">
                <h2 className="text-sm font-semibold text-stone-900">
                  Inventory
                </h2>
                <p className="mt-0.5 text-xs text-stone-500">
                  Tracked products — quantity × unit cost becomes the opening
                  inventory debit
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-stone-50/80 text-left text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                      <th className="px-4 py-3 sm:px-5">Product</th>
                      <th className="px-3 py-3">Qty</th>
                      <th className="px-3 py-3">Unit cost</th>
                      <th className="px-3 py-3">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-4 py-6 text-center text-sm text-stone-500"
                        >
                          No tracked inventory products.
                        </td>
                      </tr>
                    ) : (
                      inventory.map((row, idx) => (
                        <tr
                          key={row.key}
                          className="border-t border-stone-100"
                        >
                          <td className="px-4 py-2.5 font-medium text-stone-900 sm:px-5">
                            {row.name}
                          </td>
                          <td className="px-3 py-2">
                            <MoneyInput
                              value={row.qty}
                              disabled={!canManage || saveMutation.isPending}
                              onChange={(v) => {
                                const next = [...inventory];
                                next[idx] = { ...row, qty: v };
                                setInventory(next);
                              }}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <MoneyInput
                              value={row.unitCost}
                              disabled={!canManage || saveMutation.isPending}
                              onChange={(v) => {
                                const next = [...inventory];
                                next[idx] = { ...row, unitCost: v };
                                setInventory(next);
                              }}
                            />
                          </td>
                          <td className="px-3 py-2 font-mono text-xs tabular-nums text-stone-700">
                            {inventoryLineTotal(row.qty, row.unitCost)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {history.length > 0 ? (
              <section className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
                <div className="border-b border-stone-100 px-4 py-3 sm:px-5">
                  <h2 className="text-sm font-semibold text-stone-900">
                    Previous versions
                  </h2>
                </div>
                <ul className="divide-y divide-stone-100 text-sm">
                  {history.map((h) => (
                    <li
                      key={h.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5"
                    >
                      <span className="font-mono text-xs font-semibold text-stone-800">
                        {h.number}
                      </span>
                      <StatusChip status={h.status} />
                      <span className="text-xs text-stone-500">
                        {h.sourceEvent ?? "—"}
                      </span>
                      <span className="text-xs tabular-nums text-stone-500">
                        {new Date(h.createdAt).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}

        {canManage ? (
          <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200/80 bg-white/95 p-4 shadow-lg backdrop-blur sm:px-5">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                checked={confirm}
                disabled={saveMutation.isPending}
                onChange={(e) => setConfirm(e.target.checked)}
                className="rounded border-stone-300 text-[#D4AF37] focus:ring-[#D4AF37]"
              />
              Confirm replace of previous opening balance version
            </label>
            <button
              type="button"
              disabled={!confirm || saveMutation.isPending || !dirty}
              onClick={() => void save()}
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#c4a030] disabled:opacity-50"
            >
              {saveMutation.isPending ? <ButtonSpinner /> : null}
              {saveMutation.isPending
                ? "Saving…"
                : "Save opening balances"}
            </button>
          </div>
        ) : null}
      </div>
    </AccountingGate>
  );
}
