'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

export function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function agoLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)}h ago`;
}

/** "● Live · Updated 12s ago · Refresh" — shared by party list / catalog screens. */
export default function PartiesLiveStatus({
  fetching,
  updatedAt,
  failed,
  onRefresh,
}: {
  fetching: boolean;
  updatedAt: number;
  failed: boolean;
  onRefresh: () => void;
}) {
  const now = useNow(5_000);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-stone-600">
      <span className="inline-flex items-center gap-1.5 font-medium">
        <span className="relative flex h-2.5 w-2.5">
          {!failed ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /> : null}
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${failed ? 'bg-amber-500' : 'bg-emerald-500'}`} />
        </span>
        {failed ? 'Connection issue' : 'Live'}
      </span>
      <span className="text-stone-400">·</span>
      <span>{fetching ? 'Refreshing…' : updatedAt ? `Updated ${agoLabel(now - updatedAt)}` : 'Loading…'}</span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={fetching}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-stone-500 transition hover:bg-stone-100 hover:text-stone-800 disabled:opacity-60"
        aria-label="Refresh"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${fetching ? 'animate-spin' : ''}`} />
        Refresh
      </button>
    </div>
  );
}
