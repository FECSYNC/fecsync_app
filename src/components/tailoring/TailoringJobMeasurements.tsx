'use client';

import MeasurementValuesDisplay from '@/components/measurements/MeasurementValuesDisplay';
import type { TailoringJobMeasurementSnapshot } from '@/lib/tailoringJobs.shared';

type Props = {
  snapshot?: TailoringJobMeasurementSnapshot | null;
  label?: string | null;
};

/**
 * Job measurement panel — full catalog with "Not set" for empty fields.
 * Requires a real snapshot; label-only without snapshot is not treated as data.
 */
export default function TailoringJobMeasurements({
  snapshot,
  label,
}: Props) {
  if (!snapshot) {
    return (
      <dd className="text-stone-400 italic">
        {label ? `${label} · snapshot unavailable` : 'Not set'}
      </dd>
    );
  }

  return (
    <dd className="space-y-3">
      <p className="font-medium text-gray-900">
        {snapshot.label || label || 'Measurements'}
        {snapshot.unit ? ` · ${snapshot.unit.toUpperCase()}` : ''}
        {snapshot.gender ? ` · ${snapshot.gender}` : ''}
      </p>
      <MeasurementValuesDisplay
        measurements={snapshot.measurements}
        unit={snapshot.unit}
      />
    </dd>
  );
}
