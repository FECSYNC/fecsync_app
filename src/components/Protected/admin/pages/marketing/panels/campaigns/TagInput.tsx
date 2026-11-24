"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  MERGE_TAG_LABELS,
  MERGE_TAG_NAMES,
  type MergeTagName,
} from "@/lib/marketing/campaigns/richText";

export const fieldCls =
  "w-full rounded-xl border-0 bg-stone-50 px-3 py-2 text-sm text-stone-900 ring-1 ring-stone-200/90 placeholder:text-stone-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/55 disabled:opacity-60";

/** Single-line input with an "insert personalisation" menu that inserts at the caret. */
export default function TagInput({
  value,
  onChange,
  placeholder,
  disabled,
  maxLength,
  tags = MERGE_TAG_NAMES,
  className = "",
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  tags?: readonly MergeTagName[];
  className?: string;
  ariaLabel?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const caret = useRef<number | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function insert(tag: MergeTagName) {
    const token = `{{${tag}}}`;
    const el = inputRef.current;
    const at = caret.current ?? value.length;
    const next = `${value.slice(0, at)}${token}${value.slice(at)}`;
    onChange(maxLength ? next.slice(0, maxLength) : next);
    setOpen(false);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = at + token.length;
      el.setSelectionRange(pos, pos);
      caret.current = pos;
    });
  }

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        className={`${fieldCls} pr-10`}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-label={ariaLabel}
        onChange={(e) => {
          caret.current = e.target.selectionStart;
          onChange(e.target.value);
        }}
        onSelect={(e) => {
          caret.current = (e.target as HTMLInputElement).selectionStart;
        }}
      />
      {!disabled ? (
        <button
          type="button"
          title="Insert personalisation"
          aria-label="Insert personalisation"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((v) => !v)}
          className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[#8a7020] transition hover:bg-[#D4AF37]/15"
        >
          <Sparkles className="h-3.5 w-3.5" />
        </button>
      ) : null}
      {open ? (
        <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border border-stone-200 bg-white p-1.5 shadow-xl shadow-stone-900/10">
          <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400">
            Insert for each guest
          </p>
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(t)}
              className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm text-stone-700 hover:bg-[#D4AF37]/10"
            >
              {MERGE_TAG_LABELS[t]}
              <code className="text-[10px] text-stone-400">{`{{${t}}}`}</code>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
