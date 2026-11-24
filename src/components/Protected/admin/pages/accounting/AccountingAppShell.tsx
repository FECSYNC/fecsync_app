"use client";

import { useMemo, type ReactNode, type MouseEvent } from "react";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import {
  isAdminPageAllowed,
  isStorefrontOrgSession,
} from "@/hooks/useAdminPermission";
import {
  ACCOUNTING_APP_TABS,
  matchAccountingAppTab,
} from "@/lib/adminNav";
import { useAccountingInitialized } from "@/hooks/useAccounting";
import { planAllowsModule } from "@/lib/subscriptionPlans";
import {
  useAccountingDesk,
  useInAccountingDesk,
  accountingHrefFromPanel,
  accountingPanelFromHref,
} from "./accountingDesk";
import AccountingTabRail, {
  type AccountingTabRailItem,
} from "./AccountingTabRail";

function isModifiedClick(e: MouseEvent) {
  return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}

export default function AccountingAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const { can, user } = useAuthStore();
  const storefront = isStorefrontOrgSession(user);
  const planOk = planAllowsModule(user?.subscriptionPlan, "accounting");
  const { initialized } = useAccountingInitialized(
    !storefront && planOk && (can(P.AccountingRead) || can(P.AccountingManage))
  );
  const desk = useAccountingDesk();
  const inDesk = useInAccountingDesk();

  const routeActive = matchAccountingAppTab(pathname) ?? "/admin/accounting";
  // Open modal wins; after Close/Esc keep highlighting the tab that was open
  // (not Dashboard unless that was the closed tab).
  const highlightPanel = desk?.panel ?? desk?.retainedPanel ?? null;
  const activeHref = highlightPanel
    ? accountingHrefFromPanel(highlightPanel)
    : routeActive;

  const tabs = useMemo(() => {
    const allowed = ACCOUNTING_APP_TABS.filter((tab) => {
      if (tab.href === "/admin/accounting") return true;
      if (initialized === true && tab.href === "/admin/accounting/setup") {
        return false;
      }
      return isAdminPageAllowed(tab.href, can, user).allowed;
    });
    const dash = allowed.filter((t) => t.href === "/admin/accounting");
    const rest = allowed.filter((t) => t.href !== "/admin/accounting");
    return [...dash, ...rest];
  }, [can, user, initialized]);

  const items: AccountingTabRailItem[] = useMemo(
    () =>
      tabs.map((tab) => {
        const panel = accountingPanelFromHref(tab.href);
        return {
          key: tab.href,
          label: tab.name,
          active: activeHref === tab.href,
          href: tab.href,
          onWarm: () => {
            if (panel && desk) desk.warmPanel(panel);
          },
          onSelect: (e) => {
            if (!desk) {
              if (typeof window !== "undefined") {
                window.location.assign(tab.href);
              }
              return;
            }
            if (e && isModifiedClick(e)) {
              if (typeof window !== "undefined") {
                window.open(tab.href, "_blank");
              }
              return;
            }
            if (panel) {
              desk.openPanel(panel);
              return;
            }
            if (typeof window !== "undefined") {
              window.location.assign(tab.href);
            }
          },
        };
      }),
    [tabs, activeHref, desk]
  );

  // Inside the modal the header already has tabs — don't duplicate.
  if (inDesk) return <>{children}</>;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-stone-200/80 bg-white px-2 py-2 shadow-sm sm:px-3">
        <AccountingTabRail
          items={items}
          activeKey={activeHref}
          freezeScroll={Boolean(desk?.panel)}
          ariaLabel="Accounting features"
        />
      </div>
      <div className={desk?.panel ? "hidden" : undefined}>{children}</div>
    </div>
  );
}
