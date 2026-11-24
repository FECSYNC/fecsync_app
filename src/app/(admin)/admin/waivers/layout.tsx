import type { ReactNode } from "react";
import WaiversWorkspaceGate from "@/components/Protected/admin/pages/waivers/WaiversWorkspaceGate";

export default function AdminWaiversLayout({ children }: { children: ReactNode }) {
  return <WaiversWorkspaceGate>{children}</WaiversWorkspaceGate>;
}
