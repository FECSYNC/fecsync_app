import { Suspense } from "react";
import WaiverResponsesPage from "@/components/Protected/admin/pages/waivers/WaiverResponsesPage";

export default function Page() {
  return (
    <Suspense fallback={<p className="px-4 py-6 text-sm text-stone-500">Loading responses…</p>}>
      <WaiverResponsesPage />
    </Suspense>
  );
}
