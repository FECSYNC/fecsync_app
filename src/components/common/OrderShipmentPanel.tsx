/**
 * Shared shipment summary for customer profile + admin order detail.
 * Reads serialized `order.shipment` from GET /api/order (same truth as Deliveries).
 */

"use client";

import { useState } from "react";
import { Truck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { Order } from "@/services/order";
import { formatPrice } from "@/utils/currency";
import {
  bookShipmentForOrderId,
  cancelShipmentById,
} from "@/services/shipping";
import { invalidateShipmentCaches } from "@/hooks/useShipments";
import { ApiError } from "@/utils/api";

const TIMELINE_STEPS = [
  { key: "booked", label: "Label created" },
  { key: "picked_up", label: "Picked up" },
  { key: "in_transit", label: "In transit" },
  { key: "out_for_delivery", label: "Out for delivery" },
  { key: "delivered", label: "Delivered" },
] as const;

const STEP_RANK: Record<string, number> = {
  pending: 0,
  booked: 1,
  picked_up: 2,
  in_transit: 3,
  out_for_delivery: 4,
  delivered: 5,
  failed: -1,
  cancelled: -1,
};

function timelineActiveIndex(status: string | undefined | null): number {
  if (!status) return -1;
  const rank = STEP_RANK[status];
  if (rank == null || rank < 0) return -1;
  return Math.max(0, rank - 1);
}

function customerStatusLabel(status: string): string {
  switch (status) {
    case "pending":
    case "booked":
      return "Label ready";
    case "picked_up":
      return "Picked up";
    case "in_transit":
      return "In transit";
    case "out_for_delivery":
      return "Out for delivery";
    case "delivered":
      return "Delivered";
    default:
      return status.replace(/_/g, " ");
  }
}

export default function OrderShipmentPanel({
  order,
  showFailureReason = false,
  canManageShipments = false,
  shippingFee,
  onShipmentChange,
}: {
  order: Pick<Order, "shipment" | "shippingMethod" | "_id" | "status"> & {
    id?: string;
    shippingAddress?: Order["shippingAddress"];
  };
  /** Staff-only: surface booking failure text + label URL */
  showFailureReason?: boolean;
  /** Staff with deliveries:manage — book/retry/cancel */
  canManageShipments?: boolean;
  shippingFee?: number;
  onShipmentChange?: () => void;
}) {
  const shipment = order.shipment;
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<"book" | "cancel" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const customerFacing = !showFailureReason && !canManageShipments;

  if (!shipment && !order.shippingMethod && shippingFee == null) return null;

  const terminalFailed = shipment?.status === "failed";
  const terminalCancelled = shipment?.status === "cancelled";
  const terminalBad = terminalFailed || terminalCancelled;

  const statusLabel =
    shipment?.status && !(customerFacing && terminalBad)
      ? customerFacing
        ? customerStatusLabel(String(shipment.status))
        : String(shipment.status).replace(/_/g, " ")
      : null;
  const courier =
    shipment?.courierName ||
    order.shippingMethod?.courierName ||
    order.shippingMethod?.serviceCode ||
    null;
  const fee =
    shippingFee != null
      ? shippingFee
      : order.shippingMethod?.fee != null
        ? Number(order.shippingMethod.fee)
        : null;
  const activeIdx = timelineActiveIndex(shipment?.status);

  const orderId = order._id || order.id;
  const paidLike =
    order.status === "paid" ||
    order.status === "shipping" ||
    order.status === "shipped";
  const preparing =
    !shipment && Boolean(order.shippingMethod) && paidLike;
  const canBook =
    canManageShipments &&
    paidLike &&
    (!shipment ||
      shipment.status === "failed" ||
      shipment.status === "cancelled" ||
      shipment.status === "pending");
  const canCancel =
    canManageShipments &&
    shipment &&
    shipment.status !== "cancelled" &&
    shipment.status !== "delivered" &&
    shipment.status !== "pending";

  async function afterShipmentChange() {
    await invalidateShipmentCaches(queryClient, orderId);
    onShipmentChange?.();
  }

  async function handleBook() {
    if (!orderId || busy) return;
    setBusy("book");
    setActionError(null);
    try {
      const result = await bookShipmentForOrderId(orderId);
      if (result.status === "failed") {
        setActionError(result.failureReason || "Shipment booking failed");
      }
      await afterShipmentChange();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Booking failed";
      setActionError(msg);
      await afterShipmentChange();
    } finally {
      setBusy(null);
    }
  }

  async function handleCancel() {
    if (!shipment?.id || busy) return;
    if (!window.confirm("Cancel this shipment with the courier?")) return;
    setBusy("cancel");
    setActionError(null);
    try {
      await cancelShipmentById(shipment.id);
      await afterShipmentChange();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Cancel failed";
      setActionError(msg);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
      <h3 className="text-lg font-semibold mb-4 text-gray-900 flex items-center gap-2">
        <Truck className="w-5 h-5 text-[#B8941F]" />
        Delivery
      </h3>
      <div className="space-y-3 text-sm">
        {preparing && (
          <p className="text-gray-700">
            Preparing your shipment. You will see tracking here once the courier
            label is ready.
          </p>
        )}

        {terminalFailed && !showFailureReason && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
            <p className="font-medium">Delivery being arranged</p>
            <p className="mt-1 text-amber-800">
              We are sorting out courier booking for this order. If you need
              help sooner, contact support with order #
              {(orderId || "").slice(-8)}.
            </p>
          </div>
        )}

        {terminalCancelled && !showFailureReason && (
          <p className="text-gray-700">
            This shipment was cancelled. Check your order status or contact
            support if you need help.
          </p>
        )}

        {statusLabel && (
          <div>
            <span className="text-gray-600 font-medium block mb-1">
              Shipment status
            </span>
            <p className="text-gray-900 capitalize">{statusLabel}</p>
          </div>
        )}
        {courier && (
          <div>
            <span className="text-gray-600 font-medium block mb-1">Courier</span>
            <p className="text-gray-900">{courier}</p>
          </div>
        )}
        {!customerFacing &&
          (shipment?.provider || order.shippingMethod?.provider) && (
            <div>
              <span className="text-gray-600 font-medium block mb-1">
                Provider
              </span>
              <p className="text-gray-900 capitalize">
                {shipment?.provider || order.shippingMethod?.provider}
              </p>
            </div>
          )}
        {fee != null && Number.isFinite(fee) && (
          <div>
            <span className="text-gray-600 font-medium block mb-1">
              Shipping fee
            </span>
            <p className="text-gray-900">
              {fee > 0
                ? formatPrice(fee)
                : order.shippingMethod
                  ? "Free"
                  : "—"}
            </p>
          </div>
        )}
        {shipment?.trackingNumber && (
          <div>
            <span className="text-gray-600 font-medium block mb-1">
              Tracking number
            </span>
            <p className="text-gray-900 font-mono text-xs break-all">
              {shipment.trackingNumber}
            </p>
          </div>
        )}
        {shipment?.trackingUrl && (
          <div>
            <a
              href={shipment.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#B8941F] font-medium hover:underline"
            >
              Track shipment
            </a>
          </div>
        )}
        {showFailureReason && shipment?.labelUrl && (
          <div>
            <a
              href={shipment.labelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#B8941F] font-medium hover:underline"
            >
              Open shipping label
            </a>
          </div>
        )}

        {shipment && !terminalBad && (
          <div className="pt-2">
            <span className="text-gray-600 font-medium block mb-2">
              Progress
            </span>
            <ol className="space-y-2">
              {TIMELINE_STEPS.map((step, idx) => {
                const done = activeIdx >= idx;
                const current = activeIdx === idx;
                return (
                  <li key={step.key} className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                        done ? "bg-[#D4AF37]" : "bg-gray-300"
                      } ${current ? "ring-2 ring-[#D4AF37]/40" : ""}`}
                    />
                    <span
                      className={
                        done ? "text-gray-900 font-medium" : "text-gray-500"
                      }
                    >
                      {step.label}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {!shipment && order.shippingMethod && !preparing && (
          <p className="text-gray-600">
            Shipping selected at checkout
            {order.shippingMethod.fee != null
              ? ` (${order.shippingMethod.fee > 0 ? "paid rate" : "free"})`
              : ""}
            . Label not booked yet.
          </p>
        )}
        {showFailureReason && shipment?.status === "failed" && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
            {shipment.failureReason ||
              "Booking failed. Retry from Deliveries or check provider credentials."}
          </div>
        )}
        {actionError && <p className="text-red-600 text-sm">{actionError}</p>}
        {canManageShipments && (canBook || canCancel) && (
          <div className="flex flex-wrap gap-2 pt-2">
            {canBook && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={handleBook}
                className="px-3 py-2 text-sm font-medium rounded-lg bg-[#D4AF37] text-black hover:bg-[#B8941F] disabled:opacity-50"
              >
                {busy === "book"
                  ? "Booking…"
                  : shipment?.status === "failed" ||
                      shipment?.status === "cancelled"
                    ? "Retry booking"
                    : "Book shipment"}
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={handleCancel}
                className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-100 disabled:opacity-50"
              >
                {busy === "cancel" ? "Cancelling…" : "Cancel shipment"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
