'use client';

import { useMemo, useState, useEffect } from 'react';
import {
  Camera,
  Share2,
  ChevronRight,
  Star,
  MoreVertical,
  Pencil,
  Trash2,
} from 'lucide-react';
import {
  MEASUREMENT_CATEGORIES,
  MEASUREMENT_GENDERS,
  allCategoryCompletions,
  countSetMeasurements,
  profileCompletionPercent,
  type MeasurementCategoryId,
  type MeasurementGender,
  type MeasurementProfileDto,
} from '@/lib/measurements.shared';
import MeasurementCategoryIcon from './MeasurementCategoryIcon';
import MeasurementCategoryFormModal from './MeasurementCategoryFormModal';
import MeasurementAiScanFlow from './MeasurementAiScanFlow';
import MeasurementValuesDisplay from '@/components/measurements/MeasurementValuesDisplay';
import ConfirmDialog from '../confirm-dialog';
import {
  useDeleteMeasurementMutation,
  useSetDefaultMeasurementMutation,
  useUpdateMeasurementMutation,
  measurementKeys,
} from '@/hooks/useMeasurements';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';

type Props = {
  profile: MeasurementProfileDto;
  onProfileDeleted?: () => void;
  /** Open a category modal once (from ?category= deep link). */
  initialCategoryId?: MeasurementCategoryId | null;
  /** Keep ?category= in sync when opening or closing the category modal. */
  onCategoryChange?: (categoryId: MeasurementCategoryId | null) => void;
};

