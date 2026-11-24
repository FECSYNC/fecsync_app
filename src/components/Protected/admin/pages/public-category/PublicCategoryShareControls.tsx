'use client';

import { useEffect, useState } from 'react';
import { copyToClipboard } from '@/lib/copyToClipboard';
import type { PublicCategoryPageDto } from '@/lib/publicCategory/snippet';

type Layout = 'auto' | 'grid' | 'stack';

export function PublicCategoryShareControls({
  page,
  canWrite,
  saving,
  onSave,
  showCopyButtons = true,
}: {
  page: PublicCategoryPageDto | null | undefined;
  canWrite: boolean;
  saving?: boolean;
  /** Tables copy from the Actions column instead. */
  showCopyButtons?: boolean;
  onSave?: (patch: {
    slug: string;
    layout: Layout;
    embedEnabled: boolean;
  }) => void;
}) {
  const [slug, setSlug] = useState(page?.slug ?? '');
  const [layout, setLayout] = useState<Layout>(page?.layout ?? 'auto');
  const [embedEnabled, setEmbedEnabled] = useState(page?.embedEnabled ?? true);
  const [copied, setCopied] = useState<'link' | 'embed' | 'link-failed' | 'embed-failed' | null>(null);

  useEffect(() => {
    setSlug(page?.slug ?? '');
    setLayout(page?.layout ?? 'auto');
    setEmbedEnabled(page?.embedEnabled ?? true);
  }, [page?.slug, page?.layout, page?.embedEnabled, page?.url]);

  if (!page) return null;

  const copy = async (text: string, which: 'link' | 'embed') => {
    if (await copyToClipboard(text)) {
      setCopied(which);
      window.setTimeout(() => setCopied(null), 1500);
    } else {
      setCopied(which === 'link' ? 'link-failed' : 'embed-failed');
      window.setTimeout(() => setCopied(null), 2000);
    }
  };

  return (
    <div className="mt-2 max-w-xl space-y-2 whitespace-normal rounded-md border border-stone-200 bg-stone-50 p-2">
      <p className="break-all text-xs text-stone-700">{page.url}</p>
      {showCopyButtons ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border border-stone-300 bg-white px-2 py-1 text-xs font-medium text-stone-800"
            onClick={() => void copy(page.url, 'link')}
          >
            {copied === 'link' ? 'Copied' : copied === 'link-failed' ? 'Copy failed' : 'Copy link'}
          </button>
          <button
            type="button"
            className="rounded border border-stone-300 bg-white px-2 py-1 text-xs font-medium text-stone-800 disabled:opacity-50"
            disabled={!page.embedEnabled}
            onClick={() => void copy(page.embedSnippet, 'embed')}
          >
            {copied === 'embed' ? 'Copied' : copied === 'embed-failed' ? 'Copy failed' : 'Copy embed'}
          </button>
        </div>
      ) : null}
      {!page.embedEnabled ? (
        <p className="text-xs text-stone-500">
          Embedding is off, so embedded copies of this page show “not found”. The direct link still works.
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block min-w-0 text-xs font-medium text-stone-600">
          Public link
          <input
            className="mt-1 w-full rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-900 disabled:opacity-60"
            value={slug}
            disabled={!canWrite || saving}
            onChange={(e) => setSlug(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="block min-w-0 text-xs font-medium text-stone-600">
          Layout
          <select
            className="mt-1 w-full rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-900 disabled:opacity-60"
            value={layout}
            disabled={!canWrite || saving}
            onChange={(e) => setLayout(e.target.value as Layout)}
          >
            <option value="auto">Auto</option>
            <option value="grid">Grid</option>
            <option value="stack">Stack</option>
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-xs text-stone-700">
        <input
          type="checkbox"
          checked={embedEnabled}
          disabled={!canWrite || saving}
          onChange={(e) => setEmbedEnabled(e.target.checked)}
        />
        Embed enabled
      </label>
      {canWrite && onSave ? (
        <button
          type="button"
          className="rounded bg-[#D4AF37] px-2 py-1 text-xs font-semibold text-stone-950 disabled:opacity-60"
          disabled={saving || !slug.trim()}
          onClick={() =>
            onSave({ slug: slug.trim(), layout, embedEnabled })
          }
        >
          {saving ? 'Saving…' : 'Save public page'}
        </button>
      ) : null}
      {!page.active ? (
        <p className="text-xs text-stone-500">This public page is inactive.</p>
      ) : null}
    </div>
  );
}
