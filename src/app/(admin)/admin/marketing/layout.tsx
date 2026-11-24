import type { ReactNode } from "react";
import MarketingWorkspaceGate from "@/components/Protected/admin/pages/marketing/MarketingWorkspaceGate";

export default function AdminMarketingLayout({ children }: { children: ReactNode }) {
  return <MarketingWorkspaceGate>{children}</MarketingWorkspaceGate>;
}
