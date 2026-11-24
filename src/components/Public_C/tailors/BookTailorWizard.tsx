'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  ArrowLeft,
  ArrowRight,
  Check,
  Ruler,
  ImagePlus,
  X,
  LogIn,
  UserPlus,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { signInHref, signupHref } from '@/utils/authRedirect';
import { usePublicTailorQuery } from '@/hooks/useTailors';
import {
  useMyMeasurementProfilesQuery,
} from '@/hooks/useMeasurements';
import { useCreateTailoringJobMutation } from '@/hooks/useTailoringJobs';
import { uploadJobReferenceImage } from '@/services/tailoringJobs';
import { useToast } from '@/contexts/toast-context';
import type { PublicTailorDto } from '@/lib/tailors.shared';
import {
  countSetMeasurements,
  type MeasurementGender,
  type MeasurementUnit,
} from '@/lib/measurements.shared';
import CatalogImage from '@/components/common/CatalogImage';
import BookMeasurementFields, {
  emptyMeasurementFormValues,
  formValuesFromMeasurements,
  parseMeasurementFormValues,
} from '@/components/Public_C/tailors/BookMeasurementFields';
import MeasurementValuesDisplay from '@/components/measurements/MeasurementValuesDisplay';

type BookTailorWizardProps = {
  slug: string;
  initialTailor?: PublicTailorDto;
};

const STEPS = [
  { id: 1, label: 'Details' },
  { id: 2, label: 'Measurements' },
  { id: 3, label: 'Review' },
] as const;

const fieldClass =
  'mt-1.5 w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 outline-none transition focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20';

function bookingProfileLabel(jobTitle: string, tailorName: string): string {
  const base = jobTitle.trim()
    ? `Booking · ${jobTitle.trim()}`
    : `Booking · ${tailorName}`;
  return base.slice(0, 80);
}

