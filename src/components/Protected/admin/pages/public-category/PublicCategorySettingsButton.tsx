'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOverlayDismiss } from '@/hooks/useOverlayDismiss';
import type { PublicCategoryPageDto } from '@/lib/publicCategory/snippet';
import { PublicCategoryShareControls } from './PublicCategoryShareControls';

type PublicPagePatch = {
  slug: string;
  layout: 'auto' | 'grid' | 'stack';
  embedEnabled: boolean;
};

/** Actions-column button that edits one category's public link, layout, and embed flag in a dialog. */
export function PublicCategorySettingsButton({
  categoryName,
  page,
  saving,
  onSave,
}: {
  categoryName: string;
  page: PublicCategoryPageDto | null | undefined;
  saving?: boolean;
  onSave: (patch: PublicPagePatch) => void;
}) {
  const [open, setOpen] = useState(false);
  const pageKey = page ? `${page.slug}|${page.layout}|${page.embedEnabled}` : '';
  const keyAtSave = useRef<string | null>(null);

  const close = () => {
    if (saving) return;
    keyAtSave.current = null;
    setOpen(false);
  };
  const { overlayDismissProps } = useOverlayDismiss(close);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close reads the latest saving flag
  }, [open, saving]);

  // The saved row comes back through the list cache; a changed page means the save went through.
  useEffect(() => {
    if (open && keyAtSave.current != null && keyAtSave.current !== pageKey) {
      keyAtSave.current = null;
      setOpen(false);
    }
  }, [open, pageKey]);

  if (!page) return null;

  return (
    <>
      <button
        type="button"
        className="whitespace-nowrap rounded border border-stone-300 px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50"
        onClick={() => setOpen(true)}
      >
        Public link
      </button>
      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 text-left sm:items-center"
              role="dialog"
              aria-modal="true"
              aria-label={`Public link for ${categoryName}`}
              {...overlayDismissProps}
            >
              <div
                className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 className="text-lg font-semibold text-stone-900">Public link</h2>
                <p className="mt-1 text-sm text-stone-600">
                  {categoryName} — change the link, the layout, and whether websites can embed this page.
                  Use Copy in the Actions column to copy the link or the iframe.
                </p>
                <PublicCategoryShareControls
                  page={page}
                  canWrite
                  saving={saving}
                  showCopyButtons={false}
                  onSave={(patch) => {
                    keyAtSave.current = pageKey;
                    onSave(patch);
                  }}
                />
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    className="rounded border border-stone-300 px-4 py-2 text-sm text-stone-700 disabled:opacity-60"
                    disabled={saving}
                    onClick={close}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
