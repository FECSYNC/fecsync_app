"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AdminRouteLoading from "@/components/Protected/admin/components/AdminRouteLoading";

/** Leaf URL → desk modal via query (no second Turbopack route). */
export default function AdminMarketingCampaignsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/marketing?tab=campaigns");
  }, [router]);
  return <AdminRouteLoading label="Opening Campaigns…" />;
}