export default function MeasurementProfileDetail({
  profile,
  onProfileDeleted,
  initialCategoryId = null,
  onCategoryChange,
}: Props) {
  const { addToast } = useToast();
  const qc = useQueryClient();
  const deleteMut = useDeleteMeasurementMutation();
  const defaultMut = useSetDefaultMeasurementMutation();
  const updateMut = useUpdateMeasurementMutation();

  const [categoryId, setCategoryId] = useState<MeasurementCategoryId | null>(
    null
  );
  const [aiScanOpen, setAiScanOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameLabel, setRenameLabel] = useState(profile.label);
  const [showAllFields, setShowAllFields] = useState(false);

  useEffect(() => {
    setRenameLabel(profile.label);
  }, [profile.label, profile._id]);

  useEffect(() => {
    setCategoryId(initialCategoryId ?? null);
  }, [initialCategoryId, profile._id]);

  const openCategory = (id: MeasurementCategoryId) => {
    setCategoryId(id);
    onCategoryChange?.(id);
  };

  const closeCategory = () => {
    setCategoryId(null);
    onCategoryChange?.(null);
  };

  const completions = useMemo(
    () => allCategoryCompletions(profile),
    [profile]
  );
  const completionById = useMemo(
    () => new Map(completions.map((c) => [c.categoryId, c])),
    [completions]
  );

  const filledTotal = countSetMeasurements(profile.measurements);
  const percent = profileCompletionPercent(profile);

  const saveRename = async () => {
    const next = renameLabel.trim();
    if (!next || next === profile.label) {
      setRenaming(false);
      setRenameLabel(profile.label);
      return;
    }
    try {
      await updateMut.mutateAsync({
        id: profile._id,
        payload: { label: next, unit: profile.unit },
      });
      addToast('Profile renamed', 'success');
      setRenaming(false);
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Could not rename profile',
        'error'
      );
    }
  };

  const busy =
    deleteMut.isPending || defaultMut.isPending || updateMut.isPending;

  const setUnit = async (unit: 'cm' | 'in') => {
    if (unit === profile.unit) return;
    setMenuOpen(false);
    try {
      await updateMut.mutateAsync({
        id: profile._id,
        payload: { label: profile.label, unit },
      });
      addToast(`Unit updated to ${unit.toUpperCase()}`, 'success');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Could not update unit',
        'error'
      );
    }
  };

  const setGender = async (gender: MeasurementGender | '') => {
    setMenuOpen(false);
    try {
      await updateMut.mutateAsync({
        id: profile._id,
        payload: {
          label: profile.label,
          unit: profile.unit,
          gender: gender ? gender : null,
        },
      });
      addToast('Profile updated', 'success');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Could not update gender',
        'error'
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={renameLabel}
                onChange={(e) => setRenameLabel(e.target.value)}
                className="rounded-lg border border-stone-200 px-3 py-1.5 text-lg font-semibold text-stone-900"
                autoFocus
              />
              <button
                type="button"
                onClick={() => void saveRename()}
                disabled={busy}
                className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm text-white"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setRenaming(false);
                  setRenameLabel(profile.label);
                }}
                className="text-sm text-stone-600"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h2 className="truncate text-2xl font-bold text-stone-900">
                {profile.label}
              </h2>
              {profile.isDefault ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#FFF8E7] px-2 py-0.5 text-xs font-medium text-[#8A6D00]">
                  <Star size={12} /> Default
                </span>
              ) : null}
            </div>
          )}
          <p className="mt-1 text-sm text-stone-600">
            Body measurements for booking a tailor or joining campaigns.
          </p>
          <p className="mt-0.5 text-xs text-stone-500">
            {filledTotal > 0
              ? `${filledTotal} saved · ${percent}% of all fields · ${profile.unit.toUpperCase()}`
              : `No measurements yet · ${profile.unit.toUpperCase()}`}
            {profile.gender ? ` · ${profile.gender}` : ''}
          </p>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-xl border border-stone-200 p-2 text-stone-600 hover:bg-stone-50"
            aria-label="Profile options"
          >
            <MoreVertical size={18} />
          </button>
          {menuOpen ? (
            <>
              <button
                type="button"
                className="fixed inset-0 z-10 cursor-default"
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 z-20 mt-1 w-48 rounded-xl border border-stone-200 bg-white py-1 shadow-lg">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50"
                  onClick={() => {
                    setMenuOpen(false);
                    setRenaming(true);
                    setRenameLabel(profile.label);
                  }}
                >
                  <Pencil size={14} /> Rename
                </button>
                {!profile.isDefault ? (
                  <button
                    type="button"
                    disabled={busy}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                    onClick={() => {
                      setMenuOpen(false);
                      void defaultMut
                        .mutateAsync(profile._id)
                        .then(() =>
                          addToast('Default profile updated', 'success')
                        );
                    }}
                  >
                    <Star size={14} /> Set as default
                  </button>
                ) : null}
                <div className="border-t border-stone-100 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                    Unit
                  </p>
                  <div className="mt-1 flex gap-1">
                    {(['cm', 'in'] as const).map((u) => (
                      <button
                        key={u}
                        type="button"
                        disabled={busy}
                        onClick={() => void setUnit(u)}
                        className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium uppercase ${
                          profile.unit === u
                            ? 'bg-stone-900 text-white'
                            : 'bg-stone-100 text-stone-700'
                        }`}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="border-t border-stone-100 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                    Gender
                  </p>
                  <select
                    value={profile.gender ?? ''}
                    disabled={busy}
                    onChange={(e) =>
                      void setGender(e.target.value as MeasurementGender | '')
                    }
                    className="mt-1 w-full rounded-lg border border-stone-200 px-2 py-1.5 text-xs"
                  >
                    <option value="">Not set</option>
                    {MEASUREMENT_GENDERS.map((g) => (
                      <option key={g} value={g}>
                        {g.charAt(0).toUpperCase() + g.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                  onClick={() => {
                    setMenuOpen(false);
                    setDeleteOpen(true);
                  }}
                >
                  <Trash2 size={14} /> Delete profile
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setAiScanOpen(true)}
          className="flex items-center gap-3 rounded-2xl border border-[#D4AF37]/40 bg-gradient-to-br from-[#FFF8E7] to-white p-4 text-left shadow-sm transition hover:border-[#D4AF37]"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#D4AF37] text-white">
            <Camera size={22} />
          </span>
          <span>
            <span className="block text-sm font-semibold text-stone-900">
              AI camera scan
            </span>
            <span className="block text-xs text-stone-600">
              Auto-fill from photos
            </span>
          </span>
        </button>

        <div
          className="relative flex items-center gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 opacity-80"
          title="Share link for tailors — coming soon"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-stone-200 text-stone-500">
            <Share2 size={22} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-stone-700">
              Share
            </span>
            <span className="block text-xs text-stone-500">
              Send read-only link to your tailor
            </span>
          </span>
          <span className="shrink-0 rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-600">
            Soon
          </span>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          Measurement categories
        </h3>
        <ul className="mt-3 space-y-2">
          {MEASUREMENT_CATEGORIES.map((cat) => {
            const stats = completionById.get(cat.id);
            const filled = stats?.filled ?? 0;
            const total = stats?.total ?? cat.fieldKeys.length;
            const complete = stats?.complete ?? false;
            return (
              <li key={cat.id}>
                <button
                  type="button"
                  onClick={() => openCategory(cat.id)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3.5 text-left shadow-sm transition hover:border-stone-300 hover:bg-stone-50/80"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFF8E7]">
                    <MeasurementCategoryIcon iconKey={cat.iconKey} size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-stone-900">
                      {cat.label}
                    </span>
                    <span className="block text-xs text-stone-500">
                      {filled}/{total} fields
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      complete
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-stone-100 text-stone-600'
                    }`}
                  >
                    {complete ? 'Complete' : 'Not set'}
                  </span>
                  <ChevronRight
                    size={18}
                    className="shrink-0 text-stone-400"
                    aria-hidden
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white px-4 py-4 shadow-sm sm:px-5">
        <button
          type="button"
          onClick={() => setShowAllFields((v) => !v)}
          className="flex w-full items-center justify-between gap-3 text-left"
          aria-expanded={showAllFields}
        >
          <span>
            <span className="block text-xs font-semibold uppercase tracking-wide text-stone-500">
              All fields
            </span>
            <span className="mt-0.5 block text-xs text-stone-500">
              Same layout tailors see on job details — blank values show as Not
              set.
            </span>
          </span>
          <ChevronRight
            size={18}
            className={`shrink-0 text-stone-400 transition ${showAllFields ? 'rotate-90' : ''}`}
            aria-hidden
          />
        </button>
        {showAllFields ? (
          <div className="mt-4 border-t border-stone-100 pt-4">
            <MeasurementValuesDisplay
              measurements={profile.measurements}
              unit={profile.unit}
            />
          </div>
        ) : null}
      </div>

      <MeasurementCategoryFormModal
        open={categoryId != null}
        categoryId={categoryId}
        profile={profile}
        onClose={closeCategory}
      />

      <MeasurementAiScanFlow
        open={aiScanOpen}
        onClose={() => setAiScanOpen(false)}
        profileId={profile._id}
        profileLabel={profile.label}
        onComplete={() => {
          void qc.invalidateQueries({ queryKey: measurementKeys.all });
        }}
      />

      <ConfirmDialog
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          void deleteMut
            .mutateAsync(profile._id)
            .then(() => {
              addToast('Profile deleted', 'success');
              setDeleteOpen(false);
              onProfileDeleted?.();
            })
            .catch((err) => {
              addToast(
                err instanceof Error
                  ? err.message
                  : 'Could not delete profile',
                'error'
              );
            });
        }}
        title="Delete measurement profile?"
        message="This cannot be undone. Profiles linked to jobs or campaigns cannot be deleted."
        confirmText="Delete"
        isPending={deleteMut.isPending}
        variant="danger"
      />
    </div>
  );
}
