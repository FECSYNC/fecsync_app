"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listPosSales, type PosSaleDto } from "@/services/pos";
import { settlePosCardFromStripeReturn } from "./posCardReturn";

export default function PosSalesPage() {
  const [sales, setSales] = useState<PosSaleDto[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState("");

  function reload() {
    setLoading(true);
    listPosSales()
      .then((payload) => setSales(payload.sales ?? []))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const paid = new URLSearchParams(window.location.search).get("paid");
    if (paid === "1") {
      setBanner("Payment link return — refreshing sales. Webhook completes unpaid card/link tenders.");
      reload();
    } else if (paid === "0") {
      setBanner("Payment link cancelled — sale stays unpaid until paid.");
    }
    void settlePosCardFromStripeReturn().then((message) => {
      if (!message) return;
      setBanner(message);
      reload();
    });
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#D4AF37]">Sell</p>
      <h1 className="mt-2 text-2xl font-semibold text-stone-900">POS sales</h1>
      <Link href="/admin/pos" className="mt-2 inline-block text-sm text-stone-600 underline">
        Back to terminal
      </Link>
      {banner ? <p className="mt-3 text-sm text-amber-900">{banner}</p> : null}
      {loading ? <p className="mt-4 text-sm text-stone-600">Loading…</p> : null}
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      {!loading && sales.length === 0 ? (
        <p className="mt-4 text-sm text-stone-600">No sales yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
          {sales.map((sale) => {
            const awaitingCard =
              sale.status !== "voided" &&
              sale.status !== "refunded" &&
              (sale.payments ?? []).some(
                (p) =>
                  (p.status === "pending" || p.status === "authorized") &&
                  (p.tender === "card" || p.tender === "stored_card") &&
                  Boolean(p.stripePaymentIntentId?.startsWith("pi_"))
              );
            return (
              <li key={sale.id}>
                <Link
                  href={`/admin/pos/sales/${sale.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-stone-50"
                >
                  <span className="font-medium text-stone-900">{sale.publicId}</span>
                  <span className="text-right text-stone-600">
                    {awaitingCard ? (
                      <span className="mr-2 text-amber-800">Awaiting card</span>
                    ) : null}
                    {sale.status} · ${sale.total.toFixed(2)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
