"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { listPosSales, type PosSaleDto } from "@/services/pos";
import { settlePosCardFromStripeReturn } from "./posCardReturn";
import PosSaleDetailPanel from "./PosSaleDetailPanel";
import { onPosEvent } from "./posEvents";
import PosToolShell from "./PosToolShell";
import { saleStatusTone } from "./posUi";

type Props = {
  parkName?: string;
  onChanged?: () => void;
};

export default function PosSalesPanel({ parkName, onChanged }: Props) {
  const [sales, setSales] = useState<PosSaleDto[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const reload = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    listPosSales()
      .then((payload) => {
        setSales(payload.sales ?? []);
        setError("");
        onChangedRef.current?.();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    void settlePosCardFromStripeReturn().then((message) => {
      if (!message) return;
      setBanner(message);
      reload(true);
    });
  }, [reload]);

  useEffect(() => {
    const onFocus = () => {
      if (!detailId) reload(true);
    };
    window.addEventListener("focus", onFocus);
    const unsub = onPosEvent(["pos:sale", "pos:tab", "pos:catalog"], () => {
      if (!detailId) reload(true);
    });
    return () => {
      window.removeEventListener("focus", onFocus);
      unsub();
    };
  }, [reload, detailId]);

  if (detailId) {
    return (
      <PosSaleDetailPanel
        saleId={detailId}
        compact
        onBack={() => {
          setDetailId(null);
          reload();
        }}
        onChanged={() => {
          onChangedRef.current?.();
          listPosSales()
            .then((payload) => setSales(payload.sales ?? []))
            .catch(() => undefined);
        }}
      />
    );
  }

  return (
    <PosToolShell
      title="Sales"
      parkName={parkName}
      onRefresh={() => reload()}
      refreshing={loading}
    >
      <div className="space-y-3 text-sm">
        <AnimatePresence mode="wait">
          {banner ? (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950"
            >
              {banner}
            </motion.p>
          ) : null}
          {error ? (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-red-800"
            >
              {error}
            </motion.p>
          ) : null}
        </AnimatePresence>

        {loading && !sales.length ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-stone-100" />
            ))}
          </div>
        ) : !sales.length ? (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-gradient-to-br from-stone-50 to-white px-4 py-10 text-center">
            <p className="font-serif text-lg text-stone-900">No sales yet</p>
            <p className="mt-1 text-xs text-stone-500">
              Complete a checkout on Terminal — history appears here instantly.
            </p>
          </div>
        ) : (
          <ul className="max-h-[min(60vh,420px)] divide-y divide-stone-100 overflow-y-auto overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm">
            {sales.map((sale, i) => {
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
                <motion.li
                  key={sale.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.02, 0.2) }}
                >
                  <button
                    type="button"
                    onClick={() => setDetailId(sale.id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition hover:bg-[#D4AF37]/5"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold tabular-nums text-stone-900">
                        {sale.publicId}
                      </span>
                      {awaitingCard ? (
                        <span className="mt-0.5 block text-[11px] font-medium text-amber-800">
                          Awaiting card confirm
                        </span>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${saleStatusTone(
                          sale.status
                        )}`}
                      >
                        {sale.status}
                      </span>
                      <span className="tabular-nums text-sm font-medium text-stone-800">
                        ${Number(sale.total).toFixed(2)}
                      </span>
                    </span>
                  </button>
                </motion.li>
              );
            })}
          </ul>
        )}
      </div>
    </PosToolShell>
  );
}
