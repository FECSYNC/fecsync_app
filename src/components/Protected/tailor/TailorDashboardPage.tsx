'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ExternalLink,
  MapPin,
  Plus,
  Trash2,
  User,
} from 'lucide-react';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import {
  useMyTailorQuery,
  useUpdateMyTailorMutation,
  useUploadTailorPortfolioMutation,
} from '@/hooks/useTailors';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import { IMAGE_FILE_ACCEPT, isLikelyImageFile } from '@/utils/imageUpload';
import type { TailorServiceTierDto } from '@/lib/tailors.shared';
import { TAILOR_PORTFOLIO_REEL_MAX } from '@/lib/tailors.shared';
import { countrySelectOptions } from '@/lib/countries';

const PORTFOLIO_REEL_MAX = TAILOR_PORTFOLIO_REEL_MAX;

type SectionId = 'profile' | 'services' | 'portfolio';

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'services', label: 'Services' },
  { id: 'portfolio', label: 'Portfolio' },
];

const EMPTY_TIER: TailorServiceTierDto = {
  name: '',
  description: '',
  priceFrom: undefined,
  currency: 'NGN',
};

export default function TailorDashboardPage() {
  const { addToast } = useToast();
  const { user } = useAuthStore();
  const { data: tailor, isLoading, isError, error } = useMyTailorQuery();
  const updateMutation = useUpdateMyTailorMutation();
  const uploadMutation = useUploadTailorPortfolioMutation();

  const [section, setSection] = useState<SectionId>('profile');
  const [displayName, setDisplayName] = useState('');
  const [slug, setSlug] = useState('');
  const [bio, setBio] = useState('');
  const [specialties, setSpecialties] = useState('');
  const [serviceTypes, setServiceTypes] = useState('');
  const [pricingNotes, setPricingNotes] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [country, setCountry] = useState('');
  const [portfolioImages, setPortfolioImages] = useState<string[]>([]);
  const [serviceTiers, setServiceTiers] = useState<TailorServiceTierDto[]>([]);

  useEffect(() => {
    if (!tailor) return;
    setDisplayName(tailor.displayName);
    setSlug(tailor.slug);
    setBio(tailor.bio);
    setSpecialties(tailor.specialties.join(', '));
    setServiceTypes(tailor.serviceTypes.join(', '));
    setPricingNotes(tailor.pricingNotes);
    setCity(tailor.location.city ?? '');
    setState(tailor.location.state ?? '');
    setCountry(tailor.location.country ?? '');
    setPortfolioImages(tailor.portfolioImages);
    setServiceTiers(
      tailor.serviceTiers.length > 0 ? tailor.serviceTiers : [{ ...EMPTY_TIER }]
    );
  }, [tailor]);

  const parseList = (raw: string) =>
    raw
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

  const canEdit = tailor?.status === 'approved';
  const suspended = tailor?.status === 'suspended';
  const awaitingApproval =
    tailor?.status === 'pending' || tailor?.status === 'draft';

  const completeness = useMemo(() => {
    if (!tailor) return 0;
    const checks = [
      Boolean(displayName.trim()),
      Boolean(bio.trim()),
      Boolean(country.trim()),
      parseList(specialties).length > 0,
      parseList(serviceTypes).length > 0,
      portfolioImages.length > 0,
      serviceTiers.some((t) => t.name.trim()),
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [
    tailor,
    displayName,
    bio,
    city,
    state,
    country,
    specialties,
    serviceTypes,
    portfolioImages,
    serviceTiers,
  ]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tailor || !canEdit) return;
    if (!country.trim()) {
      addToast('Country is required for your public listing', 'error');
      return;
    }
    try {
      await updateMutation.mutateAsync({
        displayName: displayName.trim(),
        bio,
        specialties: parseList(specialties),
        serviceTypes: parseList(serviceTypes),
        pricingNotes,
        location: { city, state, country },
        portfolioImages: portfolioImages.slice(0, PORTFOLIO_REEL_MAX),
        serviceTiers: serviceTiers
          .filter((t) => t.name.trim())
          .map((t) => ({
            name: t.name.trim(),
            description: t.description?.trim() || undefined,
            priceFrom:
              t.priceFrom != null && Number.isFinite(t.priceFrom)
                ? t.priceFrom
                : undefined,
            currency: t.currency?.trim() || 'NGN',
          })),
      });
      addToast('Profile saved', 'success');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to save profile',
        'error'
      );
    }
  };

  const handleUpload = async (file: File | null) => {
    if (!file || !canEdit) return;
    if (portfolioImages.length >= PORTFOLIO_REEL_MAX) {
      addToast(`Portfolio is limited to ${PORTFOLIO_REEL_MAX} images`, 'error');
      return;
    }
    if (!isLikelyImageFile(file)) {
      addToast('Please choose an image file', 'error');
      return;
    }
    try {
      const result = await uploadMutation.mutateAsync(file);
      setPortfolioImages(result.tailor.portfolioImages);
      addToast('Image uploaded', 'success');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Upload failed',
        'error'
      );
    }
  };

  const removeImage = (url: string) => {
    setPortfolioImages((prev) => prev.filter((u) => u !== url));
  };

  const updateTier = (
    index: number,
    patch: Partial<TailorServiceTierDto>
  ) => {
    setServiceTiers((prev) =>
      prev.map((t, i) => (i === index ? { ...t, ...patch } : t))
    );
  };

  if (isLoading) {
    return (
      <p className="text-sm text-stone-500">Loading your studio profile…</p>
    );
  }

  if (isError || !tailor) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-stone-900">
          No tailor profile yet
        </h2>
        <p className="mt-2 text-sm text-stone-600">
          {error instanceof Error
            ? error.message
            : 'Ask a FECSYNC admin to link your account as a tailor.'}
        </p>
      </div>
    );
  }

  const locationLine = [city, state, country].filter(Boolean).join(', ');
  const statusStyles: Record<string, string> = {
    approved: 'bg-emerald-50 text-emerald-800',
    pending: 'bg-amber-50 text-amber-800',
    draft: 'bg-stone-100 text-stone-700',
    suspended: 'bg-red-50 text-red-800',
  };

  return (
    <div className="space-y-6 pb-24 md:pb-8">
      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#FFF8E7] text-lg font-semibold text-[#8A6D00]">
            {(user?.name || user?.fullName || displayName || user?.email || '?')
              .charAt(0)
              .toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-stone-900">
              {user?.name || user?.fullName || displayName}
            </h2>
            <p className="text-sm text-stone-600">{user?.email}</p>
          </div>
        </div>
        <dl className="mt-5 divide-y divide-stone-100 text-sm">
          {(
            [
              ['Name', user?.name || user?.fullName || displayName, 'Locked'],
              ['Email', user?.email ?? '—', 'Locked'],
              ['Account type', 'Tailor', 'Locked'],
            ] as const
          ).map(([label, value, state]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-3 py-3"
            >
              <dt className="text-xs font-semibold uppercase tracking-wide text-stone-400">
                {label}
              </dt>
              <dd className="flex items-center gap-3 text-stone-800">
                <span className="truncate">{value}</span>
                <span className="shrink-0 text-xs text-stone-400">{state}</span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-stone-500">
          Name, email and account type are set at registration and can&apos;t be
          changed here.
        </p>
      </section>

      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
        <div className="bg-gradient-to-br from-stone-900 via-stone-800 to-stone-900 px-5 py-6 text-white sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#D4AF37]/20 text-[#D4AF37]">
                <User size={28} />
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#D4AF37]">
                  Studio profile
                </p>
                <h2 className="mt-1 text-xl font-semibold">{displayName}</h2>
                <p className="mt-1 text-sm text-stone-300">/{slug}</p>
                {locationLine ? (
                  <p className="mt-2 inline-flex items-center gap-1 text-sm text-stone-400">
                    <MapPin size={14} />
                    {locationLine}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${statusStyles[tailor.status] ?? statusStyles.draft}`}
              >
                {tailor.status}
              </span>
              {tailor.status === 'approved' ? (
                <Link
                  href={`/tailors/${encodeURIComponent(slug)}`}
                  target="_blank"
                  className="inline-flex items-center gap-1 rounded-xl border border-white/20 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10"
                >
                  Public page
                  <ExternalLink size={12} />
                </Link>
              ) : null}
            </div>
          </div>
        </div>

        <div className="border-b border-stone-100 px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-stone-600">
              Profile completeness:{' '}
              <span className="font-semibold text-stone-900">
                {completeness}%
              </span>
            </p>
            <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-stone-100 sm:w-48">
              <div
                className="h-full rounded-full bg-[#D4AF37] transition-all"
                style={{ width: `${completeness}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {suspended && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          Your profile is suspended. Contact FECSYNC support to reopen it.
        </p>
      )}

      {awaitingApproval && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your profile is awaiting admin approval. You can preview fields here;
          editing unlocks after approval.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              section === s.id
                ? 'bg-[#D4AF37] text-black'
                : 'bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <form
        onSubmit={handleSave}
        className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6"
      >
        {section === 'profile' && (
          <div className="space-y-4">
            <h3 className="font-semibold text-stone-900">Tailor listing</h3>
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-600">
                Business name
              </label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={!canEdit}
                required
                className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm disabled:bg-stone-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-600">
                Public URL slug
              </label>
              <input
                value={slug}
                disabled
                className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm disabled:bg-stone-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-600">
                Bio
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                disabled={!canEdit}
                rows={5}
                placeholder="Tell customers about your craft, experience, and style."
                className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm disabled:bg-stone-50"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-1">
                <label className="mb-1 block text-xs font-medium text-stone-600">
                  Country <span className="text-red-500">*</span>
                </label>
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  disabled={!canEdit}
                  required
                  className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm disabled:bg-stone-50"
                >
                  <option value="">Select country</option>
                  {countrySelectOptions(country).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-stone-500">
                  Required. Sets your listing location for Find a Tailor.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-stone-600">
                  City
                </label>
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  disabled={!canEdit}
                  className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm disabled:bg-stone-50"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-stone-600">
                  State / region
                </label>
                <input
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  disabled={!canEdit}
                  className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm disabled:bg-stone-50"
                />
              </div>
            </div>
          </div>
        )}

        {section === 'services' && (
          <div className="space-y-5">
            <h3 className="font-semibold text-stone-900">Services & pricing</h3>
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-600">
                Specialties (comma-separated)
              </label>
              <input
                value={specialties}
                onChange={(e) => setSpecialties(e.target.value)}
                disabled={!canEdit}
                placeholder="Bridal, Menswear, Alterations"
                className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm disabled:bg-stone-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-600">
                Service types (comma-separated)
              </label>
              <input
                value={serviceTypes}
                onChange={(e) => setServiceTypes(e.target.value)}
                disabled={!canEdit}
                placeholder="Bespoke, Ready-to-wear, Fitting"
                className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm disabled:bg-stone-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-600">
                Pricing notes
              </label>
              <textarea
                value={pricingNotes}
                onChange={(e) => setPricingNotes(e.target.value)}
                disabled={!canEdit}
                rows={3}
                placeholder="Consultation fees, typical ranges, deposit policy…"
                className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm disabled:bg-stone-50"
              />
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-stone-800">
                  Service tiers
                </p>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() =>
                      setServiceTiers((prev) => [...prev, { ...EMPTY_TIER }])
                    }
                    className="inline-flex items-center gap-1 text-sm text-[#B8960C] hover:underline"
                  >
                    <Plus size={14} />
                    Add tier
                  </button>
                ) : null}
              </div>
              {serviceTiers.map((tier, index) => (
                <div
                  key={index}
                  className="rounded-xl border border-stone-200 bg-stone-50/50 p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <input
                      value={tier.name}
                      onChange={(e) =>
                        updateTier(index, { name: e.target.value })
                      }
                      disabled={!canEdit}
                      placeholder="Tier name"
                      className="flex-1 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm disabled:bg-stone-50"
                    />
                    {canEdit && serviceTiers.length > 1 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setServiceTiers((prev) =>
                            prev.filter((_, i) => i !== index)
                          )
                        }
                        className="rounded-lg p-2 text-stone-400 hover:bg-stone-100 hover:text-red-600"
                        aria-label="Remove tier"
                      >
                        <Trash2 size={16} />
                      </button>
                    ) : null}
                  </div>
                  <textarea
                    value={tier.description ?? ''}
                    onChange={(e) =>
                      updateTier(index, { description: e.target.value })
                    }
                    disabled={!canEdit}
                    rows={2}
                    placeholder="What's included"
                    className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm disabled:bg-stone-50"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      min={0}
                      value={tier.priceFrom ?? ''}
                      onChange={(e) =>
                        updateTier(index, {
                          priceFrom: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        })
                      }
                      disabled={!canEdit}
                      placeholder="From price"
                      className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm disabled:bg-stone-50"
                    />
                    <input
                      value={tier.currency ?? 'NGN'}
                      onChange={(e) =>
                        updateTier(index, { currency: e.target.value })
                      }
                      disabled={!canEdit}
                      placeholder="Currency"
                      className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm disabled:bg-stone-50"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {section === 'portfolio' && (
          <div className="space-y-4">
            <h3 className="font-semibold text-stone-900">
              Portfolio reel ({portfolioImages.length}/{PORTFOLIO_REEL_MAX})
            </h3>
            <p className="text-sm text-stone-600">
              Showcase your best work on your public Find a Tailor page.
            </p>
            <div className="flex flex-wrap gap-3">
              {portfolioImages.map((url) => (
                <div key={url} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt=""
                    className="h-24 w-24 rounded-xl object-cover ring-1 ring-stone-200"
                  />
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => removeImage(url)}
                      className="absolute -right-1 -top-1 rounded-full bg-black px-1.5 text-xs text-white"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {portfolioImages.length === 0 ? (
                <p className="text-sm text-stone-500">No images yet.</p>
              ) : null}
            </div>
            {canEdit && portfolioImages.length < PORTFOLIO_REEL_MAX && (
              <label className="block">
                <span className="text-sm font-medium text-stone-700">
                  Upload image
                </span>
                <input
                  type="file"
                  accept={IMAGE_FILE_ACCEPT}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    void handleUpload(file);
                    e.target.value = '';
                  }}
                  disabled={uploadMutation.isPending}
                  className="mt-2 block w-full text-sm text-stone-600"
                />
              </label>
            )}
            <p className="text-xs text-stone-500">
              Up to {PORTFOLIO_REEL_MAX} photos on your public listing.
            </p>
          </div>
        )}

        <div className="mt-6 border-t border-stone-100 pt-4">
          <button
            type="submit"
            disabled={!canEdit || updateMutation.isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-stone-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
          >
            {(updateMutation.isPending || uploadMutation.isPending) && (
              <ButtonSpinner />
            )}
            Save tailor listing
          </button>
        </div>
      </form>
    </div>
  );
}
