"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AdminRouteLoading from "@/components/Protected/admin/components/AdminRouteLoading";

export default function AdminMarketingAutomationsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/marketing?tab=automations");
  }, [router]);
  return <AdminRouteLoading label="Opening Automations…" />;
}
