'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  X,
  Loader2,
  Sparkles,
  ChevronRight,
  Ruler,
} from 'lucide-react';
import {
  MEASUREMENT_CATEGORIES,
  countSetMeasurements,
  type MeasurementCategoryId,
  type MeasurementProfileDto,
} from '@/lib/measurements.shared';
import {
  useMyMeasurementProfilesQuery,
  measurementKeys,
} from '@/hooks/useMeasurements';
import { useJoinCampaignMutation } from '@/hooks/useMeasurementCampaigns';
import { useToast } from '@/contexts/toast-context';
import { useQueryClient } from '@tanstack/react-query';
import { measurementProfileTabHref } from '@/utils/measurementProfileUrl';
import MeasurementCategoryFormModal, {
  type CreateProfileDraft,
} from '@/components/Protected/profile/measurements/MeasurementCategoryFormModal';
import MeasurementCategoryIcon from '@/components/Protected/profile/measurements/MeasurementCategoryIcon';
import MeasurementAiScanFlow from '@/components/Protected/profile/measurements/MeasurementAiScanFlow';

type Props = {
  open: boolean;
  onClose: () => void;
  slug: string;
  campaignName?: string;
  inviteToken?: string;
  groupToken?: string;
  sponsoredScansRemaining?: number;
  onSubmitted?: () => void;
};

