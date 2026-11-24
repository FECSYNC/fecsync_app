"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import {
  usePurchaseOrderActionMutation,
  usePurchaseOrderQuery,
} from "@/hooks/useAccounting";
import {
  AccountingErrorMessage,
  AccountingGate,
  MoneyCell,
  StatusChip,
  accountingErrorMessage,
  asItems,
  asRecord,
  todayIsoDate,
  unwrapEntity,
} from "../shared";

export default function PurchaseOrderDetailPage() {
  const params = useParams();
  const id = String(params.poId ?? "");
  const router = useRouter();
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.AccountingPayablesWrite);
  const canApprove = can(P.AccountingPayablesApprove);
  const query = usePurchaseOrderQuery(id, Boolean(id));
  const action = usePurchaseOrderActionMutation();
  const po = unwrapEntity(query.data, ["purchaseOrder"]);
  const lines = asItems(asRecord(po).lines);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveDate, setReceiveDate] = useState(todayIsoDate());
  const [recv, setRecv] = useState<Record<string, { qty: string; unitCost: string }>>({});

  const openReceive = () => {
    const init: Record<string, { qty: string; unitCost: string }> = {};
    for (const l of lines) {
      const remaining = Number(l.qty ?? 0) - Number(l.qtyReceived ?? 0);
      init[String(l.id)] = {
        qty: remaining > 0 ? String(remaining) : "0",
        unitCost: String(l.unitCost ?? "0"),
      };
    }
    setRecv(init);
    setReceiveOpen(true);
  };

  const run = async (
    act:
      | "submit"
      | "approve"
      | "reject"
      | "send"
      | "receive"
      | "close"
      | "cancel"
      | "convert-to-bill",
    body?: Record<string, unknown>
  ) => {
    try {
      const res = await action.mutateAsync({ id, action: act, body });
      if (act === "convert-to-bill") {
        const bill = asRecord(asRecord(res).bill ?? res);
        addToast("Converted to bill", "success");
        if (bill.id) router.push(`/admin/accounting/bills/${String(bill.id)}`);
        return;
      }
      addToast(`PO ${act.replace(/-/g, " ")}`, "success");
      setReceiveOpen(false);
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    }
  };

  const status = String(po.status ?? "");
  const progress = useMemo(() => {
    let ordered = 0;
    let received = 0;
    let billed = 0;
    for (const l of lines) {
      ordered += Number(l.qty ?? 0);
      received += Number(l.qtyReceived ?? 0);
      billed += Number(l.qtyBilled ?? 0);
    }
    return { ordered, received, billed };
  }, [lines]);

  return (
    <AccountingGate>
      <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
        <div>
          <Link href="/admin/accounting/purchase-orders" className="text-sm text-[#B8860B]">
            ← Purchase orders
          </Link>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">{String(po.number ?? "PO")}</h1>
              <p className="mt-1 text-sm text-gray-600">{String(po.supplierName ?? "")}</p>
            </div>
            <StatusChip status={status} />
          </div>
        </div>
        <AccountingErrorMessage error={query.error} />
        <p className="text-sm text-gray-600">
          Received {progress.received}/{progress.ordered} · Billed {progress.billed}/{progress.ordered}
        </p>
        <div className="flex flex-wrap gap-2">
          {canWrite && status === "draft" ? (
            <button type="button" className="rounded-md bg-[#D4AF37] px-3 py-2 text-sm text-white" onClick={() => void run("submit")}>
              Submit
            </button>
          ) : null}
          {canApprove && status === "pending_approval" ? (
            <>
              <button type="button" className="rounded-md bg-[#D4AF37] px-3 py-2 text-sm text-white" onClick={() => void run("approve")}>
                Approve
              </button>
              <button
                type="button"
                className="rounded-md border px-3 py-2 text-sm"
                onClick={() => {
                  const reason = window.prompt("Reject reason") || "";
                  if (reason.trim().length < 3) return;
                  void run("reject", { reason });
                }}
              >
                Reject
              </button>
            </>
          ) : null}
          {canWrite && ["approved", "sent", "partially_received"].includes(status) ? (
            <>
              {status === "approved" ? (
                <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => void run("send")}>
                  Mark sent
                </button>
              ) : null}
              <button type="button" className="rounded-md bg-[#D4AF37] px-3 py-2 text-sm text-white" onClick={openReceive}>
                Receive…
              </button>
              <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => void run("convert-to-bill")}>
                Convert to bill
              </button>
              <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => void run("close")}>
                Close
              </button>
            </>
          ) : null}
          {canWrite && ["draft", "approved", "sent"].includes(status) ? (
            <button
              type="button"
              className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700"
              onClick={() => {
                const reason = window.prompt("Cancel reason") || "";
                void run("cancel", { reason });
              }}
            >
              Cancel
            </button>
          ) : null}
          {action.isPending ? <ButtonSpinner /> : null}
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Received</th>
                <th className="px-3 py-2 text-right">Billed</th>
                <th className="px-3 py-2 text-right">Unit</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={String(l.id)} className="border-t border-gray-100">
                  <td className="px-3 py-2">{String(l.description)}</td>
                  <td className="px-3 py-2 text-right">{String(l.qty)}</td>
                  <td className="px-3 py-2 text-right">{String(l.qtyReceived)}</td>
                  <td className="px-3 py-2 text-right">{String(l.qtyBilled)}</td>
                  <td className="px-3 py-2 text-right">
                    <MoneyCell value={l.unitCost as string} currency={String(po.currency ?? "USD")} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <MoneyCell value={l.lineTotal as string} currency={String(po.currency ?? "USD")} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {receiveOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-4 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-lg bg-white p-4 shadow-lg">
            <h2 className="text-lg font-semibold">Receive goods</h2>
            <input
              type="date"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              value={receiveDate}
              onChange={(e) => setReceiveDate(e.target.value)}
            />
            {lines.map((l) => (
              <div key={String(l.id)} className="grid grid-cols-2 gap-2 rounded border border-gray-100 p-2 text-sm">
                <p className="col-span-2 font-medium">{String(l.description)}</p>
                <label>
                  Qty
                  <input
                    className="mt-1 w-full rounded border px-2 py-1"
                    value={recv[String(l.id)]?.qty ?? "0"}
                    onChange={(e) =>
                      setRecv({
                        ...recv,
                        [String(l.id)]: {
                          qty: e.target.value,
                          unitCost: recv[String(l.id)]?.unitCost ?? String(l.unitCost),
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Unit cost
                  <input
                    className="mt-1 w-full rounded border px-2 py-1"
                    value={recv[String(l.id)]?.unitCost ?? String(l.unitCost)}
                    onChange={(e) =>
                      setRecv({
                        ...recv,
                        [String(l.id)]: {
                          qty: recv[String(l.id)]?.qty ?? "0",
                          unitCost: e.target.value,
                        },
                      })
                    }
                  />
                </label>
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <button type="button" className="px-3 py-2 text-sm" onClick={() => setReceiveOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-[#D4AF37] px-4 py-2 text-sm font-medium text-white"
                onClick={() =>
                  void run("receive", {
                    receivedDate: receiveDate,
                    lines: Object.entries(recv)
                      .filter(([, v]) => Number(v.qty) > 0)
                      .map(([lineId, v]) => ({
                        lineId,
                        qty: v.qty,
                        unitCost: v.unitCost,
                      })),
                  })
                }
              >
                Receive
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AccountingGate>
  );
}
