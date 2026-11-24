'use client';

import { useEffect, useRef, useState } from 'react';
import { copyToClipboard } from '@/lib/copyToClipboard';
import type { PublicCategoryPageDto } from '@/lib/publicCategory/snippet';

const MENU_WIDTH = 176;
const MENU_HEIGHT = 84;

type Copied = 'link' | 'embed' | 'failed' | null;

/** Actions-column Copy menu: public link or iframe embed for one category. */
export function PublicCategoryCopyMenu({
  page,
}: {
  page: PublicCategoryPageDto | null | undefined;
}) {
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [copied, setCopied] = useState<Copied>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current != null) window.clearTimeout(resetTimer.current);
    },
    []
  );

  useEffect(() => {
    if (!menuPos) return;
    const close = () => setMenuPos(null);
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menuPos]);

  if (!page) return null;

  const toggle = () => {
    if (menuPos) {
      setMenuPos(null);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const opensUp = rect.bottom + MENU_HEIGHT + 8 > window.innerHeight;
    setMenuPos({
      top: opensUp ? rect.top - MENU_HEIGHT - 4 : rect.bottom + 4,
      left: Math.max(8, rect.right - MENU_WIDTH),
    });
  };

  const copy = async (text: string, which: 'link' | 'embed') => {
    setMenuPos(null);
    const ok = await copyToClipboard(text);
    setCopied(ok ? which : 'failed');
    if (resetTimer.current != null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setCopied(null), 1800);
  };

  const label =
    copied === 'link'
      ? 'Link copied'
      : copied === 'embed'
        ? 'Iframe copied'
        : copied === 'failed'
          ? 'Copy failed'
          : 'Copy';

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={menuPos != null}
        disabled={!page.active}
        title={page.active ? 'Copy public link or iframe embed' : 'This public page is inactive'}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-stone-300 px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={toggle}
      >
        {label}
        <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {menuPos ? (
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-50 rounded-md border border-stone-200 bg-white py-1 text-left shadow-lg"
          style={{ top: menuPos.top, left: menuPos.left, width: MENU_WIDTH }}
        >
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-2 text-left text-xs text-stone-800 hover:bg-stone-100"
            onClick={() => void copy(page.url, 'link')}
          >
            Copy link
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!page.embedEnabled}
            title={page.embedEnabled ? undefined : 'Embedding is off for this page'}
            className="block w-full px-3 py-2 text-left text-xs text-stone-800 hover:bg-stone-100 disabled:cursor-not-allowed disabled:text-stone-400 disabled:hover:bg-transparent"
            onClick={() => void copy(page.embedSnippet, 'embed')}
          >
            Copy iframe embed
          </button>
        </div>
      ) : null}
    </>
  );
}
