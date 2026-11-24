'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import {
  bookingAccountKeys,
  listBookingAccounts,
  createBookingAccount,
} from '@/services/bookingAccounts';
import {
  btnPrimaryClass,
  btnSecondaryClass,
  fieldClass,
} from '../ticketing/ticketingUi';
import { ADMIN_LIST_STALE_MS, adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';
import { useHqLocationFilter } from '@/hooks/useHqLocationFilter';
import AdminHowToGuideModal, {
  AdminHowToGuideButton,
  BOOKING_ACCOUNTS_GUIDE_STEPS,
} from '@/components/Protected/admin/components/AdminHowToGuideModal';
import {
  listAdminVenueLocations,
  venueLocationKeys,
} from '@/services/venueLocations';

export default function BookingAccountsPage() {
  const { addToast } = useToast();
  const qc = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const canWrite = can(P.BookingAccountsWrite);
  const [guideOpen, setGuideOpen] = useState(false);
  const {
    locationId,
    setLocationId,
    scopedLocationId,
    scopedLocationName,
    parkLocked,
  } = useHqLocationFilter();

  const [name, setName] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [taxId, setTaxId] = useState('');
  const [notes, setNotes] = useState('');
  const [defaultTaxExempt, setDefaultTaxExempt] = useState(false);

  const venuesKey = venueLocationKeys.list('all');
  const venuesQuery = useQuery({
    queryKey: venuesKey,
    queryFn: () => listAdminVenueLocations({ scope: 'all' }),
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(venuesKey),
    placeholderData: (previous) => previous,
  });

  const venues = (venuesQuery.data ?? []).filter((v) => {
    if (v.status === 'archived') return false;
    if (scopedLocationId) return v.id === scopedLocationId;
    if (parkLocked) {
      const assigned = new Set(user?.assignedLocationIds ?? []);
      return assigned.has(v.id);
    }
    return true;
  });

  const accountsKey = bookingAccountKeys.list();
  const listQuery = useQuery({
    queryKey: accountsKey,
    queryFn: listBookingAccounts,
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(accountsKey),
    placeholderData: (previous) => previous,
  });

  const createMutation = useMutation({
    mutationFn: createBookingAccount,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: bookingAccountKeys.all });
    },
  });

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    const stampLocationId =
      locationId || scopedLocationId || (parkLocked ? venues[0]?.id : '') || '';
    if (parkLocked && !stampLocationId) {
      addToast('Select an assigned park before creating a company', 'error');
      return;
    }
    try {
      await createMutation.mutateAsync({
        name: name.trim(),
        billingEmail: billingEmail.trim() || null,
        phone: phone.trim() || null,
        taxId: taxId.trim() || null,
        notes: notes.trim() || null,
        defaultTaxExempt,
        locationId: stampLocationId || null,
      });
      addToast('Company created', 'success');
      setName('');
      setBillingEmail('');
      setPhone('');
      setTaxId('');
      setNotes('');
      setDefaultTaxExempt(false);
      if (!parkLocked && !scopedLocationId) setLocationId('');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Could not create company',
        'error'
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[#D4AF37]">
            Bookings
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-stone-900">
            B2B companies
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Corporate booking clients and contacts — not SaaS admin logins. Open
            the guide if you are doing this for the first time.
          </p>
        </div>
        <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
      </div>

      <AdminHowToGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="B2B companies"
        subtitle="Follow these steps in order — written for first-time admins."
        steps={BOOKING_ACCOUNTS_GUIDE_STEPS}
      />

      {canWrite ? (
        <form
          onSubmit={onCreate}
          className="max-w-xl space-y-3 rounded-lg border border-stone-200 bg-white p-4"
        >
          <h2 className="text-sm font-semibold text-stone-800">Add company</h2>
          <input
            required
            minLength={2}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Legal / trading name"
            className={fieldClass}
          />
          {!parkLocked && !scopedLocationId ? (
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className={fieldClass}
              aria-label="Park / venue"
            >
              <option value="">Company-shared (all parks)</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-stone-500">
              Stamped to{' '}
              {scopedLocationName ||
                venues.find((v) => v.id === (locationId || scopedLocationId))
                  ?.name ||
                'assigned park'}
              .
            </p>
          )}
          <input
            type="email"
            value={billingEmail}
            onChange={(e) => setBillingEmail(e.target.value)}
            placeholder="Billing email"
            className={fieldClass}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone"
              className={fieldClass}
            />
            <input
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              placeholder="Tax ID"
              className={fieldClass}
            />
          </div>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes"
            className={fieldClass}
          />
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={defaultTaxExempt}
              onChange={(e) => setDefaultTaxExempt(e.target.checked)}
            />
            Default tax exempt
          </label>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className={btnPrimaryClass}
          >
            {createMutation.isPending ? <ButtonSpinner /> : null}
            Create company
          </button>
        </form>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Billing email</th>
              <th className="px-4 py-3 font-semibold">Contacts</th>
              <th className="px-4 py-3 font-semibold">Bookings</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {listQuery.isPending && !(listQuery.data?.length) ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-stone-500">
                  Loading…
                </td>
              </tr>
            ) : (listQuery.data ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-stone-500">
                  No companies yet.
                </td>
              </tr>
            ) : (
              (listQuery.data ?? []).map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-3 font-medium text-stone-900">
                    {a.name}
                  </td>
                  <td className="px-4 py-3 text-stone-600">
                    {a.billingEmail ?? '—'}
                  </td>
                  <td className="px-4 py-3">{a.contactsCount}</td>
                  <td className="px-4 py-3">{a.bookingsCount}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/booking-accounts/${a.id}`}
                      className={btnSecondaryClass}
                    >
                      View / Edit
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
