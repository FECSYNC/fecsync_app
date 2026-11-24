'use client';

import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import MeasurementCategoryIcon from '@/components/Protected/profile/measurements/MeasurementCategoryIcon';
import {
  MEASUREMENT_CATEGORIES,
  MEASUREMENT_FIELD_LABELS,
  MEASUREMENT_GENDERS,
  MEASUREMENT_UNITS,
  categoryCompletion,
  countSetMeasurements,
  measurementFieldLabel,
  type MeasurementGender,
  type MeasurementUnit,
} from '@/lib/measurements.shared';

export function emptyMeasurementFormValues(): Record<string, string> {
  const next: Record<string, string> = {};
  for (const category of MEASUREMENT_CATEGORIES) {
    for (const key of category.fieldKeys) {
      next[key] = '';
    }
  }
  return next;
}

export function formValuesFromMeasurements(
  measurements: Record<string, number> | null | undefined
): Record<string, string> {
  const next = emptyMeasurementFormValues();
  if (!measurements) return next;
  for (const key of Object.keys(next)) {
    const value = measurements[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      next[key] = String(value);
    }
  }
  return next;
}

export function parseMeasurementFormValues(
  values: Record<string, string>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(values)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const num = Number(trimmed);
    if (!Number.isFinite(num) || num <= 0 || num > 500) continue;
    out[key] = num;
  }
  return out;
}

type ProfileOption = {
  _id: string;
  label: string;
  unit: MeasurementUnit;
  gender?: MeasurementGender;
  measurements: Record<string, number>;
  isDefault?: boolean;
};

type Props = {
  values: Record<string, string>;
  onValuesChange: (next: Record<string, string>) => void;
  unit: MeasurementUnit;
  onUnitChange: (unit: MeasurementUnit) => void;
  gender: MeasurementGender | '';
  onGenderChange: (gender: MeasurementGender | '') => void;
  profiles: ProfileOption[];
  sourceProfileId: string;
  onSourceProfileChange: (profileId: string) => void;
  fieldClass?: string;
};

export default function BookMeasurementFields({
  values,
  onValuesChange,
  unit,
  onUnitChange,
  gender,
  onGenderChange,
  profiles,
  sourceProfileId,
  onSourceProfileChange,
  fieldClass = 'mt-1.5 w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 outline-none transition focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20',
}: Props) {
  const parsed = useMemo(() => parseMeasurementFormValues(values), [values]);
  const filledCount = countSetMeasurements(parsed);

  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>(
    () =>
      Object.fromEntries(
        MEASUREMENT_CATEGORIES.map((c) => [
          c.id,
          c.id === 'general' || c.id === 'upper_body' || c.id === 'lower_body',
        ])
      )
  );

  const toggleCategory = (id: string) => {
    setOpenCategories((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-5">
      {profiles.length > 0 ? (
        <label className="block text-sm">
          <span className="font-medium text-stone-800">
            Prefill from a saved profile
          </span>
          <select
            value={sourceProfileId}
            onChange={(e) => onSourceProfileChange(e.target.value)}
            className={fieldClass}
          >
            <option value="">Start blank</option>
            {profiles.map((p) => (
              <option key={p._id} value={p._id}>
                {p.label}
                {p.isDefault ? ' (default)' : ''} ·{' '}
                {countSetMeasurements(p.measurements)} filled ·{' '}
                {p.unit.toUpperCase()}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-stone-500">
            Prefill copies values into this form only — your saved profile is
            not changed. Empty fields show as Not set for the tailor.
          </span>
        </label>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-stone-800">Measurement unit</span>
          <select
            value={unit}
            onChange={(e) => onUnitChange(e.target.value as MeasurementUnit)}
            className={fieldClass}
          >
            {MEASUREMENT_UNITS.map((u) => (
              <option key={u} value={u}>
                {u.toUpperCase()}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-stone-500">
            Changing unit does not convert numbers already entered.
          </span>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-stone-800">Gender fit</span>
          <select
            value={gender}
            onChange={(e) =>
              onGenderChange(
                (e.target.value || '') as MeasurementGender | ''
              )
            }
            className={fieldClass}
          >
            <option value="">Not set</option>
            {MEASUREMENT_GENDERS.map((g) => (
              <option key={g} value={g}>
                {g.charAt(0).toUpperCase() + g.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 text-sm text-stone-600">
        <span className="font-semibold text-stone-800">{filledCount}</span> of{' '}
        {Object.keys(values).length} measurements filled · unit{' '}
        <span className="font-semibold text-stone-800">{unit.toUpperCase()}</span>
        . Fill what this garment needs — leave the rest blank.
      </p>

      <div className="space-y-3">
        {MEASUREMENT_CATEGORIES.map((category) => {
          const completion = categoryCompletion(parsed, category.id);
          const open = Boolean(openCategories[category.id]);
          return (
            <div
              key={category.id}
              className="overflow-hidden rounded-xl border border-stone-200"
            >
              <button
                type="button"
                onClick={() => toggleCategory(category.id)}
                className="flex w-full items-center gap-3 bg-white px-4 py-3 text-left transition hover:bg-stone-50"
                aria-expanded={open}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#FFF8E7]">
                  <MeasurementCategoryIcon
                    iconKey={category.iconKey}
                    size={18}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-stone-900">
                    {category.label}
                  </span>
                  <span className="text-xs text-stone-500">
                    {completion.filled}/{completion.total} filled
                    {completion.filled === 0 ? ' · all Not set' : ''}
                  </span>
                </span>
                <ChevronDown
                  size={18}
                  className={`shrink-0 text-stone-400 transition ${open ? 'rotate-180' : ''}`}
                  aria-hidden
                />
              </button>

              {open ? (
                <div className="border-t border-stone-100 bg-stone-50/60 px-4 py-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {category.fieldKeys.map((key) => (
                      <label key={key} className="block text-sm">
                        <span className="font-medium text-stone-800">
                          {MEASUREMENT_FIELD_LABELS[key] ??
                            measurementFieldLabel(key)}
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.1"
                          min="0"
                          value={values[key] ?? ''}
                          onChange={(e) =>
                            onValuesChange({
                              ...values,
                              [key]: e.target.value,
                            })
                          }
                          placeholder={`Not set · ${unit}`}
                          className={fieldClass}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
