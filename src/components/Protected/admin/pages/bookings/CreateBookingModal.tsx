'use client';

import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import NewBookingWizardPage from './NewBookingWizardPage';

type Props = {
  open: boolean;
  onClose: () => void;
  /** HQ / list park filter → preselect venue in the wizard */
  preferLocationId?: string;
  accountId?: string;
  onCreated?: (booking: { id: string; publicId: string }) => void;
};

/**
 * Create-booking overlay on the Bookings list — stays in the main content
 * column so the admin sidebar remains visible (lg+).
 */
export default function CreateBookingModal({
  open,
  onClose,
  preferLocationId,
  accountId,
  onCreated,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  // Sync guard — React setState is async; Esc/backdrop must not race success dismiss.
  const busyRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const setBusySafe = useCallback((next: boolean) => {
    busyRef.current = next;
    setBusy(next);
  }, []);

  const requestClose = useCallback(() => {
    if (busyRef.current) return;
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      setBusySafe(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        requestClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, requestClose, setBusySafe]);

  if (!mounted || !open) return null;

  const node: ReactNode = (
    <div
      className="fixed inset-0 z-[45] flex flex-col bg-stone-900/40 lg:left-64"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-booking-modal-title"
      aria-busy={busy || undefined}
    >
      <div
        className="absolute inset-0"
        aria-hidden
        onClick={requestClose}
      />
      <div
        className="relative z-[1] flex h-full w-full flex-col overflow-hidden bg-stone-50 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3 sm:px-6">
          <h2
            id="create-booking-modal-title"
            className="text-base font-semibold text-stone-900"
          >
            Create booking
          </h2>
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Close"
            title="Close"
            disabled={busy}
            onClick={requestClose}
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
          <Suspense fallback={null}>
            <NewBookingWizardPage
              key={`${preferLocationId ?? ''}:${accountId ?? ''}`}
              presentation="modal"
              onClose={requestClose}
              onCreated={onCreated}
              onBusyChange={setBusySafe}
              preferLocationId={preferLocationId}
              preferAccountId={accountId}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
