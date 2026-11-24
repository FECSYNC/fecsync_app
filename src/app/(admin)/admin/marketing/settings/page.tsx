"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AdminRouteLoading from "@/components/Protected/admin/components/AdminRouteLoading";

export default function AdminMarketingSettingsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/marketing?tab=settings");
  }, [router]);
  return <AdminRouteLoading label="Opening Settings…" />;
}
