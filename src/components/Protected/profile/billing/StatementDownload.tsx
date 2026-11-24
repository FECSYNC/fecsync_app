'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/contexts/toast-context';
import {
  useMeAccountingStatementQuery,
  useMeAccountingSummaryQuery,
} from '@/hooks/useMeAccounting';
import { billingBtn, billingBtnGhost, billingCard, billingField, formatBillingMoney } from './billingUi';

type StatementPayload = {
  currency?: string;
  from?: string;
  to?: string;
  openingBalance?: string;
  closingBalance?: string;
  aging?: Record<string, string>;
  items?: Array<{
    date: string;
    description?: string | null;
    reference?: string | null;
    charges: string;
    credits: string;
    balance: string;
  }>;
  company?: { name?: string };
  customer?: { name?: string };
  footer?: string | null;
};

function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 90 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default function StatementDownload({
  orgId: orgIdProp,
  compact,
}: {
  orgId?: string;
  compact?: boolean;
}) {
  const { addToast } = useToast();
  const summaryQ = useMeAccountingSummaryQuery();
  const orgs =
    (summaryQ.data as { orgs?: Array<{ orgId: string; currency: string }> } | undefined)?.orgs ?? [];
  const [range, setRange] = useState(defaultRange);
  const [pickedOrgId, setPickedOrgId] = useState('');
  const activeOrgId = orgIdProp ?? (pickedOrgId || orgs[0]?.orgId || '');
  const [load, setLoad] = useState(Boolean(orgIdProp));

  useEffect(() => {
    if (orgIdProp) setLoad(true);
  }, [orgIdProp]);

  const stmtQ = useMeAccountingStatementQuery(
    { from: range.from, to: range.to, orgId: activeOrgId },
    load && Boolean(activeOrgId)
  );

  const statement = useMemo(() => stmtQ.data as StatementPayload | undefined, [stmtQ.data]);

  function onGenerate(e: FormEvent) {
    e.preventDefault();
    if (!activeOrgId) {
      addToast('Select a venue for your statement', 'error');
      return;
    }
    setLoad(true);
  }

  function onPrint() {
    if (!statement) {
      addToast('Generate a statement first', 'info');
      return;
    }
    window.print();
  }

  const aging = statement?.aging ?? {};
  const wrapperClass = compact ? 'space-y-3' : `${billingCard} space-y-4 print:border-0`;

  return (
    <div className={wrapperClass}>
      {!compact ? <h2 className="text-base font-semibold text-stone-900">Account statement</h2> : null}
      <form onSubmit={onGenerate} className="flex flex-wrap items-end gap-3 print:hidden">
        {!orgIdProp && orgs.length > 1 ? (
          <label className="flex flex-col gap-1 text-xs text-stone-600">
            Venue
            <select
              className={billingField}
              value={activeOrgId}
              onChange={(e) => setPickedOrgId(e.target.value)}
            >
              {orgs.map((o) => (
                <option key={o.orgId} value={o.orgId}>
                  Venue · {o.orgId.slice(0, 8)}…
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-xs text-stone-600">
          From
          <input
            type="date"
            className={billingField}
            value={range.from}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-stone-600">
          To
          <input
            type="date"
            className={billingField}
            value={range.to}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
          />
        </label>
        <button type="submit" className={billingBtn} disabled={stmtQ.isFetching}>
          {stmtQ.isFetching ? 'Loading…' : compact ? 'Download statement' : 'Generate statement'}
        </button>
        {statement ? (
          <button type="button" className={billingBtnGhost} onClick={onPrint}>
            Print / PDF
          </button>
        ) : null}
      </form>

      {stmtQ.isError ? (
        <p className="text-sm text-red-700 print:hidden">Could not load statement for this period.</p>
      ) : null}

      {statement ? (
        <div className="statement-print space-y-3 text-sm">
          <div className="hidden print:block">
            <h1 className="text-xl font-semibold">{statement.company?.name ?? 'Statement'}</h1>
            <p>{statement.customer?.name}</p>
            <p className="text-stone-600">
              {statement.from ? new Date(statement.from).toLocaleDateString() : ''} –{' '}
              {statement.to ? new Date(statement.to).toLocaleDateString() : ''}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <p>
              Opening:{' '}
              <strong>{formatBillingMoney(statement.openingBalance, statement.currency)}</strong>
            </p>
            <p>
              Closing:{' '}
              <strong>{formatBillingMoney(statement.closingBalance, statement.currency)}</strong>
            </p>
          </div>
          {Object.keys(aging).length ? (
            <div className="flex flex-wrap gap-3 text-xs text-stone-600">
              {Object.entries(aging).map(([k, v]) => (
                <span key={k}>
                  {k}: {formatBillingMoney(v, statement.currency)}
                </span>
              ))}
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Description</th>
                  <th className="py-2 pr-3 text-right">Charges</th>
                  <th className="py-2 pr-3 text-right">Credits</th>
                  <th className="py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {(statement.items ?? []).map((row, i) => (
                  <tr key={i} className="border-b border-stone-100">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {new Date(row.date).toLocaleDateString()}
                    </td>
                    <td className="py-2 pr-3 max-w-xs truncate">
                      {row.description ?? row.reference ?? '—'}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {Number(row.charges) > 0 ? formatBillingMoney(row.charges, statement.currency) : '—'}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {Number(row.credits) > 0 ? formatBillingMoney(row.credits, statement.currency) : '—'}
                    </td>
                    <td className="py-2 text-right">{formatBillingMoney(row.balance, statement.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {statement.footer ? <p className="text-xs text-stone-500">{statement.footer}</p> : null}
        </div>
      ) : load && stmtQ.isLoading ? (
        <p className="text-sm text-stone-500">Preparing statement…</p>
      ) : null}
    </div>
  );
}
