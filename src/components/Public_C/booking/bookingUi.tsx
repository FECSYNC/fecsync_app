'use client';

import { useEffect, useState } from 'react';
import { formatClockDateTime } from '@/lib/timeClock';

export const gold = '#D4AF37';

export function formatMoney(n: number, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export function formatWhen(
  iso: string | null | undefined,
  tz?: string | null,
  timeFormat?: string | null
) {
  return formatClockDateTime(iso, timeFormat, tz);
}

export const bookBtn =
  'inline-flex items-center justify-center rounded-md bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-stone-950 hover:bg-[#c4a030] disabled:opacity-50';
export const bookBtnGhost =
  'inline-flex items-center justify-center rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50';
export const bookField =
  'w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-[#D4AF37] focus:outline-none focus:ring-1 focus:ring-[#D4AF37]';

export function HoldCountdown({
  expiresAt,
  restartHref,
  onExpired,
}: {
  expiresAt: string;
  restartHref?: string;
  onExpired?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [fired, setFired] = useState(false);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const end = new Date(expiresAt).getTime();
  const left = Math.max(0, end - now);
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  useEffect(() => {
    if (left <= 0 && !fired) {
      setFired(true);
      onExpired?.();
    }
  }, [left, fired, onExpired]);
  if (left <= 0) {
    return (
      <p className="text-sm text-red-700">
        Hold expired —{' '}
        {restartHref ? (
          <a href={restartHref} className="font-semibold underline">
            start again
          </a>
        ) : (
          'start again'
        )}{' '}
        to keep your seats.
      </p>
    );
  }
  return (
    <p className="text-sm text-stone-700">
      Seats held for <span className="font-semibold text-[#D4AF37]">{m}:{String(s).padStart(2, '0')}</span>
    </p>
  );
}

export function TicketCard({
  code,
  status,
  qrPayload,
}: {
  code: string;
  status: string;
  qrPayload?: string;
}) {
  const data = encodeURIComponent(qrPayload || code);
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 print:border-stone-400">
      <p className="text-xs uppercase tracking-wide text-[#D4AF37]">Ticket</p>
      <p className="mt-1 font-mono text-lg font-semibold text-stone-900">{code}</p>
      <p className="text-xs text-stone-500">{status}</p>
      <img
        alt={`QR ${code}`}
        className="mt-3 h-32 w-32 bg-white"
        src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${data}`}
      />
    </div>
  );
}
