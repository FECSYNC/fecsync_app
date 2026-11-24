import { Suspense } from "react";
import WaiverSignagePage from "@/components/Protected/admin/pages/waivers/WaiverSignagePage";

export default function AdminWaiverSignageRoute() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-stone-500">Loading signage…</p>}>
      <WaiverSignagePage />
    </Suspense>
  );
}
