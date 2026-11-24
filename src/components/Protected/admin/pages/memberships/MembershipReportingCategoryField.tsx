'use client';

/**
 * GL reporting-category typeahead for the membership plan form.
 * Standard venue codes plus any codes already saved on other plans (live).
 */
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  REPORTING_CATEGORY_MAX,
  isStandardReportingCategory,
  mergeReportingCategoryOptions,
  normalizeReportingCategory,
} from '@/lib/memberships/reportingCategory';

type Props = {
  value: string;
  onChange: (next: string) => void;
  /** Extra codes already used on membership plans (from live plans query). */
  extraCodes?: string[];
  disabled?: boolean;
  /** Soft “Updating…” when sibling plans are refetching. */
  fetching?: boolean;
};

export {
  STANDARD_REPORTING_CATEGORIES,
} from '@/lib/memberships/reportingCategory';

export default function MembershipReportingCategoryField(props: Props) {
  const { value, onChange, extraCodes, disabled, fetching } = props;
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const codes = useMemo(
    () => mergeReportingCategoryOptions(extraCodes),
    [extraCodes]
  );

  const customFromPlans = useMemo(() => {
    const set = new Set(
      (extraCodes ?? [])
        .map(normalizeReportingCategory)
        .filter((c) => c && !isStandardReportingCategory(c))
    );
    return set;
  }, [extraCodes]);

  const shown = useMemo(() => {
    const q = normalizeReportingCategory(value);
    if (!q) return codes;
    const matches = codes.filter((c) => c.includes(q));
    // Custom / unmatched codes keep the full list visible (ROLLER parity).
    return matches.length > 0 ? matches : codes;
  }, [codes, value]);

  const canCreateCustom =
    Boolean(value.trim()) &&
    !codes.includes(normalizeReportingCategory(value));

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [shown, open]);

  function pick(code: string) {
    onChange(normalizeReportingCategory(code));
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true);
      return;
    }
    if (!open) return;
    const total = shown.length + (canCreateCustom ? 1 : 0);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % Math.max(total, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + Math.max(total, 1)) % Math.max(total, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (canCreateCustom && highlight === shown.length) {
        pick(value);
        return;
      }
      const code = shown[highlight];
      if (code) pick(code);
    }
  }

  const selected = normalizeReportingCategory(value);

  return (
    <div ref={rootRef} className="relative space-y-2">
      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm focus-within:border-[#D4AF37] focus-within:ring-2 focus-within:ring-[#D4AF37]/25">
        <div className="flex items-center justify-between gap-2 border-b border-stone-100 bg-stone-50/80 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-stone-500">
            GL code
          </p>
          <span className="flex items-center gap-2 text-[11px] text-stone-400">
            {fetching ? <span>Syncing codes…</span> : null}
            <span className="tabular-nums">
              {value.length} / {REPORTING_CATEGORY_MAX}
            </span>
          </span>
        </div>
        <div className="relative">
          <input
            className="w-full border-0 bg-transparent px-3 py-2.5 text-sm font-semibold uppercase tracking-wide text-stone-900 outline-none placeholder:font-normal placeholder:normal-case placeholder:tracking-normal placeholder:text-stone-400 disabled:opacity-50"
            value={value}
            maxLength={REPORTING_CATEGORY_MAX}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            placeholder="Type or pick a code (e.g. F&B)"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            onChange={(e) => {
              onChange(
                normalizeReportingCategory(e.target.value).slice(
                  0,
                  REPORTING_CATEGORY_MAX
                )
              );
              setOpen(true);
            }}
          />
        </div>
      </div>

      {open && (shown.length > 0 || canCreateCustom) ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-40 mt-1 max-h-60 overflow-y-auto rounded-xl border border-stone-200 bg-white py-1 shadow-xl ring-1 ring-black/5"
        >
          {shown.map((code, idx) => {
            const isSelected = selected === code;
            const isHi = highlight === idx;
            const fromPlans = customFromPlans.has(code);
            const standard = isStandardReportingCategory(code);
            return (
              <li key={code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm uppercase tracking-wide transition-colors ${
                    isHi || isSelected
                      ? 'bg-[#D4AF37]/12 text-stone-900'
                      : 'text-stone-700 hover:bg-stone-50'
                  }`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHighlight(idx)}
                  onClick={() => pick(code)}
                >
                  <span className="font-semibold">{code}</span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                      standard
                        ? 'bg-stone-100 text-stone-500'
                        : fromPlans
                          ? 'bg-[#D4AF37]/15 text-[#8a7020]'
                          : 'bg-stone-100 text-stone-500'
                    }`}
                  >
                    {standard ? 'Standard' : 'On plans'}
                  </span>
                </button>
              </li>
            );
          })}
          {canCreateCustom ? (
            <li>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className={`flex w-full items-center justify-between gap-2 border-t border-stone-100 px-3 py-2.5 text-left text-sm transition-colors ${
                  highlight === shown.length
                    ? 'bg-[#D4AF37]/12'
                    : 'hover:bg-stone-50'
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(shown.length)}
                onClick={() => pick(value)}
              >
                <span className="text-stone-800">
                  Use custom code{' '}
                  <span className="font-semibold uppercase tracking-wide">
                    {normalizeReportingCategory(value)}
                  </span>
                </span>
                <span className="shrink-0 rounded bg-[#D4AF37]/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#8a7020]">
                  New
                </span>
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}

      <p className="text-[11px] leading-relaxed text-stone-500">
        Standard venue GL codes plus codes already used on other membership
        plans. Custom codes are allowed and roll into Memberships reports.
      </p>
    </div>
  );
}
