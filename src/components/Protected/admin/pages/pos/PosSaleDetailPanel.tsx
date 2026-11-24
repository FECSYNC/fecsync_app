"use client";

import { useEffect, useState } from "react";
import {
  adjustPosBookingItems,
  emailPosReceipt,
  getPosCardSecrets,
  getPosSale,
  getPosSettings,
  refundPosSale,
  reschedulePosBooking,
  sendPosPaymentLink,
  voidPosSale,
  type PosSaleDto,
  type PosSettingsDto,
} from "@/services/pos";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import PosPinModal from "./PosPinModal";
import PosCardConfirmModal, { type CardClientSecret } from "./PosCardConfirmModal";
import { settlePosCardFromStripeReturn } from "./posCardReturn";
import { emitPosEvent } from "./posEvents";
import { AccountingEntriesPanel } from "../accounting/shared";

type Props = {
  saleId: string;
  /** Embedded in the Sales station modal (no page chrome). */
  compact?: boolean;
  onBack?: () => void;
  onChanged?: () => void;
};

export default function PosSaleDetailPanel({
  saleId,
  compact = false,
  onBack,
  onChanged,
}: Props) {
  const can = useAuthStore((s) => s.can);
  const canSell = can(P.PosSell);
  const canVoid = can(P.PosVoid);
  const canRefund = can(P.PosRefund);
  const [sale, setSale] = useState<PosSaleDto | null>(null);
  const [settings, setSettings] = useState<PosSettingsDto | null>(null);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [pinKind, setPinKind] = useState<"void" | "refund" | null>(null);
  const [bookingId, setBookingId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [cardConfirm, setCardConfirm] = useState<{
    saleId: string;
    publicId: string;
    secrets: CardClientSecret[];
  } | null>(null);
  const [cardBusy, setCardBusy] = useState(false);

  function reload(notifyParent = false) {
    getPosSale(saleId)
      .then(async (r) => {
        setSale(r.sale);
        if (notifyParent) onChanged?.();
        if (r.sale.locationId) {
          const s = await getPosSettings(r.sale.locationId);
          setSettings(s.settings);
        }
      })
      .catch((e: Error) => setError(e.message));
  }

  useEffect(() => {
    if (saleId) reload(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on saleId only
  }, [saleId]);

  useEffect(() => {
    void settlePosCardFromStripeReturn().then((message) => {
      if (!message) return;
      window.alert(message);
      if (saleId) reload(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleId]);

  function printReceipt() {
    if (!sale) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html><body style="font-family:sans-serif;padding:16px">
      <h1>Receipt ${sale.publicId}</h1>
      <img alt="QR" src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(sale.publicId)}" />
      <ul>${(sale.lines ?? []).map((l) => `<li>${l.qty}× ${l.name} $${Number(l.unitPrice).toFixed(2)}</li>`).join("")}</ul>
      <p>Total: $${Number(sale.total).toFixed(2)}</p>
      </body></html>`);
    win.document.close();
    win.print();
  }

  async function withPin(kind: "void" | "refund", pin: string) {
    if (!sale) return;
    try {
      setError("");
      if (kind === "void") {
        await voidPosSale(sale.id, { managerPin: pin, locationId: sale.locationId });
      } else {
        await refundPosSale(sale.id, {
          managerPin: pin,
          locationId: sale.locationId,
          // Fresh key per click; server also claims amountRefunded under sale lock.
          idempotencyKey: `ui-refund:${sale.id}:${crypto.randomUUID()}`,
        });
      }
      reload(true);
      onChanged?.();
      emitPosEvent("pos:sale", { locationId: sale.locationId });
      emitPosEvent("pos:capacity", { locationId: sale.locationId });
      emitPosEvent("pos:till", { locationId: sale.locationId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    }
  }

  const shell = compact
    ? "space-y-3 text-sm"
    : "mx-auto max-w-2xl space-y-4 px-4 py-8";

  if (!sale && !error) {
    return <p className={compact ? "py-6 text-center text-sm text-stone-600" : "p-8 text-sm text-stone-600"}>Loading…</p>;
  }

  return (
    <div className={shell}>
      {onBack ? (
        <button
          type="button"
          className="text-sm font-medium text-[#8a7320] underline"
          onClick={onBack}
        >
          ← Sales list
        </button>
      ) : null}
      {sale ? (
        <>
          <h1 className={compact ? "font-serif text-xl text-stone-900" : "text-2xl font-semibold text-stone-900"}>
            {sale.publicId}
          </h1>
          <p className="text-sm text-stone-600">
            {sale.status} · Paid ${sale.amountPaid.toFixed(2)} / Due ${sale.amountDue.toFixed(2)}
          </p>
          <ul className="rounded-xl border border-stone-200 bg-white p-3 text-sm">
            {(sale.lines ?? []).map((l) => (
              <li key={l.id}>
                {l.qty}× {l.name}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={printReceipt}>
              Reprint
            </button>
            <input
              className="rounded border px-2 py-1 text-sm"
              placeholder="Receipt email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button
              type="button"
              className="rounded-lg bg-[#D4AF37] px-3 py-2 text-sm font-semibold text-stone-900"
              onClick={() =>
                emailPosReceipt(sale.id, email || undefined)
                  .then(() => setError(""))
                  .catch((e: Error) => setError(e.message))
              }
            >
              Email receipt
            </button>
            {sale.status !== "voided" &&
            sale.status !== "refunded" &&
            sale.amountDue > 0 ? (
              <button
                type="button"
                className="rounded-lg border px-3 py-2 text-sm"
                onClick={() =>
                  sendPosPaymentLink(sale.id, { email, locationId: sale.locationId })
                    .then((r) => window.alert(r.url ?? "Link sent"))
                    .catch((e: Error) => setError(e.message))
                }
              >
                Payment link
              </button>
            ) : null}
            {canSell &&
            sale.status === "unpaid" &&
            (sale.payments ?? []).some(
              (p) =>
                p.status === "pending" &&
                (p.tender === "card" || p.tender === "stored_card") &&
                Boolean(p.stripePaymentIntentId?.startsWith("pi_"))
            ) ? (
              <button
                type="button"
                className="rounded-lg border border-[#D4AF37] px-3 py-2 text-sm font-semibold text-stone-900"
                disabled={cardBusy}
                onClick={() => {
                  setCardBusy(true);
                  setError("");
                  getPosCardSecrets(sale.id)
                    .then((r) => {
                      if (!r.cardClientSecrets.length) {
                        setError(
                          "No open card PaymentIntent to confirm — use payment link or cash."
                        );
                        return;
                      }
                      setCardConfirm({
                        saleId: r.saleId,
                        publicId: r.publicId,
                        secrets: r.cardClientSecrets,
                      });
                    })
                    .catch((e: Error) => setError(e.message))
                    .finally(() => setCardBusy(false));
                }}
              >
                {cardBusy ? "Loading card…" : "Confirm card"}
              </button>
            ) : null}
            {!canSell &&
            sale.status === "unpaid" &&
            (sale.payments ?? []).some(
              (p) =>
                p.status === "pending" &&
                (p.tender === "card" || p.tender === "stored_card")
            ) ? (
              <p className="w-full text-xs text-amber-800">
                Awaiting card confirm — needs pos:sell to complete payment.
              </p>
            ) : null}
            {canVoid ? (
              <button
                type="button"
                className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-800"
                onClick={() => {
                  if (settings?.managerPinRequiredForVoid) {
                    setPinKind("void");
                    setPinOpen(true);
                  } else withPin("void", "");
                }}
              >
                Void
              </button>
            ) : null}
            {canRefund ? (
              <button
                type="button"
                className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-800"
                onClick={() => {
                  if (settings?.managerPinRequiredForRefund) {
                    setPinKind("refund");
                    setPinOpen(true);
                  } else withPin("refund", "");
                }}
              >
                Refund
              </button>
            ) : null}
          </div>
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm">
            <h2 className="font-semibold">Reschedule / adjust booking</h2>
            <input
              className="mt-2 w-full rounded border px-2 py-1"
              placeholder="Booking id"
              value={bookingId}
              onChange={(e) => setBookingId(e.target.value)}
            />
            <input
              className="mt-2 w-full rounded border px-2 py-1"
              placeholder="New session id (reschedule)"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
            />
            <button
              type="button"
              className="mt-2 rounded border px-3 py-1"
              onClick={() =>
                reschedulePosBooking(bookingId, { locationId: sale.locationId, sessionId })
                  .then(() => reload(true))
                  .catch((e: Error) => setError(e.message))
              }
            >
              Reschedule
            </button>
            <button
              type="button"
              className="ml-2 mt-2 rounded border px-3 py-1"
              onClick={() =>
                adjustPosBookingItems(bookingId, { locationId: sale.locationId, lines: [] })
                  .then(() => reload(true))
                  .catch((e: Error) => setError(e.message))
              }
            >
              Adjust items
            </button>
          </div>
        </>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <PosPinModal
        open={pinOpen}
        locationId={sale?.locationId ?? ""}
        onClose={() => setPinOpen(false)}
        onVerified={(pin) => {
          if (pinKind) withPin(pinKind, pin).catch((e: Error) => setError(e.message));
          setPinKind(null);
        }}
      />
      {saleId ? (
        <AccountingEntriesPanel
          sourceType="pos_sale"
          sourceId={saleId}
          className="mt-4"
        />
      ) : null}
      <PosCardConfirmModal
        open={Boolean(cardConfirm)}
        saleId={cardConfirm?.saleId ?? ""}
        publicId={cardConfirm?.publicId ?? ""}
        secrets={cardConfirm?.secrets ?? []}
        onClose={() => {
          setCardConfirm(null);
          setError(
            "Card not confirmed — sale stays unpaid. Use Confirm card again, or payment link / cash."
          );
        }}
        onSettled={(message) => {
          setCardConfirm(null);
          window.alert(message);
          reload(true);
        }}
      />
    </div>
  );
}
