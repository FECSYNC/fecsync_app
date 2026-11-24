import {
  MEASUREMENT_CATEGORY_IDS,
  type MeasurementCategoryId,
} from '@/lib/measurements.shared';

/** Customer profile measurements tab — supports Phase D deep links. */
export function measurementProfileTabHref(
  profileId?: string | null,
  categoryId?: MeasurementCategoryId | null
): string {
  const params = new URLSearchParams({ tab: 'measurements' });
  const id = profileId?.trim();
  if (id) params.set('profile', id);
  if (categoryId && isMeasurementCategoryId(categoryId)) {
    params.set('category', categoryId);
  }
  return `/profile?${params.toString()}`;
}

export function isMeasurementCategoryId(
  value: string
): value is MeasurementCategoryId {
  return (MEASUREMENT_CATEGORY_IDS as readonly string[]).includes(value);
}

export function parseMeasurementCategoryParam(
  value: string | null | undefined
): MeasurementCategoryId | null {
  const trimmed = value?.trim();
  if (!trimmed || !isMeasurementCategoryId(trimmed)) return null;
  return trimmed;
}
