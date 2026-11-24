"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AdminRouteLoading from "@/components/Protected/admin/components/AdminRouteLoading";

/** Legacy leaf → desk modal via query (no second Turbopack route). */
export default function AdminMarketingNewsletterRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/marketing?tab=newsletter");
  }, [router]);
  return <AdminRouteLoading label="Opening Newsletter…" />;
}
