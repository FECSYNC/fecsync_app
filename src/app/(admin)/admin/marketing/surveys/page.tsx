"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AdminRouteLoading from "@/components/Protected/admin/components/AdminRouteLoading";

export default function AdminMarketingSurveysRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/marketing?tab=surveys");
  }, [router]);
  return <AdminRouteLoading label="Opening Surveys…" />;
}
