"use client";

import { useEffect, useRef, useState } from "react";
import { verifyManagerPin } from "@/services/pos";

type Props = {
  open: boolean;
  locationId: string;
  title?: string;
  onClose: () => void;
  onVerified: (pin: string, userId?: string) => void;
};

export default function PosPinModal({
  open,
  locationId,
  title = "Manager PIN",
  onClose,
  onVerified,
}: Props) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPin("");
      setError("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await verifyManagerPin(pin, locationId);
      const verifiedPin = pin;
      setPin("");
      onVerified(verifiedPin, result.userId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "PIN verification failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-xl border border-stone-200 bg-white p-5 shadow-lg"
      >
        <h2 className="text-lg font-semibold text-stone-900">{title}</h2>
        <p className="mt-1 text-sm text-stone-600">Enter your manager PIN. It is never sent in the URL.</p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={12}
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-center text-lg tracking-widest"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          />
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || pin.length < 4}
              className="flex-1 rounded-lg bg-[#D4AF37] px-3 py-2 text-sm font-semibold text-stone-900 disabled:opacity-50"
            >
              {busy ? "Checking…" : "Verify"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
