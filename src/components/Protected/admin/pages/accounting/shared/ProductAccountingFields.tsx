"use client";

import { useState } from "react";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import {
  useAccountingInitialized,
  usePatchInventoryCostsMutation,
} from "@/hooks/useAccounting";
import { updatePosProduct } from "@/services/pos";
import { useToast } from "@/contexts/toast-context";

type Props = {
  mode: "shop" | "pos";
  productId: string;
  locationId?: string | null;
  avgCost?: string | number | null;
  lastCost?: string | number | null;
  inventoryAccountId?: string | null;
  cogsAccountId?: string | null;
  revenueAccountId?: string | null;
  onSaved?: () => void;
};

export default function ProductAccountingFields({
  mode,
  productId,
  locationId,
  avgCost,
  lastCost,
  inventoryAccountId,
  cogsAccountId,
  revenueAccountId,
  onSaved,
}: Props) {
  const can = useAuthStore((s) => s.can);
  const canInventory = can(P.AccountingInventoryWrite);
  const { initialized } = useAccountingInitialized(can(P.AccountingRead));
  const { addToast } = useToast();
  const patchCosts = usePatchInventoryCostsMutation();
  const [last, setLast] = useState(String(lastCost ?? ""));
  const [invAcct, setInvAcct] = useState(inventoryAccountId ?? "");
  const [cogsAcct, setCogsAcct] = useState(cogsAccountId ?? "");
  const [revAcct, setRevAcct] = useState(revenueAccountId ?? "");
  const [busy, setBusy] = useState(false);

  if (!initialized) return null;

  const productRef =
    mode === "pos"
      ? { posProductId: productId }
      : { shopProductId: productId };

  return (
    <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50/60 p-3 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
        Inventory &amp; cost (accounting)
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-stone-600">
          Avg cost (read-only)
          <input
            className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 tabular-nums"
            readOnly
            value={String(avgCost ?? "0")}
          />
        </label>
        {canInventory ? (
          <label className="block text-xs text-stone-600">
            Last cost
            <input
              className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5"
              value={last}
              onChange={(e) => setLast(e.target.value)}
            />
          </label>
        ) : null}
      </div>
      {canInventory && mode === "pos" ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <label className="block text-xs text-stone-600">
            Inventory account id
            <input
              className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 font-mono text-[11px]"
              value={invAcct}
              onChange={(e) => setInvAcct(e.target.value)}
            />
          </label>
          <label className="block text-xs text-stone-600">
            COGS account id
            <input
              className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 font-mono text-[11px]"
              value={cogsAcct}
              onChange={(e) => setCogsAcct(e.target.value)}
            />
          </label>
          <label className="block text-xs text-stone-600">
            Revenue account id
            <input
              className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 font-mono text-[11px]"
              value={revAcct}
              onChange={(e) => setRevAcct(e.target.value)}
            />
          </label>
        </div>
      ) : null}
      {canInventory ? (
        <button
          type="button"
          disabled={busy || patchCosts.isPending}
          className="mt-3 rounded-lg bg-[#D4AF37] px-3 py-1.5 text-xs font-semibold text-stone-900 disabled:opacity-50"
          onClick={() => {
            void (async () => {
              setBusy(true);
              try {
                if (last.trim()) {
                  await patchCosts.mutateAsync({
                    items: [
                      {
                        productRef,
                        unitCost: last.trim(),
                        reason: "Product editor cost update",
                      },
                    ],
                  });
                }
                if (mode === "pos") {
                  await updatePosProduct(productId, {
                    locationId: locationId ?? undefined,
                    inventoryAccountId: invAcct.trim() || null,
                    cogsAccountId: cogsAcct.trim() || null,
                    revenueAccountId: revAcct.trim() || null,
                  });
                }
                addToast("Accounting product fields saved", "success");
                onSaved?.();
              } catch (err) {
                addToast(
                  err instanceof Error ? err.message : "Could not save costs",
                  "error"
                );
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          Save accounting fields
        </button>
      ) : null}
    </div>
  );
}
