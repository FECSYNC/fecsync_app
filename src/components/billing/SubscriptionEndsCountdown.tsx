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
 * Live countdown until an active subscription period ends (renewal due).
 * Uses wall-clock ticks so the display stays accurate while the tab is open.
 */
export default function SubscriptionEndsCountdown({
  endsAt,
  planLabel,
  className,
}: {
  endsAt: string | Date | null | undefined;
  planLabel?: string | null;
  className?: string;
}) {
  const endMs =
    endsAt == null
      ? null
      : endsAt instanceof Date
        ? endsAt.getTime()
        : new Date(endsAt).getTime();

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (endMs == null || Number.isNaN(endMs)) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [endMs]);

  if (endMs == null || Number.isNaN(endMs)) return null;

  const remaining = endMs - now;
  const plan = (planLabel || 'package').trim() || 'package';

  if (remaining <= 0) {
    return (
      <div className={className}>
        <p className="text-xs font-medium uppercase tracking-wide text-amber-800/80">
          Subscription due
        </p>
        <p className="mt-1 text-sm font-medium text-amber-950">
          Your {plan} period has ended. Open Billing to renew, or contact
          customer care for help.
        </p>
      </div>
    );
  }

  const { days, hours, minutes, seconds } = partsFromMs(remaining);
  const dueDate = new Date(endMs).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div className={className}>
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
        Active {plan} — time remaining
      </p>
      <p
        className="mt-1 font-mono text-2xl font-semibold tabular-nums text-stone-900"
        aria-live="polite"
      >
        {days > 0 ? `${days}d ` : ''}
        {pad(hours)}:{pad(minutes)}:{pad(seconds)}
      </p>
      <p className="mt-1 text-xs text-stone-600">
        Expires {dueDate}. Renew before this timer ends to avoid interruption.
      </p>
    </div>
  );
}
