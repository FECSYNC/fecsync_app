"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import PosSaleDetailPanel from "./PosSaleDetailPanel";

/** Deep-link / bookmark shell — same detail UI as the Sales station modal. */
export default function PosSaleDetailPage() {
  const params = useParams();
  const saleId = String(params?.id ?? "");

  return (
    <div>
      <div className="mx-auto max-w-2xl px-4 pt-8">
        <Link href="/admin/pos" className="text-sm text-stone-600 underline">
          ← Terminal
        </Link>
      </div>
      <PosSaleDetailPanel saleId={saleId} />
    </div>
  );
}
