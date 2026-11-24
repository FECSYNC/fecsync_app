'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { useToast } from '@/contexts/toast-context';
import {
  listAdminVenueLocations,
  venueLocationKeys,
} from '@/services/venueLocations';
import { useHqLocationFilter } from '@/hooks/useHqLocationFilter';
import {
  getTicketingAvailability,
  getTicketingProduct,
  getTicketingSettings,
  listTicketingProducts,
  ticketingKeys,
  type AdmissionProductType,
} from '@/services/ticketing';
import { listBookingAccounts, bookingAccountKeys } from '@/services/bookingAccounts';
import {
  confirmAdminBooking,
  createAdminBooking,
  reviewAdminBooking,
} from '@/services/adminBookings';
import {
  btnPrimaryClass,
  btnSecondaryClass,
  fieldClass,
  formatBookingChannel,
  formatMoney,
  formatProductType,
} from '../ticketing/ticketingUi';
import { invalidateAfterBookingMutation } from '@/utils/invalidateTicketingQueries';
import {
  dateKeyFromIso,
  monthRangeKeys,
  todayKeyInZone,
} from '@/components/common/BookingDateCalendar';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import { validateStaffBookingContact } from '@/lib/ticketing/staffBookingContact';
import CreateBookingTabs, {
  CREATE_BOOKING_TABS,
  type CreateBookingTabId,
} from './CreateBookingTabs';
import BookingHolderForm, {
  initialStaffChannel,
  type HolderType,
  type StaffChannel,
} from './BookingHolderForm';
import AvailabilitiesRail from './AvailabilitiesRail';
import AdminHowToGuideModal, {
  AdminHowToGuideButton,
  CREATE_BOOKING_GUIDE_STEPS,
} from '@/components/Protected/admin/components/AdminHowToGuideModal';

function WizardFetchLoader({ label }: { label: string }) {
  return (
    <div
      className="flex items-center gap-3 rounded-md border border-stone-200 bg-stone-50 px-4 py-6 text-sm text-stone-600"
      role="status"
      aria-live="polite"
    >
      <span
        className="inline-block h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-[#D4AF37] border-t-transparent"
        aria-hidden
      />
      <span>{label}</span>
    </div>
  );
}

/**
 * Staff "Create booking" = at-venue entry with domain tabs.
 * Online / guest-account channels are stamped by public /book checkout.
 * Optional ?channel=phone|pos|walk_in, ?locationId=, ?party=1, ?accountId=.
 *
 * Marketing opt-ins skipped: no Guest CRM marketing email/SMS fields in schema.
 *
 * `presentation="modal"` embeds on the Bookings list (no route change).
 */
export type NewBookingWizardProps = {
  presentation?: 'page' | 'modal';
  onClose?: () => void;
  onCreated?: (booking: { id: string; publicId: string }) => void;
  /** Modal shell uses this to block Esc / backdrop dismiss while submitting. */
  onBusyChange?: (busy: boolean) => void;
  preferLocationId?: string;
  preferAccountId?: string;
};

