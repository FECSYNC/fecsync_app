'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import {
  useNotificationsQuery,
  useMarkNotificationReadMutation,
} from '@/hooks/useNotifications';
import type { AppNotification } from '@/services/notifications';

type UserTailoringAlertsProps = {
  /** Base path for job deep links (customer vs tailor workspace). */
  jobBasePath: '/profile/tailoring-jobs' | '/tailor/jobs';
};

function isTailoringAlert(note: AppNotification): boolean {
  if (note.type === 'tailoring') return true;
  const kind = note.metadata?.kind;
  return typeof kind === 'string' && kind.startsWith('tailoring');
}

function isCampaignAlert(note: AppNotification): boolean {
  if (note.type === 'campaign') return true;
  return typeof note.metadata?.campaignId === 'string';
}

/** Order / shipment updates (Phase 4 S8) — customer profile only. */
function isOrderAlert(note: AppNotification): boolean {
  return note.type === 'order';
}

function isProfileAlert(
  note: AppNotification,
  jobBasePath: UserTailoringAlertsProps['jobBasePath']
): boolean {
  if (jobBasePath === '/profile/tailoring-jobs') {
    return (
      isTailoringAlert(note) || isCampaignAlert(note) || isOrderAlert(note)
    );
  }
  return isTailoringAlert(note);
}

function jobHref(note: AppNotification, base: string): string | null {
  const jobId = note.metadata?.jobId;
  if (typeof jobId === 'string' && jobId.trim()) {
    return `${base}/${jobId.trim()}`;
  }
  return base === '/profile/tailoring-jobs'
    ? '/profile?tab=tailoring-jobs'
    : '/tailor/jobs';
}

/** Only allow same-origin profile deep links from notification metadata. */
function safeProfileHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const href = raw.trim();
  if (!href.startsWith('/profile')) return null;
  if (href.startsWith('//') || href.includes('://')) return null;
  return href;
}

function alertHref(
  note: AppNotification,
  jobBasePath: UserTailoringAlertsProps['jobBasePath']
): string | null {
  if (jobBasePath === '/profile/tailoring-jobs') {
    if (isOrderAlert(note)) {
      return safeProfileHref(note.metadata?.href) || '/profile?tab=orders';
    }
    if (isCampaignAlert(note)) {
      return '/profile?tab=campaigns';
    }
  }
  return jobHref(note, jobBasePath);
}

export default function UserTailoringAlerts({
  jobBasePath,
}: UserTailoringAlertsProps) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const { data: notes = [] } = useNotificationsQuery(true);
  const markRead = useMarkNotificationReadMutation();

  const visibleNotes = useMemo(
    () => notes.filter((n) => isProfileAlert(n, jobBasePath)).slice(0, 12),
    [notes, jobBasePath]
  );
  const unread = visibleNotes.filter((n) => !n.read).length;
  const headerLabel =
    jobBasePath === '/profile/tailoring-jobs'
      ? 'Updates'
      : 'Tailoring updates';
  const ariaLabel =
    jobBasePath === '/profile/tailoring-jobs' ? 'Account alerts' : 'Tailoring alerts';

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const onSelect = async (note: AppNotification) => {
    try {
      await markRead.mutateAsync(note._id);
    } catch {
      /* navigate anyway */
    }
    setOpen(false);
    const href = alertHref(note, jobBasePath);
    if (href) router.push(href);
  };

  if (visibleNotes.length === 0 && unread === 0) {
    return null;
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-stone-600 hover:bg-stone-100 hover:text-stone-900"
        aria-label={ariaLabel}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#D4AF37] px-1 text-[10px] font-bold text-black">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-stone-200 bg-white shadow-lg">
          <div className="border-b px-4 py-3">
            <p className="text-sm font-semibold text-stone-900">{headerLabel}</p>
          </div>
          {visibleNotes.length === 0 ? (
            <p className="px-4 py-3 text-sm text-stone-500">No alerts yet.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {visibleNotes.map((note) => (
                <li key={note._id}>
                  <button
                    type="button"
                    onClick={() => void onSelect(note)}
                    className={`w-full border-b border-stone-50 px-4 py-3 text-left hover:bg-stone-50 ${
                      note.read ? 'opacity-70' : 'bg-[#FFF8E7]/40'
                    }`}
                  >
                    <p className="text-sm font-medium text-stone-900">
                      {note.title}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-600 line-clamp-2">
                      {note.message}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
