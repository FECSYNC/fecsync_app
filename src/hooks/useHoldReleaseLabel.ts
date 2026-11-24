'use client';

import { useEffect, useState } from 'react';

function formatHoldReleaseCountdown(
  iso: string | null | undefined,
  nowMs: number
): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const ms = t - nowMs;
  if (ms <= 0) return 'any moment (refresh)';
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Live countdown that re-renders every second while a hold release is pending. */
export function useHoldReleaseLabel(nextReleaseAt: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!nextReleaseAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [nextReleaseAt]);

  return formatHoldReleaseCountdown(nextReleaseAt, now);
}
