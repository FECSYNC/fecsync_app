'use client';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { useToast } from '@/contexts/toast-context';
import {
  listAdminVenueLocations,
  venueLocationKeys,
} from '@/services/venueLocations';
import { useHqLocationFilter } from '@/hooks/useHqLocationFilter';
import { useAdminBookings } from '@/hooks/useBookings';
import {
  adminBookingKeys,
  assignAdminBookingStaff,
  cancelAdminBooking,
  confirmAdminBooking,
  createAdminBookingPaymentLink,
  getAdminBookingTickets,
  overbookAdminBooking,
  reactivateAdminBooking,
  reviewAdminBooking,
  type AdminBookingDto,
} from '@/services/adminBookings';
import { createAdminBookingInvoice } from '@/services/adminBookingInvoices';
import { listOrgMembers } from '@/services/members';
import {
  BOOKING_CHANNEL_OPTIONS,
  btnPrimaryClass,
  btnSecondaryClass,
  fieldClass,
  formatBookingChannel,
  formatMoney,
} from '../ticketing/ticketingUi';
import TakePaymentModal from './TakePaymentModal';
import CreateBookingModal from './CreateBookingModal';
import BookingsCalendarModal from './BookingsCalendarModal';
import { invalidateAfterBookingMutation } from '@/utils/invalidateTicketingQueries';
import { ADMIN_LIST_STALE_MS, adminListQueryDefaults } from '@/lib/adminListCache';
import AdminHowToGuideModal, {
  AdminHowToGuideButton,
  BOOKINGS_LIST_GUIDE_STEPS,
} from '@/components/Protected/admin/components/AdminHowToGuideModal';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';
import { warmAdminInstantPage } from '@/lib/adminInstantNav';
import { formatClockDateTime } from '@/lib/timeClock';
import { useTimeClockFormat } from '@/hooks/useTimeClock';

/** Dispatched by AdminLayout Alt+Shift+N when already on the Bookings list. */
export const OPEN_CREATE_BOOKING_EVENT = 'admin:open-create-booking';

const STATUSES = [
  'draft',
  'hold',
  'reserved',
  'pending_payment',
  'confirmed',
  'cancelled',
  'expired',
  'refunded',
] as const;

const PAGE = 50;
const ACTIONS_MENU_WIDTH = 200;

type ActionsMenuPos = { top: number; left: number };

function visitLabel(b: AdminBookingDto, timeFormat?: string | null) {
  if (!b.visitStartsAt) return '—';
  return formatClockDateTime(b.visitStartsAt, timeFormat);
}

function qtyOf(b: AdminBookingDto) {
  return b.lines.reduce((n, l) => n + (l.qty || 0), 0);
}

function productsOf(b: AdminBookingDto) {
  const names = b.lines.map((l) => l.productName).filter(Boolean);
  if (!names.length) return '—';
  return names.length > 2
    ? `${names.slice(0, 2).join(', ')} +${names.length - 2}`
    : names.join(', ');
}

function statusChip(b: AdminBookingDto) {
  const due = b.amountDue > 0 ? ` · $${b.amountDue.toFixed(2)} DUE` : '';
  return `${b.status.replace('_', ' ')}${due}`;
}

function canCancelStatus(status: string) {
  return !['cancelled', 'refunded', 'expired'].includes(status);
}

function canReactivateStatus(status: string) {
  return status === 'cancelled';
}

function canConfirmStatus(status: string) {
  return ['draft', 'hold', 'reserved', 'pending_payment'].includes(status);
}

