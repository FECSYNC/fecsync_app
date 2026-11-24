"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import {
  useAccountingCustomerQuery,
  useAccountingCustomerStatementQuery,
  useAccountingInitialized,
  useCreateCustomerStatementLinkMutation,
  useWriteOffInvoiceMutation,
} from "@/hooks/useAccounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  ConfirmReasonModal,
  MoneyCell,
  StatusChip,
  accountingErrorMessage,
} from "../shared";

const TABS = ["invoices", "bookings", "payments", "credits", "statement"] as const;

export default function CustomerDetailPage() {
  const params = useParams();
  const partyKey = decodeURIComponent(String(params?.partyKey ?? ""));
  const router = useRouter();
  const sp = useSearchParams();
  const tab = (sp.get("tab") as (typeof TABS)[number]) || "invoices";
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.AccountingReceivablesWrite);
  const { settings } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";

  const customer = useAccountingCustomerQuery(partyKey, Boolean(partyKey));
  const [stmtFrom, setStmtFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  });
  const [stmtTo, setStmtTo] = useState(() => new Date().toISOString().slice(0, 10));
  const statement = useAccountingCustomerStatementQuery(
    partyKey,
    { from: stmtFrom, to: stmtTo },
    tab === "statement" && Boolean(partyKey)
  );
  const linkM = useCreateCustomerStatementLinkMutation();
  const writeOffM = useWriteOffInvoiceMutation();
  const [writeOffInvoiceId, setWriteOffInvoiceId] = useState<string | null>(null);

  const data = customer.data as {
    name?: string;
    email?: string | null;
    phone?: string | null;
    balance?: string;
    overdue?: string;
    buckets?: Record<string, string>;
    invoices?: Array<Record<string, unknown>>;
    bookings?: Array<Record<string, unknown>>;
    payments?: Array<Record<string, unknown>>;
    credits?: Array<Record<string, unknown>>;
  };

  const agingTotal = useMemo(() => {
    const b = data?.buckets ?? {};
    return ["current", "d1_30", "d31_60", "d61_90", "d90_plus"].map((k) => ({
      key: k,
      label: k === "current" ? "Current" : k.replace("d", "").replace("_", "–"),
      value: Number(b[k] ?? 0),
    }));
  }, [data?.buckets]);
  const agingSum = agingTotal.reduce((s, x) => s + Math.max(x.value, 0), 0) || 1;

  const setTab = (t: string) => {
    const next = new URLSearchParams(sp.toString());
    next.set("tab", t);
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  const copyStatementLink = async () => {
    try {
      const res = (await linkM.mutateAsync({
        partyKey,
        body: { from: stmtFrom, to: stmtTo },
      })) as { path?: string; token?: string };
      const path = res.path || (res.token ? `/statement/${res.token}` : "");
      const url = `${window.location.origin}${path}`;
      await navigator.clipboard.writeText(url);
      addToast("Statement link copied", "success");
    } catch (e) {
      addToast(accountingErrorMessage(e), "error");
    }
  };

  return (
    <AccountingGate>
      <div className="space-y-5">
        {customer.isLoading ? (
          <div className="flex min-h-[30vh] items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#D4AF37] border-t-transparent" />
          </div>
        ) : null}
        {customer.isError ? (
          <AccountingErrorMessage error={customer.error} />
        ) : null}

        {data?.name ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link
                  href="/admin/accounting/customers"
                  className="text-sm text-[#D4AF37] hover:underline"
                >
                  ← Customers
                </Link>
                <h1 className="mt-2 text-2xl font-bold text-gray-900">{data.name}</h1>
                <p className="mt-1 text-sm text-gray-600">
                  {[data.email, data.phone].filter(Boolean).join(" · ") || partyKey}
                </p>
              </div>
              {canWrite ? (
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/admin/accounting/invoices/new?partyKey=${encodeURIComponent(partyKey)}`}
                    className="rounded-xl bg-[#D4AF37] px-3 py-2 text-sm font-semibold text-white"
                  >
                    New invoice
                  </Link>
                  <Link
                    href={`/admin/accounting/receipts/new?partyKey=${encodeURIComponent(partyKey)}`}
                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium"
                  >
                    Record receipt
                  </Link>
                  <button
                    type="button"
                    disabled={linkM.isPending}
                    onClick={() => void copyStatementLink()}
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium"
                  >
                    {linkM.isPending ? <ButtonSpinner /> : null}
                    Copy statement link
                  </button>
                </div>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-gray-100 bg-white px-4 py-4">
                <p className="text-xs uppercase text-gray-500">Balance</p>
                <p className="mt-1 text-xl font-semibold">
                  <MoneyCell value={data.balance} currency={currency} align="left" />
                </p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-white px-4 py-4">
                <p className="text-xs uppercase text-gray-500">Overdue</p>
                <p className="mt-1 text-xl font-semibold text-red-700">
                  <MoneyCell value={data.overdue} currency={currency} align="left" />
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white p-4">
              <p className="mb-2 text-sm font-semibold">Aging</p>
              <div className="flex h-3 overflow-hidden rounded-full bg-gray-100">
                {agingTotal.map((b, i) => (
                  <div
                    key={b.key}
                    style={{ width: `${(Math.max(b.value, 0) / agingSum) * 100}%` }}
                    className={
                      ["bg-emerald-400", "bg-sky-400", "bg-amber-400", "bg-orange-400", "bg-red-500"][
                        i
                      ]
                    }
                    title={`${b.label}: ${b.value}`}
                  />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-600">
                {agingTotal.map((b) => (
                  <span key={b.key}>
                    {b.label}:{" "}
                    <MoneyCell value={b.value} currency={currency} />
                  </span>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium capitalize ${
                    tab === t
                      ? "bg-[#D4AF37] text-white"
                      : "border border-gray-200 text-gray-700"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {tab === "invoices" ? (
              <Table
                empty="No invoices"
                rows={(data.invoices ?? []).map((inv) => ({
                  key: String(inv.id),
                  cells: [
                    <Link
                      key="n"
                      href={
                        inv.kind === "booking"
                          ? `/admin/booking-invoices/${inv.id}`
                          : `/admin/accounting/invoices/${inv.id}`
                      }
                      className="text-[#D4AF37] hover:underline"
                    >
                      {String(inv.number)}
                    </Link>,
                    <StatusChip key="s" status={String(inv.status)} />,
                    <MoneyCell key="a" value={String(inv.amountDue ?? inv.amount)} currency={currency} />,
                    canWrite &&
                    Number(inv.amountDue ?? 0) > 0 &&
                    inv.kind !== "booking" ? (
                      <button
                        key="w"
                        type="button"
                        className="text-xs text-red-700"
                        onClick={() => setWriteOffInvoiceId(String(inv.id))}
                      >
                        Write off
                      </button>
                    ) : (
                      "—"
                    ),
                  ],
                }))}
                headers={["Invoice", "Status", "Due", ""]}
              />
            ) : null}

            {tab === "bookings" ? (
              <Table
                empty="No bookings"
                headers={["Booking", "Status", "Total", "Due"]}
                rows={(data.bookings ?? []).map((b) => ({
                  key: String(b.id),
                  cells: [
                    <Link
                      key="b"
                      href={`/admin/bookings/${b.id}`}
                      className="text-[#D4AF37] hover:underline"
                    >
                      {String(b.publicId ?? b.id)}
                    </Link>,
                    String(b.status),
                    <MoneyCell key="t" value={String(b.total)} currency={currency} />,
                    <MoneyCell key="d" value={String(b.amountDue)} currency={currency} />,
                  ],
                }))}
              />
            ) : null}

            {tab === "payments" ? (
              <Table
                empty="No payments"
                headers={["Date", "Reference", "Method", "Amount"]}
                rows={(data.payments ?? []).map((p) => ({
                  key: String(p.id),
                  cells: [
                    String(p.date).slice(0, 10),
                    String(p.reference ?? "—"),
                    String(p.method ?? "—"),
                    <MoneyCell key="a" value={String(p.amount)} currency={currency} />,
                  ],
                }))}
              />
            ) : null}

            {tab === "credits" ? (
              <Table
                empty="No unapplied credits"
                headers={["Receipt", "Unapplied"]}
                rows={(data.credits ?? []).map((c) => ({
                  key: String(c.id),
                  cells: [
                    String(c.number),
                    <MoneyCell key="u" value={String(c.unapplied)} currency={currency} />,
                  ],
                }))}
              />
            ) : null}

            {tab === "statement" ? (
              <div className="space-y-4 rounded-2xl border border-gray-100 bg-white p-4">
                <div className="flex flex-wrap gap-3">
                  <label className="text-sm">
                    From
                    <input
                      type="date"
                      value={stmtFrom}
                      onChange={(e) => setStmtFrom(e.target.value)}
                      className="ml-2 rounded-xl border border-gray-200 px-3 py-2"
                    />
                  </label>
                  <label className="text-sm">
                    To
                    <input
                      type="date"
                      value={stmtTo}
                      onChange={(e) => setStmtTo(e.target.value)}
                      className="ml-2 rounded-xl border border-gray-200 px-3 py-2"
                    />
                  </label>
                  {canWrite ? (
                    <button
                      type="button"
                      onClick={() => void copyStatementLink()}
                      className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
                    >
                      Send / copy link
                    </button>
                  ) : null}
                </div>
                {statement.isError ? (
                  <AccountingErrorMessage error={statement.error} />
                ) : null}
                <pre className="overflow-auto rounded-xl bg-gray-50 p-3 text-xs text-gray-700">
                  {JSON.stringify(statement.data ?? {}, null, 2)}
                </pre>
              </div>
            ) : null}
          </>
        ) : null}

        <ConfirmReasonModal
          open={Boolean(writeOffInvoiceId)}
          title="Write off invoice"
          message="Requests approval when required, then writes off the remaining balance."
          requireReason
          confirmLabel="Write off"
          busy={writeOffM.isPending}
          onClose={() => setWriteOffInvoiceId(null)}
          onConfirm={async (reason) => {
            if (!writeOffInvoiceId) return;
            const inv = (data.invoices ?? []).find(
              (i) => String(i.id) === writeOffInvoiceId
            );
            try {
              await writeOffM.mutateAsync({
                id: writeOffInvoiceId,
                amount: String(inv?.amountDue ?? "0"),
                reason,
              });
              addToast("Write-off submitted", "success");
              setWriteOffInvoiceId(null);
              void customer.refetch();
            } catch (e) {
              addToast(accountingErrorMessage(e), "error");
            }
          }}
        />
      </div>
    </AccountingGate>
  );
}

function Table({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: Array<{ key: string; cells: ReactNode[] }>;
  empty: string;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            {headers.map((h) => (
              <th key={h || "x"} className="px-4 py-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} className="px-4 py-8 text-center text-gray-500">
                {empty}
              </td>
            </tr>
          ) : null}
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-gray-50">
              {r.cells.map((c, i) => (
                <td key={i} className="px-4 py-3">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
