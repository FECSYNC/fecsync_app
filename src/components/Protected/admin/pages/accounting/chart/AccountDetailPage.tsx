"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { MouseEvent } from "react";
import {
  useAccountingAccountQuery,
  useAccountingInitialized,
  useAccountingLedgerQuery,
} from "@/hooks/useAccounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  MoneyCell,
  StatusChip,
} from "../shared";
import { useAccountingDesk } from "../accountingDesk";

export default function AccountDetailPage() {
  const params = useParams();
  const desk = useAccountingDesk();
  const accountId = String(params?.accountId ?? "");
  const { settings } = useAccountingInitialized(true);
  const accountQuery = useAccountingAccountQuery(accountId, Boolean(accountId));
  const ledgerQuery = useAccountingLedgerQuery(
    { accountId, from: undefined, to: undefined },
    Boolean(accountId)
  );
  const account = accountQuery.data;
  const currency = settings?.baseCurrency ?? "USD";
  const lines =
    ((ledgerQuery.data as { lines?: Record<string, unknown>[] })?.lines ??
      (ledgerQuery.data as { items?: Record<string, unknown>[] })?.items ??
      []) as {
      id?: string;
      entryDate?: string;
      entryNumber?: string;
      description?: string;
      debit?: string;
      credit?: string;
      runningBalance?: string;
    }[];

  const onBackToChart = (e: MouseEvent) => {
    if (!desk) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    desk.openPanel("chart-of-accounts");
  };

  return (
    <AccountingGate>
      <div className="space-y-5">
        <div>
          <Link
            href="/admin/accounting/chart-of-accounts"
            onClick={onBackToChart}
            className="text-sm text-[#D4AF37] hover:underline"
          >
            ← Chart of accounts
          </Link>
          {accountQuery.isLoading ? (
            <div className="mt-6 flex justify-center">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#D4AF37] border-t-transparent" />
            </div>
          ) : null}
          {accountQuery.isError ? (
            <AccountingErrorMessage error={accountQuery.error} className="mt-4" />
          ) : null}
          {account ? (
            <div className="mt-3">
              <h1 className="text-2xl font-bold text-gray-900">
                <span className="font-mono text-lg text-gray-500">{account.code}</span>{" "}
                {account.name}
              </h1>
              <div className="mt-2 flex flex-wrap gap-2 text-sm text-gray-600">
                <span className="capitalize">{account.type}</span>
                <span>·</span>
                <span>{account.subtype}</span>
                {account.systemKey ? (
                  <StatusChip status="locked" className="ml-1" />
                ) : null}
                <StatusChip
                  status={
                    account.archivedAt
                      ? "archived"
                      : account.isActive
                        ? "active"
                        : "void"
                  }
                />
              </div>
              <p className="mt-3 text-sm text-gray-600">
                Balance:{" "}
                <MoneyCell value={account.balance} currency={currency} />
              </p>
              {account.description ? (
                <p className="mt-2 text-sm text-gray-500">{account.description}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <section className="rounded-2xl border border-gray-100 bg-white">
          <h2 className="border-b border-gray-50 px-4 py-3 text-sm font-semibold">
            Recent ledger activity
          </h2>
          {ledgerQuery.isError ? (
            <div className="p-4">
              <AccountingErrorMessage error={ledgerQuery.error} />
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Entry</th>
                  <th className="px-4 py-2">Description</th>
                  <th className="px-4 py-2 text-right">Debit</th>
                  <th className="px-4 py-2 text-right">Credit</th>
                  <th className="px-4 py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                      No lines in range.
                    </td>
                  </tr>
                ) : (
                  lines.map((l, i) => (
                    <tr key={l.id ?? i} className="border-t border-gray-50">
                      <td className="px-4 py-2">
                        {l.entryDate ? String(l.entryDate).slice(0, 10) : "—"}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {l.entryNumber ?? "—"}
                      </td>
                      <td className="px-4 py-2">{l.description ?? "—"}</td>
                      <td className="px-4 py-2 text-right">
                        <MoneyCell value={l.debit} currency={currency} />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <MoneyCell value={l.credit} currency={currency} />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <MoneyCell value={l.runningBalance} currency={currency} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AccountingGate>
  );
}
