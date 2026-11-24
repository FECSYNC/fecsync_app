'use client';

/**
 * ROLLER-style Alternate address fields (shown when the option is checked).
 * Live venue list powers “Copy from park” so staff stay in sync with Venues.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ALTERNATE_ADDRESS_LIMITS,
  isPlausibleWebsite,
  normalizeWebsite,
  venueToAlternateAddress,
  type AlternateAddressDetails,
} from '@/lib/memberships/alternateAddress';
import { fieldClass } from '@/components/Protected/admin/pages/ticketing/ticketingUi';
import { ADMIN_LIST_STALE_MS, adminListQueryDefaults } from '@/lib/adminListCache';
import { ADMIN_MEMBERSHIPS_MODAL_LIVE_MS } from '@/utils/adminLiveRefresh';
import {
  listAdminVenueLocations,
  venueLocationKeys,
  type VenueLocationDto,
} from '@/services/venueLocations';

type Props = {
  value: AlternateAddressDetails;
  onChange: (next: AlternateAddressDetails) => void;
  disabled?: boolean;
  /** Keep venue list warm/live while the plan modal is open. */
  live?: boolean;
};

function CharCount({
  current,
  max,
  warnAt = 0.9,
}: {
  current: number;
  max: number;
  warnAt?: number;
}) {
  const hot = current >= max * warnAt;
  return (
    <span
      className={`tabular-nums text-[11px] ${
        hot ? 'font-medium text-amber-700' : 'text-stone-400'
      }`}
    >
      {current} / {max}
    </span>
  );
}

function FieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-600">{message}</p>;
}

