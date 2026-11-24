"use client";

import { Suspense } from "react";
import MarketingOverviewPage from "@/components/Protected/admin/pages/marketing/MarketingOverviewPage";
import AdminRouteLoading from "@/components/Protected/admin/components/AdminRouteLoading";

export default function AdminMarketingPage() {
  return (
    <Suspense fallback={<AdminRouteLoading label="Opening Marketing…" />}>
      <MarketingOverviewPage />
    </Suspense>
  );
}
