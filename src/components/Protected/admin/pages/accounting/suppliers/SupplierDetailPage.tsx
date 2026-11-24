"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import {
  useAccountingInitialized,
  useAccountingSupplierQuery,
  useArchiveSupplierMutation,
  usePatchSupplierMutation,
  useSupplierStatementQuery,
} from "@/hooks/useAccounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  DateRangePicker,
  MoneyCell,
  StatusChip,
  accountingErrorMessage,
  asItems,
  asRecord,
  todayIsoDate,
} from "../shared";

type Tab = "bills" | "payments" | "pos" | "statement";

export default function SupplierDetailPage() {
  const params = useParams();
  const id = String(params.supplierId ?? "");
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.AccountingPayablesWrite);
  const { settings } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";
  const [tab, setTab] = useState<Tab>("bills");
  const [editing, setEditing] = useState(false);
  const [range, setRange] = useState({
    from: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10),
    to: todayIsoDate(),
  });
  const detailQuery = useAccountingSupplierQuery(id, Boolean(id));
  const statementQuery = useSupplierStatementQuery(
    id,
    { from: range.from, to: range.to },
    tab === "statement" && Boolean(id)
  );
  const patchMutation = usePatchSupplierMutation();
  const archiveMutation = useArchiveSupplierMutation();
  const data = asRecord(detailQuery.data);
  const supplier = asRecord(data.supplier ?? data);
  const [form, setForm] = useState<Record<string, string>>({});

  const startEdit = () => {
    setForm({
      name: String(supplier.name ?? ""),
      email: String(supplier.email ?? ""),
      phone: String(supplier.phone ?? ""),
      notes: String(supplier.notes ?? ""),
      paymentTermsDays: supplier.paymentTermsDays != null ? String(supplier.paymentTermsDays) : "",
    });
    setEditing(true);
  };

  const save = async () => {
    try {
      await patchMutation.mutateAsync({
        id,
        body: {
          name: form.name.trim(),
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          notes: form.notes.trim() || null,
          paymentTermsDays: form.paymentTermsDays ? Number(form.paymentTermsDays) : null,
        },
      });
      addToast("Supplier updated", "success");
      setEditing(false);
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    }
  };

  const bills = asItems(data.bills);
  const payments = asItems(data.payments);
  const pos = asItems(data.purchaseOrders);
  const statementRows = asItems(asRecord(statementQuery.data).lines ?? statementQuery.data);

  return (
    <AccountingGate>
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <div>
          <Link href="/admin/accounting/suppliers" className="text-sm text-[#B8860B]">
            ← Suppliers
          </Link>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                {String(supplier.name ?? "Supplier")}
              </h1>
              <p className="mt-1 text-sm text-gray-600">
                {String(supplier.code ?? "")}
                {supplier.bankAccountLast4
                  ? ` · Bank ****${String(supplier.bankAccountLast4)}`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canWrite && !supplier.archivedAt ? (
                <>
                  <button
                    type="button"
                    onClick={startEdit}
                    className="rounded-md border border-gray-200 px-3 py-2 text-sm"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={archiveMutation.isPending}
                    onClick={() => {
                      if (!window.confirm("Archive this supplier?")) return;
                      void archiveMutation.mutateAsync(id).then(
                        () => addToast("Supplier archived", "success"),
                        (err) => addToast(accountingErrorMessage(err), "error")
                      );
                    }}
                    className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700"
                  >
                    {archiveMutation.isPending ? <ButtonSpinner /> : null}
                    Archive
                  </button>
                </>
              ) : null}
              <Link
                href={`/admin/accounting/bills/new?supplierId=${id}`}
                className="rounded-md bg-[#D4AF37] px-3 py-2 text-sm font-medium text-white"
              >
                New bill
              </Link>
            </div>
          </div>
        </div>

        <AccountingErrorMessage error={detailQuery.error} />

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs uppercase text-gray-500">Balance</p>
            <p className="mt-1 text-lg font-semibold">
              <MoneyCell value={supplier.balance as string} currency={currency} />
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs uppercase text-gray-500">Email</p>
            <p className="mt-1 text-sm">{String(supplier.email ?? "—")}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs uppercase text-gray-500">Status</p>
            <div className="mt-1">
              <StatusChip status={supplier.archivedAt ? "void" : "posted"} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-gray-200">
          {(
            [
              ["bills", "Bills"],
              ["payments", "Payments"],
              ["pos", "Purchase orders"],
              ["statement", "Statement"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`border-b-2 px-3 py-2 text-sm font-medium ${
                tab === key
                  ? "border-[#D4AF37] text-gray-900"
                  : "border-transparent text-gray-500"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "bills" ? (
          <table className="min-w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-3 py-2">Number</th>
                <th className="px-3 py-2">Supplier inv.</th>
                <th className="px-3 py-2">Due</th>
                <th className="px-3 py-2 text-right">Due amount</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <tr key={String(b.id)} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/accounting/bills/${String(b.id)}`}
                      className="text-[#B8860B] hover:underline"
                    >
                      {String(b.number)}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{String(b.supplierInvoiceNumber ?? "—")}</td>
                  <td className="px-3 py-2">{String(b.dueDate ?? "").slice(0, 10)}</td>
                  <td className="px-3 py-2 text-right">
                    <MoneyCell value={b.amountDue as string} currency={currency} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusChip status={String(b.status)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {tab === "payments" ? (
          <table className="min-w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-3 py-2">Number</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={String(p.id)} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/accounting/supplier-payments/${String(p.id)}`}
                      className="text-[#B8860B] hover:underline"
                    >
                      {String(p.number)}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{String(p.paymentDate ?? "").slice(0, 10)}</td>
                  <td className="px-3 py-2 text-right">
                    <MoneyCell value={p.amount as string} currency={currency} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusChip status={String(p.status)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {tab === "pos" ? (
          <table className="min-w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-3 py-2">Number</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {pos.map((p) => (
                <tr key={String(p.id)} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/accounting/purchase-orders/${String(p.id)}`}
                      className="text-[#B8860B] hover:underline"
                    >
                      {String(p.number)}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{String(p.orderDate ?? "").slice(0, 10)}</td>
                  <td className="px-3 py-2 text-right">
                    <MoneyCell value={p.total as string} currency={currency} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusChip status={String(p.status)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {tab === "statement" ? (
          <div className="space-y-3">
            <DateRangePicker
              from={range.from}
              to={range.to}
              onChange={(next) => setRange(next)}
            />
            <AccountingErrorMessage error={statementQuery.error} />
            <table className="min-w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">Debit</th>
                  <th className="px-3 py-2 text-right">Credit</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {statementRows.map((row, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-3 py-2">
                      {String(row.date ?? row.entryDate ?? "").slice(0, 10)}
                    </td>
                    <td className="px-3 py-2">
                      {String(row.description ?? row.memo ?? "—")}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <MoneyCell value={row.debit as string} currency={currency} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <MoneyCell value={row.credit as string} currency={currency} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <MoneyCell value={row.balance as string} currency={currency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {editing ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-4 sm:items-center">
          <div className="w-full max-w-md space-y-3 rounded-lg bg-white p-4 shadow-lg">
            <h2 className="text-lg font-semibold">Edit supplier</h2>
            {(["name", "email", "phone", "paymentTermsDays", "notes"] as const).map((k) =>
              k === "notes" ? (
                <textarea
                  key={k}
                  rows={3}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  value={form[k] ?? ""}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                  placeholder={k}
                />
              ) : (
                <input
                  key={k}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  value={form[k] ?? ""}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                  placeholder={k}
                />
              )
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="px-3 py-2 text-sm" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md bg-[#D4AF37] px-4 py-2 text-sm font-medium text-white"
                onClick={() => void save()}
              >
                {patchMutation.isPending ? <ButtonSpinner /> : null}
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AccountingGate>
  );
}