export default function MembershipAlternateAddressFields(props: Props) {
  const { value, onChange, disabled, live = true } = props;
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [venueId, setVenueId] = useState('');

  const venuesQuery = useQuery({
    queryKey: venueLocationKeys.list('all'),
    queryFn: () => listAdminVenueLocations({ scope: 'all' }),
    enabled: live,
    ...adminListQueryDefaults,
    staleTime: live ? 0 : ADMIN_LIST_STALE_MS,
    refetchInterval: live ? ADMIN_MEMBERSHIPS_MODAL_LIVE_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: live,
    placeholderData: (prev) => prev,
  });

  const venues = useMemo(() => {
    const rows: VenueLocationDto[] = venuesQuery.data ?? [];
    return rows
      .filter((v) => v.status !== 'archived' && !v.archivedAt)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [venuesQuery.data]);

  // Drop selection if the park was archived while the modal is open.
  useEffect(() => {
    if (!venueId) return;
    if (!venues.some((v) => v.id === venueId)) setVenueId('');
  }, [venues, venueId]);

  function patch(partial: Partial<AlternateAddressDetails>) {
    onChange({ ...value, ...partial });
  }

  function mark(field: string) {
    setTouched((t) => ({ ...t, [field]: true }));
  }

  const nameErr =
    touched.name && !value.name.trim() ? 'Name is required' : null;
  const addressErr = touched.address
    ? !value.address.trim()
      ? 'Address is required'
      : value.address.length > ALTERNATE_ADDRESS_LIMITS.address
        ? `Max ${ALTERNATE_ADDRESS_LIMITS.address} characters`
        : null
    : null;
  const emailErr =
    touched.email &&
    value.email.trim() &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim())
      ? 'Enter a valid email'
      : null;
  const websiteErr =
    touched.website &&
    value.website.trim() &&
    !isPlausibleWebsite(value.website)
      ? 'Enter a valid website URL'
      : null;

  function applyVenue(id: string) {
    setVenueId(id);
    const venue = venues.find((v) => v.id === id);
    if (!venue) return;
    onChange(venueToAlternateAddress(venue));
    setTouched({
      name: true,
      address: true,
      email: Boolean(venue.franchiseSupportEmail),
      contactNumber: Boolean(venue.franchiseSupportPhone),
    });
  }

  const inputRing = (err: string | null) =>
    err
      ? `${fieldClass} border-red-300 focus:border-red-400 focus:ring-red-200`
      : fieldClass;

  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-gradient-to-b from-stone-50/80 to-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-100 bg-white/80 px-3.5 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-stone-800">
            Guest-facing location
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-stone-500">
            Shown when this membership uses a different place than your main
            park. Copy from a venue to stay in sync with Locations.
          </p>
        </div>
        {venuesQuery.isFetching ? (
          <span className="shrink-0 text-[11px] text-stone-400">
            Syncing parks…
          </span>
        ) : null}
      </div>

      <div className="space-y-3.5 p-3.5 sm:p-4">
        {venues.length > 0 ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="block min-w-0 flex-1 text-sm">
              <span className="text-stone-600">Copy from park</span>
              <select
                className={`${fieldClass} mt-1`}
                value={venueId}
                disabled={disabled || venuesQuery.isLoading}
                onChange={(e) => applyVenue(e.target.value)}
              >
                <option value="">Select a park…</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.city ? ` · ${v.city}` : ''}
                  </option>
                ))}
              </select>
            </label>
            {venueId ? (
              <button
                type="button"
                className="shrink-0 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                disabled={disabled}
                onClick={() => applyVenue(venueId)}
              >
                Refresh from park
              </button>
            ) : null}
          </div>
        ) : null}

        <label className="block text-sm">
          <span className="flex items-center justify-between gap-2 text-stone-700">
            <span>
              Name <span className="text-red-600">*</span>
            </span>
            <CharCount
              current={value.name.length}
              max={ALTERNATE_ADDRESS_LIMITS.name}
            />
          </span>
          <input
            className={`mt-1 ${inputRing(nameErr)}`}
            value={value.name}
            maxLength={ALTERNATE_ADDRESS_LIMITS.name}
            disabled={disabled}
            required
            autoComplete="organization"
            placeholder="Location or business name"
            onBlur={() => mark('name')}
            onChange={(e) => patch({ name: e.target.value })}
          />
          <FieldError message={nameErr} />
        </label>

        <label className="block text-sm">
          <span className="flex items-center justify-between gap-2 text-stone-700">
            <span>
              Address <span className="text-red-600">*</span>
            </span>
            <CharCount
              current={value.address.length}
              max={ALTERNATE_ADDRESS_LIMITS.address}
            />
          </span>
          <textarea
            className={`mt-1 min-h-[4.5rem] resize-y ${inputRing(addressErr)}`}
            value={value.address}
            maxLength={ALTERNATE_ADDRESS_LIMITS.address}
            disabled={disabled}
            required
            rows={2}
            autoComplete="street-address"
            placeholder="Street, city, postcode"
            onBlur={() => mark('address')}
            onChange={(e) => patch({ address: e.target.value })}
          />
          <FieldError message={addressErr} />
        </label>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <label className="block text-sm sm:col-span-2">
            <span className="flex items-center justify-between gap-2 text-stone-700">
              <span>Website</span>
              <CharCount
                current={value.website.length}
                max={ALTERNATE_ADDRESS_LIMITS.website}
              />
            </span>
            <input
              className={`mt-1 ${inputRing(websiteErr)}`}
              type="url"
              inputMode="url"
              placeholder="https://"
              value={value.website}
              maxLength={ALTERNATE_ADDRESS_LIMITS.website}
              disabled={disabled}
              autoComplete="url"
              onBlur={() => {
                mark('website');
                if (value.website.trim()) {
                  patch({ website: normalizeWebsite(value.website) });
                }
              }}
              onChange={(e) => patch({ website: e.target.value })}
            />
            <FieldError message={websiteErr} />
          </label>

          <label className="block text-sm">
            <span className="flex items-center justify-between gap-2 text-stone-700">
              <span>Email</span>
              <CharCount
                current={value.email.length}
                max={ALTERNATE_ADDRESS_LIMITS.email}
              />
            </span>
            <input
              className={`mt-1 ${inputRing(emailErr)}`}
              type="email"
              inputMode="email"
              placeholder="hello@example.com"
              value={value.email}
              maxLength={ALTERNATE_ADDRESS_LIMITS.email}
              disabled={disabled}
              autoComplete="email"
              onBlur={() => mark('email')}
              onChange={(e) => patch({ email: e.target.value })}
            />
            <FieldError message={emailErr} />
          </label>

          <label className="block text-sm">
            <span className="flex items-center justify-between gap-2 text-stone-700">
              <span>Contact number</span>
              <CharCount
                current={value.contactNumber.length}
                max={ALTERNATE_ADDRESS_LIMITS.contactNumber}
              />
            </span>
            <input
              className={`mt-1 ${fieldClass}`}
              type="tel"
              inputMode="tel"
              placeholder="+1 …"
              value={value.contactNumber}
              maxLength={ALTERNATE_ADDRESS_LIMITS.contactNumber}
              disabled={disabled}
              autoComplete="tel"
              onChange={(e) => patch({ contactNumber: e.target.value })}
            />
          </label>
        </div>

        {(value.name.trim() || value.address.trim()) && (
          <div className="rounded-lg border border-[#D4AF37]/35 bg-[#D4AF37]/08 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8a7020]">
              Preview
            </p>
            <p className="mt-0.5 text-sm font-medium text-stone-900">
              {value.name.trim() || 'Untitled location'}
            </p>
            {value.address.trim() ? (
              <p className="mt-0.5 text-xs text-stone-600">{value.address.trim()}</p>
            ) : null}
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-stone-500">
              {value.website.trim() ? <span>{normalizeWebsite(value.website)}</span> : null}
              {value.email.trim() ? <span>{value.email.trim()}</span> : null}
              {value.contactNumber.trim() ? (
                <span>{value.contactNumber.trim()}</span>
              ) : null}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
