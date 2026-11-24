'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, ChevronDown } from 'lucide-react';
import type { MeasurementCategoryId, MeasurementProfileDto } from '@/lib/measurements.shared';
import {
  useMyMeasurementProfilesQuery,
} from '@/hooks/useMeasurements';
import { measurementProfileTabHref, parseMeasurementCategoryParam } from '@/utils/measurementProfileUrl';
import { PageSpinner } from '@/components/Protected/admin/components/Spinner';
import MeasurementProfileDetail from './MeasurementProfileDetail';
import CreateMeasurementProfileModal from './CreateMeasurementProfileModal';
import MeasurementCategoryFormModal, {
  type CreateProfileDraft,
} from './MeasurementCategoryFormModal';

export default function MeasurementsSection() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const profileFromUrl = searchParams.get('profile')?.trim() || '';
  const categoryFromUrl = parseMeasurementCategoryParam(
    searchParams.get('category')
  );

  const { data: profiles = [], isLoading, error } =
    useMyMeasurementProfilesQuery();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateProfileDraft | null>(
    null
  );
  const [createCategoryId, setCreateCategoryId] =
    useState<MeasurementCategoryId | null>(null);

  const sorted = useMemo(
    () =>
      [...profiles].sort((a, b) => Number(b.isDefault) - Number(a.isDefault)),
    [profiles]
  );

  const activeProfile = useMemo(() => {
    if (sorted.length === 0) return null;
    if (profileFromUrl) {
      const match = sorted.find((p) => p._id === profileFromUrl);
      if (match) return match;
    }
    return sorted.find((p) => p.isDefault) ?? sorted[0];
  }, [sorted, profileFromUrl]);

  const setActiveProfileId = useCallback(
    (id: string, categoryId?: typeof categoryFromUrl | null) => {
      const cat =
        categoryId === undefined ? categoryFromUrl : categoryId;
      router.replace(measurementProfileTabHref(id, cat));
    },
    [router, categoryFromUrl]
  );

  useEffect(() => {
    if (isLoading || sorted.length === 0 || !activeProfile) return;
    if (profileFromUrl !== activeProfile._id) {
      setActiveProfileId(activeProfile._id);
    }
  }, [
    isLoading,
    sorted.length,
    activeProfile,
    profileFromUrl,
    setActiveProfileId,
  ]);

  const startCreateProfile = () => {
    setCreateOpen(true);
  };

  const onProfileCreated = (created: MeasurementProfileDto) => {
    setCreateDraft(null);
    setCreateCategoryId(null);
    setActiveProfileId(created._id);
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="rounded-lg border bg-white">
          <PageSpinner className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {sorted.length === 0 ? (
          <div>
            <h1 className="text-xl font-bold text-stone-900 md:text-2xl">
              My Measurements
            </h1>
            <p className="mt-0.5 text-sm text-stone-600">
              Save body measurements for booking and campaigns.
            </p>
          </div>
        ) : (
          <p className="text-sm text-stone-500">Measurement profiles</p>
        )}
        {sorted.length > 0 ? (
          <button
            type="button"
            onClick={startCreateProfile}
            className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50"
          >
            <Plus size={16} />
            New profile
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-red-600">
          Failed to load measurement profiles.
        </p>
      ) : null}

      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center">
          <p className="text-stone-700">
            Save your measurements once — use them to book tailors and join
            measurement campaigns.
          </p>
          <button
            type="button"
            onClick={startCreateProfile}
            className="mt-6 inline-flex rounded-xl bg-[#D4AF37] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#c4a030]"
          >
            Set up measurements
          </button>
        </div>
      ) : (
        <>
          {sorted.length > 1 && activeProfile ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50"
              >
                Switch profile: {activeProfile.label}
                <ChevronDown size={16} />
              </button>
              {pickerOpen ? (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-10 cursor-default"
                    aria-label="Close picker"
                    onClick={() => setPickerOpen(false)}
                  />
                  <ul className="absolute left-0 z-20 mt-1 min-w-[12rem] rounded-xl border border-stone-200 bg-white py-1 shadow-lg">
                    {sorted.map((p) => (
                      <li key={p._id}>
                        <button
                          type="button"
                          className={`block w-full px-3 py-2 text-left text-sm hover:bg-stone-50 ${
                            p._id === activeProfile._id
                              ? 'font-semibold text-stone-900'
                              : 'text-stone-700'
                          }`}
                          onClick={() => {
                            setPickerOpen(false);
                            setActiveProfileId(p._id, null);
                          }}
                        >
                          {p.label}
                          {p.isDefault ? ' (default)' : ''}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}

          {activeProfile ? (
            <MeasurementProfileDetail
              key={activeProfile._id}
              profile={activeProfile}
              initialCategoryId={categoryFromUrl}
              onCategoryChange={(categoryId) =>
                setActiveProfileId(activeProfile._id, categoryId)
              }
              onProfileDeleted={() => {
                const remaining = sorted.filter(
                  (p) => p._id !== activeProfile._id
                );
                if (remaining[0]) setActiveProfileId(remaining[0]._id);
                else router.replace(measurementProfileTabHref());
              }}
            />
          ) : null}
        </>
      )}

      <CreateMeasurementProfileModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        isFirstProfile={sorted.length === 0}
        onContinue={(draft) => {
          setCreateOpen(false);
          setCreateDraft(draft);
          setCreateCategoryId('general');
        }}
      />

      <MeasurementCategoryFormModal
        open={createCategoryId != null && createDraft != null}
        categoryId={createCategoryId}
        profile={null}
        createDraft={createDraft}
        onCreated={onProfileCreated}
        onClose={() => {
          setCreateDraft(null);
          setCreateCategoryId(null);
        }}
      />
    </div>
  );
}
