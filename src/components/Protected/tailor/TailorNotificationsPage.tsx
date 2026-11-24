'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Bell,
  Check,
  CheckCheck,
  Loader2,
  Megaphone,
  Search,
  Trash2,
} from 'lucide-react';
import {
  useDeleteNotificationMutation,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
  useNotificationsQuery,
} from '@/hooks/useNotifications';
import type { AppNotification } from '@/services/notifications';

type FilterId = 'all' | 'unread' | 'campaign' | 'tailoring';

function notificationHref(n: AppNotification): string | null {
  const meta = n.metadata ?? {};
  if (n.type === 'campaign' || typeof meta.campaignId === 'string') {
    const campaignId =
      typeof meta.campaignId === 'string' ? meta.campaignId : null;
    return campaignId
      ? `/tailor/campaigns?campaign=${encodeURIComponent(campaignId)}`
      : '/tailor/campaigns';
  }
  if (n.type === 'tailoring' || typeof meta.jobId === 'string') {
    const jobId = typeof meta.jobId === 'string' ? meta.jobId : null;
    return jobId ? `/tailor/jobs/${jobId}` : '/tailor/jobs';
  }
  return null;
}

function matchesFilter(n: AppNotification, filter: FilterId): boolean {
  if (filter === 'all') return true;
  if (filter === 'unread') return !n.read;
  if (filter === 'campaign') {
    return n.type === 'campaign' || Boolean(n.metadata?.campaignId);
  }
  return n.type === 'tailoring' || Boolean(n.metadata?.jobId);
}

function formatWhen(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function TailorNotificationsPage() {
  const { data: notifications = [], isLoading, isFetching } =
    useNotificationsQuery();
  const markRead = useMarkNotificationReadMutation();
  const markAll = useMarkAllNotificationsReadMutation();
  const deleteNote = useDeleteNotificationMutation();
  const [filter, setFilter] = useState<FilterId>('all');
  const [q, setQ] = useState('');

  const unread = notifications.filter((n) => !n.read).length;

  const filtered = useMemo(() => {
    let list = notifications.filter((n) => matchesFilter(n, filter));
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter(
        (n) =>
          n.title.toLowerCase().includes(needle) ||
          n.message.toLowerCase().includes(needle)
      );
    }
    return list;
  }, [notifications, filter, q]);

  const openNotification = (n: AppNotification) => {
    if (!n.read) void markRead.mutateAsync(n._id);
  };

  return (
    <div className="space-y-5 pb-24 md:pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-stone-900">Notifications</h2>
          <p className="mt-1 text-sm text-stone-600">{unread} unread</p>
        </div>
        {isFetching && !isLoading ? (
          <Loader2 size={16} className="animate-spin text-stone-400" />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-[#FFF8E7]/50 px-4 py-3">
        <div className="flex min-w-0 items-start gap-2">
          <Megaphone size={18} className="mt-0.5 shrink-0 text-[#B8960C]" />
          <div>
            <p className="text-sm font-medium text-stone-900">
              Send measurement reminders
            </p>
            <p className="text-xs text-stone-600">
              Open a campaign and use Send reminders for pending participants.
            </p>
          </div>
        </div>
        <Link
          href="/tailor/campaigns"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-stone-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-stone-800"
        >
          Open campaigns
        </Link>
      </div>

      <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            disabled={unread === 0 || markAll.isPending}
            onClick={() => void markAll.mutateAsync()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 px-3 py-1.5 text-sm disabled:opacity-40"
          >
            {markAll.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <CheckCheck size={14} />
            )}
            Mark all read
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="relative sm:col-span-2 block">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search"
              className="w-full rounded-xl border border-stone-200 py-2.5 pl-9 pr-3 text-sm"
            />
          </label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterId)}
            className="rounded-xl border border-stone-200 px-3 py-2.5 text-sm"
            aria-label="Filter notifications"
          >
            <option value="all">All</option>
            <option value="unread">Unread</option>
            <option value="campaign">Campaigns</option>
            <option value="tailoring">Jobs</option>
          </select>
        </div>
      </section>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="animate-spin text-stone-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-12 text-center">
          <Bell className="mx-auto text-stone-300" size={32} />
          <p className="mt-3 font-medium text-stone-800">No notifications</p>
          <p className="mt-1 text-sm text-stone-500">
            {notifications.length === 0
              ? 'When participants submit measurements or job status changes, alerts appear here.'
              : 'Try a different filter or search term.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((n) => {
            const href = notificationHref(n);
            const body = (
              <>
                <div className="flex items-center gap-2">
                  {!n.read ? (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full bg-orange-500"
                      aria-hidden
                    />
                  ) : null}
                  <h3 className="font-semibold text-stone-900">{n.title}</h3>
                </div>
                <p className="mt-1 text-sm text-stone-600">{n.message}</p>
                <p className="mt-2 text-xs text-stone-400">
                  {formatWhen(n.createdAt)}
                </p>
              </>
            );
            return (
              <li
                key={n._id}
                className={`rounded-2xl border p-4 ${
                  n.read
                    ? 'border-stone-200 bg-white'
                    : 'border-orange-100 bg-orange-50/30'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  {href ? (
                    <Link
                      href={href}
                      onClick={() => openNotification(n)}
                      className="min-w-0 flex-1 hover:opacity-90"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="min-w-0 flex-1">{body}</div>
                  )}
                  <div className="flex shrink-0 gap-1">
                    {!n.read ? (
                      <button
                        type="button"
                        title="Mark read"
                        onClick={() => void markRead.mutateAsync(n._id)}
                        className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"
                      >
                        <Check size={15} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      title="Delete"
                      onClick={() => void deleteNote.mutateAsync(n._id)}
                      className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100 hover:text-red-600"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
