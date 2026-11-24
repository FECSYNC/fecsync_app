'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import {
  btnPrimaryClass,
  fieldClass,
} from '@/components/Protected/admin/pages/ticketing/ticketingUi';
import { ADMIN_LIST_STALE_MS } from '@/lib/adminListCache';
import { ADMIN_MEMBERSHIPS_SELL_MODAL_LIVE_MS } from '@/utils/adminLiveRefresh';
import {
  createMembershipGuest,
  getMembershipSettings,
  listMembershipPlans,
  membershipKeys,
  searchMembershipGuests,
  sellMembership,
} from '@/services/memberships';
import { notifyMembershipChange } from '@/lib/membershipsSync';
import { listAdminVenueLocations } from '@/services/venueLocations';

type Props = {
  open: boolean;
  onClose: () => void;
  canWrite: boolean;
  canSell: boolean;
  onSold?: (membershipId: string) => void;
};

/**
 * Modal: create guest profile (optional) + sell/assign a membership plan.
 */
export default function CreateMembershipMemberModal({
  open,
  onClose,
  canWrite,
  canSell,
  onSold,
}: Props) {
  const { addToast } = useToast();
  const qc = useQueryClient();
  const firstInputRef = useRef<HTMLInputElement | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [sendCredentialsEmail, setSendCredentialsEmail] = useState(true);
  const [sellGuestId, setSellGuestId] = useState('');
  const [sellPlanId, setSellPlanId] = useState('');
  const [sellLocationId, setSellLocationId] = useState('');
  const [sellHomeId, setSellHomeId] = useState('');
  const [sellPayment, setSellPayment] = useState<
    'collected' | 'pending' | 'stripe'
  >('collected');
  const [sellAmount, setSellAmount] = useState('');
  const [sellFamilyIds, setSellFamilyIds] = useState<string[]>([]);
  const sellIdemRef = useRef(`ui-sell:${crypto.randomUUID()}`);
  const homeTouched = useRef(false);

  const guestsQuery = useQuery({
    queryKey: membershipKeys.guests(''),
    queryFn: () => searchMembershipGuests(''),
    enabled: open && (canWrite || canSell),
    staleTime: open ? 0 : ADMIN_LIST_STALE_MS,
    refetchInterval: open ? ADMIN_MEMBERSHIPS_SELL_MODAL_LIVE_MS : false,
    refetchIntervalInBackground: false,
    refetchOnMount: open ? 'always' : false,
  });
  const plansQuery = useQuery({
    queryKey: membershipKeys.plans(false),
    queryFn: () => listMembershipPlans(),
    enabled: open && canSell,
    staleTime: open ? 0 : ADMIN_LIST_STALE_MS,
    refetchInterval: open ? ADMIN_MEMBERSHIPS_SELL_MODAL_LIVE_MS : false,
    refetchIntervalInBackground: false,
    refetchOnMount: open ? 'always' : false,
  });
  const settingsQuery = useQuery({
    queryKey: membershipKeys.settings(sellLocationId || null),
    queryFn: () => getMembershipSettings(sellLocationId || null),
    enabled: open && canSell,
    staleTime: 0,
    refetchInterval: open ? ADMIN_MEMBERSHIPS_SELL_MODAL_LIVE_MS : false,
    refetchIntervalInBackground: false,
    refetchOnMount: open ? 'always' : false,
  });
  const venuesQuery = useQuery({
    queryKey: ['admin', 'venue-locations', 'memberships-sell-modal'],
    queryFn: () => listAdminVenueLocations({ scope: 'all' }),
    enabled: open && canSell,
    staleTime: open ? 0 : ADMIN_LIST_STALE_MS,
    refetchInterval: open ? ADMIN_MEMBERSHIPS_SELL_MODAL_LIVE_MS : false,
    refetchIntervalInBackground: false,
  });

  const guests = guestsQuery.data ?? [];
  const plans = plansQuery.data ?? [];
  const venues = venuesQuery.data ?? [];

  useEffect(() => {
    if (!open) {
      homeTouched.current = false;
      return;
    }
    const t = window.setTimeout(() => firstInputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open]);

  // Follow Memberships → Settings default home until the operator picks one.
  useEffect(() => {
    if (!open || homeTouched.current || !settingsQuery.data) return;
    if ((settingsQuery.data.locationId ?? '') !== sellLocationId) return;
    const home = settingsQuery.data.defaultHomeLocationId ?? '';
    const active = venues.some(
      (v) => v.id === home && v.status === 'active'
    );
    setSellHomeId(home && active ? home : '');
  }, [open, sellLocationId, settingsQuery.data, venues]);

  // Clear plan selection if the plan was archived/removed while the modal is open.
  useEffect(() => {
    if (!open || !sellPlanId) return;
    if (!plans.some((p) => p.id === sellPlanId)) {
      setSellPlanId('');
    }
  }, [open, sellPlanId, plans]);

  const resetForm = () => {
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
    setPassword('');
    setPasswordConfirm('');
    setSendCredentialsEmail(true);
    setSellGuestId('');
    setSellPlanId('');
    setSellLocationId('');
    setSellHomeId('');
    homeTouched.current = false;
    setSellPayment('collected');
    setSellAmount('');
    setSellFamilyIds([]);
    sellIdemRef.current = `ui-sell:${crypto.randomUUID()}`;
  };

  const createGuestMutation = useMutation({
    mutationFn: () => {
      const pwd = password.trim();
      if (pwd) {
        if (!email.trim()) {
          throw new Error('Email is required when setting a dashboard password');
        }
        if (pwd.length < 8) {
          throw new Error('Password must be at least 8 characters');
        }
        if (pwd !== passwordConfirm.trim()) {
          throw new Error('Password confirmation does not match');
        }
      }
      return createMembershipGuest({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        ...(pwd
          ? {
              password: pwd,
              sendCredentialsEmail,
            }
          : {}),
      });
    },
    onSuccess: (guest) => {
      addToast(
        guest.accountNote ||
          (guest.userId
            ? 'Guest created and linked to existing customer account'
            : 'Guest profile created — now assign a plan'),
        'success'
      );
      setFirstName('');
      setLastName('');
      setEmail('');
      setPhone('');
      setPassword('');
      setPasswordConfirm('');
      setSendCredentialsEmail(true);
      setSellGuestId(guest.id);
      notifyMembershipChange(qc, {
        kind: 'guest',
        action: 'create',
        id: guest.id,
      });
    },
    onError: (err: Error) => addToast(err.message || 'Create failed', 'error'),
  });

  const sellMutation = useMutation({
    mutationFn: () =>
      sellMembership({
        guestProfileId: sellGuestId,
        planId: sellPlanId,
        locationId: sellLocationId,
        homeLocationId: sellHomeId || sellLocationId,
        paymentMethod: sellPayment,
        collectedAmount:
          sellPayment === 'collected' ? Number(sellAmount || 0) : undefined,
        familyMemberIds: sellFamilyIds.length ? sellFamilyIds : undefined,
        idempotencyKey: sellIdemRef.current,
        allowPendingWithoutStripe: sellPayment === 'stripe',
      }),
    onSuccess: (data) => {
      sellIdemRef.current = `ui-sell:${crypto.randomUUID()}`;
      addToast(data.note || 'Membership sold', 'success');
      notifyMembershipChange(qc, {
        kind: 'member',
        action: 'create',
        id: data.membership?.id,
      });
      const id = data.membership?.id;
      resetForm();
      onClose();
      if (id) onSold?.(id);
    },
    onError: (err: Error) => addToast(err.message || 'Sell failed', 'error'),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-member-title"
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-stone-200 bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2
              id="create-member-title"
              className="text-lg font-semibold text-stone-900"
            >
              Create member
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              Create a guest profile, then sell or assign a membership plan. Desk,
              POS, and linked online accounts all show in the Members table.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-stone-500 hover:bg-stone-100 hover:text-stone-800"
          >
            Close
          </button>
        </div>

        <div className="space-y-6">
          {canWrite ? (
            <form
              className="grid gap-3 rounded-xl border border-stone-100 bg-stone-50/80 p-4 sm:grid-cols-2"
              onSubmit={(ev: FormEvent) => {
                ev.preventDefault();
                createGuestMutation.mutate();
              }}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500 sm:col-span-2">
                Step 1 — Guest profile
              </p>
              <label className="block text-sm">
                <span className="text-stone-700">First name</span>
                <input
                  ref={firstInputRef}
                  className={fieldClass}
                  name="member-first-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                />
              </label>
              <label className="block text-sm">
                <span className="text-stone-700">Last name</span>
                <input
                  className={fieldClass}
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                />
              </label>
              <label className="block text-sm">
                <span className="text-stone-700">Email</span>
                <input
                  className={fieldClass}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Required if setting a password"
                  required={Boolean(password.trim())}
                />
              </label>
              <label className="block text-sm">
                <span className="text-stone-700">Phone</span>
                <input
                  className={fieldClass}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="text-stone-700">
                  Dashboard password{' '}
                  <span className="font-normal text-stone-500">(optional)</span>
                </span>
                <input
                  className={fieldClass}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  minLength={password.trim() ? 8 : undefined}
                />
              </label>
              <label className="block text-sm">
                <span className="text-stone-700">Confirm password</span>
                <input
                  className={fieldClass}
                  type="password"
                  autoComplete="new-password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  disabled={!password.trim()}
                  required={Boolean(password.trim())}
                />
              </label>
              <label className="flex items-start gap-2 text-sm text-stone-700 sm:col-span-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={sendCredentialsEmail}
                  onChange={(e) => setSendCredentialsEmail(e.target.checked)}
                  disabled={!password.trim()}
                />
                <span>
                  Email login details (email + temporary password + dashboard
                  link). Leave password blank to create the CRM profile only —
                  they get a set-password invite after sell or Invite dashboard.
                </span>
              </label>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  className={btnPrimaryClass}
                  disabled={createGuestMutation.isPending}
                >
                  {createGuestMutation.isPending ? <ButtonSpinner /> : null}
                  Create guest profile
                </button>
              </div>
            </form>
          ) : null}

          {canSell ? (
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(ev: FormEvent) => {
                ev.preventDefault();
                sellMutation.mutate();
              }}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500 sm:col-span-2">
                Step 2 — Sell / assign plan
              </p>
              <label className="block text-sm sm:col-span-2">
                <span className="text-stone-700">Guest</span>
                <select
                  className={fieldClass}
                  value={sellGuestId}
                  onChange={(e) => setSellGuestId(e.target.value)}
                  required
                >
                  <option value="">Select guest…</option>
                  {guests.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.displayName}
                      {g.email ? ` (${g.email})` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-stone-700">Plan</span>
                <select
                  className={fieldClass}
                  value={sellPlanId}
                  onChange={(e) => {
                    setSellPlanId(e.target.value);
                    const p = plans.find((x) => x.id === e.target.value);
                    if (p) setSellAmount(p.price);
                  }}
                  required
                >
                  <option value="">Select plan…</option>
                  {plans.map((p) => {
                    const badges: string[] = [];
                    if (p.categoryName) badges.push(p.categoryName);
                    if (p.hideFromOnlineSales) badges.push("hidden online");
                    if (p.membershipType === "group") badges.push("group");
                    const badge = badges.length ? ` [${badges.join(", ")}]` : "";
                    return (
                      <option key={p.id} value={p.id}>
                        {p.name} — {p.price} {p.currency} ({p.billing}){badge}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-stone-700">Sell venue</span>
                <select
                  className={fieldClass}
                  value={sellLocationId}
                  onChange={(e) => setSellLocationId(e.target.value)}
                  required
                >
                  <option value="">Select venue…</option>
                  {venues.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-stone-700">Home venue</span>
                <select
                  className={fieldClass}
                  value={sellHomeId}
                  onChange={(e) => {
                    homeTouched.current = true;
                    setSellHomeId(e.target.value);
                  }}
                >
                  <option value="">Same as sell venue</option>
                  {venues.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-stone-700">Payment</span>
                <select
                  className={fieldClass}
                  value={sellPayment}
                  onChange={(e) =>
                    setSellPayment(e.target.value as typeof sellPayment)
                  }
                >
                  <option value="collected">Collected at desk</option>
                  <option value="pending">Pending (no charge)</option>
                  <option value="stripe">Stripe (or pending if unset)</option>
                </select>
              </label>
              {sellPayment === 'collected' ? (
                <label className="block text-sm">
                  <span className="text-stone-700">Amount collected</span>
                  <input
                    className={fieldClass}
                    type="number"
                    step="0.01"
                    min="0"
                    value={sellAmount}
                    onChange={(e) => setSellAmount(e.target.value)}
                    required
                  />
                </label>
              ) : null}
              {plans.find((p) => p.id === sellPlanId)?.familyAllowed ? (
                <label className="block text-sm sm:col-span-2">
                  <span className="text-stone-700">
                    Family dependents (optional)
                  </span>
                  <select
                    className={fieldClass}
                    multiple
                    value={sellFamilyIds}
                    onChange={(e) =>
                      setSellFamilyIds(
                        Array.from(e.target.selectedOptions).map((o) => o.value)
                      )
                    }
                  >
                    {guests
                      .filter((g) => g.id !== sellGuestId)
                      .map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.displayName}
                          {g.email ? ` (${g.email})` : ''}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <button
                  type="submit"
                  className={btnPrimaryClass}
                  disabled={sellMutation.isPending}
                >
                  {sellMutation.isPending ? <ButtonSpinner /> : null}
                  Sell membership
                </button>
                <button
                  type="button"
                  className="rounded-md border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50"
                  onClick={onClose}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-stone-500">
              You can create guest profiles, but selling a plan needs
              memberships:sell.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
