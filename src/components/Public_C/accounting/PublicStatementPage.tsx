'use client';

import { usePublicAccountingStatementQuery } from '@/hooks/usePublicAccounting';
import { ApiError } from '@/utils/api';
import { ACCT } from '@/lib/accounting/acctCodes';
import { billingBtnGhost, billingCard, formatBillingMoney } from '@/components/Protected/profile/billing/billingUi';

type Stmt = {
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
  company?: { name?: string; logoUrl?: string | null };
  customer?: { name?: string };
  footer?: string | null;
};

export default function PublicStatementPage({ token }: { token: string }) {
  const q = usePublicAccountingStatementQuery(token);
  const data = q.data as { statement?: Stmt; kind?: string } | Stmt | undefined;
  const statement = (data as { statement?: Stmt })?.statement ?? (data as Stmt | undefined);

  const expired =
    q.isError &&
    q.error instanceof ApiError &&
    (q.error.status === 410 || q.error.message === ACCT.TOKEN_EXPIRED);
  const invalid = q.isError && !expired;

  if (q.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center bg-stone-50 px-4">
        <p className="text-sm text-stone-500">Loading statement…</p>
      </div>
    );
  }

  if (expired) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-stone-900">Statement expired</h1>
        <p className="mt-2 text-sm text-stone-600">This statement link has expired. Ask the venue for a new one.</p>
        <p className="mt-4">
          <a href="/home" className="text-sm font-medium text-[#D4AF37] hover:underline">
            Return to store
          </a>
        </p>
      </div>
    );
  }

  if (invalid || !statement) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-stone-900">Statement not found</h1>
        <p className="mt-2 text-sm text-stone-600">This link is invalid.</p>
      </div>
    );
  }

  const aging = statement.aging ?? {};

  return (
    <div className="min-h-screen bg-stone-50 px-4 py-10 print:bg-white">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="text-center sm:text-left">
          <h1 className="text-2xl font-semibold text-stone-900">{statement.company?.name ?? 'Account statement'}</h1>
          <p className="text-sm text-stone-600">{statement.customer?.name}</p>
          <p className="text-sm text-stone-500">
            {statement.from ? new Date(statement.from).toLocaleDateString() : ''} –{' '}
            {statement.to ? new Date(statement.to).toLocaleDateString() : ''}
          </p>
        </header>

        <div className={billingCard}>
          <div className="grid gap-2 sm:grid-cols-2">
            <p>
              Opening <strong>{formatBillingMoney(statement.openingBalance, statement.currency)}</strong>
            </p>
            <p>
              Closing <strong>{formatBillingMoney(statement.closingBalance, statement.currency)}</strong>
            </p>
          </div>
          {Object.keys(aging).length ? (
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-stone-600">
              {Object.entries(aging).map(([k, v]) => (
                <span key={k}>
                  {k}: {formatBillingMoney(v, statement.currency)}
                </span>
              ))}
            </div>
          ) : null}
          <div className="mt-4 overflow-x-auto">
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
                    <td className="py-2 pr-3 whitespace-nowrap">{new Date(row.date).toLocaleDateString()}</td>
                    <td className="py-2 pr-3 max-w-xs truncate">{row.description ?? row.reference ?? '—'}</td>
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
          {statement.footer ? <p className="mt-4 text-xs text-stone-500">{statement.footer}</p> : null}
        </div>

        <div className="print:hidden">
          <button type="button" className={billingBtnGhost} onClick={() => window.print()}>
            Print / PDF
          </button>
        </div>
      </div>
    </div>
  );
}