export default function BookingsListShellPage() {
  const router = useRouter();
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const canWrite = can(P.BookingsWrite);
  const canCreateBooking =
    can(P.BookingsCreate) || can(P.BookingsWrite);
  const canExport = can(P.BookingsExport);
  const canPay = can(P.BookingsPaymentsTake);
  const canOverbook = can(P.BookingsOverbook);
  const canAssign = can(P.BookingsAssign);
  const canReadUsers = can(P.UsersRead);
  const canFilterStaff = can(P.BookingsRead);
  const canInvoice = can(P.BookingInvoicesManage);
  const { addToast } = useToast();
  const qc = useQueryClient();
  const searchParams = useSearchParams();

  const sessionId = searchParams.get('sessionId') ?? '';
  const accountId = searchParams.get('accountId') ?? '';
  const visitFromParam = searchParams.get('visitFrom') ?? '';
  const visitToParam = searchParams.get('visitTo') ?? '';

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState('');
  const [visitFrom, setVisitFrom] = useState(visitFromParam);
  const [visitTo, setVisitTo] = useState(visitToParam);
  const {
    locationId,
    setLocationId,
    scopedLocationId,
  } = useHqLocationFilter();
  const [staffId, setStaffId] = useState('');
  const [amountDueOnly, setAmountDueOnly] = useState(false);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [skip, setSkip] = useState(0);
  const [payBooking, setPayBooking] = useState<AdminBookingDto | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [actionsMenuId, setActionsMenuId] = useState<string | null>(null);
  const [actionsMenuPos, setActionsMenuPos] = useState<ActionsMenuPos | null>(
    null
  );
  const [assignPickerId, setAssignPickerId] = useState<string | null>(null);
  const actionsTriggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Warm dedicated /admin/bookings/new route (sidebar / deep links).
  // Modal uses a static import — no separate chunk wait on Create click.
  useEffect(() => {
    if (!canCreateBooking) return;
    try {
      void router.prefetch('/admin/bookings/new');
    } catch {
      /* prefetch optional */
    }
    warmAdminInstantPage('/admin/bookings/new');
    void import('@/lib/prefetchAdminRoute').then((mod) => {
      mod.prefetchAdminRoute(qc, '/admin/bookings/new', can, user);
    });
  }, [canCreateBooking, router, qc, can, user]);

  useEffect(() => {
    if (!canCreateBooking) return;
    const open = () => setCreateOpen(true);
    window.addEventListener(OPEN_CREATE_BOOKING_EVENT, open);
    return () => window.removeEventListener(OPEN_CREATE_BOOKING_EVENT, open);
  }, [canCreateBooking]);

  const filters = useMemo(
    () => ({
      q: q.trim() || undefined,
      status: status || undefined,
      channel: channel || undefined,
      visitFrom: visitFrom || undefined,
      visitTo: visitTo || undefined,
      locationId: locationId || undefined,
      staffId: staffId || undefined,
      amountDueOnly: amountDueOnly || undefined,
      includeClosed: includeClosed || undefined,
      sessionId: sessionId || undefined,
      accountId: accountId || undefined,
      skip,
      take: PAGE,
    }),
    [
      q,
      status,
      channel,
      visitFrom,
      visitTo,
      locationId,
      staffId,
      amountDueOnly,
      includeClosed,
      sessionId,
      accountId,
      skip,
    ]
  );

  const venuesKey = venueLocationKeys.list('all');
  const venuesQuery = useQuery({
    queryKey: venuesKey,
    queryFn: () => listAdminVenueLocations({ scope: 'all' }),
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(venuesKey),
    placeholderData: (previous) => previous,
  });
  const membersKey = ['admin', 'members', 'active'] as const;
  const membersQuery = useQuery({
    queryKey: membersKey,
    queryFn: () => listOrgMembers({ status: 'active' }),
    enabled: canAssign || canReadUsers,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(membersKey),
    placeholderData: (previous) => previous,
  });
  useEffect(() => {
    setSkip(0);
  }, [scopedLocationId]);

  const { timeFormat } = useTimeClockFormat(locationId || null);

  const listQuery = useAdminBookings(filters);

  const bookings = listQuery.data?.bookings ?? [];
  const total = listQuery.data?.total ?? 0;
  const staffFilterOptions = useMemo(() => {
    const map = new Map<string, { userId: string; label: string }>();
    for (const m of membersQuery.data?.members ?? []) {
      const label =
        [m.user?.firstName, m.user?.lastName].filter(Boolean).join(' ') ||
        m.user?.email ||
        m.userId;
      map.set(m.userId, { userId: m.userId, label });
    }
    for (const b of bookings) {
      if (b.assignedStaff?.id && !map.has(b.assignedStaff.id)) {
        map.set(b.assignedStaff.id, {
          userId: b.assignedStaff.id,
          label:
            b.assignedStaff.name ||
            b.assignedStaff.email ||
            b.assignedStaff.id,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [membersQuery.data?.members, bookings]);
  const venues = (venuesQuery.data ?? []).filter((v) => {
    if (v.status === 'archived') return false;
    if (scopedLocationId) return v.id === scopedLocationId;
    return true;
  });

  const actionsBooking =
    bookings.find((b) => b.id === actionsMenuId) ?? null;
  const actionsPast = Boolean(
    actionsBooking?.visitStartsAt &&
      new Date(actionsBooking.visitStartsAt).getTime() < Date.now()
  );

  useLayoutEffect(() => {
    if (!actionsMenuId) {
      setActionsMenuPos(null);
      return;
    }

    const syncPosition = () => {
      const trigger = actionsTriggerRefs.current.get(actionsMenuId);
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const menuEl = document.querySelector(
        '[data-booking-actions-menu]'
      ) as HTMLElement | null;
      const menuHeight = menuEl?.offsetHeight || 0;
      const menuWidth = menuEl?.offsetWidth || ACTIONS_MENU_WIDTH;
      const gap = 4;

      let top = rect.bottom + gap;
      if (
        menuHeight > 0 &&
        top + menuHeight > window.innerHeight - 8 &&
        rect.top - menuHeight - gap >= 8
      ) {
        top = rect.top - menuHeight - gap;
      }

      let left = rect.right - menuWidth;
      left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));

      setActionsMenuPos((prev) => {
        if (prev && prev.top === top && prev.left === left) return prev;
        return { top, left };
      });
    };

    syncPosition();
    const raf = window.requestAnimationFrame(() => syncPosition());
    const onScrollOrResize = () => syncPosition();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [actionsMenuId, assignPickerId]);

  useEffect(() => {
    if (!actionsMenuId) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(`[data-booking-actions="${actionsMenuId}"]`)) return;
      if (target?.closest('[data-booking-actions-menu]')) return;
      setActionsMenuId(null);
      setAssignPickerId(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActionsMenuId(null);
        setAssignPickerId(null);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [actionsMenuId]);

  const actionMut = useMutation({
    mutationFn: async (opts: {
      id: string;
      kind: string;
      staffUserId?: string;
    }) => {
      if (opts.kind === 'cancel') return cancelAdminBooking(opts.id);
      if (opts.kind === 'reactivate') return reactivateAdminBooking(opts.id);
      if (opts.kind === 'review') return reviewAdminBooking(opts.id);
      if (opts.kind === 'confirm') return confirmAdminBooking(opts.id, true);
      if (opts.kind === 'overbook') return overbookAdminBooking(opts.id);
      if (opts.kind === 'assign' && opts.staffUserId) {
        return assignAdminBookingStaff(opts.id, opts.staffUserId);
      }
      return null;
    },
    onMutate: async (opts) => {
      if (opts.kind !== 'cancel' || includeClosed || status) return;
      await qc.cancelQueries({ queryKey: adminBookingKeys.all });
      // Optimistic remove so the row leaves the table immediately.
      qc.setQueriesData<{
        bookings: AdminBookingDto[];
        total: number;
        take: number;
        skip: number;
      }>({ queryKey: adminBookingKeys.all }, (old) => {
        if (!old?.bookings) return old;
        const next = old.bookings.filter((b) => b.id !== opts.id);
        if (next.length === old.bookings.length) return old;
        return {
          ...old,
          bookings: next,
          total: Math.max(0, (old.total ?? next.length) - 1),
        };
      });
      setActionsMenuId(null);
      addToast('Deleting booking…', 'info');
    },
    onSuccess: (_data, opts) => {
      invalidateAfterBookingMutation(qc);
      addToast(
        opts.kind === 'cancel'
          ? 'Booking deleted — removed from list'
          : 'Updated',
        'success'
      );
      setActionsMenuId(null);
      setAssignPickerId(null);
    },
    onError: (err: Error) => {
      invalidateAfterBookingMutation(qc);
      addToast(err.message || 'Action failed', 'error');
    },
  });

  function closeActions() {
    setActionsMenuId(null);
    setAssignPickerId(null);
  }

  async function downloadTickets(id: string) {
    try {
      const tickets = await getAdminBookingTickets(id);
      const w = window.open('', '_blank');
      if (!w) {
        addToast('Pop-up blocked — allow pop-ups to download tickets', 'error');
        return;
      }
      w.document.write(
        `<pre>${tickets
          .map((t) => `${t.code} ${t.status} ${t.customTicketId ?? ''}`)
          .join('\n')}</pre>`
      );
      w.document.close();
      w.print();
    } catch (ex) {
      addToast(
        ex instanceof Error ? ex.message : 'Could not load tickets',
        'error'
      );
    }
  }

  async function sendPaymentLink(b: AdminBookingDto) {
    try {
      const link = await createAdminBookingPaymentLink(b.id, {
        to: b.primaryContactEmail || undefined,
        sendVia: ['email'],
      });
      addToast(
        link.payUrl
          ? `Payment link sent · ${link.payUrl}`
          : 'Payment link created',
        'success'
      );
    } catch (ex) {
      addToast(
        ex instanceof Error ? ex.message : 'Payment link failed',
        'error'
      );
    }
  }

  async function createInvoice(b: AdminBookingDto) {
    try {
      const inv = await createAdminBookingInvoice(b.id);
      addToast(`Invoice ${inv.number} created`, 'success');
      router.push(`/admin/booking-invoices/${inv.id}`);
    } catch (ex) {
      addToast(ex instanceof Error ? ex.message : 'Invoice failed', 'error');
    }
  }

  const menuItemClass =
    'block w-full px-3 py-2 text-left text-xs text-stone-800 hover:bg-stone-50 disabled:opacity-50';
  const menuDangerClass =
    'block w-full px-3 py-2 text-left text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50';
  const colCount = 13;
  const busy = actionMut.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[#D4AF37]">
            Bookings
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-stone-900">
            Bookings
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            All visits in one list. New here? Open the guide for how Online vs
            staff bookings work.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
          {canCreateBooking ? (
            <button
              type="button"
              className={btnPrimaryClass}
              title="Create booking (Alt+Shift+N)"
              onClick={() => setCreateOpen(true)}
            >
              Create booking
            </button>
          ) : null}
          <button
            type="button"
            className={btnSecondaryClass}
            onClick={() => setCalendarOpen(true)}
          >
            Calendar
          </button>
          {canExport ? (
            <button
              type="button"
              className={btnSecondaryClass}
              onClick={() => {
                const sp = new URLSearchParams();
                if (filters.q) sp.set('q', filters.q);
                if (filters.status) sp.set('status', filters.status);
                if (filters.channel) sp.set('channel', filters.channel);
                if (filters.visitFrom) sp.set('visitFrom', filters.visitFrom);
                if (filters.visitTo) sp.set('visitTo', filters.visitTo);
                if (filters.locationId)
                  sp.set('locationId', filters.locationId);
                if (filters.staffId) sp.set('staffId', filters.staffId);
                if (filters.amountDueOnly) sp.set('amountDueOnly', 'true');
                window.location.href = `/api/admin/bookings/export?${sp}`;
              }}
            >
              Export CSV
            </button>
          ) : null}
        </div>
      </div>

      <AdminHowToGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Bookings"
        subtitle="Follow these steps in order — written for first-time admins."
        steps={BOOKINGS_LIST_GUIDE_STEPS}
      />

      <div className="flex flex-wrap gap-3 rounded-lg border border-stone-200 bg-white p-4">
        <input
          value={q}
          onChange={(e) => {
            setSkip(0);
            setQ(e.target.value);
          }}
          placeholder="Search name / email / phone / ID / Stripe…"
          className={`${fieldClass} min-w-[14rem] flex-1`}
        />
        <select
          className={`${fieldClass} w-auto`}
          value={status}
          onChange={(e) => {
            setSkip(0);
            setStatus(e.target.value);
          }}
        >
          <option value="">Status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className={`${fieldClass} w-auto`}
          value={channel}
          onChange={(e) => {
            setSkip(0);
            setChannel(e.target.value);
          }}
        >
          <option value="">Origin</option>
          {BOOKING_CHANNEL_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          type="date"
          className={`${fieldClass} w-auto`}
          value={visitFrom}
          onChange={(e) => {
            setSkip(0);
            setVisitFrom(e.target.value);
          }}
        />
        <input
          type="date"
          className={`${fieldClass} w-auto`}
          value={visitTo}
          onChange={(e) => {
            setSkip(0);
            setVisitTo(e.target.value);
          }}
        />
        <select
          className={`${fieldClass} w-auto`}
          value={locationId}
          onChange={(e) => {
            setSkip(0);
            setLocationId(e.target.value);
          }}
          disabled={Boolean(scopedLocationId)}
        >
          <option value="">Venue</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        {canFilterStaff ? (
          <select
            className={`${fieldClass} w-auto`}
            value={staffId}
            onChange={(e) => {
              setSkip(0);
              setStaffId(e.target.value);
            }}
          >
            <option value="">Staff</option>
            {staffFilterOptions.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.label}
              </option>
            ))}
          </select>
        ) : null}
        <label className="inline-flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={amountDueOnly}
            onChange={(e) => {
              setSkip(0);
              setAmountDueOnly(e.target.checked);
            }}
          />
          Amount due
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={includeClosed}
            onChange={(e) => {
              setSkip(0);
              setIncludeClosed(e.target.checked);
            }}
          />
          Show cancelled / expired
        </label>
      </div>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="w-12 whitespace-nowrap px-3 py-3 font-semibold">
                  #
                </th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">
                  Visit
                </th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">ID</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">
                  Guest
                </th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">
                  Contact
                </th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">
                  Venue
                </th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">
                  Products
                </th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">
                  Qty
                </th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">
                  Status
                </th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">
                  Origin
                </th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">
                  Staff
                </th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">
                  Total / Paid
                </th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {listQuery.isPending && bookings.length === 0 ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={colCount} className="px-4 py-4">
                      <div className="h-4 rounded bg-stone-100" />
                    </td>
                  </tr>
                ))
              ) : listQuery.isError ? (
                <tr>
                  <td
                    colSpan={colCount}
                    className="px-4 py-12 text-center text-red-600"
                  >
                    {(listQuery.error as Error)?.message ||
                      'Failed to load bookings'}
                  </td>
                </tr>
              ) : bookings.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-12 text-center">
                    <p className="text-sm font-medium text-stone-800">
                      No bookings
                    </p>
                    <p className="mt-1 text-sm text-stone-500">
                      Create a booking for walk-in, phone, or POS, or wait for
                      online checkout.
                    </p>
                    {canCreateBooking ? (
                      <button
                        type="button"
                        className={`${btnPrimaryClass} mt-4 inline-flex`}
                        title="Create booking (Alt+Shift+N)"
                        onClick={() => setCreateOpen(true)}
                      >
                        Create booking
                      </button>
                    ) : null}
                  </td>
                </tr>
              ) : (
                bookings.map((b, index) => (
                  <tr key={b.id} className="align-middle">
                    <td className="px-3 py-3 tabular-nums text-stone-500">
                      {skip + index + 1}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-stone-600">
                      {visitLabel(b, timeFormat)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-stone-900">
                      {b.publicId}
                      {b.partyDetail ? (
                        <Link
                          href={`/admin/parties/${b.id}`}
                          className="ml-2 inline-flex rounded-full bg-[#D4AF37]/15 px-2 py-0.5 text-[11px] font-semibold text-stone-900 ring-1 ring-[#D4AF37]/40 hover:bg-[#D4AF37]/25"
                          title={b.partyDetail.partyName ?? undefined}
                        >
                          Party{b.partyDetail.packageName ? ` · ${b.partyDetail.packageName}` : ''}
                        </Link>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-stone-800">
                      {b.primaryContactName ?? '—'}
                      {b.account?.name ? (
                        <span className="block text-xs text-stone-500">
                          {b.account.name}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {b.primaryContactEmail ?? '—'}
                      <span className="block text-xs">
                        {b.primaryContactPhone ?? ''}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {b.location?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {productsOf(b)}
                    </td>
                    <td className="px-4 py-3 text-stone-600">{qtyOf(b)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs">
                          {statusChip(b)}
                        </span>
                        {b.notes?.startsWith('SPECIAL_REQUEST') ? (
                          <span className="rounded-full bg-[#D4AF37]/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-900">
                            Special request
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {formatBookingChannel(b.channel)}
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {b.assignedStaff?.name ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-stone-800">
                      {formatMoney(b.total)} / {formatMoney(b.amountPaid)}
                    </td>
                    <td className="px-4 py-3">
                      <div
                        className="inline-block text-left"
                        data-booking-actions={b.id}
                      >
                        <button
                          type="button"
                          ref={(el) => {
                            if (el) actionsTriggerRefs.current.set(b.id, el);
                            else actionsTriggerRefs.current.delete(b.id);
                          }}
                          disabled={busy}
                          aria-haspopup="menu"
                          aria-expanded={actionsMenuId === b.id}
                          onClick={() => {
                            setAssignPickerId(null);
                            setActionsMenuId((id) =>
                              id === b.id ? null : b.id
                            );
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-50"
                        >
                          Actions
                          <svg
                            className={`h-3.5 w-3.5 text-stone-500 transition-transform ${
                              actionsMenuId === b.id ? 'rotate-180' : ''
                            }`}
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
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-stone-100 px-4 py-3 text-xs text-stone-500">
          <span>
            {listQuery.isPending && bookings.length === 0
              ? '…'
              : `${skip + 1}–${Math.min(skip + PAGE, total)} of ${total}`}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className={btnSecondaryClass}
              disabled={skip <= 0}
              onClick={() => setSkip(Math.max(0, skip - PAGE))}
            >
              Prev
            </button>
            <button
              type="button"
              className={btnSecondaryClass}
              disabled={skip + PAGE >= total}
              onClick={() => setSkip(skip + PAGE)}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {actionsBooking && actionsMenuPos && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="menu"
              data-booking-actions-menu
              style={{
                position: 'fixed',
                top: actionsMenuPos.top,
                left: actionsMenuPos.left,
                width: ACTIONS_MENU_WIDTH,
              }}
              className="z-[60] max-h-[min(70vh,28rem)] overflow-y-auto rounded-md border border-stone-200 bg-white py-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                className={menuItemClass}
                onClick={() => {
                  closeActions();
                  router.push(
                    actionsBooking.partyDetail
                      ? `/admin/parties/${actionsBooking.id}`
                      : `/admin/bookings/${actionsBooking.id}`
                  );
                }}
              >
                {actionsBooking.partyDetail ? 'Open party' : 'View'}
              </button>
              {canWrite && !actionsPast ? (
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass}
                  onClick={() => {
                    closeActions();
                    router.push(
                      actionsBooking.partyDetail
                        ? `/admin/parties/${actionsBooking.id}?edit=1`
                        : `/admin/bookings/${actionsBooking.id}/edit`
                    );
                  }}
                >
                  Edit
                </button>
              ) : null}
              {canWrite && canConfirmStatus(actionsBooking.status) ? (
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass}
                  disabled={busy}
                  onClick={() =>
                    actionMut.mutate({
                      id: actionsBooking.id,
                      kind: 'confirm',
                    })
                  }
                >
                  Confirm
                </button>
              ) : null}
              {canWrite ? (
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass}
                  disabled={busy}
                  onClick={() =>
                    actionMut.mutate({
                      id: actionsBooking.id,
                      kind: 'review',
                    })
                  }
                >
                  Review
                </button>
              ) : null}
              {canPay && actionsBooking.amountDue > 0 ? (
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass}
                  onClick={() => {
                    closeActions();
                    setPayBooking(actionsBooking);
                  }}
                >
                  Take payment
                </button>
              ) : null}
              {canPay && actionsBooking.amountDue > 0 ? (
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass}
                  onClick={() => {
                    closeActions();
                    void sendPaymentLink(actionsBooking);
                  }}
                >
                  Payment link
                </button>
              ) : null}
              {canInvoice ? (
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass}
                  onClick={() => {
                    closeActions();
                    void createInvoice(actionsBooking);
                  }}
                >
                  Invoice
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className={menuItemClass}
                onClick={() => {
                  closeActions();
                  void downloadTickets(actionsBooking.id);
                }}
              >
                Download tickets
              </button>
              {canAssign ? (
                assignPickerId === actionsBooking.id ? (
                  <div className="border-t border-stone-100 px-2 py-2">
                    <select
                      autoFocus
                      className={fieldClass}
                      defaultValue=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        actionMut.mutate({
                          id: actionsBooking.id,
                          kind: 'assign',
                          staffUserId: e.target.value,
                        });
                      }}
                    >
                      <option value="">Select staff…</option>
                      {(membersQuery.data?.members ?? []).map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {[m.user?.firstName, m.user?.lastName]
                            .filter(Boolean)
                            .join(' ') || m.user?.email}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    className={menuItemClass}
                    onClick={() => setAssignPickerId(actionsBooking.id)}
                  >
                    Assign staff
                  </button>
                )
              ) : null}
              {canOverbook ? (
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass}
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm('Overbook / hold anyway?')) return;
                    actionMut.mutate({
                      id: actionsBooking.id,
                      kind: 'overbook',
                    });
                  }}
                >
                  Overbook
                </button>
              ) : null}
              {canWrite && canReactivateStatus(actionsBooking.status) ? (
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass}
                  disabled={busy}
                  onClick={() =>
                    actionMut.mutate({
                      id: actionsBooking.id,
                      kind: 'reactivate',
                    })
                  }
                >
                  Reactivate
                </button>
              ) : null}
              {canWrite && canCancelStatus(actionsBooking.status) ? (
                <>
                  <div className="my-1 border-t border-stone-100" />
                  <button
                    type="button"
                    role="menuitem"
                    className={menuDangerClass}
                    disabled={busy}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Delete booking ${actionsBooking.publicId}? It will be cancelled and removed from this list. History is kept.`
                        )
                      ) {
                        return;
                      }
                      actionMut.mutate({
                        id: actionsBooking.id,
                        kind: 'cancel',
                      });
                    }}
                  >
                    {busy ? 'Deleting…' : 'Delete'}
                  </button>
                </>
              ) : null}
            </div>,
            document.body
          )
        : null}

      {payBooking ? (
        <TakePaymentModal
          booking={payBooking}
          onClose={() => setPayBooking(null)}
        />
      ) : null}

      <CreateBookingModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        preferLocationId={locationId || undefined}
        accountId={accountId || undefined}
      />

      <BookingsCalendarModal
        open={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        onCreateBooking={() => {
          setCalendarOpen(false);
          setCreateOpen(true);
        }}
        onSelectSession={(id) => {
          setCalendarOpen(false);
          const sp = new URLSearchParams(searchParams.toString());
          sp.set('sessionId', id);
          const qs = sp.toString();
          router.replace(qs ? `/admin/bookings?${qs}` : '/admin/bookings');
        }}
        onSelectBooking={(id) => {
          setCalendarOpen(false);
          router.push(`/admin/bookings/${id}`);
        }}
      />
    </div>
  );
}