export default function BookTailorWizard({
  slug,
  initialTailor,
}: BookTailorWizardProps) {
  const router = useRouter();
  const { addToast } = useToast();
  const { user, hasHydratedAuth, isStaff } = useAuthStore();
  const bookPath = `/tailors/${encodeURIComponent(slug)}/book`;
  const profilePath = `/tailors/${encodeURIComponent(slug)}`;

  const { data: tailor, isLoading: tailorLoading, isError } =
    usePublicTailorQuery(slug, true, initialTailor);
  const { data: profiles = [], isLoading: profilesLoading } =
    useMyMeasurementProfilesQuery(Boolean(user));
  const createMut = useCreateTailoringJobMutation();

  const [step, setStep] = useState(1);
  const [title, setTitle] = useState('');
  const [style, setStyle] = useState('');
  const [eventType, setEventType] = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const [sourceProfileId, setSourceProfileId] = useState('');
  const [measurementUnit, setMeasurementUnit] =
    useState<MeasurementUnit>('cm');
  const [measurementGender, setMeasurementGender] = useState<
    MeasurementGender | ''
  >('');
  const [measurementValues, setMeasurementValues] = useState<
    Record<string, string>
  >(() => emptyMeasurementFormValues());
  const [didPrefill, setDidPrefill] = useState(false);
  const [submitLocked, setSubmitLocked] = useState(false);
  const submitLockRef = useRef(false);

  const parsedMeasurements = useMemo(
    () => parseMeasurementFormValues(measurementValues),
    [measurementValues]
  );
  const filledCount = countSetMeasurements(parsedMeasurements);
  const hasUsableMeasurements = filledCount > 0;

  // One-time prefill from default (or first) profile when profiles load.
  useEffect(() => {
    if (didPrefill || profilesLoading || profiles.length === 0) return;
    const preferred =
      profiles.find((p) => p.isDefault) ??
      profiles.find((p) => countSetMeasurements(p.measurements) > 0) ??
      profiles[0];
    if (!preferred) return;
    setSourceProfileId(preferred._id);
    setMeasurementUnit(preferred.unit);
    setMeasurementGender(preferred.gender ?? '');
    setMeasurementValues(formValuesFromMeasurements(preferred.measurements));
    setDidPrefill(true);
  }, [didPrefill, profiles, profilesLoading]);

  const applySourceProfile = (profileId: string) => {
    setSourceProfileId(profileId);
    if (!profileId) {
      setMeasurementValues(emptyMeasurementFormValues());
      return;
    }
    const profile = profiles.find((p) => p._id === profileId);
    if (!profile) return;
    setMeasurementUnit(profile.unit);
    setMeasurementGender(profile.gender ?? '');
    setMeasurementValues(formValuesFromMeasurements(profile.measurements));
  };

  const displayName =
    tailor?.displayName ?? initialTailor?.displayName ?? 'this tailor';

  if (!user) {
    if (!hasHydratedAuth) {
      return (
        <div className="flex min-h-[50vh] items-center justify-center bg-stone-50 pt-28">
          <div className="flex items-center gap-2 text-sm text-stone-500">
            <Loader2 className="animate-spin text-[#D4AF37]" size={18} />
            Preparing booking…
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-stone-50 pt-24 pb-16 px-4 sm:px-6">
        <div className="mx-auto max-w-lg">
          <Link
            href={profilePath}
            className="mb-6 inline-flex items-center gap-1.5 text-sm text-stone-600 hover:text-stone-900"
          >
            <ArrowLeft size={14} aria-hidden />
            Back to profile
          </Link>

          <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
            <div className="border-b border-[#E8D48B]/60 bg-gradient-to-br from-[#FFF8E7] to-white px-6 py-8 sm:px-8">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#8A6D00]">
                Booking
              </p>
              <h1 className="mt-2 text-2xl font-bold text-stone-900 sm:text-3xl">
                Sign in to book {displayName}
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-stone-600">
                You&apos;ll enter body measurements here and send a request.
                No payment is taken at this step.
              </p>
            </div>

            <div className="space-y-3 px-6 py-6 sm:px-8">
              <ul className="mb-4 space-y-2.5 text-sm text-stone-700">
                {[
                  'Fill measurements for this garment in one place',
                  'Share style notes and reference images',
                  'Track the job from your profile',
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#FFF8E7] text-[#8A6D00]">
                      <Check size={12} strokeWidth={3} aria-hidden />
                    </span>
                    {line}
                  </li>
                ))}
              </ul>

              <Link
                href={signInHref(bookPath)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#D4AF37] px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-[#c4a030]"
              >
                <LogIn size={16} aria-hidden />
                Sign in to continue
              </Link>
              <Link
                href={signupHref(bookPath)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-3.5 text-sm font-semibold text-stone-800 transition hover:bg-stone-50"
              >
                <UserPlus size={16} aria-hidden />
                Register your company
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (tailorLoading && !tailor) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center bg-stone-50 pt-28">
        <Loader2 className="animate-spin text-[#D4AF37]" size={28} />
      </div>
    );
  }

  if (isError || !tailor) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center bg-stone-50 px-6 pt-28">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-stone-900">
            Tailor not available
          </h1>
          <p className="mt-2 text-sm text-stone-600">
            This profile may have been removed or is no longer accepting
            bookings.
          </p>
          <Link
            href="/tailors"
            className="mt-6 inline-flex rounded-xl bg-[#D4AF37] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#c4a030]"
          >
            Browse tailors
          </Link>
        </div>
      </div>
    );
  }

  const onUpload = async (file: File | null) => {
    if (!file || submitLockRef.current) return;
    if (images.length >= 8) {
      addToast('Maximum 8 reference images', 'error');
      return;
    }
    setUploading(true);
    try {
      const url = await uploadJobReferenceImage(file);
      if (typeof url === 'string' && url.startsWith('https://')) {
        setImages((prev) => (prev.length >= 8 ? prev : [...prev, url]));
      } else {
        addToast('Invalid image URL from upload', 'error');
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (submitLockRef.current || createMut.isPending || !hasUsableMeasurements) {
      return;
    }
    if (uploading) {
      setError('Wait for image uploads to finish before submitting');
      return;
    }
    submitLockRef.current = true;
    setSubmitLocked(true);
    setError('');
    try {
      const httpsImages = images.filter((u) => {
        try {
          return new URL(u).protocol === 'https:';
        } catch {
          return false;
        }
      });
      // Server creates profile + job atomically (no orphan profile on failure).
      const job = await createMut.mutateAsync({
        tailorSlug: tailor.slug,
        title: title.trim(),
        style: style.trim(),
        eventType: eventType.trim(),
        description: description.trim(),
        referenceImages: httpsImages,
        measurements: parsedMeasurements,
        measurementUnit,
        measurementGender:
          measurementGender === '' ? undefined : measurementGender,
        measurementLabel: bookingProfileLabel(title, tailor.displayName),
      });
      addToast('Request submitted', 'success');
      if (isStaff()) {
        router.push(`/admin/tailoring-jobs/${job._id}`);
      } else {
        router.push(`/profile/tailoring-jobs/${job._id}`);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Submit failed';
      // Job may already exist if details failed to reload — avoid blind retry.
      if (
        message.includes('Check My jobs') ||
        message.includes('could not be loaded')
      ) {
        addToast(
          'Your request may already be submitted. Opening your jobs…',
          'info'
        );
        router.push(
          isStaff() ? '/admin/tailoring-jobs' : '/profile?tab=tailoring-jobs'
        );
        return;
      }
      submitLockRef.current = false;
      setSubmitLocked(false);
      setError(message);
    }
  };

  const submitting = createMut.isPending || submitLocked;

  return (
    <div className="min-h-screen bg-stone-50 pt-24 pb-20 px-4 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <Link
          href={profilePath}
          className="mb-5 inline-flex items-center gap-1.5 text-sm text-stone-600 hover:text-stone-900"
        >
          <ArrowLeft size={14} aria-hidden />
          Back to {tailor.displayName}
        </Link>

        <header className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#8A6D00]">
            Tailoring request
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-stone-900">
            Book {tailor.displayName}
          </h1>
          <p className="mt-2 text-sm text-stone-600">
            No payment required yet — send details and measurements first.
          </p>
        </header>

        <nav aria-label="Booking steps" className="mb-6">
          <ol className="flex items-center gap-2">
            {STEPS.map((s, i) => {
              const done = step > s.id;
              const active = step === s.id;
              return (
                <li key={s.id} className="flex min-w-0 flex-1 items-center gap-2">
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      done
                        ? 'bg-[#D4AF37] text-white'
                        : active
                          ? 'bg-stone-900 text-white'
                          : 'bg-stone-200 text-stone-500'
                    }`}
                  >
                    {done ? <Check size={14} strokeWidth={3} /> : s.id}
                  </div>
                  <span
                    className={`hidden truncate text-sm sm:inline ${
                      active
                        ? 'font-semibold text-stone-900'
                        : 'text-stone-500'
                    }`}
                  >
                    {s.label}
                  </span>
                  {i < STEPS.length - 1 ? (
                    <div
                      className={`mx-1 hidden h-px flex-1 sm:block ${
                        done ? 'bg-[#D4AF37]' : 'bg-stone-200'
                      }`}
                      aria-hidden
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-7">
          {step === 1 ? (
            <div className="space-y-5">
              <label className="block text-sm">
                <span className="font-medium text-stone-800">Job title</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={fieldClass}
                  placeholder="e.g. Wedding agbada"
                  autoFocus
                />
              </label>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-medium text-stone-800">Style</span>
                  <input
                    value={style}
                    onChange={(e) => setStyle(e.target.value)}
                    className={fieldClass}
                    placeholder="Optional"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-stone-800">Event type</span>
                  <input
                    value={eventType}
                    onChange={(e) => setEventType(e.target.value)}
                    className={fieldClass}
                    placeholder="Wedding, birthday…"
                  />
                </label>
              </div>
              <label className="block text-sm">
                <span className="font-medium text-stone-800">Description</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className={fieldClass}
                  placeholder="Fabric preference, fit notes, deadline…"
                />
              </label>

              <div>
                <p className="text-sm font-medium text-stone-800">
                  Reference images
                  <span className="ml-1 font-normal text-stone-500">
                    (optional, up to 8)
                  </span>
                </p>
                <label className="mt-2 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300 bg-stone-50/80 px-4 py-8 text-center transition hover:border-[#D4AF37] hover:bg-[#FFF8E7]/40">
                  <ImagePlus className="text-[#B8960C]" size={22} aria-hidden />
                  <span className="text-sm font-medium text-stone-700">
                    {uploading ? 'Uploading…' : 'Add a photo'}
                  </span>
                  <span className="text-xs text-stone-500">
                    Inspiration, sketches, or fabric samples
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    disabled={uploading || submitting}
                    onChange={(e) => {
                      void onUpload(e.target.files?.[0] ?? null);
                      e.target.value = '';
                    }}
                  />
                </label>
                {images.length > 0 ? (
                  <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {images.map((url) => (
                      <li
                        key={url}
                        className="group relative aspect-square overflow-hidden rounded-lg bg-stone-100"
                      >
                        <CatalogImage
                          src={url}
                          alt=""
                          fill
                          optimizeWidth={200}
                          className="object-cover"
                        />
                        <button
                          type="button"
                          aria-label="Remove image"
                          disabled={submitting}
                          className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-90 transition hover:bg-black disabled:opacity-40"
                          onClick={() =>
                            setImages((prev) => prev.filter((u) => u !== url))
                          }
                        >
                          <X size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="flex justify-end border-t border-stone-100 pt-5">
                <button
                  type="button"
                  disabled={!title.trim()}
                  onClick={() => setStep(2)}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#c4a030] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Continue
                  <ArrowRight size={16} aria-hidden />
                </button>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-5">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFF8E7] text-[#8A6D00]">
                  <Ruler size={18} aria-hidden />
                </span>
                <div>
                  <h2 className="font-semibold text-stone-900">
                    Your measurements
                  </h2>
                  <p className="mt-0.5 text-sm text-stone-600">
                    Enter body measurements for this request. Prefill copies a
                    saved profile into this form without changing it. Leave any
                    field blank if it doesn&apos;t apply — the tailor will see
                    those as Not set.
                  </p>
                </div>
              </div>

              {profilesLoading && !didPrefill ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="animate-spin text-[#D4AF37]" size={22} />
                </div>
              ) : (
                <BookMeasurementFields
                  values={measurementValues}
                  onValuesChange={setMeasurementValues}
                  unit={measurementUnit}
                  onUnitChange={setMeasurementUnit}
                  gender={measurementGender}
                  onGenderChange={setMeasurementGender}
                  profiles={profiles}
                  sourceProfileId={sourceProfileId}
                  onSourceProfileChange={applySourceProfile}
                  fieldClass={fieldClass}
                />
              )}

              {!hasUsableMeasurements ? (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  Fill in at least one measurement to continue.
                </p>
              ) : null}

              <div className="flex flex-wrap justify-between gap-2 border-t border-stone-100 pt-5">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={!hasUsableMeasurements}
                  onClick={() => setStep(3)}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#c4a030] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Review
                  <ArrowRight size={16} aria-hidden />
                </button>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-5">
              <h2 className="font-semibold text-stone-900">Review & submit</h2>
              <dl className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-stone-50/50">
                {[
                  { label: 'Tailor', value: tailor.displayName },
                  { label: 'Title', value: title },
                  {
                    label: 'Style',
                    value: style.trim() || '—',
                  },
                  {
                    label: 'Event',
                    value: eventType.trim() || '—',
                  },
                  {
                    label: 'Unit',
                    value: measurementUnit.toUpperCase(),
                  },
                  {
                    label: 'Gender fit',
                    value: measurementGender || 'Not set',
                  },
                  {
                    label: 'Measurements filled',
                    value: `${filledCount}`,
                  },
                  {
                    label: 'Reference images',
                    value: `${images.length}`,
                  },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm"
                  >
                    <dt className="text-stone-500">{row.label}</dt>
                    <dd className="max-w-[70%] text-right font-medium text-stone-900">
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
              {description.trim() ? (
                <div className="rounded-xl border border-stone-200 px-4 py-3 text-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
                    Description
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-stone-700">
                    {description.trim()}
                  </p>
                </div>
              ) : null}

              <div className="rounded-xl border border-stone-200 px-4 py-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-stone-500">
                  Measurement snapshot
                </p>
                <MeasurementValuesDisplay
                  measurements={parsedMeasurements}
                  unit={measurementUnit}
                  compact
                />
              </div>

              {error ? (
                <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-wrap justify-between gap-2 border-t border-stone-100 pt-5">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setStep(2)}
                  className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={submitting || !hasUsableMeasurements}
                  onClick={() => void submit()}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#c4a030] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="animate-spin" size={16} />
                      Submitting…
                    </>
                  ) : (
                    'Submit request'
                  )}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
