import type { ReactNode } from "react";
import AccountingDeskHost from "@/components/Protected/admin/pages/accounting/AccountingDeskHost";
import AccountingAppShell from "@/components/Protected/admin/pages/accounting/AccountingAppShell";

/**
 * Accounting desk: tab clicks open feature pages as an in-place modal
 * (sidebar stays visible). Base route children render underneath.
 */
export default function AdminAccountingLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <AccountingDeskHost>
      <AccountingAppShell>{children}</AccountingAppShell>
    </AccountingDeskHost>
  );
}
