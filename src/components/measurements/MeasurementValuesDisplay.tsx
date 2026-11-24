'use client';

import {
  MEASUREMENT_CATEGORIES,
  MEASUREMENT_FIELD_LABELS,
  isMeasurementValueSet,
  measurementFieldLabel,
} from '@/lib/measurements.shared';

type MeasurementMap = Record<string, number> | null | undefined;

type Props = {
  measurements?: MeasurementMap;
  unit?: string | null;
  /** Show unit next to each filled value (campaign tables). */
  showUnitPerValue?: boolean;
  /** Compact density for nested tables. */
  compact?: boolean;
  className?: string;
};

/**
 * Full body-measurement grid — every catalog field is listed; empty values
 * render as "Not set" so tailor/customer/admin views stay in sync.
 */
export default function MeasurementValuesDisplay({
  measurements,
  unit,
  showUnitPerValue = false,
  compact = false,
  className,
}: Props) {
  const values = measurements ?? {};
  const unitLabel = unit?.trim() ? unit.trim().toLowerCase() : '';

  return (
    <div className={className ?? 'space-y-4'}>
      {MEASUREMENT_CATEGORIES.map((category) => (
        <section key={category.id}>
          <h4
            className={
              compact
                ? 'mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-stone-400'
                : 'mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500'
            }
          >
            {category.label}
          </h4>
          <dl
            className={
              compact
                ? 'grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs'
                : 'grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3'
            }
          >
            {category.fieldKeys.map((key) => {
              const raw = values[key];
              const set = isMeasurementValueSet(raw);
              const label =
                MEASUREMENT_FIELD_LABELS[key] ?? measurementFieldLabel(key);
              return (
                <div key={key} className="min-w-0">
                  <dt className="text-stone-500">{label}</dt>
                  <dd
                    className={
                      set
                        ? 'font-medium tabular-nums text-stone-900'
                        : 'text-stone-400 italic'
                    }
                  >
                    {set
                      ? showUnitPerValue && unitLabel
                        ? `${raw} ${unitLabel}`
                        : raw
                      : 'Not set'}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </div>
  );
}
