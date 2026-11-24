'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import BookingsCalendarPage from './BookingsCalendarPage';

type Props = {
  open: boolean;
  onClose: () => void;
  onCreateBooking?: () => void;
  onSelectSession?: (sessionId: string) => void;
  onSelectBooking?: (bookingId: string) => void;
};

/**
 * Bookings calendar overlay on the list — content column only (sidebar stays
 * visible on lg+), matching Create booking modal chrome.
 */
export default function BookingsCalendarModal({
  open,
  onClose,
  onCreateBooking,
  onSelectSession,
  onSelectBooking,
}: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const requestClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
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
  }, [open, requestClose]);

  if (!mounted || !open) return null;

  const node: ReactNode = (
    <div
      className="fixed inset-0 z-[45] flex flex-col bg-stone-900/40 lg:left-64"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bookings-calendar-modal-title"
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
            id="bookings-calendar-modal-title"
            className="text-base font-semibold text-stone-900"
          >
            Calendar
          </h2>
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800"
            aria-label="Close"
            title="Close"
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
          <BookingsCalendarPage
            key="bookings-calendar-modal"
            presentation="modal"
            onCreateBooking={onCreateBooking}
            onSelectSession={onSelectSession}
            onSelectBooking={onSelectBooking}
          />
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
