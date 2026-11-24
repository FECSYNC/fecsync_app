'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import {
  MEASUREMENT_CATEGORIES,
  MEASUREMENT_FIELD_LABELS,
  measurementFieldLabel,
  type MeasurementCategoryId,
  type MeasurementGender,
  type MeasurementProfileDto,
  type MeasurementUnit,
} from '@/lib/measurements.shared';
import {
  useCreateMeasurementMutation,
  usePatchMeasurementCategoryMutation,
} from '@/hooks/useMeasurements';
import { useToast } from '@/contexts/toast-context';

export type CreateProfileDraft = {
  label: string;
  unit: MeasurementUnit;
  gender?: MeasurementGender;
  isDefault?: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  categoryId: MeasurementCategoryId | null;
  profile: MeasurementProfileDto | null;
  createDraft?: CreateProfileDraft | null;
  onCreated?: (profile: MeasurementProfileDto) => void;
  /** Raise z-index when opened above another modal (e.g. submit flow). */
  stacked?: boolean;
};

function parseMeasurements(
  values: Record<string, string>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(values)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const num = Number(trimmed);
    if (!Number.isFinite(num) || num <= 0) continue;
    out[key] = num;
  }
  return out;
}

export default function MeasurementCategoryFormModal({
  open,
  onClose,
  categoryId,
  profile,
  createDraft,
  onCreated,
  stacked = false,
}: Props) {
  const { addToast } = useToast();
  const patchMut = usePatchMeasurementCategoryMutation();
  const createMut = useCreateMeasurementMutation();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const category = useMemo(
    () => MEASUREMENT_CATEGORIES.find((c) => c.id === categoryId),
    [categoryId]
  );

  const isCreateMode = !profile && Boolean(createDraft);

  useEffect(() => {
    if (!open || !category) return;
    const next: Record<string, string> = {};
    for (const key of category.fieldKeys) {
      const existing = profile?.measurements[key];
      next[key] = existing != null ? String(existing) : '';
    }
    setValues(next);
    setError('');
  }, [open, category, profile]);

  if (!open || !category) return null;

  const busy = patchMut.isPending || createMut.isPending;

  const onSave = async () => {
    setError('');
    const measurements = parseMeasurements(values);
    if (Object.keys(measurements).length === 0) {
      setError('Enter at least one measurement for this category');
      return;
    }

    try {
      if (isCreateMode && createDraft) {
        const created = await createMut.mutateAsync({
          label: createDraft.label.trim(),
          unit: createDraft.unit,
          gender: createDraft.gender,
          isDefault: createDraft.isDefault ?? true,
          measurements,
        });
        addToast('Measurement profile created', 'success');
        onCreated?.(created);
        onClose();
        return;
      }

      if (!profile) {
        setError('Select or create a profile first');
        return;
      }

      await patchMut.mutateAsync({
        id: profile._id,
        payload: {
          categoryId: category.id,
          measurements,
          unit: profile.unit,
        },
      });
      addToast(`${category.label} measurements saved`, 'success');
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not save measurements';
      setError(message);
    }
  };

  return (
    <div
      className={`fixed inset-0 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4 ${stacked ? 'z-[60]' : 'z-50'}`}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-form-title"
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between border-b border-stone-100 px-5 py-4">
          <div>
            <h2
              id="category-form-title"
              className="text-lg font-semibold text-stone-900"
            >
              {category.label}
            </h2>
            <p className="mt-0.5 text-sm text-stone-500">
              {isCreateMode
                ? `New profile · ${createDraft?.label}`
                : `${profile?.label} · ${profile?.unit.toUpperCase()}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-stone-500 hover:bg-stone-100"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {category.fieldKeys.map((key) => (
              <label key={key} className="block text-sm">
                <span className="font-medium text-stone-800">
                  {MEASUREMENT_FIELD_LABELS[key] ?? measurementFieldLabel(key)}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  value={values[key] ?? ''}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                  placeholder={`${profile?.unit ?? createDraft?.unit ?? 'cm'}`}
                  className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5 tabular-nums"
                />
              </label>
            ))}
          </div>
          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
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
            disabled={busy}
            onClick={() => void onSave()}
            className="inline-flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Saving…
              </>
            ) : (
              'Save'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
