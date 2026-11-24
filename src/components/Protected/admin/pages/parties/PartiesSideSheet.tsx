'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * Right-hand sheet for in-place create / edit flows (packages, new party).
 * Content is bundled with the opener, so it paints instantly. lg:left-64 keeps
 * the sidebar visible; Esc / backdrop / Close all go through onRequestClose.
 */
export default function PartiesSideSheet({
  eyebrow,
  title,
  icon,
  onRequestClose,
  children,
  width = 'max-w-3xl',
}: {
  eyebrow: string;
  title: string;
  icon: ReactNode;
  onRequestClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onRequestClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onRequestClose]);

  return (
    <div className="fixed inset-y-0 left-0 right-0 z-[70] flex justify-end lg:left-64" role="dialog" aria-modal="true" aria-label={title}>
      <style>{`@keyframes partiesSheetIn{from{opacity:.4;transform:translateX(32px)}to{opacity:1;transform:none}}@keyframes partiesSheetFade{from{opacity:0}to{opacity:1}}`}</style>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        onClick={onRequestClose}
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-[2px]"
        style={{ animation: 'partiesSheetFade 150ms ease-out' }}
      />
      <div
        className={`relative flex h-full w-full ${width} flex-col bg-[#faf9f7] shadow-[-24px_0_60px_-30px_rgba(28,25,23,0.6)] sm:border-l sm:border-stone-200`}
        style={{ animation: 'partiesSheetIn 200ms cubic-bezier(0.22,1,0.36,1)' }}
      >
        <header className="relative flex shrink-0 items-start justify-between gap-3 border-b border-stone-200 bg-white px-5 py-4">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#D4AF37]/12 via-white to-white" />
          <div className="relative flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#D4AF37]/20 text-[#8a6d12]">{icon}</span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#A6892A]">{eyebrow}</p>
              <h2 className="truncate text-xl font-semibold tracking-tight text-stone-900">{title}</h2>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onRequestClose}
            className="relative inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]/50"
          >
            <X className="h-4 w-4" />
            Close
            <kbd className="ml-1 hidden rounded border border-stone-200 px-1 text-[10px] text-stone-400 sm:inline">Esc</kbd>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5">
          {children}
          <div className="h-5" />
        </div>
      </div>
    </div>
  );
}
