'use client';

import AdminPendingLink from '@/components/Protected/admin/components/AdminPendingLink';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { useAccountingDashboardQuery, useAccountingInitialized } from '@/hooks/useAccounting';
import { formatPrice } from '@/utils/currency';

export default function AccountingFinanceSummaryCard() {
  const can = useAuthStore((s) => s.can);
  const canRead = can(P.AccountingRead);
  const { initialized, isLoading: initLoading } = useAccountingInitialized(canRead);
  const dash = useAccountingDashboardQuery({}, canRead && initialized);
  const kpis = (dash.data as { kpis?: Record<string, string> } | undefined)?.kpis;

  if (!canRead) return null;
  if (!initLoading && !initialized) return null;

  const value =
    dash.isError || !kpis
      ? dash.isError
        ? 'Unavailable'
        : dash.isLoading
          ? '…'
          : '—'
      : formatPrice(Number(kpis.netProfit ?? 0));

  const sub =
    dash.isError || !kpis
      ? 'Open Accounting for revenue, cash, AR, and posting exceptions.'
      : `Net profit (MTD) · Revenue ${formatPrice(Number(kpis.revenue ?? 0))} · Cash ${formatPrice(Number(kpis.cashAndBank ?? 0))}`;

  return (
    <AdminPendingLink
      href="/admin/accounting"
      className="rounded-lg border border-gray-200 bg-white p-6 transition-colors hover:border-[#D4AF37]/40"
    >
      <p className="text-sm font-medium text-gray-600">Accounting</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-sm text-gray-500">{sub}</p>
    </AdminPendingLink>
  );
}
