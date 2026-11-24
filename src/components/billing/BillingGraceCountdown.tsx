'use client';

import { useEffect, useState } from 'react';

function pad(n: number) {
  return String(Math.max(0, n)).padStart(2, '0');
}

function partsFromMs(ms: number) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return { days, hours, minutes, seconds };
}

/**
 * Live countdown until billing grace ends (then Demo demotion).
 */
export default function BillingGraceCountdown({
  graceEndsAt,
  className,
}: {
  graceEndsAt: string | Date | null | undefined;
  className?: string;
}) {
  const endMs =
    graceEndsAt == null
      ? null
      : graceEndsAt instanceof Date
        ? graceEndsAt.getTime()
        : new Date(graceEndsAt).getTime();

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (endMs == null || Number.isNaN(endMs)) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [endMs]);

  if (endMs == null || Number.isNaN(endMs)) return null;

  const remaining = endMs - now;
  if (remaining <= 0) {
    return (
      <p className={className ?? 'text-sm font-medium text-amber-900'}>
        Grace period ended — renew now or your workspace moves to Demo (records
        kept).
      </p>
    );
  }

  const { days, hours, minutes, seconds } = partsFromMs(remaining);

  return (
    <div className={className}>
      <p className="text-xs font-medium uppercase tracking-wide text-amber-800/80">
        Renewal grace — countdown
      </p>
      <p
        className="mt-1 font-mono text-2xl font-semibold tabular-nums text-amber-950"
        aria-live="polite"
      >
        {days > 0 ? `${days}d ` : ''}
        {pad(hours)}:{pad(minutes)}:{pad(seconds)}
      </p>
      <p className="mt-1 text-xs text-amber-900/90">
        Renew before this timer ends to keep full access. Afterward the workspace
        moves to Demo — your records stay intact.
      </p>
    </div>
  );
}
