'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/contexts/toast-context';
import { api, unwrap, type MaybeWrapped } from '@/utils/api';
import {
  invalidateBillingUsageQueries,
  useBillingUsageQuery,
} from '@/hooks/useBilling';
import { usageMeterFor } from '@/services/billing';
import { softGateBlockedMessage, softGateInlineHint } from '@/utils/planLimitSoftGate';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { isStorefrontOrgSession } from '@/hooks/useAdminPermission';
import { P, isPlatformAdminActor } from '@/lib/auth/permissions';
import { useHqLocationFilter } from '@/hooks/useHqLocationFilter';
import AdminHowToGuideModal, {
  AdminHowToGuideButton,
  BOOKING_PACKAGES_GUIDE_STEPS,
} from '@/components/Protected/admin/components/AdminHowToGuideModal';
import { DEFAULT_MARKETPLACE_CURRENCY } from '@/lib/marketplace/fees';

type BookingPackageDto = {
  id: string;
  orgId: string;
  locationId: string | null;
  slug: string;
  title: string;
  description: string | null;
  amountMinor: number;
  currency: string;
  capacity: number | null;
  active: boolean;
  published: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type MarketplaceAccountDto = {
  chargeReady: boolean;
  onboardingStatus: string;
  orgSlug?: string | null;
};

type PackageForm = {
  title: string;
  slug: string;
  description: string;
  amountMajor: string;
  currency: string;
  capacity: string;
  published: boolean;
  active: boolean;
  startsAt: string;
  endsAt: string;
};

const emptyForm = (): PackageForm => ({
  title: '',
  slug: '',
  description: '',
  amountMajor: '',
  currency: DEFAULT_MARKETPLACE_CURRENCY,
  capacity: '',
  published: false,
  active: true,
  startsAt: '',
  endsAt: '',
});

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function formatMoney(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}

function majorToMinor(raw: string): number | null {
  const n = Number.parseFloat(raw.trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

type MarketplaceBookingRow = {
  id: string;
  packageTitle: string;
  customerEmail: string;
  amountMinor: number;
  currency: string;
  status: string;
  refundableMinor: number;
  hasPaymentIntent: boolean;
  paidAt: string | null;
};

export default function BookingPackagesPage() {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const can = useAuthStore((s) => s.can);
  // Marketplace Connect is tenant-only — DEFAULT_ORG / FECSYNC storefront is never a merchant.
  const isStorefront = isStorefrontOrgSession(user);
  const companyConsole = !isStorefront;
  const canManagePackages =
    companyConsole &&
    (can(P.BookingPackagesManage) ||
      can(P.BookingPackagesWrite) ||
      can(P.BookingPackagesRead));
  const canWritePackage =
    companyConsole &&
    (can(P.BookingPackagesWrite) || can(P.BookingPackagesManage));
  const canPublishPackage =
    companyConsole &&
    (can(P.BookingPackagesPublish) || can(P.BookingPackagesManage));
  const canDeletePackage =
    companyConsole &&
    (can(P.BookingPackagesDelete) || can(P.BookingPackagesManage));
  const canRefund =
    companyConsole &&
    (can(P.MarketplaceRefunds) ||
      (can(P.PayoutsManage) && isPlatformAdminActor(user)) ||
      (can(P.SettingsManage) && isPlatformAdminActor(user)));
  const {
    parkLocked,
    scopedLocationId,
  } = useHqLocationFilter();
  const [guideOpen, setGuideOpen] = useState(false);

  const [packages, setPackages] = useState<BookingPackageDto[]>([]);
  const [bookings, setBookings] = useState<MarketplaceBookingRow[]>([]);
  const [publicOrgKey, setPublicOrgKey] = useState<string | null>(null);
  const [chargeReady, setChargeReady] = useState(false);
  /** Franchise parks with published packages that are not park charge-ready. */
  const [parkPayoutGap, setParkPayoutGap] = useState<{
    locationId: string;
    locationName: string;
  } | null>(null);
  /** locationId → chargeReady for franchise parks (form publish hint). */
  const [parkChargeReadyById, setParkChargeReadyById] = useState<
    Map<string, boolean>
  >(() => new Map());
  const [loading, setLoading] = useState(!isStorefront);
  const [form, setForm] = useState<PackageForm>(emptyForm());
  const [slugManual, setSlugManual] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refundingId, setRefundingId] = useState<string | null>(null);

  const usageQuery = useBillingUsageQuery(companyConsole && canManagePackages);
  const meter = usageMeterFor(usageQuery.data, 'bookingPackages');
  const usageReady = Boolean(usageQuery.data) || usageQuery.isError;
  const atLimit =
    !usageQuery.isError &&
    (!usageReady ||
      !meter ||
      (!meter.unlimited && (meter.remaining ?? 0) <= 0));
  const createBlockedHint = !usageReady
    ? 'Checking plan usage…'
    : softGateInlineHint(usageQuery.data, 'bookingPackages', atLimit, {
        zeroCap: Boolean(meter) && !meter?.unlimited && meter?.limit === 0,
      });

  const load = useCallback(async () => {
    // Storefront / DEFAULT_ORG is never a Connect merchant — skip APIs that fail-closed.
    if (isStorefrontOrgSession(useAuthStore.getState().user)) {
      setPackages([]);
      setBookings([]);
      setChargeReady(false);
      setParkPayoutGap(null);
      setParkChargeReadyById(new Map());
      setPublicOrgKey(null);
      return;
    }

    const bookingsPromise = api<
      MaybeWrapped<{ bookings: MarketplaceBookingRow[] }>
    >('/api/admin/marketplace/bookings?take=40').catch(() => null);
    const parksPromise = api<
      MaybeWrapped<{
        parks: Array<{
          locationId: string;
          locationName: string;
          chargeReady?: boolean;
          isFranchise?: boolean;
        }>;
      }>
    >('/api/admin/marketplace/park-accounts').catch(() => null);

    if (!canManagePackages) {
      const [acctRaw, bookingsRaw] = await Promise.all([
        api<MaybeWrapped<{ account: MarketplaceAccountDto }>>(
          '/api/admin/marketplace/account'
        ).catch(() => null),
        bookingsPromise,
      ]);
      setPackages([]);
      setParkPayoutGap(null);
      setParkChargeReadyById(new Map());
      const acct = acctRaw ? unwrap(acctRaw)?.account : null;
      setChargeReady(Boolean(acct?.chargeReady));
      setPublicOrgKey(
        acct?.orgSlug?.trim() || user?.orgId?.trim() || null
      );
      setBookings(bookingsRaw ? unwrap(bookingsRaw)?.bookings ?? [] : []);
      return;
    }

    const [pkgRaw, acctRaw, bookingsRaw, parksRaw] = await Promise.all([
      api<MaybeWrapped<{ packages: BookingPackageDto[]; orgId: string }>>(
        '/api/admin/booking-packages'
      ),
      api<MaybeWrapped<{ account: MarketplaceAccountDto }>>(
        '/api/admin/marketplace/account'
      ).catch(() => null),
      bookingsPromise,
      parksPromise,
    ]);
    const pkgData = unwrap(pkgRaw);
    const pkgs = pkgData?.packages ?? [];
    setPackages(pkgs);
    const acct = acctRaw ? unwrap(acctRaw)?.account : null;
    setChargeReady(Boolean(acct?.chargeReady));
    const parks = parksRaw ? unwrap(parksRaw)?.parks ?? [] : [];
    const readyMap = new Map<string, boolean>();
    for (const p of parks) {
      readyMap.set(p.locationId, Boolean(p.chargeReady));
    }
    setParkChargeReadyById(readyMap);
    const publishedLocIds = new Set(
      pkgs
        .filter((p) => p.published && p.locationId)
        .map((p) => p.locationId as string)
    );
    const blockedPark = parks.find(
      (p) =>
        p.isFranchise !== false &&
        !p.chargeReady &&
        publishedLocIds.has(p.locationId)
    );
    setParkPayoutGap(
      blockedPark
        ? {
            locationId: blockedPark.locationId,
            locationName: blockedPark.locationName,
          }
        : null
    );
    // Prefer public slug for book links; API accepts slug or id.
    setPublicOrgKey(
      acct?.orgSlug?.trim() ||
        pkgData?.orgId?.trim() ||
        user?.orgId?.trim() ||
        null
    );
    setBookings(bookingsRaw ? unwrap(bookingsRaw)?.bookings ?? [] : []);
  }, [user?.orgId, canManagePackages]);

  const onRefund = async (booking: MarketplaceBookingRow) => {
    if (!canRefund || booking.refundableMinor <= 0) return;
    if (
      !window.confirm(
        `Refund ${formatMoney(booking.refundableMinor, booking.currency)} for ${booking.customerEmail}? Application fee is refunded with the charge.`
      )
    ) {
      return;
    }
    setRefundingId(booking.id);
    try {
      await api(`/api/admin/marketplace/bookings/${booking.id}/refund`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'admin_refund' }),
      });
      addToast('Refund submitted', 'success');
      await load();
    } catch (err) {
      addToast(errMessage(err, 'Refund failed'), 'error');
    } finally {
      setRefundingId(null);
    }
  };

  useEffect(() => {
    if (isStorefront) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await load();
      } catch (err) {
        if (!cancelled) {
          addToast(
            errMessage(
              err,
              canManagePackages
                ? 'Failed to load booking packages'
                : 'Failed to load marketplace bookings'
            ),
            'error'
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addToast, load, canManagePackages, isStorefront]);

  if (isStorefront) {
    const canSeeCompanies = can(P.UsersManageRoles);
    return (
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Booking packages</h1>
          <p className="text-sm text-stone-600 mt-1">
            Marketplace catalog for registered company workspaces — not the
            FECSYNC storefront.
          </p>
        </div>
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-950 space-y-3">
          <p className="font-semibold">Wrong workspace for this feature</p>
          <p>
            You are signed into the FECSYNC storefront (platform ops). Booking
            packages and Connect payouts belong to a{' '}
            <strong className="font-semibold">registered company</strong>{' '}
            tenant — the storefront cannot be a Connect merchant.
          </p>
          <p>
            Sign in as that company&apos;s platform admin (or register a company),
            then open Booking packages and complete Payouts there.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            {canSeeCompanies ? (
              <Link
                href="/admin/registered-companies"
                className="inline-flex h-10 items-center justify-center rounded-lg bg-[#D4AF37] px-4 text-sm font-semibold text-stone-900 shadow-sm hover:bg-[#c4a030]"
              >
                Company workspaces
              </Link>
            ) : null}
            <Link
              href="/register-company"
              className="inline-flex h-10 items-center justify-center rounded-lg border border-amber-400 bg-white px-4 text-sm font-semibold text-amber-950 hover:border-amber-500"
            >
              Register a company
            </Link>
            <Link
              href="/admin/payouts"
              className="inline-flex h-10 items-center justify-center rounded-lg border border-amber-300 bg-white/80 px-4 text-sm font-semibold text-amber-900"
            >
              Payouts (same rule)
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const startEdit = (pkg: BookingPackageDto) => {
    setEditingId(pkg.id);
    setSlugManual(true);
    setForm({
      title: pkg.title,
      slug: pkg.slug,
      description: pkg.description ?? '',
      amountMajor: (pkg.amountMinor / 100).toFixed(2),
      currency: DEFAULT_MARKETPLACE_CURRENCY,
      capacity: pkg.capacity != null ? String(pkg.capacity) : '',
      published: pkg.published,
      active: pkg.active,
      startsAt: toDatetimeLocalValue(pkg.startsAt),
      endsAt: toDatetimeLocalValue(pkg.endsAt),
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setSlugManual(false);
    setForm(emptyForm());
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingId) {
      const blocked = softGateBlockedMessage(usageQuery.data, 'bookingPackages', {
        atLimit,
        usageReady,
        zeroCap: Boolean(meter) && !meter?.unlimited && meter?.limit === 0,
      });
      if (blocked) {
        addToast(blocked, 'error');
        return;
      }
    }

    const amountMinor = majorToMinor(form.amountMajor);
    if (amountMinor == null || amountMinor <= 0) {
      addToast('Enter a valid price (major units, e.g. 50.00)', 'error');
      return;
    }
    const title = form.title.trim();
    const slug = (form.slug.trim() || slugify(title)).toLowerCase();
    if (!title || !slug) {
      addToast('Title and slug are required', 'error');
      return;
    }

    const capacityRaw = form.capacity.trim();
    const capacity =
      capacityRaw === ''
        ? null
        : Number.parseInt(capacityRaw, 10);
    // Blank = unlimited; otherwise require ≥ 1 (server rejects 0).
    if (
      capacityRaw !== '' &&
      (!Number.isFinite(capacity) || (capacity as number) < 1)
    ) {
      addToast('Capacity must be blank (unlimited) or at least 1', 'error');
      return;
    }

    const startsAt = fromDatetimeLocalValue(form.startsAt);
    const endsAt = fromDatetimeLocalValue(form.endsAt);
    if (form.startsAt.trim() && !startsAt) {
      addToast('Sale start time is invalid', 'error');
      return;
    }
    if (form.endsAt.trim() && !endsAt) {
      addToast('Sale end time is invalid', 'error');
      return;
    }
    if (startsAt && endsAt && new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
      addToast('Sale end must be on or after sale start', 'error');
      return;
    }

    const body: Record<string, unknown> = {
      title,
      slug,
      description: form.description.trim() || null,
      amountMinor,
      currency: DEFAULT_MARKETPLACE_CURRENCY,
      capacity,
      published: form.published,
      active: form.active,
      startsAt,
      endsAt,
    };
    if (!editingId && (parkLocked || scopedLocationId)) {
      body.locationId = scopedLocationId || user?.assignedLocationIds?.[0] || null;
    }

    setSaving(true);
    try {
      if (editingId) {
        await api(`/api/admin/booking-packages/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        addToast('Package updated', 'success');
      } else {
        await api('/api/admin/booking-packages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        addToast('Package created', 'success');
        invalidateBillingUsageQueries(queryClient);
      }
      if (form.published) {
        const parkLoc =
          (typeof body.locationId === 'string' && body.locationId) ||
          scopedLocationId ||
          null;
        if (parkLoc) {
          // Franchise parks only — non-franchise location stamps use org Connect.
          let parkChargeReady: boolean | null = null;
          try {
            const parkRaw = await api<
              MaybeWrapped<{
                account: { chargeReady?: boolean; isFranchise?: boolean };
              }>
            >(
              `/api/admin/marketplace/park-accounts/${encodeURIComponent(parkLoc)}`
            );
            const parkAcct = unwrap(parkRaw)?.account;
            if (parkAcct?.isFranchise) {
              parkChargeReady = Boolean(parkAcct.chargeReady);
            }
          } catch {
            parkChargeReady = null;
          }
          if (parkChargeReady === false) {
            addToast(
              'Publish OK; park payouts not ready — online pay for this franchise park stays blocked until Connect completes on /admin/payouts.',
              'info'
            );
          } else if (parkChargeReady === null && !chargeReady) {
            addToast(
              'Publish OK; online pay blocked until payouts complete.',
              'info'
            );
          }
        } else if (!chargeReady) {
          addToast(
            'Publish OK; online pay blocked until payouts complete.',
            'info'
          );
        }
      }
      resetForm();
      await load();
    } catch (err) {
      addToast(errMessage(err, 'Failed to save package'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!window.confirm('Delete this booking package?')) return;
    setDeletingId(id);
    try {
      await api(`/api/admin/booking-packages/${id}`, { method: 'DELETE' });
      addToast('Package deleted', 'success');
      if (editingId === id) resetForm();
      invalidateBillingUsageQueries(queryClient);
      await load();
    } catch (err) {
      addToast(errMessage(err, 'Failed to delete package'), 'error');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {canManagePackages ? 'Booking packages' : 'Marketplace bookings'}
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            {canManagePackages
              ? 'Sell simple packages online. Open the guide if you are setting this up for the first time.'
              : 'Review and refund marketplace bookings. Open the guide for the full setup path.'}
          </p>
        </div>
        <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
      </div>

      <AdminHowToGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Booking packages"
        subtitle="Follow these steps in order — written for first-time admins."
        steps={BOOKING_PACKAGES_GUIDE_STEPS}
      />

      {canManagePackages && parkPayoutGap ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {parkPayoutGap.locationName} has a published package, but park
          payouts are not charge-ready yet. Guests for that franchise park stay
          blocked until Connect completes on{' '}
          <Link
            href={`/admin/payouts?locationId=${encodeURIComponent(parkPayoutGap.locationId)}`}
            className="font-semibold underline"
          >
            Park payouts
          </Link>
          .
        </div>
      ) : canManagePackages && !chargeReady ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Company payouts are not charge-ready yet. You can publish packages, but
          online card pay for company / null-location catalog stays blocked until
          Connect onboarding completes on{' '}
          <Link href="/admin/payouts" className="font-semibold underline">
            Payouts
          </Link>
          .
        </div>
      ) : null}

      {canManagePackages ? (
      <>
      {canWritePackage ? (
      <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">
          {editingId ? 'Edit package' : 'Create package'}
        </h2>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="bp-title"
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                Title
              </label>
              <input
                id="bp-title"
                value={form.title}
                onChange={(e) => {
                  const title = e.target.value;
                  setForm((prev) => ({
                    ...prev,
                    title,
                    slug: slugManual ? prev.slug : slugify(title),
                  }));
                }}
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                required
              />
            </div>
            <div>
              <label
                htmlFor="bp-slug"
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                Slug
              </label>
              <input
                id="bp-slug"
                value={form.slug}
                onChange={(e) => {
                  setSlugManual(true);
                  setForm((prev) => ({
                    ...prev,
                    slug: slugify(e.target.value),
                  }));
                }}
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                required
              />
            </div>
            <div>
              <label
                htmlFor="bp-amount"
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                Price (major units)
              </label>
              <input
                id="bp-amount"
                type="number"
                min="0"
                step="0.01"
                value={form.amountMajor}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, amountMajor: e.target.value }))
                }
                placeholder="50.00"
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                required
              />
              <p className="mt-1 text-xs text-stone-500">
                Enter major currency units (e.g. 50.00). Saved as minor units
                (×100) for the API.
              </p>
            </div>
            <div>
              <label
                htmlFor="bp-currency"
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                Currency
              </label>
              <input
                id="bp-currency"
                value={DEFAULT_MARKETPLACE_CURRENCY.toUpperCase()}
                readOnly
                className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm uppercase text-stone-700 focus:outline-none"
                aria-describedby="bp-currency-hint"
              />
              <p id="bp-currency-hint" className="mt-1 text-xs text-stone-500">
                Marketplace packages settle in USD (v1). Matches Connect payouts.
              </p>
            </div>
            <div>
              <label
                htmlFor="bp-capacity"
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                Capacity (optional)
              </label>
              <input
                id="bp-capacity"
                type="number"
                min="1"
                value={form.capacity}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, capacity: e.target.value }))
                }
                placeholder="Unlimited if blank"
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
              />
            </div>
            <div>
              <label
                htmlFor="bp-starts"
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                Sale starts (optional)
              </label>
              <input
                id="bp-starts"
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, startsAt: e.target.value }))
                }
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
              />
            </div>
            <div>
              <label
                htmlFor="bp-ends"
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                Sale ends (optional)
              </label>
              <input
                id="bp-ends"
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, endsAt: e.target.value }))
                }
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
              />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:pb-1">
              <label className="inline-flex items-center gap-2 text-sm text-stone-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.published}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      published: e.target.checked,
                    }))
                  }
                  className="rounded border-stone-300 text-[#D4AF37] focus:ring-[#D4AF37]"
                />
                Publish
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-stone-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      active: e.target.checked,
                    }))
                  }
                  className="rounded border-stone-300 text-[#D4AF37] focus:ring-[#D4AF37]"
                />
                Active
              </label>
            </div>
          </div>
          <div>
            <label
              htmlFor="bp-desc"
              className="block text-sm font-medium text-gray-700 mb-1.5"
            >
              Description
            </label>
            <textarea
              id="bp-desc"
              rows={3}
              value={form.description}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, description: e.target.value }))
              }
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
            />
          </div>

          {(() => {
            if (!form.published) return null;
            // Create/edit stamps location from HQ park filter / park-lock (body), not a form field.
            const formLoc = scopedLocationId?.trim() || null;
            const formIsFranchisePark =
              Boolean(formLoc) && parkChargeReadyById.has(formLoc!);
            const blocked = formIsFranchisePark
              ? parkChargeReadyById.get(formLoc!) === false
              : !chargeReady;
            if (!blocked) return null;
            return (
              <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                {formIsFranchisePark
                  ? 'Publish OK; online pay for this franchise park stays blocked until park payouts are charge-ready.'
                  : 'Publish OK; online pay blocked until company payouts complete.'}
              </p>
            );
          })()}

          {!editingId && createBlockedHint && (
            <p className="text-sm text-stone-600">{createBlockedHint}</p>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={saving || (!editingId && Boolean(createBlockedHint))}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#D4AF37] px-4 text-sm font-semibold text-stone-900 shadow-sm hover:bg-[#c4a030] disabled:opacity-50"
            >
              {saving && <ButtonSpinner />}
              {editingId ? 'Save changes' : 'Create package'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800"
              >
                Cancel edit
              </button>
            )}
          </div>
        </form>
      </section>
      ) : null}

      <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Packages</h2>
        {loading ? (
          <p className="text-sm text-stone-500">Loading…</p>
        ) : packages.length === 0 ? (
          <div className="rounded-xl border border-dashed border-stone-200 bg-stone-50 px-4 py-8 text-center space-y-2">
            <p className="text-sm text-stone-700">No booking packages yet.</p>
            <p className="text-xs text-stone-500">
              Complete{' '}
              <Link
                href="/admin/payouts"
                className="font-semibold text-stone-800 underline"
              >
                payouts setup
              </Link>{' '}
              to accept online payment, then create a package above.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-stone-100">
            {packages.map((pkg) => (
              <li
                key={pkg.id}
                className="py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              >
                <div>
                  <p className="text-sm font-semibold text-stone-900">
                    {pkg.title}
                    {pkg.published ? (
                      <span className="ml-2 text-xs font-medium text-emerald-700">
                        Published
                      </span>
                    ) : (
                      <span className="ml-2 text-xs font-medium text-stone-400">
                        Draft
                      </span>
                    )}
                    {!pkg.active && (
                      <span className="ml-2 text-xs font-medium text-rose-600">
                        Inactive
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-stone-500 mt-0.5">
                    {formatMoney(pkg.amountMinor, pkg.currency || DEFAULT_MARKETPLACE_CURRENCY)}
                    {pkg.capacity != null ? ` · cap ${pkg.capacity}` : ''}
                    {' · '}
                    <span className="font-mono">{pkg.slug}</span>
                    {pkg.startsAt || pkg.endsAt
                      ? ` · ${pkg.startsAt ? new Date(pkg.startsAt).toLocaleString() : '…'} → ${pkg.endsAt ? new Date(pkg.endsAt).toLocaleString() : '…'}`
                      : ''}
                  </p>
                  {publicOrgKey && pkg.published && (
                    <Link
                      href={`/book/${encodeURIComponent(publicOrgKey)}/${encodeURIComponent(pkg.slug)}`}
                      className="text-xs text-[#8a7420] underline-offset-2 hover:underline mt-1 inline-block"
                      target="_blank"
                    >
                      Public book link
                    </Link>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => startEdit(pkg)}
                    disabled={!canWritePackage}
                    className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-800 hover:border-stone-400 disabled:opacity-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={!canDeletePackage || deletingId === pkg.id}
                    onClick={() => void onDelete(pkg.id)}
                    className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:border-red-300 disabled:opacity-50"
                  >
                    {deletingId === pkg.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      </>
      ) : null}

      <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">
            Recent marketplace bookings
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Paid bookings can be refunded here (application fee refunded with the
            charge). Soft-hold / suspended companies cannot take new payments.
          </p>
        </div>
        {loading ? (
          <p className="text-sm text-stone-500">Loading…</p>
        ) : bookings.length === 0 ? (
          <p className="text-sm text-stone-500">No marketplace bookings yet.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {bookings.map((b) => {
              const refundable =
                canRefund &&
                (b.status === 'paid' || b.status === 'partially_refunded') &&
                b.refundableMinor > 0 &&
                b.hasPaymentIntent;
              return (
                <li
                  key={b.id}
                  className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                >
                  <div>
                    <p className="text-sm font-medium text-stone-900">
                      {b.packageTitle}{' '}
                      <span className="text-xs font-normal text-stone-500">
                        · {b.status}
                      </span>
                    </p>
                    <p className="text-xs text-stone-500">
                      {b.customerEmail} ·{' '}
                      {formatMoney(b.amountMinor, b.currency)}
                      {b.refundableMinor > 0 &&
                      b.refundableMinor < b.amountMinor
                        ? ` · refundable ${formatMoney(b.refundableMinor, b.currency)}`
                        : ''}
                    </p>
                  </div>
                  {refundable && (
                    <button
                      type="button"
                      disabled={refundingId === b.id}
                      onClick={() => void onRefund(b)}
                      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:border-amber-400 disabled:opacity-50 shrink-0"
                    >
                      {refundingId === b.id ? 'Refunding…' : 'Refund'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