export default function SubmitMeasurementsModal({
  open,
  onClose,
  slug,
  campaignName = 'this campaign',
  inviteToken,
  groupToken,
  sponsoredScansRemaining = 0,
  onSubmitted,
}: Props) {
  const { addToast } = useToast();
  const qc = useQueryClient();
  const joinMut = useJoinCampaignMutation(slug);
  const { data: profiles = [], isLoading: profilesLoading } =
    useMyMeasurementProfilesQuery(open);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [categoryId, setCategoryId] =
    useState<MeasurementCategoryId>('general');
  const [categoryFormOpen, setCategoryFormOpen] = useState(false);
  const [aiScanOpen, setAiScanOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateProfileDraft | null>(
    null
  );

  const usableProfiles = useMemo(
    () => profiles.filter((p) => countSetMeasurements(p.measurements) > 0),
    [profiles]
  );

  const profileOptions =
    usableProfiles.length > 0 ? usableProfiles : profiles;

  const selectedProfile = useMemo(
    () => profiles.find((p) => p._id === selectedProfileId) ?? null,
    [profiles, selectedProfileId]
  );

  const selectedUsableProfile = useMemo(
    () => usableProfiles.find((p) => p._id === selectedProfileId) ?? null,
    [usableProfiles, selectedProfileId]
  );

  const selectedCategory = useMemo(
    () => MEASUREMENT_CATEGORIES.find((c) => c.id === categoryId),
    [categoryId]
  );

  const canSubmit = Boolean(selectedUsableProfile);

  useEffect(() => {
    if (!open) {
      setCategoryFormOpen(false);
      setAiScanOpen(false);
      setCreateDraft(null);
      return;
    }
    if (usableProfiles.length > 0) {
      const selectedStillUsable = usableProfiles.some(
        (p) => p._id === selectedProfileId
      );
      if (selectedStillUsable) return;
      const preferred =
        usableProfiles.find((p) => p.isDefault) ?? usableProfiles[0];
      if (preferred) setSelectedProfileId(preferred._id);
      return;
    }
    if (profiles.length === 0) {
      setSelectedProfileId('');
      return;
    }
    const preferred = profiles.find((p) => p.isDefault) ?? profiles[0];
    if (!preferred) return;
    const selectedExists = profiles.some((p) => p._id === selectedProfileId);
    if (!selectedExists) setSelectedProfileId(preferred._id);
  }, [open, usableProfiles, profiles, selectedProfileId]);

  const refreshProfiles = async () => {
    await qc.invalidateQueries({ queryKey: measurementKeys.all });
    await qc.refetchQueries({ queryKey: measurementKeys.all });
  };

  const onSubmit = () => {
    if (!selectedUsableProfile || !canSubmit) return;
    void joinMut
      .mutateAsync({
        measurementProfileId: selectedUsableProfile._id,
        inviteToken,
        groupToken,
      })
      .then((result) => {
        if (result.alreadyCompleted) {
          addToast(
            'Measurements were already submitted to this campaign',
            'info'
          );
        } else {
          addToast('Measurements submitted to campaign', 'success');
        }
        onSubmitted?.();
        onClose();
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Could not submit';
        if (
          msg.includes('Database temporarily unavailable') ||
          msg.includes('temporarily unavailable')
        ) {
          addToast(
            "You're joined, but submission failed due to a temporary issue. Please try again.",
            'error'
          );
          onSubmitted?.();
          return;
        }
        if (
          msg.includes(
            'Joined the campaign, but measurements were not submitted'
          )
        ) {
          addToast(
            "You're joined, but measurements weren't submitted. Fix your profile and try again.",
            'error'
          );
          onSubmitted?.();
          return;
        }
        addToast(msg, 'error');
      });
  };

  if (!open) return null;

  const scansLeft = Math.max(0, sponsoredScansRemaining);
  const canUseSponsoredScan = scansLeft > 0;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="submit-measurements-title"
          className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        >
          <div className="flex items-start justify-between border-b border-stone-100 px-5 py-4">
            <div className="min-w-0 pr-3">
              <h2
                id="submit-measurements-title"
                className="text-lg font-semibold text-stone-900"
              >
                Submit measurements to {campaignName}
              </h2>
              <p className="mt-1 text-sm text-stone-500">
                Share a snapshot of measurements you already saved — or take new
                ones now if you haven&apos;t measured yet.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg p-1 text-stone-500 hover:bg-stone-100"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          <div className="overflow-y-auto px-5 py-4 space-y-4">
            {profilesLoading ? (
              <p className="flex items-center gap-2 text-sm text-stone-500">
                <Loader2 size={16} className="animate-spin" />
                Loading profiles…
              </p>
            ) : profiles.length === 0 ? (
              <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50/60 p-4">
                <p className="text-sm text-stone-700">
                  No saved profile yet. Enter measurements here — we&apos;ll
                  create one for you. You don&apos;t need to leave this page.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setCreateDraft({
                      label: 'My measurements',
                      unit: 'cm',
                      isDefault: true,
                    });
                    setCategoryId('general');
                    setCategoryFormOpen(true);
                  }}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
                >
                  <Ruler size={14} aria-hidden />
                  Enter measurements
                </button>
              </div>
            ) : (
              <>
                <label className="block text-sm">
                  <span className="font-medium text-stone-800">
                    Measurement profile
                  </span>
                  <select
                    value={selectedProfileId}
                    onChange={(e) => setSelectedProfileId(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-stone-200 px-3 py-2.5 text-stone-900"
                  >
                    {profileOptions.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.label}
                        {p.isDefault ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedProfile ? (
                  <Link
                    href={measurementProfileTabHref(selectedProfile._id)}
                    onClick={onClose}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-[#B8960C] hover:underline"
                  >
                    <Ruler size={14} aria-hidden />
                    Review or update these measurements
                    <ChevronRight size={14} aria-hidden />
                  </Link>
                ) : null}
              </>
            )}

            {profiles.length > 0 ? (
              <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-4 space-y-4">
                <p className="text-sm font-medium text-stone-800">
                  Need to capture measurements first?
                </p>

                <div>
                  <p className="text-xs font-medium text-stone-600">
                    Enter manually
                  </p>
                  <div className="mt-2 flex gap-2">
                    <div className="relative min-w-0 flex-1">
                      {selectedCategory ? (
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
                          <MeasurementCategoryIcon
                            iconKey={selectedCategory.iconKey}
                            size={16}
                          />
                        </span>
                      ) : null}
                      <select
                        value={categoryId}
                        onChange={(e) =>
                          setCategoryId(e.target.value as MeasurementCategoryId)
                        }
                        disabled={!selectedProfile}
                        className="w-full appearance-none rounded-xl border border-stone-200 bg-white py-2.5 pl-9 pr-8 text-sm text-stone-900 disabled:opacity-50"
                      >
                        {MEASUREMENT_CATEGORIES.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      disabled={!selectedProfile}
                      onClick={() => setCategoryFormOpen(true)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
                    >
                      <Ruler size={14} aria-hidden />
                      Enter
                    </button>
                  </div>
                  {selectedProfile ? (
                    <Link
                      href={measurementProfileTabHref(selectedProfile._id)}
                      onClick={onClose}
                      className="mt-2 inline-flex items-center gap-0.5 text-xs font-medium text-stone-600 hover:text-[#B8960C]"
                    >
                      See all measurement categories
                      <ChevronRight size={12} aria-hidden />
                    </Link>
                  ) : null}
                </div>

                <div className="border-t border-stone-200 pt-4">
                  <p className="text-xs text-stone-600">
                    Or use a sponsored AI scan
                  </p>
                  <button
                    type="button"
                    disabled={!canUseSponsoredScan || !selectedProfile}
                    title={
                      canUseSponsoredScan
                        ? 'Analyze photos to auto-fill measurements'
                        : 'No sponsored scans remaining'
                    }
                    onClick={() => setAiScanOpen(true)}
                    className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-stone-800 hover:border-stone-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Sparkles size={16} className="text-[#8A6D00]" aria-hidden />
                    AI scan
                    {scansLeft > 0 ? ` (${scansLeft} sponsored)` : ' — none left'}
                  </button>
                </div>
              </div>
            ) : null}

            {selectedProfile && !canSubmit ? (
              <p className="text-xs text-amber-800 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                Add at least one measurement to this profile before submitting.
              </p>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t border-stone-100 px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={joinMut.isPending || !canSubmit}
              onClick={onSubmit}
              className="inline-flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
            >
              {joinMut.isPending ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Submitting…
                </>
              ) : (
                'Submit to organizer'
              )}
            </button>
          </div>
        </div>
      </div>

      <MeasurementCategoryFormModal
        open={
          categoryFormOpen &&
          (Boolean(selectedProfile) || Boolean(createDraft))
        }
        onClose={() => {
          setCategoryFormOpen(false);
          setCreateDraft(null);
          void refreshProfiles();
        }}
        categoryId={categoryId}
        profile={selectedProfile as MeasurementProfileDto | null}
        createDraft={selectedProfile ? null : createDraft}
        onCreated={(profile) => {
          setSelectedProfileId(profile._id);
          setCreateDraft(null);
          void refreshProfiles();
        }}
        stacked
      />

      <MeasurementAiScanFlow
        open={aiScanOpen}
        onClose={() => setAiScanOpen(false)}
        profileId={selectedProfile?._id}
        profileLabel={selectedProfile?.label}
        campaignSlug={slug}
        inviteToken={inviteToken}
        sponsoredScansRemaining={scansLeft}
        requireSponsoredScan
        onComplete={() => {
          void (async () => {
            await refreshProfiles();
            onSubmitted?.();
          })();
        }}
      />
    </>
  );
}
