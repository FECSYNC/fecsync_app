"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useToast } from "@/contexts/toast-context";
import { useAuthStore } from "@/store/authStore";
import { P } from "@/lib/auth/permissions";
import { ButtonSpinner } from "@/components/Protected/admin/components/Spinner";
import {
  useAccountingInitialized,
  useCreateJournalMutation,
  usePostJournalMutation,
  useSubmitJournalMutation,
} from "@/hooks/useAccounting";
import {
  AccountingGate,
  AttachmentUploader,
  DebitCreditLinesEditor,
  LocationPicker,
  accountingErrorMessage,
  newJournalLineDraft,
  type JournalLineDraft,
} from "../shared";

export default function JournalNewPage({
  embedded = false,
  onClose,
  onCreated,
}: {
  /** Rendered inside a modal over the journals list (no route change). */
  embedded?: boolean;
  onClose?: () => void;
  onCreated?: (entryId: string) => void;
} = {}) {
  const router = useRouter();
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.AccountingJournalsWrite);
  const canPost = can(P.AccountingJournalsPost);
  const { settings } = useAccountingInitialized(true);
  const currency = settings?.baseCurrency ?? "USD";
  const createMutation = useCreateJournalMutation();
  const submitMutation = useSubmitJournalMutation();
  const postMutation = usePostJournalMutation();
  const closeRef = useRef<HTMLButtonElement>(null);

  const [entryDate, setEntryDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [memo, setMemo] = useState("");
  const [reference, setReference] = useState("");
  const [locationId, setLocationId] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [lines, setLines] = useState<JournalLineDraft[]>([
    newJournalLineDraft(),
    newJournalLineDraft(),
  ]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!embedded) return;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [embedded, busy, onClose]);

  const buildBody = (submit?: boolean) => ({
    entryDate,
    memo: memo.trim() || null,
    reference: reference.trim() || null,
    locationId: locationId || null,
    attachments: attachments.map((url) => ({ url })),
    submit: submit || undefined,
    lines: lines
      .filter((l) => l.ledgerAccountId && (l.debit || l.credit))
      .map((l) => ({
        accountId: l.ledgerAccountId,
        debit: l.debit || "0",
        credit: l.credit || "0",
        description: l.description || null,
        locationId: l.locationId || locationId || null,
      })),
  });

  const finish = (entryId: string) => {
    if (onCreated) {
      onCreated(entryId);
      return;
    }
    router.push(`/admin/accounting/journals/${entryId}`);
  };

  const save = async (mode: "draft" | "submit" | "post") => {
    if (!canWrite) {
      addToast("You do not have permission to create journals", "error");
      return;
    }
    setBusy(true);
    try {
      const entry = (await createMutation.mutateAsync(
        buildBody(mode === "submit")
      )) as { id: string; status?: string };
      if (mode === "post" && canPost) {
        await postMutation.mutateAsync(entry.id);
        addToast("Journal posted", "success");
      } else if (mode === "submit") {
        if (entry.status === "draft") {
          await submitMutation.mutateAsync(entry.id);
        }
        addToast("Journal submitted for approval", "success");
      } else {
        addToast("Draft journal saved", "success");
      }
      finish(entry.id);
    } catch (err) {
      addToast(accountingErrorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const form = !canWrite ? (
    <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      You need journals write permission to create entries.
    </p>
  ) : (
    <div className="mx-auto max-w-5xl space-y-5">
      {!embedded ? (
        <div>
          <Link
            href="/admin/accounting/journals"
            className="text-sm text-[#D4AF37] hover:underline"
          >
            ← Journals
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-stone-900">New journal</h1>
          <p className="mt-2 text-sm text-stone-600">
            Enter balanced debit and credit lines in {currency}.
          </p>
        </div>
      ) : (
        <p className="text-sm text-stone-600">
          Enter balanced debit and credit lines in {currency}.
        </p>
      )}

      <div className="grid gap-4 rounded-2xl border border-stone-100 bg-white p-5 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-stone-700">
            Entry date
          </span>
          <input
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            className="w-full rounded-xl border border-stone-200 px-3 py-2"
          />
        </label>
        <LocationPicker
          value={locationId}
          onChange={setLocationId}
          allowCompanyWide
          className="w-full"
        />
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-stone-700">Memo</span>
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            className="w-full rounded-xl border border-stone-200 px-3 py-2"
          />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-stone-700">
            Reference
          </span>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="w-full rounded-xl border border-stone-200 px-3 py-2"
          />
        </label>
      </div>

      <DebitCreditLinesEditor
        lines={lines}
        onChange={setLines}
        currency={currency}
      />

      <div className="rounded-2xl border border-stone-100 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-stone-900">
          Attachments
        </h2>
        <AttachmentUploader urls={attachments} onChange={setAttachments} />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save("draft")}
          className="inline-flex items-center gap-2 rounded-xl border border-stone-200 px-4 py-2 text-sm font-medium"
        >
          {busy ? <ButtonSpinner /> : null}
          Save draft
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save("submit")}
          className="inline-flex items-center gap-2 rounded-xl border border-[#D4AF37] px-4 py-2 text-sm font-semibold text-[#D4AF37]"
        >
          {busy ? <ButtonSpinner /> : null}
          Submit for approval
        </button>
        {canPost ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void save("post")}
            className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white"
          >
            {busy ? <ButtonSpinner /> : null}
            Save & post
          </button>
        ) : null}
        {embedded && onClose ? (
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-xl border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );

  if (embedded) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New journal"
        className="fixed inset-y-0 left-0 right-0 z-[70] flex lg:left-64"
      >
        <button
          type="button"
          aria-label="Close overlay"
          tabIndex={-1}
          className="absolute inset-0 bg-stone-900/45 backdrop-blur-[2px]"
          onClick={onClose}
        />
        <div className="relative m-0 flex w-full flex-col overflow-hidden bg-[#faf9f7] shadow-[0_24px_60px_-28px_rgba(28,25,23,0.55)] sm:m-3 sm:rounded-2xl sm:border sm:border-stone-200">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-900">
                New journal
              </h2>
              <p className="text-xs text-stone-500">
                Creates a manual ledger entry
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50"
            >
              <X className="h-4 w-4" />
              Close
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            <AccountingGate requireInitialized={false}>{form}</AccountingGate>
          </div>
        </div>
      </div>
    );
  }

  return <AccountingGate>{form}</AccountingGate>;
}
