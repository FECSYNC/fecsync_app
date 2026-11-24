"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import WaiverCreateWizard from "@/components/Protected/admin/pages/waivers/WaiverCreateWizard";

/**
 * Create-waiver overlay on the Waivers list. Stays in the main content
 * column so the admin sidebar remains visible (lg+).
 */
export default function WaiverCreateModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const node: ReactNode = (
    <div
      className="fixed inset-0 z-[45] flex flex-col lg:left-64"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-waiver-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-stone-900/40"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative z-[1] flex h-full w-full flex-col overflow-hidden bg-stone-50 shadow-xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3 sm:px-6">
          <h2 id="create-waiver-modal-title" className="text-base font-semibold text-stone-900">
            Create a waiver
          </h2>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-2 rounded-md px-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
            aria-label="Close"
            title="Close"
            onClick={onClose}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Close
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
          <WaiverCreateWizard mode="documents" onDone={onClose} />
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
