"use client";

import { useMemo, useState } from "react";
import type { PosTender } from "@/services/pos";

export type PayPadTender = {
  tender: PosTender;
  amount: number;
  giftCode?: string;
  cashlessCode?: string;
  guestProfileId?: string;
  simulate?: string;
};

type Props = {
  totalDue: number;
  tipAmount: number;
  tipPercents: number[];
  tipEnabled: boolean;
  cashRequiresOpenTill: boolean;
  tillOpen: boolean;
  stripeConfigured: boolean;
  terminalConfigured: boolean;
  onTipChange: (amount: number) => void;
  onPay: (tenders: PayPadTender[]) => void;
  onRequestManagerPin: (then: () => void) => void;
  busy?: boolean;
};

function money(n: number) {
  return n.toFixed(2);
}

export default function PosPayPad({
  totalDue,
  tipAmount,
  tipPercents,
  tipEnabled,
  cashRequiresOpenTill,
  tillOpen,
  stripeConfigured,
  terminalConfigured,
  onTipChange,
  onPay,
  onRequestManagerPin,
  busy,
}: Props) {
  const grandTotal = useMemo(() => totalDue + tipAmount, [totalDue, tipAmount]);
  const [splitMode, setSplitMode] = useState(false);
  const [cashAmt, setCashAmt] = useState("");
  const [cardAmt, setCardAmt] = useState("");
  const [giftAmt, setGiftAmt] = useState("");
  const [giftCode, setGiftCode] = useState("");
  const [walletAmt, setWalletAmt] = useState("");
  const [walletGuestId, setWalletGuestId] = useState("");
  const [cashlessAmt, setCashlessAmt] = useState("");
  const [cashlessCode, setCashlessCode] = useState("");
  const [message, setMessage] = useState("");

  const cashDisabled = cashRequiresOpenTill && !tillOpen;

  function applyTipPercent(pct: number) {
    onTipChange(Math.round(totalDue * (pct / 100) * 100) / 100);
  }

  function paySingle(tender: PosTender, extra?: Partial<PayPadTender>) {
    setMessage("");
    const amount = grandTotal;
    if (tender === "cash" && cashDisabled) {
      setMessage("Open the till on this device before taking cash.");
      return;
    }
    if ((tender === "card" || tender === "stored_card") && !stripeConfigured) {
      setMessage("Stripe publishable key is not configured. Use payment link or cash.");
      return;
    }
    if (tender === "stored_card") {
      setMessage(
        "Stored-card vault charge is not wired — this runs the same in-browser card form as Card."
      );
    } else if (tender === "card" && stripeConfigured && terminalConfigured) {
      setMessage("Present the card on the Terminal reader after checkout.");
    } else if (tender === "card" && stripeConfigured && !terminalConfigured) {
      setMessage(
        "No reader on this device — a card form will open after checkout to confirm in-browser."
      );
    }
    onPay([{ tender, amount, ...extra }]);
  }

  function paySplit() {
    setMessage("");
    const tenders: PayPadTender[] = [];
    const push = (tender: PosTender, raw: string, extra?: Partial<PayPadTender>) => {
      const amount = Math.round(parseFloat(raw || "0") * 100) / 100;
      if (amount > 0) tenders.push({ tender, amount, ...extra });
    };
    if (cashDisabled && parseFloat(cashAmt || "0") > 0) {
      setMessage("Open the till before recording cash.");
      return;
    }
    push("cash", cashAmt);
    push("card", cardAmt);
    if (parseFloat(giftAmt || "0") > 0 && !giftCode.trim()) {
      setMessage("Enter a gift code for the gift-card split amount.");
      return;
    }
    push("gift_card", giftAmt, { giftCode: giftCode.trim() });
    if (parseFloat(walletAmt || "0") > 0 && !walletGuestId.trim()) {
      setMessage("Enter a guest id for the park-wallet split amount.");
      return;
    }
    push("park_wallet", walletAmt, { guestProfileId: walletGuestId.trim() });
    if (parseFloat(cashlessAmt || "0") > 0 && !cashlessCode.trim()) {
      setMessage("Enter a cashless code for the cashless split amount.");
      return;
    }
    push("cashless", cashlessAmt, { cashlessCode: cashlessCode.trim() });
    const sum = tenders.reduce((s, t) => s + t.amount, 0);
    if (Math.abs(sum - grandTotal) > 0.02) {
      setMessage(`Split must total $${money(grandTotal)} (currently $${money(sum)}).`);
      return;
    }
    if (tenders.some((t) => t.tender === "card") && !stripeConfigured) {
      setMessage("Card split needs NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY configured.");
      return;
    }
    if (tenders.some((t) => t.tender === "card") && stripeConfigured && terminalConfigured) {
      setMessage("Present the card on the Terminal reader after checkout for the card portion.");
    } else if (
      tenders.some((t) => t.tender === "card") &&
      stripeConfigured &&
      !terminalConfigured
    ) {
      setMessage(
        "No reader on this device — a card form will open after checkout for the card portion."
      );
    }
    onPay(tenders);
  }

  const btn =
    "rounded-xl px-3 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45";
  const field =
    "w-full rounded-xl bg-stone-50 px-3 py-2 text-sm ring-1 ring-stone-200 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/55";

  return (
    <div className="space-y-3 rounded-2xl border border-stone-200/80 bg-gradient-to-b from-white to-stone-50 p-3.5 shadow-sm">
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">
            Amount due
          </p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight text-stone-900">
            ${money(grandTotal)}
          </p>
        </div>
        {tipAmount > 0 ? (
          <p className="text-xs text-stone-500">
            incl. tip ${money(tipAmount)}
          </p>
        ) : null}
      </div>
      {tipEnabled ? (
        <div className="flex flex-wrap gap-1.5">
          {tipPercents.map((pct) => (
            <button
              key={pct}
              type="button"
              className={`${btn} bg-white text-stone-800 ring-1 ring-stone-200 hover:ring-[#D4AF37]/70`}
              onClick={() => applyTipPercent(pct)}
            >
              {pct}%
            </button>
          ))}
          <button
            type="button"
            className={`${btn} bg-white text-stone-500 ring-1 ring-stone-200`}
            onClick={() => onTipChange(0)}
          >
            No tip
          </button>
        </div>
      ) : null}
      {message ? <p className="text-xs text-amber-800">{message}</p> : null}
      {!splitMode ? (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy || cashDisabled}
            title={cashDisabled ? "Till must be open for cash" : undefined}
            className={`${btn} bg-[#D4AF37] text-stone-900 shadow-sm shadow-[#D4AF37]/25 hover:brightness-105`}
            onClick={() => paySingle("cash")}
          >
            Cash
          </button>
          <button
            type="button"
            disabled={busy || !stripeConfigured}
            className={`${btn} bg-stone-900 text-white hover:bg-stone-800`}
            onClick={() => paySingle("card")}
          >
            {terminalConfigured ? "Card" : "Card"}
          </button>
          <input
            className={`${field} col-span-2`}
            placeholder="Gift code (required for gift card)"
            value={giftCode}
            onChange={(e) => setGiftCode(e.target.value)}
          />
          <button
            type="button"
            disabled={busy || !giftCode.trim()}
            className={`${btn} bg-white text-stone-800 ring-1 ring-stone-200`}
            onClick={() => {
              if (!giftCode.trim()) {
                setMessage("Enter a gift code before charging a gift card.");
                return;
              }
              paySingle("gift_card", { giftCode: giftCode.trim() });
            }}
          >
            Gift card
          </button>
          <button
            type="button"
            disabled={busy || !stripeConfigured}
            className={`${btn} bg-white text-stone-800 ring-1 ring-stone-200`}
            onClick={() => paySingle("payment_link")}
          >
            Pay link
          </button>
          <input
            className={`${field} col-span-2`}
            placeholder="Wallet guest id"
            value={walletGuestId}
            onChange={(e) => setWalletGuestId(e.target.value)}
          />
          <button
            type="button"
            disabled={busy || !walletGuestId.trim()}
            className={`${btn} bg-white text-stone-800 ring-1 ring-stone-200`}
            onClick={() => {
              if (!walletGuestId.trim()) {
                setMessage("Enter the guest id for park wallet.");
                return;
              }
              paySingle("park_wallet", { guestProfileId: walletGuestId.trim() });
            }}
          >
            Park wallet
          </button>
          <button
            type="button"
            disabled={busy || !stripeConfigured}
            className={`${btn} bg-white text-stone-800 ring-1 ring-stone-200`}
            onClick={() => paySingle("stored_card")}
          >
            Stored card
          </button>
          <input
            className={`${field} col-span-2`}
            placeholder="Cashless code"
            value={cashlessCode}
            onChange={(e) => setCashlessCode(e.target.value)}
          />
          <button
            type="button"
            disabled={busy || !cashlessCode.trim()}
            className={`${btn} bg-white text-stone-800 ring-1 ring-stone-200`}
            onClick={() => {
              if (!cashlessCode.trim()) {
                setMessage("Enter a cashless code before charging.");
                return;
              }
              paySingle("cashless", { cashlessCode: cashlessCode.trim() });
            }}
          >
            Cashless
          </button>
          <button
            type="button"
            className={`${btn} col-span-2 border border-dashed border-stone-300 bg-stone-50 text-stone-600 hover:border-[#D4AF37]/60`}
            onClick={() => setSplitMode(true)}
          >
            Split tender
          </button>
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <input className={field} placeholder="Cash amount" value={cashAmt} onChange={(e) => setCashAmt(e.target.value)} />
          <input className={field} placeholder="Card amount" value={cardAmt} onChange={(e) => setCardAmt(e.target.value)} />
          <input className={field} placeholder="Gift code" value={giftCode} onChange={(e) => setGiftCode(e.target.value)} />
          <input className={field} placeholder="Gift amount" value={giftAmt} onChange={(e) => setGiftAmt(e.target.value)} />
          <input className={field} placeholder="Wallet guest id" value={walletGuestId} onChange={(e) => setWalletGuestId(e.target.value)} />
          <input className={field} placeholder="Wallet amount" value={walletAmt} onChange={(e) => setWalletAmt(e.target.value)} />
          <input className={field} placeholder="Cashless code" value={cashlessCode} onChange={(e) => setCashlessCode(e.target.value)} />
          <input className={field} placeholder="Cashless amount" value={cashlessAmt} onChange={(e) => setCashlessAmt(e.target.value)} />
          <div className="flex gap-2">
            <button
              type="button"
              className={`${btn} flex-1 bg-white text-stone-700 ring-1 ring-stone-200`}
              onClick={() => setSplitMode(false)}
            >
              Back
            </button>
            <button
              type="button"
              disabled={busy}
              className={`${btn} flex-1 bg-[#D4AF37] text-stone-900`}
              onClick={() => onRequestManagerPin(() => paySplit())}
            >
              Pay split
            </button>
          </div>
        </div>
      )}
      {cashDisabled ? (
        <p className="text-xs text-stone-500">Open a till on this device to take cash.</p>
      ) : null}
      {!stripeConfigured ? (
        <p className="text-xs text-stone-500">
          Card needs NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (and STRIPE_SECRET_KEY on the server).
        </p>
      ) : terminalConfigured ? (
        <p className="text-xs text-stone-500">
          Terminal reader linked — card collect runs on the reader; falls back to in-browser if
          offline.
        </p>
      ) : (
        <p className="text-xs text-stone-500">
          Card confirms in-browser. Add a Stripe reader id (tmr_…) on the device in Setup for
          Terminal collect.
        </p>
      )}
    </div>
  );
}
