'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  detectBrowserTimezone,
  detectVenuePlaceFromDevice,
  listIanaTimezones,
  searchCities,
  timezoneForCitySuggestion,
  type CitySuggestion,
} from '@/lib/venueFormHelpers';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';

const fieldClass =
  'w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-900 focus:border-[#D4AF37] focus:outline-none focus:ring-1 focus:ring-[#D4AF37] disabled:opacity-60';

const PANEL_MAX_H = 240;
const PANEL_GAP = 4;

type PanelPos = { top: number; left: number; width: number; maxHeight: number };

type VenuePlaceFieldsProps = {
  city: string;
  timezone: string;
  onCityChange: (city: string) => void;
  onTimezoneChange: (timezone: string) => void;
  disabled?: boolean;
  /** Prefill browser timezone once when empty. */
  autoPrefillTimezone?: boolean;
};

/** Scrollbar pointerdown is not "outside" — keep the floating list open. */
function isScrollbarClick(event: { target: EventTarget | null; clientX: number; clientY: number }): boolean {
  let node: HTMLElement | null =
    event.target instanceof HTMLElement ? event.target : null;
  while (node) {
    const { overflowX, overflowY } = getComputedStyle(node);
    const scrollY =
      node.scrollHeight > node.clientHeight &&
      /(auto|scroll|overlay)/.test(overflowY);
    const scrollX =
      node.scrollWidth > node.clientWidth &&
      /(auto|scroll|overlay)/.test(overflowX);
    if (scrollX || scrollY) {
      const rect = node.getBoundingClientRect();
      const sbW = node.offsetWidth - node.clientWidth;
      const sbH = node.offsetHeight - node.clientHeight;
      if (scrollY && sbW > 0 && event.clientX >= rect.right - sbW - 1) {
        return true;
      }
      if (scrollX && sbH > 0 && event.clientY >= rect.bottom - sbH - 1) {
        return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}

function positionPanelBelowOrAbove(anchor: HTMLElement): PanelPos {
  const rect = anchor.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - 8;
  const spaceAbove = rect.top - 8;
  const openDown =
    spaceBelow >= Math.min(PANEL_MAX_H, 120) || spaceBelow >= spaceAbove;
  const maxHeight = Math.max(
    96,
    Math.min(PANEL_MAX_H, openDown ? spaceBelow : spaceAbove)
  );
  const top = openDown
    ? rect.bottom + PANEL_GAP
    : Math.max(8, rect.top - PANEL_GAP - maxHeight);
  const width = Math.max(rect.width, 200);
  let left = rect.left;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  return { top, left, width, maxHeight };
}

export default function VenuePlaceFields({
  city,
  timezone,
  onCityChange,
  onTimezoneChange,
  disabled = false,
  autoPrefillTimezone = true,
}: VenuePlaceFieldsProps) {
  const timezones = useMemo(() => listIanaTimezones(), []);
  const [tzFilter, setTzFilter] = useState('');
  const [tzOpen, setTzOpen] = useState(false);
  const [citySuggestions, setCitySuggestions] = useState<CitySuggestion[]>([]);
  const [cityOpen, setCityOpen] = useState(false);
  const [citySearching, setCitySearching] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [placeHint, setPlaceHint] = useState<string | null>(null);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [tzPos, setTzPos] = useState<PanelPos | null>(null);
  const [cityPos, setCityPos] = useState<PanelPos | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prefilledTz = useRef(false);
  const cityAnchorRef = useRef<HTMLInputElement | null>(null);
  const tzAnchorRef = useRef<HTMLButtonElement | null>(null);
  const tzFilterRef = useRef<HTMLInputElement | null>(null);
  const cityPanelRef = useRef<HTMLUListElement | null>(null);
  const tzPanelRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (!autoPrefillTimezone || prefilledTz.current) return;
    if (timezone.trim()) {
      prefilledTz.current = true;
      return;
    }
    const browserTz = detectBrowserTimezone();
    if (browserTz) {
      onTimezoneChange(browserTz);
      prefilledTz.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefills once on mount
  }, [autoPrefillTimezone]);

  useEffect(() => {
    const q = city.trim();
    if (q.length < 2 || disabled) {
      setCitySuggestions([]);
      setCitySearching(false);
      return;
    }

    const timer = window.setTimeout(() => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setCitySearching(true);
      void searchCities(q, ac.signal)
        .then((rows) => {
          if (!ac.signal.aborted) {
            setCitySuggestions(rows);
            setCityOpen(true);
            setTzOpen(false);
          }
        })
        .catch(() => {
          if (!ac.signal.aborted) setCitySuggestions([]);
        })
        .finally(() => {
          if (!ac.signal.aborted) setCitySearching(false);
        });
    }, 320);

    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [city, disabled]);

  const syncTzPos = () => {
    const anchor = tzAnchorRef.current;
    if (!anchor) return;
    setTzPos(positionPanelBelowOrAbove(anchor));
  };

  const syncCityPos = () => {
    const anchor = cityAnchorRef.current;
    if (!anchor) return;
    setCityPos(positionPanelBelowOrAbove(anchor));
  };

  useLayoutEffect(() => {
    if (!tzOpen) {
      setTzPos(null);
      return;
    }
    syncTzPos();
    const onReposition = () => syncTzPos();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [tzOpen, tzFilter, timezone]);

  useLayoutEffect(() => {
    if (!cityOpen || citySuggestions.length === 0) {
      setCityPos(null);
      return;
    }
    syncCityPos();
    const onReposition = () => syncCityPos();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [cityOpen, citySuggestions.length]);

  useEffect(() => {
    if (!tzOpen && !cityOpen) return;

    const onPointerDown = (e: MouseEvent) => {
      if (isScrollbarClick(e)) return;
      const target = e.target;
      if (!(target instanceof Node)) return;

      if (tzOpen) {
        const inAnchor =
          tzAnchorRef.current?.contains(target) ||
          tzFilterRef.current?.contains(target);
        const inPanel = tzPanelRef.current?.contains(target);
        if (!inAnchor && !inPanel) setTzOpen(false);
      }
      if (cityOpen) {
        const inAnchor = cityAnchorRef.current?.contains(target);
        const inPanel = cityPanelRef.current?.contains(target);
        if (!inAnchor && !inPanel) setCityOpen(false);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setTzOpen(false);
      setCityOpen(false);
    };

    // pointerdown captures scrollbar drag start better than click
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [tzOpen, cityOpen]);

  const filteredTimezones = useMemo(() => {
    const q = tzFilter.trim().toLowerCase();
    if (!q) {
      const preferred = timezone.trim();
      if (preferred && timezones.includes(preferred)) {
        return [
          preferred,
          ...timezones.filter((z) => z !== preferred).slice(0, 80),
        ];
      }
      return timezones.slice(0, 100);
    }
    return timezones.filter((z) => z.toLowerCase().includes(q)).slice(0, 120);
  }, [timezones, tzFilter, timezone]);

  async function onDetectLocation() {
    if (disabled || detecting) return;
    setDetecting(true);
    setPlaceError(null);
    setPlaceHint(null);
    try {
      const place = await detectVenuePlaceFromDevice();
      if (place.city) onCityChange(place.city);
      if (place.timezone) onTimezoneChange(place.timezone);
      const via =
        place.source === 'gps'
          ? 'device GPS'
          : 'your network (GPS permission was off or unavailable)';
      if (place.city) {
        setPlaceHint(
          `Detected ${place.label}${place.timezone ? ` · ${place.timezone}` : ''} via ${via}. Refine with city search if needed.`
        );
      } else {
        setPlaceHint(
          `Set timezone to ${place.timezone} via ${via}. Search a city below to finish.`
        );
      }
      setCityOpen(false);
      setTzOpen(false);
    } catch (err) {
      setPlaceError(
        err instanceof Error
          ? err.message
          : 'Could not detect location. Search for a city below.'
      );
    } finally {
      setDetecting(false);
    }
  }

  async function pickCity(suggestion: CitySuggestion) {
    onCityChange(suggestion.city);
    setCityOpen(false);
    setPlaceHint(suggestion.label);
    setPlaceError(null);
    try {
      const tz = await timezoneForCitySuggestion(suggestion);
      if (tz) onTimezoneChange(tz);
    } catch {
      /* keep existing timezone */
    }
  }

  const cityPortal =
    cityOpen &&
    citySuggestions.length > 0 &&
    cityPos &&
    typeof document !== 'undefined'
      ? createPortal(
          <ul
            ref={cityPanelRef}
            role="listbox"
            data-venue-place-panel="city"
            className="fixed z-[80] overflow-y-auto overscroll-contain rounded-md border border-stone-200 bg-white py-1 shadow-lg"
            style={{
              top: cityPos.top,
              left: cityPos.left,
              width: cityPos.width,
              maxHeight: cityPos.maxHeight,
            }}
            onWheel={(e) => e.stopPropagation()}
          >
            {citySuggestions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  role="option"
                  className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-stone-50"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void pickCity(s)}
                >
                  <span className="font-medium text-stone-900">{s.city}</span>
                  {s.detail ? (
                    <span className="break-words text-xs text-stone-500">
                      {s.detail}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>,
          document.body
        )
      : null;

  const tzPortal =
    tzOpen && tzPos && typeof document !== 'undefined'
      ? createPortal(
          <ul
            ref={tzPanelRef}
            id="venue-timezone-list"
            role="listbox"
            aria-label="Timezones"
            data-venue-place-panel="timezone"
            className="fixed z-[80] overflow-y-auto overscroll-contain rounded-md border border-stone-200 bg-white py-1 shadow-lg"
            style={{
              top: tzPos.top,
              left: tzPos.left,
              width: tzPos.width,
              maxHeight: tzPos.maxHeight,
            }}
            onWheel={(e) => e.stopPropagation()}
          >
            {filteredTimezones.length === 0 ? (
              <li className="px-3 py-2 text-sm text-stone-500">
                No timezones match that filter.
              </li>
            ) : (
              filteredTimezones.map((z) => {
                const selected = z === timezone;
                return (
                  <li key={z}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`flex w-full px-3 py-2 text-left text-sm hover:bg-stone-50 ${
                        selected
                          ? 'bg-[#D4AF37]/15 font-medium text-stone-900'
                          : 'text-stone-800'
                      }`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onTimezoneChange(z);
                        setTzOpen(false);
                        setTzFilter('');
                      }}
                    >
                      {z}
                    </button>
                  </li>
                );
              })
            )}
          </ul>,
          document.body
        )
      : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <p className="text-xs text-stone-500">
          City & timezone — search, or detect (GPS if allowed, otherwise your
          network).
        </p>
        <button
          type="button"
          onClick={() => void onDetectLocation()}
          disabled={disabled || detecting}
          className="inline-flex w-full shrink-0 items-center justify-center gap-1.5 rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-60 sm:w-auto"
        >
          {detecting ? (
            <ButtonSpinner className="!ml-0 !mr-0 h-3.5 w-3.5" />
          ) : null}
          {detecting ? 'Detecting…' : 'Use my location'}
        </button>
      </div>

      <div className="relative">
        <input
          ref={cityAnchorRef}
          type="text"
          value={city}
          onChange={(e) => {
            onCityChange(e.target.value);
            setPlaceHint(null);
            setPlaceError(null);
            setTzOpen(false);
          }}
          onFocus={() => {
            if (citySuggestions.length) {
              setCityOpen(true);
              setTzOpen(false);
            }
          }}
          placeholder="City (search or detect)"
          disabled={disabled}
          autoComplete="off"
          className={fieldClass}
          aria-autocomplete="list"
          aria-expanded={cityOpen}
        />
        {citySearching ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-stone-400">
            Searching…
          </span>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <input
          ref={tzFilterRef}
          type="search"
          value={tzFilter}
          onChange={(e) => {
            setTzFilter(e.target.value);
            setTzOpen(true);
            setCityOpen(false);
          }}
          onFocus={() => {
            setTzOpen(true);
            setCityOpen(false);
          }}
          placeholder="Filter timezones…"
          disabled={disabled}
          className={fieldClass}
          aria-expanded={tzOpen}
          aria-controls="venue-timezone-list"
        />
        <button
          ref={tzAnchorRef}
          type="button"
          disabled={disabled}
          onClick={() => {
            setTzOpen((o) => !o);
            setCityOpen(false);
          }}
          className={`${fieldClass} flex items-center justify-between gap-2 text-left`}
          aria-haspopup="listbox"
          aria-expanded={tzOpen}
        >
          <span className={timezone ? 'text-stone-900' : 'text-stone-400'}>
            {timezone || 'Select timezone'}
          </span>
          <svg
            className={`h-4 w-4 shrink-0 text-stone-400 transition-transform ${tzOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
        {timezone ? (
          <p className="text-[11px] text-stone-500">Selected: {timezone}</p>
        ) : null}
      </div>

      {placeHint ? <p className="text-xs text-stone-600">{placeHint}</p> : null}
      {placeError ? <p className="text-xs text-red-700">{placeError}</p> : null}

      {cityPortal}
      {tzPortal}
    </div>
  );
}