export default function NewBookingWizardPage({
  presentation = 'page',
  onClose,
  onCreated,
  onBusyChange,
  preferLocationId,
  preferAccountId,
}: NewBookingWizardProps) {
  const router = useRouter();
  const sp = useSearchParams();
  const can = useAuthStore((s) => s.can);
  const { addToast } = useToast();
  const qc = useQueryClient();
  const isModal = presentation === 'modal';
  const canOverbook = can(P.BookingsOverbook);
  const canTax = can(P.BookingsTaxExempt);
  const canCreateBooking =
    can(P.BookingsCreate) || can(P.BookingsWrite);
  /** Confirm after create hits POST …/confirm which requires bookings:write. */
  const canConfirmBooking = can(P.BookingsWrite);
  const canAccounts =
    can(P.BookingAccountsRead) || can(P.BookingAccountsWrite);
  const canCatalogWrite =
    can(P.TicketingProductsWrite) || can(P.TicketingManage);

  const urlLocationId = preferLocationId || sp.get('locationId') || '';
  const urlAccountId = preferAccountId || sp.get('accountId') || '';

  const {
    scopedLocationId,
    scopedLocationName,
    parkLocked,
  } = useHqLocationFilter(urlLocationId);

  const [staffChannel, setStaffChannel] = useState<StaffChannel>(() =>
    initialStaffChannel(isModal ? null : sp.get('channel'))
  );
  const [tab, setTab] = useState<CreateBookingTabId>('details');
  const [maxReachable, setMaxReachable] = useState(0);
  const [holderType, setHolderType] = useState<HolderType>(() =>
    urlAccountId ? 'company' : 'guest'
  );
  const [locationId, setLocationId] = useState(urlLocationId);
  const [productType, setProductType] = useState<AdmissionProductType | ''>(
    !isModal && sp.get('party') === '1' ? 'party_package' : ''
  );
  const [productId, setProductId] = useState('');
  const [date, setDate] = useState('');
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [sessionId, setSessionId] = useState('');
  const [qty, setQty] = useState(1);
  const [band, setBand] = useState('');
  const [addons, setAddons] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [accountId, setAccountId] = useState(() => urlAccountId);
  const [taxExempt, setTaxExempt] = useState(false);
  const [notes, setNotes] = useState('');
  const [posNotes, setPosNotes] = useState('');
  const [createMode, setCreateMode] = useState<'hold' | 'reserve' | 'confirm'>(
    'hold'
  );
  const [allowOverbook, setAllowOverbook] = useState(false);
  const [includeUnavailable, setIncludeUnavailable] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  /** Sync guard — React `busy` state alone cannot block double-clicks in one tick. */
  const submittingRef = useRef(false);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    if (createMode === 'confirm' && !canConfirmBooking) {
      setCreateMode('hold');
    }
  }, [canConfirmBooking, createMode]);

  useEffect(() => {
    if (scopedLocationId) setLocationId(scopedLocationId);
    else if (!parkLocked) setLocationId(urlLocationId);
  }, [scopedLocationId, parkLocked, urlLocationId]);

  // Deep-link company holder from booking-accounts (and similar).
  useEffect(() => {
    const fromUrl = urlAccountId.trim();
    if (!fromUrl || !canAccounts) return;
    setHolderType('company');
    setAccountId(fromUrl);
  }, [urlAccountId, canAccounts]);

  useEffect(() => {
    if (canAccounts) return;
    if (holderType === 'company') setHolderType('guest');
    if (accountId) setAccountId('');
  }, [canAccounts, holderType, accountId]);

  // Keep ?channel= in sync for instant-nav / refresh continuity (full page only).
  useEffect(() => {
    if (isModal || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('channel') === staffChannel) return;
    url.searchParams.set('channel', staffChannel);
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
  }, [staffChannel, isModal]);

  const venuesQ = useQuery({
    queryKey: venueLocationKeys.list('all'),
    queryFn: () => listAdminVenueLocations({ scope: 'all' }),
    ...adminListQueryDefaults,
  });
  const productsQ = useQuery({
    queryKey: ticketingKeys.products({ locationId, published: 'all' }),
    queryFn: () => listTicketingProducts({ locationId, published: 'all' }),
    enabled: Boolean(locationId),
    ...adminListQueryDefaults,
  });
  const productQ = useQuery({
    queryKey: ticketingKeys.product(productId),
    queryFn: () => getTicketingProduct(productId),
    enabled: Boolean(productId),
    ...adminListQueryDefaults,
  });

  const venues = (venuesQ.data ?? []).filter((v) => {
    if (v.status === 'archived') return false;
    if (scopedLocationId) return v.id === scopedLocationId;
    return true;
  });
  const venueTz =
    venues.find((v) => v.id === locationId)?.timezone ?? null;

  const monthRange = useMemo(
    () =>
      monthRangeKeys(calendarMonth.getFullYear(), calendarMonth.getMonth()),
    [calendarMonth]
  );

  const monthAvailQ = useQuery({
    queryKey: ticketingKeys.availability({
      productId,
      from: monthRange.from,
      to: monthRange.to,
      qty,
    }),
    queryFn: () =>
      getTicketingAvailability({
        productId,
        requestedQty: qty,
        from: monthRange.from,
        to: monthRange.to,
      }),
    enabled: Boolean(productId),
  });

  const availQ = useQuery({
    queryKey: ticketingKeys.availability({ productId, date, qty }),
    queryFn: () =>
      getTicketingAvailability({
        productId,
        requestedQty: qty,
        date,
      }),
    enabled: Boolean(productId && date),
    refetchInterval: 15_000,
  });
  const settingsQ = useQuery({
    queryKey: ticketingKeys.settings(locationId || null),
    queryFn: () => getTicketingSettings(locationId || undefined),
    enabled: Boolean(locationId),
    ...adminListQueryDefaults,
  });
  const accountsQ = useQuery({
    queryKey: bookingAccountKeys.list(),
    queryFn: listBookingAccounts,
    enabled: canAccounts,
    ...adminListQueryDefaults,
  });

  const products = (productsQ.data ?? []).filter(
    (p) =>
      p.type !== 'add_on' &&
      !p.archivedAt &&
      (!productType || p.type === productType)
  );
  const product = productQ.data;
  const linkedAddOns = useMemo(() => {
    const links = product?.addOnLinks ?? [];
    const byId = new Map(
      (productsQ.data ?? [])
        .filter((p) => p.type === 'add_on' && !p.archivedAt)
        .map((p) => [p.id, p] as const)
    );
    return links.map((l) => {
      const catalog = byId.get(l.addOnProductId);
      return {
        id: l.addOnProductId,
        name: l.addOnProduct?.name ?? catalog?.name ?? l.addOnProductId,
        required: l.required,
        maxQty: l.maxQty,
        priceFrom: catalog?.priceFrom ?? null,
      };
    });
  }, [product?.addOnLinks, productsQ.data]);
  const sessions = availQ.data ?? [];
  const needsSlot = [
    'timed_session',
    'party_package',
    'group',
    'camp_event',
  ].includes(product?.type ?? '');

  const availableDays = useMemo(() => {
    const set = new Set<string>();
    for (const s of monthAvailQ.data ?? []) {
      const key = dateKeyFromIso(s.startsAt, venueTz);
      if (key) set.add(key);
    }
    return set;
  }, [monthAvailQ.data, venueTz]);

  useEffect(() => {
    if (!productId || !needsSlot) return;
    if (monthAvailQ.isLoading) return;
    if (date && availableDays.has(date)) return;
    const today = todayKeyInZone(venueTz);
    if (availableDays.has(today)) {
      setDate(today);
      return;
    }
    const next = [...availableDays].filter((d) => d >= today).sort()[0];
    if (next) setDate(next);
  }, [
    productId,
    needsSlot,
    monthAvailQ.isLoading,
    availableDays,
    date,
    venueTz,
  ]);

  useEffect(() => {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const [y, m] = date.split('-').map(Number);
    if (!y || !m) return;
    setCalendarMonth((prev) => {
      if (prev.getFullYear() === y && prev.getMonth() === m - 1) return prev;
      return new Date(y, m - 1, 1);
    });
  }, [date]);

  useEffect(() => {
    if (!productId || needsSlot) return;
    if (date) return;
    setDate(todayKeyInZone(venueTz));
  }, [productId, needsSlot, date, venueTz]);

  useEffect(() => {
    const prices = product?.prices ?? [];
    if (!prices.length) {
      if (band) setBand('');
      return;
    }
    if (band && prices.some((p) => p.code === band)) return;
    const preferred =
      prices.find((p) => p.code.trim().toLowerCase() === 'adult') ?? prices[0];
    setBand(preferred.code);
  }, [product?.id, product?.prices, band]);

  useEffect(() => {
    setAddons((prev) => {
      const next: Record<string, number> = {};
      for (const a of linkedAddOns) {
        const existing = prev[a.id];
        if (a.required) {
          next[a.id] = Math.max(1, existing ?? 1);
        } else if (existing != null && existing > 0) {
          next[a.id] =
            a.maxQty != null ? Math.min(existing, a.maxQty) : existing;
        }
      }
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (
        prevKeys.length === nextKeys.length &&
        nextKeys.every((k) => prev[k] === next[k])
      ) {
        return prev;
      }
      return next;
    });
  }, [productId, linkedAddOns]);

  const promptMode = settingsQ.data?.defaultCreateMode === 'prompt';
  const skipVenue = Boolean(scopedLocationId);

  const lines = useMemo(() => {
    if (!productId) return [];
    const main = {
      productId,
      qty,
      sessionId: sessionId || undefined,
      visitDate: needsSlot ? undefined : date,
      priceBandCode: band || undefined,
    };
    // Stamp visitDate on add-ons for non-session products. Timed products leave
    // it unset so the engine inherits the main line's session startsAt (never
    // attach sessionId — wrong productId → SESSION_SOLD_OUT).
    const extra = Object.entries(addons)
      .filter(([, n]) => n > 0)
      .map(([id, n]) => ({
        productId: id,
        qty: n,
        visitDate: needsSlot ? undefined : date || undefined,
      }));
    return [main, ...extra];
  }, [productId, qty, sessionId, date, band, addons, needsSlot]);

  const tabIndex = CREATE_BOOKING_TABS.findIndex((t) => t.id === tab);

  function goTab(id: CreateBookingTabId) {
    const i = CREATE_BOOKING_TABS.findIndex((t) => t.id === id);
    if (i < 0 || i > maxReachable) return;
    setErr('');
    setTab(id);
  }

  function validateDetails(): string | null {
    if (!staffChannel) return 'Choose how this booking was taken';
    return validateStaffBookingContact({
      channel: staffChannel,
      holderType,
      accountId,
      name,
      email,
      phone,
    });
  }

  /** Returns error message, or null. May auto-pick first open session into state. */
  function validateProduct(): string | null {
    if (!locationId) return 'Choose a venue';
    if (!productId) return 'Choose a product';
    if (productQ.isLoading || (productId && !product)) {
      return 'Loading product…';
    }
    // Derive type from the selected product when staff picks the product first
    // (type filter empty = all products listed).
    const resolvedType =
      productType ||
      (product?.type as AdmissionProductType | undefined) ||
      '';
    if (!resolvedType) return 'Choose a product type';
    if (!productType && product?.type) {
      setProductType(product.type as AdmissionProductType);
    }
    if (needsSlot) {
      if (!date) return 'Choose a visit date on the calendar';
      const overbookOk = canOverbook && allowOverbook;
      let effectiveSessionId = sessionId;
      if (!effectiveSessionId) {
        const first = sessions.find(
          (s) => s.availableForQty !== false && s.remaining > 0
        );
        if (!first && !overbookOk) {
          return 'No open seats — wait for a hold to expire or pick another day';
        }
        if (first) {
          effectiveSessionId = first.id;
          setSessionId(first.id);
        } else if (!overbookOk) {
          return 'Select a session';
        }
      }
      const selected = sessions.find((s) => s.id === effectiveSessionId);
      if (
        selected &&
        selected.availableForQty === false &&
        !overbookOk
      ) {
        return selected.status === 'held'
          ? 'This slot is held pending payment — wait for the hold to expire or choose another'
          : 'Not enough remaining — enable overbook if permitted';
      }
      if (selected && selected.remaining < qty && !overbookOk) {
        return 'Not enough remaining — enable overbook if permitted';
      }
      // Overbook relaxes capacity only — a session is still required for
      // timed / party / group / camp products (visit + capacity linkage).
      if (!effectiveSessionId) {
        return 'Select a session';
      }
    } else if (!date) {
      return 'Choose a visit date';
    }
    return null;
  }

  function resolveSessionIdForCreate(): string {
    if (sessionId) return sessionId;
    const first = sessions.find(
      (s) => s.availableForQty !== false && s.remaining > 0
    );
    return first?.id ?? '';
  }

  function validateGuests(): string | null {
    if (!Number.isInteger(qty) || qty < 1) return 'Enter at least 1 guest';
    if (product?.minGuests != null && qty < product.minGuests) {
      return `Minimum ${product.minGuests}`;
    }
    if (product?.maxGuests != null && qty > product.maxGuests) {
      return `Maximum ${product.maxGuests}`;
    }
    const selectedSession = sessions.find((s) => s.id === sessionId);
    const slotFlat =
      selectedSession?.priceOverride != null &&
      Number(selectedSession.priceOverride) > 0;
    if (!slotFlat && (product?.prices?.length ?? 0) > 0 && !band.trim()) {
      return 'Select a price band (adult, child, …) — this sets the ticket price, not payment';
    }
    if (
      !slotFlat &&
      band &&
      product?.prices?.length &&
      !product.prices.some((p) => p.code === band)
    ) {
      return 'Selected price band is not valid for this product';
    }
    for (const a of linkedAddOns) {
      const n = addons[a.id] ?? 0;
      if (a.required && n < 1) return `${a.name} is required`;
      if (a.maxQty != null && n > a.maxQty) {
        return `${a.name} max is ${a.maxQty}`;
      }
    }
    return null;
  }

  function next() {
    setErr('');
    let fail: string | null = null;
    if (tab === 'details') fail = validateDetails();
    else if (tab === 'product') fail = validateProduct();
    else if (tab === 'guests') fail = validateGuests();
    if (fail) {
      setErr(fail);
      return;
    }
    const nextIdx = Math.min(CREATE_BOOKING_TABS.length - 1, tabIndex + 1);
    setMaxReachable((m) => Math.max(m, nextIdx));
    setTab(CREATE_BOOKING_TABS[nextIdx].id);
  }

  function back() {
    setErr('');
    const prevIdx = Math.max(0, tabIndex - 1);
    setTab(CREATE_BOOKING_TABS[prevIdx].id);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submittingRef.current || busy) return;
    if (!canCreateBooking) {
      setErr('You do not have permission to create bookings.');
      return;
    }
    if (!locationId) {
      setErr('Choose a venue');
      setTab('product');
      return;
    }
    // Venue defaultCreateMode / review-before-confirm must be known before create.
    if (settingsQ.isLoading) {
      setErr('Loading venue booking settings…');
      return;
    }
    if (settingsQ.isError || !settingsQ.data) {
      setErr('Could not load venue booking settings — refresh and try again');
      return;
    }
    const contactErr = validateDetails();
    if (contactErr) {
      setErr(contactErr);
      setTab('details');
      return;
    }
    const productErr = validateProduct();
    if (productErr) {
      setErr(productErr);
      setTab('product');
      return;
    }
    const guestsErr = validateGuests();
    if (guestsErr) {
      setErr(guestsErr);
      setTab('guests');
      return;
    }
    submittingRef.current = true;
    setBusy(true);
    setErr('');
    try {
      const wantConfirm =
        promptMode && createMode === 'confirm' && canConfirmBooking;
      const mode = promptMode
        ? createMode === 'confirm'
          ? 'hold'
          : createMode
        : ((settingsQ.data.defaultCreateMode === 'reserve'
            ? 'reserve'
            : 'hold') as 'hold' | 'reserve');
      const resolvedSession = needsSlot ? resolveSessionIdForCreate() : '';
      if (needsSlot && !resolvedSession) {
        setErr('Select a session');
        setTab('product');
        return;
      }
      const createLines = lines.map((line, i) =>
        i === 0 && resolvedSession
          ? { ...line, sessionId: resolvedSession }
          : line
      );
      if (!createLines.length || !createLines[0]?.productId) {
        setErr('Choose a product');
        setTab('product');
        return;
      }
      const booking = await createAdminBooking({
        channel: staffChannel,
        locationId,
        createMode: mode,
        lines: createLines,
        primaryContactName: name.trim() || null,
        primaryContactEmail: email.trim() || null,
        primaryContactPhone: phone.trim() || null,
        accountId:
          canAccounts && holderType === 'company' && accountId
            ? accountId
            : null,
        notes: notes.trim() || null,
        posNotes: posNotes.trim() || null,
        taxExempt: canTax ? taxExempt : undefined,
        allowOverbook: canOverbook && allowOverbook,
        activate: true,
      });
      let confirmNote = '';
      if (wantConfirm) {
        try {
          // T28: requireReviewBeforeConfirm blocks confirm until review.
          // Staff chose Confirm at create — run the existing review → confirm
          // sequence (same APIs as booking detail), not a new autoReview path.
          if (settingsQ.data.requireReviewBeforeConfirm) {
            await reviewAdminBooking(booking.id);
          }
          await confirmAdminBooking(booking.id, true);
        } catch (confirmEx) {
          // Booking already held — do not leave staff thinking create failed.
          confirmNote =
            confirmEx instanceof Error
              ? confirmEx.message
              : 'Confirm failed';
        }
      }
      // Booking exists — never treat toast/nav failures as a failed create.
      invalidateAfterBookingMutation(qc);
      // Clear busy before modal dismiss so Esc/backdrop guard does not block close.
      submittingRef.current = false;
      setBusy(false);
      onBusyChange?.(false);
      try {
        if (confirmNote) {
          addToast(
            `Created ${booking.publicId} on hold — confirm failed: ${confirmNote}`,
            'error'
          );
        } else {
          addToast(`Created ${booking.publicId}`, 'success');
        }
        onCreated?.({ id: booking.id, publicId: booking.publicId });
        if (isModal) {
          onClose?.();
        }
        router.push(`/admin/bookings/${booking.id}`);
      } catch {
        if (typeof window !== 'undefined') {
          window.location.assign(`/admin/bookings/${booking.id}`);
        }
      }
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Create failed');
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  const productBlockingLoad =
    tab === 'product' &&
    (productsQ.isLoading ||
      (Boolean(productId) && productQ.isLoading) ||
      (needsSlot &&
        (monthAvailQ.isLoading || (Boolean(date) && availQ.isLoading))));

  const types: AdmissionProductType[] = [
    'timed_session',
    'day_pass',
    'group',
    'camp_event',
    'party_package',
    'pass',
  ];

  function onRailProduct(id: string) {
    setProductId(id);
    const p = (productsQ.data ?? []).find((x) => x.id === id);
    if (p) setProductType(p.type as AdmissionProductType);
    setDate('');
    setSessionId('');
    setBand('');
  }

  return (
    <div className={isModal ? 'space-y-6' : 'mx-auto max-w-6xl space-y-6'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[#D4AF37]">
            Bookings
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Create booking</h1>
          <p className="mt-1 text-sm text-stone-500">
            {CREATE_BOOKING_TABS[tabIndex]?.label} · staff at-venue entry
          </p>
          <p className="mt-2 max-w-2xl text-sm text-stone-600">
            Sell an existing product at the desk. Open the guide if you are
            doing this for the first time.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
          {canAccounts ? (
            <Link
              href="/admin/booking-accounts"
              className={btnSecondaryClass}
            >
              Add company contact
            </Link>
          ) : null}
          {!isModal ? (
            <Link href="/admin/bookings" className={btnSecondaryClass}>
              Back to list
            </Link>
          ) : null}
        </div>
      </div>

      <AdminHowToGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Create booking"
        subtitle="Follow these steps in order — written for first-time admins."
        steps={CREATE_BOOKING_GUIDE_STEPS}
      />

      <CreateBookingTabs
        active={tab}
        maxReachableIndex={maxReachable}
        onSelect={goTab}
      />

      <div
        className={
          tab === 'product'
            ? 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]'
            : undefined
        }
      >
        <div className="rounded-lg border border-stone-200 bg-white p-5">
          {tab === 'details' ? (
            <BookingHolderForm
              staffChannel={staffChannel}
              onChannel={setStaffChannel}
              holderType={holderType}
              onHolderType={setHolderType}
              name={name}
              onName={setName}
              email={email}
              onEmail={setEmail}
              phone={phone}
              onPhone={setPhone}
              accountId={accountId}
              onAccountId={setAccountId}
              accounts={accountsQ.data ?? []}
              accountsLoading={accountsQ.isLoading}
              allowCompanyHolder={canAccounts}
            />
          ) : null}

          {tab === 'product' ? (
            <div className="space-y-5">
              {!skipVenue ? (
                <label className="block text-sm font-medium text-stone-800">
                  Venue
                  <select
                    className={`${fieldClass} mt-1`}
                    value={locationId}
                    onChange={(e) => {
                      setLocationId(e.target.value);
                      setProductId('');
                      setProductType('');
                      setDate('');
                      setSessionId('');
                    }}
                  >
                    <option value="">Select venue</option>
                    {venues.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="text-sm text-stone-600">
                  Venue: {scopedLocationName || 'Scoped park'}
                </p>
              )}

              <div className="space-y-2">
                <p className="text-sm font-medium text-stone-800">
                  Product type
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {types.map((t) => (
                    <label
                      key={t}
                      className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                        productType === t
                          ? 'border-[#D4AF37] bg-[#D4AF37]/10'
                          : 'border-stone-200 hover:bg-stone-50'
                      }`}
                    >
                      <input
                        type="radio"
                        checked={productType === t}
                        onChange={() => {
                          setProductType(t);
                          setProductId('');
                          setDate('');
                          setSessionId('');
                        }}
                      />
                      {formatProductType(t)}
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-stone-800">Product</p>
                {!locationId ? (
                  <p className="text-sm text-stone-500">Choose a venue first.</p>
                ) : productsQ.isLoading && products.length === 0 ? (
                  <WizardFetchLoader label="Loading products…" />
                ) : products.length ? (
                  <div className="space-y-1.5">
                    {products.map((p) => (
                      <label
                        key={p.id}
                        className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                          productId === p.id
                            ? 'border-[#D4AF37] bg-[#D4AF37]/10'
                            : 'border-stone-200 hover:bg-stone-50'
                        }`}
                      >
                        <input
                          type="radio"
                          checked={productId === p.id}
                          onChange={() => {
                            setProductId(p.id);
                            setProductType(p.type as AdmissionProductType);
                            setDate('');
                            setSessionId('');
                            setBand('');
                          }}
                        />
                        {p.name}
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
                    <p className="font-medium">
                      No {formatProductType(productType || 'product')} products
                      for this venue yet.
                    </p>
                    {productType === 'party_package' ? (
                      <p className="text-xs leading-relaxed text-amber-900/90">
                        Create a room / party-room capacity resource for this
                        venue, then a Ticket product with type{' '}
                        <span className="font-medium">Party package</span>, then
                        add sessions. After that, return here to book it.
                      </p>
                    ) : (
                      <p className="text-xs leading-relaxed text-amber-900/90">
                        Add a published Ticket product of this type under Online
                        Booking → Ticket products for this venue
                        {productType === 'timed_session' ||
                        productType === 'group' ||
                        productType === 'camp_event'
                          ? ', then create sessions so slots appear in Availabilities'
                          : ''}
                        .
                      </p>
                    )}
                    {canCatalogWrite ? (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {productType === 'party_package' ? (
                          <Link
                            href="/admin/ticketing/resources"
                            className={btnSecondaryClass}
                          >
                            Capacity resources
                          </Link>
                        ) : null}
                        <Link
                          href={
                            locationId
                              ? `/admin/ticketing/products/new?locationId=${encodeURIComponent(locationId)}${
                                  productType
                                    ? `&type=${encodeURIComponent(productType)}`
                                    : ''
                                }`
                              : '/admin/ticketing/products/new'
                          }
                          className={btnPrimaryClass}
                        >
                          Create product
                        </Link>
                      </div>
                    ) : (
                      <p className="text-xs text-amber-900/80">
                        Ask a catalog admin to create this product for the
                        venue.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {productId && needsSlot ? (
                <p className="text-xs text-stone-500">
                  Use the Availabilities panel to pick date and session —
                  selecting a slot updates this booking.
                </p>
              ) : null}

              {productId && !needsSlot ? (
                <p className="text-xs text-stone-500">
                  Day pass / open date — set the visit date in Availabilities.
                </p>
              ) : null}
            </div>
          ) : null}

          {tab === 'guests' ? (
            <div className="space-y-5">
              <p className="text-xs text-stone-500">
                Price band sets the ticket rate only. Payment is taken on the
                booking detail after create.
              </p>
              <label className="block text-sm font-medium text-stone-800">
                Guests
                <input
                  type="number"
                  min={product?.minGuests ?? 1}
                  max={product?.maxGuests ?? 999}
                  step={1}
                  className={`${fieldClass} mt-1`}
                  value={qty}
                  onChange={(e) => {
                    const n = Math.floor(Number(e.target.value));
                    setQty(Number.isFinite(n) && n >= 1 ? n : 1);
                  }}
                />
                {product?.minGuests != null || product?.maxGuests != null ? (
                  <span className="mt-1 block text-xs font-normal text-stone-500">
                    Allowed {product?.minGuests ?? 1}
                    {product?.maxGuests != null
                      ? `–${product.maxGuests}`
                      : '+'}
                  </span>
                ) : null}
              </label>
              {(() => {
                const selectedSession = sessions.find(
                  (s) => s.id === sessionId
                );
                const slotFlat =
                  selectedSession?.priceOverride != null &&
                  Number(selectedSession.priceOverride) > 0
                    ? Number(selectedSession.priceOverride)
                    : null;
                if (slotFlat != null) {
                  const currency = product?.prices?.[0]?.currency || 'USD';
                  return (
                    <div className="rounded-md border border-[#D4AF37]/30 bg-[#D4AF37]/10 px-3 py-2 text-sm text-stone-800">
                      This slot uses a fixed price of{' '}
                      <span className="font-semibold">
                        {formatMoney(slotFlat, currency)}
                      </span>{' '}
                      per guest (bands do not apply).
                    </div>
                  );
                }
                if (!product?.prices?.length) {
                  return (
                    <p className="text-sm text-amber-800">
                      This product has no price bands configured. Add prices on
                      the product before taking paid bookings.
                    </p>
                  );
                }
                const selectedPrice = product.prices.find(
                  (p) => p.code === band
                );
                return (
                  <fieldset className="space-y-1.5">
                    <legend className="text-sm font-medium text-stone-800">
                      Price band
                    </legend>
                    <div className="space-y-1.5">
                      {product.prices.map((pr) => {
                        const active = band === pr.code;
                        return (
                          <label
                            key={pr.code}
                            className={`flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${
                              active
                                ? 'border-[#D4AF37] bg-[#D4AF37]/10'
                                : 'border-stone-200 hover:bg-stone-50'
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <input
                                type="radio"
                                name="priceBand"
                                checked={active}
                                onChange={() => setBand(pr.code)}
                              />
                              <span className="font-medium capitalize text-stone-900">
                                {pr.code}
                              </span>
                            </span>
                            <span className="font-semibold text-stone-900">
                              {formatMoney(pr.amount, pr.currency)}
                              <span className="ml-1 text-xs font-normal text-stone-500">
                                / guest
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {selectedPrice ? (
                      <p className="pt-1 text-xs text-stone-600">
                        Line total ≈{' '}
                        <span className="font-medium text-stone-800">
                          {formatMoney(
                            Number(selectedPrice.amount) * qty,
                            selectedPrice.currency
                          )}
                        </span>{' '}
                        — not charged until payment succeeds.
                      </p>
                    ) : null}
                  </fieldset>
                );
              })()}

              <div className="space-y-2">
                <p className="text-sm font-medium text-stone-800">Add-ons</p>
                {linkedAddOns.map((a) => (
                  <label
                    key={a.id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span>
                      {a.name}
                      {a.required ? (
                        <span className="ml-1 text-xs text-stone-500">
                          (required)
                        </span>
                      ) : null}
                      {a.priceFrom != null ? (
                        <span className="ml-1 text-xs text-stone-500">
                          · from {formatMoney(a.priceFrom)}
                        </span>
                      ) : null}
                    </span>
                    <input
                      type="number"
                      min={a.required ? 1 : 0}
                      max={a.maxQty ?? undefined}
                      className={`${fieldClass} w-20`}
                      value={addons[a.id] ?? (a.required ? 1 : 0)}
                      onChange={(e) => {
                        let n = Number(e.target.value);
                        if (!Number.isFinite(n) || n < 0) n = 0;
                        if (a.required && n < 1) n = 1;
                        if (a.maxQty != null && n > a.maxQty) n = a.maxQty;
                        setAddons((p) => ({ ...p, [a.id]: n }));
                      }}
                    />
                  </label>
                ))}
                {!linkedAddOns.length ? (
                  <p className="text-sm text-stone-500">
                    No add-ons linked to this product.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {tab === 'options' ? (
            <div className="space-y-4">
              {canTax ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={taxExempt}
                    onChange={(e) => setTaxExempt(e.target.checked)}
                  />
                  Tax exempt
                </label>
              ) : (
                <p className="text-sm text-stone-500">
                  You cannot mark tax exempt.
                </p>
              )}
              {canOverbook ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={allowOverbook}
                    onChange={(e) => setAllowOverbook(e.target.checked)}
                  />
                  Allow overbook on create
                </label>
              ) : null}
              <label className="block text-sm font-medium text-stone-800">
                Booking notes
                <textarea
                  className={`${fieldClass} mt-1`}
                  placeholder="Visible on the booking"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </label>
              <label className="block text-sm font-medium text-stone-800">
                POS notes (staff only)
                <textarea
                  className={`${fieldClass} mt-1`}
                  placeholder="Internal desk notes"
                  value={posNotes}
                  onChange={(e) => setPosNotes(e.target.value)}
                  rows={2}
                />
              </label>
              {promptMode ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-stone-800">
                    Create mode
                  </p>
                  {(
                    [
                      'hold',
                      'reserve',
                      ...(canConfirmBooking ? (['confirm'] as const) : []),
                    ] as const
                  ).map((m) => (
                    <label key={m} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        checked={createMode === m}
                        onChange={() => setCreateMode(m)}
                      />
                      {m === 'confirm'
                        ? 'Confirm'
                        : m === 'reserve'
                          ? 'Reserve'
                          : 'Hold'}
                    </label>
                  ))}
                  {!canConfirmBooking ? (
                    <p className="text-xs text-stone-500">
                      Confirm requires bookings:write — create as Hold or
                      Reserve, then confirm on the booking detail if entitled.
                    </p>
                  ) : settingsQ.data?.requireReviewBeforeConfirm ? (
                    <p className="text-xs text-stone-500">
                      This venue requires review before confirm — choosing
                      Confirm will mark the booking reviewed, then confirm
                      (same as Review then Confirm on the booking detail).
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-stone-500">
                  Create mode:{' '}
                  {settingsQ.data?.defaultCreateMode ?? 'hold'} (venue default)
                </p>
              )}
            </div>
          ) : null}

          {tab === 'review' ? (
            <form onSubmit={onSubmit} className="space-y-3 text-sm">
              <p>
                {formatBookingChannel(staffChannel)} ·{' '}
                {holderType === 'company' ? 'Company' : 'Guest'} · venue{' '}
                {venues.find((v) => v.id === locationId)?.name ?? '—'}
              </p>
              <p>
                Product {product?.name ?? '—'} × {qty}
                {band ? ` · ${band}` : ''}
                {sessionId ? ` · session selected` : date ? ` · ${date}` : ''}
              </p>
              <p>
                Contact {name || '—'}
                {email ? ` · ${email}` : ''}
                {phone ? ` · ${phone}` : ''}
                {accountId
                  ? ` · ${(accountsQ.data ?? []).find((a) => a.id === accountId)?.name ?? 'account'}`
                  : ''}
              </p>
              <p>
                Mode{' '}
                {promptMode
                  ? createMode
                  : (settingsQ.data?.defaultCreateMode ?? 'hold')}
                {canTax
                  ? taxExempt
                    ? ' · tax exempt'
                    : ''
                  : settingsQ.data?.defaultTaxExempt
                    ? ' · tax exempt (venue default)'
                    : ''}
                {canOverbook && allowOverbook ? ' · overbook' : ''}
              </p>
              <p className="text-xs text-stone-500">
                After create: take payment, invoices, tickets, and assign staff
                on the booking detail page.
              </p>
              <button
                type="submit"
                className={btnPrimaryClass}
                disabled={
                  busy ||
                  !canCreateBooking ||
                  !locationId ||
                  settingsQ.isLoading ||
                  settingsQ.isError ||
                  !settingsQ.data
                }
              >
                {busy ? 'Creating…' : 'Create booking'}
              </button>
            </form>
          ) : null}

          {err ? <p className="mt-3 text-sm text-red-700">{err}</p> : null}

          {tab !== 'review' ? (
            <div className="mt-4 flex gap-2">
              {tabIndex > 0 ? (
                <button
                  type="button"
                  className={btnSecondaryClass}
                  onClick={back}
                >
                  Back
                </button>
              ) : null}
              <button
                type="button"
                className={btnPrimaryClass}
                onClick={next}
                disabled={productBlockingLoad}
              >
                {productBlockingLoad ? 'Loading…' : 'Continue'}
              </button>
            </div>
          ) : (
            <div className="mt-4">
              <button
                type="button"
                className={btnSecondaryClass}
                onClick={back}
              >
                Back
              </button>
            </div>
          )}
        </div>

        {tab === 'product' ? (
          <div className="min-w-0">
            <AvailabilitiesRail
              productId={productId}
              products={products}
              onProductId={onRailProduct}
              date={date}
              onDate={(key) => {
                setDate(key);
                setSessionId('');
              }}
              calendarMonth={calendarMonth}
              onCalendarMonth={setCalendarMonth}
              sessionId={sessionId}
              onSessionId={setSessionId}
              qty={qty}
              onQty={setQty}
              sessions={sessions}
              monthSessions={monthAvailQ.data ?? []}
              venueTz={venueTz}
              timeFormat={settingsQ.data?.timeFormat}
              canOverbook={canOverbook}
              allowOverbook={allowOverbook}
              onAllowOverbook={setAllowOverbook}
              includeUnavailable={includeUnavailable}
              onIncludeUnavailable={setIncludeUnavailable}
              monthLoading={monthAvailQ.isLoading}
              dayLoading={availQ.isLoading}
              needsSlot={needsSlot || !productId}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
