'use client';

import { useEffect, useState } from 'react';
import {
  useCreateTailorMutation,
  useUpdateTailorMutation,
} from '@/hooks/useTailors';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import { useToast } from '@/contexts/toast-context';
import type { TailorProfileDto, TailorStatus } from '@/lib/tailors.shared';
import { slugifyTailorName } from '@/lib/tailors.shared';
import { countrySelectOptions } from '@/lib/countries';
import { useAuthStore } from '@/store/authStore';
import { useBillingUsageQuery } from '@/hooks/useBilling';
import { usageMeterFor } from '@/services/billing';
import {
  BILLING_REQUIRED_MESSAGE,
  softGateBlockedMessage,
} from '@/utils/planLimitSoftGate';
import { isStorefrontOrgSession } from '@/services/auth';
import { P } from '@/lib/auth/permissions';

type Props = {
  mode: 'create' | 'edit';
  tailor: TailorProfileDto | null;
  onClose: () => void;
  onSaved: () => void;
};

const STATUSES: TailorStatus[] = ['draft', 'pending', 'approved', 'suspended'];

export default function TailorEditModal({
  mode,
  tailor,
  onClose,
  onSaved,
}: Props) {
  const { addToast } = useToast();
  const createMutation = useCreateTailorMutation();
  const updateMutation = useUpdateTailorMutation();
  const user = useAuthStore((s) => s.user);
  const can = useAuthStore((s) => s.can);

  const canLoadUsage =
    !isStorefrontOrgSession(user) &&
    (can(P.SettingsManage) ||
      can(P.AnalyticsRead) ||
      can(P.UsersInvite) ||
      can(P.UsersManageRoles) ||
      can(P.TailorsManage));
  const usageQuery = useBillingUsageQuery(canLoadUsage);
  const membersMeter = usageMeterFor(usageQuery.data, 'members');
  const tailorSeatsMeter = usageMeterFor(usageQuery.data, 'tailorSeats');
  const [userId, setUserId] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [slug, setSlug] = useState('');
  const [bio, setBio] = useState('');
  const [specialties, setSpecialties] = useState('');
  const [serviceTypes, setServiceTypes] = useState('');
  const [pricingNotes, setPricingNotes] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [country, setCountry] = useState('');
  const [status, setStatus] = useState<TailorStatus>('pending');
  const [error, setError] = useState<string | null>(null);

  // Create needs a new seat unless the target user already occupies one
  // (reserved invite / live studio — mirrors assertNewTailorSeat).
  // Leaving suspended re-enters the meter when the studio was freed.
  const leavingSuspended =
    mode === 'edit' &&
    tailor?.status === 'suspended' &&
    status !== 'suspended';
  const createTargetUserId = userId.trim();
  const emailOnlyCreate =
    mode === 'create' && !createTargetUserId && Boolean(userEmail.trim());
  const alreadyOccupiesSeat = Boolean(
    mode === 'create' &&
      createTargetUserId &&
      usageQuery.data?.tailorSeatOccupantUserIds?.includes(createTargetUserId)
  );
  // Email-only create: cannot resolve occupant client-side — do not false-block;
  // server assertNewTailorSeat remains authoritative.
  const needsSeat =
    leavingSuspended ||
    (mode === 'create' && !alreadyOccupiesSeat && !emailOnlyCreate);
  const usageReady = !canLoadUsage || Boolean(usageQuery.data);
  const campaignsMeter = usageMeterFor(usageQuery.data, 'campaigns');
  const clientsMeter = usageMeterFor(usageQuery.data, 'tailorClients');
  // Fail-closed while loading or on usage API error when a seat is required —
  // server still enforces, but UX must not invite a submit that will 403.
  const seatsBlocked =
    needsSeat &&
    canLoadUsage &&
    (usageQuery.isError ||
      !usageReady ||
      !tailorSeatsMeter ||
      (!tailorSeatsMeter.unlimited &&
        (tailorSeatsMeter.remaining ?? 0) <= 0));
  // Leaving suspended also re-includes retained campaigns/clients in org meters.
  // Without per-studio counts we only hard-block when the org is already at cap
  // (remaining 0) — empty studios at cap still need the server roster assert.
  const rosterBlocked =
    leavingSuspended &&
    canLoadUsage &&
    !usageQuery.isError &&
    usageReady &&
    ((campaignsMeter &&
      !campaignsMeter.unlimited &&
      (campaignsMeter.remaining ?? 0) <= 0 &&
      campaignsMeter.used > 0) ||
      (clientsMeter &&
        !clientsMeter.unlimited &&
        (clientsMeter.remaining ?? 0) <= 0 &&
        clientsMeter.used > 0));
  const atSeatLimit = seatsBlocked || Boolean(rosterBlocked);

  useEffect(() => {
    if (mode === 'edit' && tailor) {
      setUserId(tailor.user);
      setUserEmail(tailor.userEmail ?? '');
      setDisplayName(tailor.displayName);
      setSlug(tailor.slug);
      setBio(tailor.bio);
      setSpecialties(tailor.specialties.join(', '));
      setServiceTypes(tailor.serviceTypes.join(', '));
      setPricingNotes(tailor.pricingNotes);
      setCity(tailor.location.city ?? '');
      setState(tailor.location.state ?? '');
      setCountry(tailor.location.country ?? '');
      setStatus(tailor.status);
    } else {
      setUserId('');
      setUserEmail('');
      setDisplayName('');
      setSlug('');
      setBio('');
      setSpecialties('');
      setServiceTypes('');
      setPricingNotes('');
      setCity('');
      setState('');
      setCountry('');
      setStatus('pending');
    }
    setError(null);
  }, [mode, tailor]);

  const parseList = (raw: string) =>
    raw
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

  const saving = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (atSeatLimit) {
      const msg =
        usageQuery.data?.billingEntitled === false
          ? BILLING_REQUIRED_MESSAGE
          : usageQuery.isError
            ? 'Could not verify plan capacity — try again'
            : rosterBlocked
              ? `Cannot restore studio — org is at campaign or client plan capacity on the ${usageQuery.data?.planResolved ?? 'current'} plan`
              : softGateBlockedMessage(usageQuery.data, 'tailorSeats', {
                  atLimit: true,
                  usageReady: usageReady && Boolean(tailorSeatsMeter),
                }) ?? 'Could not verify plan capacity';
      setError(msg);
      addToast(msg, 'error');
      return;
    }
    try {
      if (mode === 'create') {
        const email = userEmail.trim();
        const id = userId.trim();
        if (!email && !id) {
          setError('Enter a user email or user ID');
          return;
        }
        // Prefer email when both are set — avoids a stale/wrong ObjectId blocking create.
        await createMutation.mutateAsync({
          ...(email ? { userEmail: email } : { userId: id }),
          displayName: displayName.trim() || undefined,
          slug: slug.trim() ? slugifyTailorName(slug) : undefined,
          bio,
          specialties: parseList(specialties),
          serviceTypes: parseList(serviceTypes),
          pricingNotes,
          location: { city, state, country },
          status,
        });
        addToast(
          'Tailor created — studio access email sent to their inbox',
          'success'
        );
      } else if (tailor) {
        await updateMutation.mutateAsync({
          id: tailor._id,
          payload: {
            displayName: displayName.trim(),
            slug: slug.trim() ? slugifyTailorName(slug) : undefined,
            bio,
            specialties: parseList(specialties),
            serviceTypes: parseList(serviceTypes),
            pricingNotes,
            location: { city, state, country },
            status,
          },
        });
        addToast('Tailor updated', 'success');
      }
      onSaved();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to save tailor';
      setError(message);
      addToast(message, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {mode === 'create' ? 'Add tailor' : 'Edit tailor'}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {mode === 'create'
                ? 'Link an existing user to a tailor profile.'
                : 'Update profile details or status.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {tailorSeatsMeter ? (
          <p className="mb-4 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
            {usageQuery.data?.billingEntitled === false
              ? BILLING_REQUIRED_MESSAGE
              : tailorSeatsMeter.unlimited
                ? `Tailor seats: ${tailorSeatsMeter.used} used (unlimited on ${usageQuery.data?.planResolved ?? 'plan'})`
                : `Tailor seats: ${tailorSeatsMeter.used}/${tailorSeatsMeter.limit} used · ${tailorSeatsMeter.remaining ?? 0} remaining`}
            {usageQuery.data?.billingEntitled !== false &&
            mode === 'create' &&
            membersMeter &&
            !membersMeter.unlimited
              ? ` · Team seats: ${membersMeter.used}/${membersMeter.limit}`
              : null}
          </p>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'create' && (
            <div className="space-y-2">
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Link user
              </label>
              <input
                value={userEmail}
                onChange={(e) => setUserEmail(e.target.value)}
                placeholder="User email (recommended)"
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                autoComplete="email"
              />
              <input
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="Or paste user ID (CUID)"
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono"
              />
              <p className="text-xs text-gray-500">
                Ops can link by email without Users → View permission. The user
                account must already exist. After create, they get an email with a
                link to open their tailor studio.
              </p>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Display name
            </label>
            <input
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                if (mode === 'create' && !slug) {
                  setSlug(slugifyTailorName(e.target.value));
                }
              }}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              required={mode === 'edit'}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Slug
            </label>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              placeholder="auto from display name"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Bio
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                City
              </label>
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                State
              </label>
              <input
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Country
              </label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">Select country</option>
                {countrySelectOptions(country).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Specialties (comma-separated)
            </label>
            <input
              value={specialties}
              onChange={(e) => setSpecialties(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              placeholder="Bridal, Agbada, Alterations"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Service types (comma-separated)
            </label>
            <input
              value={serviceTypes}
              onChange={(e) => setServiceTypes(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              placeholder="Bespoke, Ready-to-wear"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Pricing notes
            </label>
            <textarea
              value={pricingNotes}
              onChange={(e) => setPricingNotes(e.target.value)}
              rows={2}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as TailorStatus)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm hover:bg-gray-50"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || atSeatLimit}
              className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:opacity-60"
            >
              {saving && <ButtonSpinner />}
              {mode === 'create' ? 'Create' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
