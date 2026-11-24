"use client";

import { useEffect, useState } from "react";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";

export default function ConfirmReasonModal({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  requireReason = false,
  reasonLabel = "Reason",
  reasonMin = 3,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  requireReason?: boolean;
  reasonLabel?: string;
  reasonMin?: number;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
}) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  if (!open) return null;

  const ok = !requireReason || reason.trim().length >= reasonMin;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
      >
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        {message ? <p className="mt-2 text-sm text-gray-600">{message}</p> : null}
        {requireReason ? (
          <label className="mt-4 block text-sm">
            <span className="mb-1 block font-medium text-gray-700">{reasonLabel}</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 outline-none focus:border-[#D4AF37]"
            />
          </label>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !ok}
            onClick={() => void onConfirm(reason.trim())}
            className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? <ButtonSpinner /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
