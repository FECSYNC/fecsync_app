'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  MEASUREMENT_GENDERS,
  type MeasurementGender,
  type MeasurementUnit,
} from '@/lib/measurements.shared';
import type { CreateProfileDraft } from './MeasurementCategoryFormModal';

type Props = {
  open: boolean;
  onClose: () => void;
  onContinue: (draft: CreateProfileDraft) => void;
  isFirstProfile?: boolean;
};

export default function CreateMeasurementProfileModal({
  open,
  onClose,
  onContinue,
  isFirstProfile = true,
}: Props) {
  const [label, setLabel] = useState('Self');
  const [unit, setUnit] = useState<MeasurementUnit>('cm');
  const [gender, setGender] = useState<MeasurementGender | ''>('');

  useEffect(() => {
    if (open) {
      setLabel('Self');
      setUnit('cm');
      setGender('');
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-profile-title"
        className="w-full max-w-md overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between border-b border-stone-100 px-5 py-4">
          <div>
            <h2
              id="create-profile-title"
              className="text-lg font-semibold text-stone-900"
            >
              New measurement profile
            </h2>
            <p className="mt-0.5 text-sm text-stone-500">
              Add a label, then enter at least one measurement.
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

        <div className="space-y-4 px-5 py-4">
          <label className="block text-sm">
            <span className="font-medium text-stone-800">Profile label</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Self, Partner, Wedding"
              className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5"
            />
          </label>

          <div className="block text-sm">
            <span className="font-medium text-stone-800">Unit</span>
            <div className="mt-2 flex gap-2">
              {(['cm', 'in'] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setUnit(u)}
                  className={`flex-1 rounded-xl border px-3 py-2.5 font-medium uppercase ${
                    unit === u
                      ? 'border-stone-900 bg-stone-900 text-white'
                      : 'border-stone-200 text-stone-700'
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>

          <label className="block text-sm">
            <span className="font-medium text-stone-800">Gender (optional)</span>
            <select
              value={gender}
              onChange={(e) =>
                setGender(e.target.value as MeasurementGender | '')
              }
              className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5"
            >
              <option value="">Prefer not to say</option>
              {MEASUREMENT_GENDERS.map((g) => (
                <option key={g} value={g}>
                  {g.charAt(0).toUpperCase() + g.slice(1)}
                </option>
              ))}
            </select>
          </label>
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
            disabled={!label.trim()}
            onClick={() => {
              if (!label.trim()) return;
              onContinue({
                label: label.trim(),
                unit,
                gender: gender || undefined,
                isDefault: isFirstProfile,
              });
            }}
            className="rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c4a030] disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
