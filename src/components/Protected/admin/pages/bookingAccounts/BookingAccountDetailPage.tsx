'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import {
  bookingAccountKeys,
  getBookingAccount,
  patchBookingAccount,
  createBookingAccountContact,
} from '@/services/bookingAccounts';
import {
  adminBookingKeys,
  listAdminBookings,
} from '@/services/adminBookings';
import {
  adminInvoiceKeys,
  listAdminBookingInvoices,
} from '@/services/adminBookingInvoices';
import {
  btnPrimaryClass,
  fieldClass,
} from '../ticketing/ticketingUi';
import AdminPendingLink from '@/components/Protected/admin/components/AdminPendingLink';

export default function BookingAccountDetailPage() {
  const params = useParams();
  const accountId = String(params?.accountId ?? '');
  const { addToast } = useToast();
  const qc = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.BookingAccountsWrite);
  const canReadBookings = can(P.BookingsRead);
  const canCreateBooking =
    can(P.BookingsCreate) || can(P.BookingsWrite);
  const canReadInvoices = can(P.BookingInvoicesRead);

  const detailQuery = useQuery({
    queryKey: bookingAccountKeys.detail(accountId),
    queryFn: () => getBookingAccount(accountId),
    enabled: Boolean(accountId),
  });

  const account = detailQuery.data;
  const [name, setName] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [taxId, setTaxId] = useState('');
  const [notes, setNotes] = useState('');
  const [defaultTaxExempt, setDefaultTaxExempt] = useState(false);

  const bookingsQuery = useQuery({
    queryKey: adminBookingKeys.list({ accountId }),
    queryFn: () => listAdminBookings({ accountId }),
    enabled: Boolean(accountId) && canReadBookings,
  });

  const invoicesQuery = useQuery({
    queryKey: adminInvoiceKeys.list({ accountId }),
    queryFn: () => listAdminBookingInvoices({ accountId }),
    enabled: Boolean(accountId) && canReadInvoices,
  });
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [title, setTitle] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);

  useEffect(() => {
    if (!account) return;
    setName(account.name);
    setBillingEmail(account.billingEmail ?? '');
    setPhone(account.phone ?? '');
    setTaxId(account.taxId ?? '');
    setNotes(account.notes ?? '');
    setDefaultTaxExempt(account.defaultTaxExempt);
  }, [account]);

  const patchMutation = useMutation({
    mutationFn: () =>
      patchBookingAccount(accountId, {
        name: name.trim(),
        billingEmail: billingEmail.trim() || null,
        phone: phone.trim() || null,
        taxId: taxId.trim() || null,
        notes: notes.trim() || null,
        defaultTaxExempt,
      }),
    onSuccess: (data) => {
      qc.setQueryData(bookingAccountKeys.detail(accountId), data);
      void qc.invalidateQueries({ queryKey: bookingAccountKeys.list() });
    },
  });

  const contactMutation = useMutation({
    mutationFn: () =>
      createBookingAccountContact(accountId, {
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
        email: contactEmail.trim() || null,
        phone: contactPhone.trim() || null,
        title: title.trim() || null,
        isPrimary,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: bookingAccountKeys.detail(accountId),
      });
    },
  });

  if (detailQuery.isLoading) {
    return <p className="py-10 text-sm text-stone-500">Loading company…</p>;
  }
  if (detailQuery.isError || !account) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-600">
          {(detailQuery.error as Error)?.message || 'Company not found'}
        </p>
        <Link href="/admin/booking-accounts" className="text-sm text-[#D4AF37]">
          Back to companies
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/booking-accounts"
          className="text-sm text-stone-500 hover:text-[#D4AF37]"
        >
          ← Companies
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-stone-900">
          {account.name}
        </h1>
      </div>

      <form
        className="max-w-xl space-y-3 rounded-lg border border-stone-200 bg-white p-4"
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          if (!canWrite) return;
          try {
            await patchMutation.mutateAsync();
            addToast('Company updated', 'success');
          } catch (err) {
            addToast(
              err instanceof Error ? err.message : 'Update failed',
              'error'
            );
          }
        }}
      >
        <h2 className="text-sm font-semibold text-stone-800">Company details</h2>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={fieldClass}
          disabled={!canWrite}
          required
        />
        <input
          type="email"
          value={billingEmail}
          onChange={(e) => setBillingEmail(e.target.value)}
          className={fieldClass}
          disabled={!canWrite}
          placeholder="Billing email"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={fieldClass}
            disabled={!canWrite}
            placeholder="Phone"
          />
          <input
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            className={fieldClass}
            disabled={!canWrite}
            placeholder="Tax ID"
          />
        </div>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={fieldClass}
          disabled={!canWrite}
        />
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={defaultTaxExempt}
            onChange={(e) => setDefaultTaxExempt(e.target.checked)}
            disabled={!canWrite}
          />
          Default tax exempt
        </label>
        {canWrite ? (
          <button
            type="submit"
            disabled={patchMutation.isPending}
            className={btnPrimaryClass}
          >
            {patchMutation.isPending ? <ButtonSpinner /> : null}
            Save
          </button>
        ) : null}
      </form>

      <div className="rounded-lg border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-800">Contacts</h2>
        </div>
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-stone-100 bg-stone-50 text-xs uppercase text-stone-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Phone</th>
              <th className="px-4 py-2">Title</th>
              <th className="px-4 py-2">Primary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {(account.contacts ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-stone-500">
                  No contacts yet.
                </td>
              </tr>
            ) : (
              (account.contacts ?? []).map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2">
                    {[c.firstName, c.lastName].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="px-4 py-2">{c.email ?? '—'}</td>
                  <td className="px-4 py-2">{c.phone ?? '—'}</td>
                  <td className="px-4 py-2">{c.title ?? '—'}</td>
                  <td className="px-4 py-2">{c.isPrimary ? 'Yes' : 'No'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {canWrite ? (
          <form
            className="grid gap-2 border-t border-stone-100 p-4 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await contactMutation.mutateAsync();
                addToast('Contact added', 'success');
                setFirstName('');
                setLastName('');
                setContactEmail('');
                setContactPhone('');
                setTitle('');
                setIsPrimary(false);
              } catch (err) {
                addToast(
                  err instanceof Error ? err.message : 'Could not add contact',
                  'error'
                );
              }
            }}
          >
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              className={fieldClass}
            />
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
              className={fieldClass}
            />
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="Email"
              className={fieldClass}
            />
            <input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="Phone"
              className={fieldClass}
            />
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              className={fieldClass}
            />
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isPrimary}
                onChange={(e) => setIsPrimary(e.target.checked)}
              />
              Primary contact
            </label>
            <button
              type="submit"
              disabled={contactMutation.isPending}
              className={btnPrimaryClass}
            >
              {contactMutation.isPending ? <ButtonSpinner /> : null}
              Add contact
            </button>
          </form>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
          <h2 className="font-semibold text-stone-800">Bookings</h2>
          {!canReadBookings ? (
            <p className="mt-2 text-stone-500">You need bookings:read to list them.</p>
          ) : bookingsQuery.isLoading &&
            !(bookingsQuery.data?.bookings?.length) ? (
            <p className="mt-2 text-stone-500">Loading…</p>
          ) : (bookingsQuery.data?.bookings ?? []).length === 0 ? (
            <div className="mt-2 space-y-2">
              <p className="text-sm text-stone-500">
                No bookings for this company yet.
              </p>
              {canCreateBooking ? (
                <AdminPendingLink
                  href={`/admin/bookings/new?accountId=${encodeURIComponent(accountId)}`}
                  className={`${btnPrimaryClass} inline-flex text-xs`}
                >
                  Create booking for company
                </AdminPendingLink>
              ) : null}
            </div>
          ) : (
            <ul className="mt-2 space-y-1">
              {(bookingsQuery.data?.bookings ?? []).slice(0, 8).map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/admin/bookings/${b.id}`}
                    className="text-[#D4AF37]"
                  >
                    {b.publicId}
                  </Link>{' '}
                  <span className="text-stone-500">{b.status}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-3">
            {canCreateBooking ? (
              <AdminPendingLink
                href={`/admin/bookings/new?accountId=${encodeURIComponent(accountId)}`}
                className="text-xs font-medium text-[#D4AF37]"
              >
                Create booking
              </AdminPendingLink>
            ) : null}
            {canReadBookings ? (
              <Link
                href={`/admin/bookings?accountId=${encodeURIComponent(accountId)}`}
                className="text-xs font-medium text-[#D4AF37]"
              >
                View all on bookings list
              </Link>
            ) : null}
          </div>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
          <h2 className="font-semibold text-stone-800">Stored cards</h2>
          {(account.storedCards ?? []).length === 0 ? (
            <p className="mt-2 text-stone-500">
              No cards on file. Charge stored methods from a booking after a card
              is saved to this company.
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {(account.storedCards ?? []).map((c) => (
                <li key={c.id} className="font-mono text-xs text-stone-700">
                  {(c.brand || 'Card').toUpperCase()} ···· {c.last4 ?? '????'}
                  {c.expMonth && c.expYear
                    ? ` · ${c.expMonth}/${c.expYear}`
                    : ''}
                  {c.isDefault ? ' · default' : ''}
                  <span className="ml-2 text-stone-400">{c.id.slice(0, 8)}…</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
          <h2 className="font-semibold text-stone-800">Invoices</h2>
          {!canReadInvoices ? (
            <p className="mt-2 text-stone-500">You need booking_invoices:read.</p>
          ) : invoicesQuery.isLoading && !(invoicesQuery.data?.length) ? (
            <p className="mt-2 text-stone-500">Loading…</p>
          ) : (invoicesQuery.data ?? []).length === 0 ? (
            <p className="mt-2 text-stone-500">No invoices for this company yet.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {(invoicesQuery.data ?? []).slice(0, 8).map((inv) => (
                <li key={inv.id}>
                  <Link
                    href={`/admin/booking-invoices/${inv.id}`}
                    className="text-[#D4AF37]"
                  >
                    {inv.number}
                  </Link>{' '}
                  <span className="text-stone-500">{inv.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
