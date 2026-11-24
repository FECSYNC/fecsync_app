/**
 * Shared measurement DTOs / Zod schemas — safe for client and server.
 */
import { z } from "zod";

export const MEASUREMENT_UNITS = ["cm", "in"] as const;
export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[number];

export const MEASUREMENT_GENDERS = [
  "male",
  "female",
  "unisex",
  "other",
] as const;
export type MeasurementGender = (typeof MEASUREMENT_GENDERS)[number];

export const MEASUREMENT_CATEGORY_IDS = [
  "general",
  "upper_body",
  "lower_body",
  "head_cap",
  "shoes",
  "hand_gloves",
  "ring",
] as const;
export type MeasurementCategoryId = (typeof MEASUREMENT_CATEGORY_IDS)[number];

export const MEASUREMENT_CATEGORY_ICON_KEYS = [
  "ruler",
  "shirt",
  "pants",
  "cap",
  "shoe",
  "glove",
  "ring",
] as const;
export type MeasurementCategoryIconKey =
  (typeof MEASUREMENT_CATEGORY_ICON_KEYS)[number];

export type MeasurementCategoryDef = {
  id: MeasurementCategoryId;
  label: string;
  iconKey: MeasurementCategoryIconKey;
  fieldKeys: readonly string[];
};

/** Categorized body fields — stored flat on MeasurementProfile.measurements JSON. */
export const MEASUREMENT_CATEGORIES: readonly MeasurementCategoryDef[] = [
  {
    id: "general",
    label: "General",
    iconKey: "ruler",
    fieldKeys: ["height", "weight"],
  },
  {
    id: "upper_body",
    label: "Upper Body",
    iconKey: "shirt",
    fieldKeys: [
      "neck",
      "shoulder",
      "chest",
      "bust",
      "back_width",
      "sleeve",
      "arm_length",
      "bicep",
      "wrist",
      "front_length",
      "across_back",
      "upper_chest",
    ],
  },
  {
    id: "lower_body",
    label: "Lower Body",
    iconKey: "pants",
    fieldKeys: [
      "waist",
      "hip",
      "inseam",
      "outseam",
      "thigh",
      "knee",
      "calf",
      "rise",
      "seat",
    ],
  },
  {
    id: "head_cap",
    label: "Head / Cap",
    iconKey: "cap",
    fieldKeys: ["head_circumference", "cap_size"],
  },
  {
    id: "shoes",
    label: "Shoes",
    iconKey: "shoe",
    fieldKeys: [
      "foot_length",
      "foot_width",
      "shoe_size",
      "instep",
      "ankle_circumference",
      "ball_width",
      "heel_width",
    ],
  },
  {
    id: "hand_gloves",
    label: "Hand (Gloves)",
    iconKey: "glove",
    fieldKeys: ["hand_length", "hand_circumference"],
  },
  {
    id: "ring",
    label: "Ring",
    iconKey: "ring",
    fieldKeys: [
      "ring_finger_circumference",
      "ring_size",
      "thumb_circumference",
      "index_circumference",
      "middle_circumference",
    ],
  },
] as const;

const EXPECTED_CATEGORY_FIELD_COUNTS: Record<MeasurementCategoryId, number> = {
  general: 2,
  upper_body: 12,
  lower_body: 9,
  head_cap: 2,
  shoes: 7,
  hand_gloves: 2,
  ring: 5,
};

for (const category of MEASUREMENT_CATEGORIES) {
  const expected = EXPECTED_CATEGORY_FIELD_COUNTS[category.id];
  if (category.fieldKeys.length !== expected) {
    throw new Error(
      `MEASUREMENT_CATEGORIES.${category.id} must have ${expected} fields`
    );
  }
}

const _fieldKeySet = new Set<string>();
for (const category of MEASUREMENT_CATEGORIES) {
  for (const key of category.fieldKeys) {
    if (_fieldKeySet.has(key)) {
      throw new Error(`Duplicate measurement field key: ${key}`);
    }
    _fieldKeySet.add(key);
  }
}

/** Flat union of all categorized field keys (39 total). */
export const MEASUREMENT_FIELD_KEYS = MEASUREMENT_CATEGORIES.flatMap(
  (c) => c.fieldKeys
) as readonly string[];

export type MeasurementFieldKey = (typeof MEASUREMENT_FIELD_KEYS)[number];

const ALLOWED_MEASUREMENT_FIELD_KEYS = new Set<string>(MEASUREMENT_FIELD_KEYS);

/** Drop unknown keys — blocks direct API writes outside the categorized model. */
export function sanitizeMeasurementValues(
  measurements: Record<string, number>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(measurements)) {
    if (!ALLOWED_MEASUREMENT_FIELD_KEYS.has(key)) continue;
    if (!isMeasurementValueSet(value)) continue;
    out[key] = value;
  }
  return out;
}

/** Original flat form keys — legacy profiles and Phase-B-previous UI. */
export const LEGACY_MEASUREMENT_FIELD_KEYS = [
  "bust",
  "waist",
  "hip",
  "shoulder",
  "sleeve",
  "inseam",
  "height",
  "neck",
  "chest",
  "thigh",
] as const;
export type LegacyMeasurementFieldKey =
  (typeof LEGACY_MEASUREMENT_FIELD_KEYS)[number];

export const MEASUREMENT_FIELD_LABELS: Record<string, string> = {
  height: "Height",
  weight: "Weight",
  neck: "Neck",
  shoulder: "Shoulder",
  chest: "Chest",
  bust: "Bust",
  back_width: "Back width",
  sleeve: "Sleeve",
  arm_length: "Arm length",
  bicep: "Bicep",
  wrist: "Wrist",
  front_length: "Front length",
  across_back: "Across back",
  upper_chest: "Upper chest",
  waist: "Waist",
  hip: "Hip",
  inseam: "Inseam",
  outseam: "Outseam",
  thigh: "Thigh",
  knee: "Knee",
  calf: "Calf",
  rise: "Rise",
  seat: "Seat",
  head_circumference: "Head circumference",
  cap_size: "Cap size",
  foot_length: "Foot length",
  foot_width: "Foot width",
  shoe_size: "Shoe size",
  instep: "Instep",
  ankle_circumference: "Ankle circumference",
  ball_width: "Ball width",
  heel_width: "Heel width",
  hand_length: "Hand length",
  hand_circumference: "Hand circumference",
  ring_finger_circumference: "Ring finger circumference",
  ring_size: "Ring size",
  thumb_circumference: "Thumb circumference",
  index_circumference: "Index circumference",
  middle_circumference: "Middle circumference",
};

const CATEGORY_BY_ID = new Map(
  MEASUREMENT_CATEGORIES.map((c) => [c.id, c] as const)
);

const FIELD_TO_CATEGORY = new Map<string, MeasurementCategoryId>();
for (const category of MEASUREMENT_CATEGORIES) {
  for (const key of category.fieldKeys) {
    FIELD_TO_CATEGORY.set(key, category.id);
  }
}

export function getMeasurementCategory(
  id: MeasurementCategoryId
): MeasurementCategoryDef {
  const category = CATEGORY_BY_ID.get(id);
  if (!category) throw new Error(`Unknown measurement category: ${id}`);
  return category;
}

export function getCategoryFieldKeys(
  categoryId: MeasurementCategoryId
): readonly string[] {
  return getMeasurementCategory(categoryId).fieldKeys;
}

export function isCategoryFieldKey(
  categoryId: MeasurementCategoryId,
  key: string
): boolean {
  return getCategoryFieldKeys(categoryId).includes(key);
}

export function measurementFieldLabel(key: string): string {
  if (MEASUREMENT_FIELD_LABELS[key]) return MEASUREMENT_FIELD_LABELS[key];
  return key
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function isMeasurementValueSet(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function getCategoryForField(
  key: string
): MeasurementCategoryId | undefined {
  return FIELD_TO_CATEGORY.get(key);
}

export type ProfileMeasurementsSource =
  | MeasurementProfileDto
  | { measurements?: Record<string, number> | null };

function isProfileDto(
  value: ProfileMeasurementsSource | Record<string, number>
): value is MeasurementProfileDto {
  return "_id" in value && "label" in value && "measurements" in value;
}

function resolveMeasurements(
  profileOrMeasurements:
    | ProfileMeasurementsSource
    | Record<string, number>
    | null
    | undefined
): Record<string, number> {
  if (!profileOrMeasurements || typeof profileOrMeasurements !== "object") {
    return {};
  }
  if (isProfileDto(profileOrMeasurements)) {
    return profileOrMeasurements.measurements ?? {};
  }
  if (
    "measurements" in profileOrMeasurements &&
    profileOrMeasurements.measurements &&
    typeof profileOrMeasurements.measurements === "object"
  ) {
    return profileOrMeasurements.measurements;
  }
  return profileOrMeasurements as Record<string, number>;
}

export type CategoryCompletion = {
  categoryId: MeasurementCategoryId;
  complete: boolean;
  filled: number;
  total: number;
};

/** Completion for one category — pass a profile DTO or a flat measurements map. */
export function categoryCompletion(
  profile: ProfileMeasurementsSource,
  categoryId: MeasurementCategoryId
): CategoryCompletion;
export function categoryCompletion(
  measurements: Record<string, number> | null | undefined,
  categoryId: MeasurementCategoryId
): CategoryCompletion;
export function categoryCompletion(
  profileOrMeasurements:
    | ProfileMeasurementsSource
    | Record<string, number>
    | null
    | undefined,
  categoryId: MeasurementCategoryId
): CategoryCompletion {
  const measurements = resolveMeasurements(profileOrMeasurements);
  const keys = getCategoryFieldKeys(categoryId);
  const filled = keys.filter((key) =>
    isMeasurementValueSet(measurements[key])
  ).length;
  return {
    categoryId,
    complete: filled === keys.length && keys.length > 0,
    filled,
    total: keys.length,
  };
}

export function allCategoryCompletions(
  profileOrMeasurements:
    | ProfileMeasurementsSource
    | Record<string, number>
    | null
    | undefined
): CategoryCompletion[] {
  const measurements = resolveMeasurements(profileOrMeasurements);
  return MEASUREMENT_CATEGORY_IDS.map((id) =>
    categoryCompletion(measurements, id)
  );
}

/** Overall profile fill rate (0–100) across all categorized fields. */
export function profileCompletionPercent(
  profile: ProfileMeasurementsSource
): number;
export function profileCompletionPercent(
  measurements: Record<string, number> | null | undefined
): number;
export function profileCompletionPercent(
  profileOrMeasurements:
    | ProfileMeasurementsSource
    | Record<string, number>
    | null
    | undefined
): number {
  const measurements = resolveMeasurements(profileOrMeasurements);
  const keys = MEASUREMENT_FIELD_KEYS;
  if (keys.length === 0) return 0;
  const filled = keys.filter((key) =>
    isMeasurementValueSet(measurements[key])
  ).length;
  return Math.round((filled / keys.length) * 100);
}

/** Merge category-scoped values into an existing flat measurements map. */
export function mergeCategoryMeasurements(
  existing: Record<string, number> | undefined | null,
  categoryId: MeasurementCategoryId,
  patch: Record<string, number>
): Record<string, number> {
  const allowed = getCategoryFieldKeys(categoryId);
  const next: Record<string, number> = { ...(existing ?? {}) };
  // Replace the whole category slice so cleared inputs remove stale stored values.
  for (const key of allowed) {
    delete next[key];
  }
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.includes(key)) continue;
    if (!isMeasurementValueSet(value)) continue;
    next[key] = value;
  }
  return sanitizeMeasurementValues(next);
}

const measurementValueSchema = z
  .number({ invalid_type_error: "Must be a number" })
  .finite()
  .positive("Must be greater than 0")
  .max(500, "Value looks too large");

export const measurementsMapSchema = z
  .record(z.string().min(1).max(40), measurementValueSchema)
  .transform(sanitizeMeasurementValues)
  .refine(
    (obj) => Object.keys(obj).length > 0,
    "Add at least one measurement"
  );

/** Partial map for merges — individual keys validated; empty object allowed. */
export const measurementsPartialMapSchema = z
  .record(z.string().min(1).max(40), measurementValueSchema)
  .transform(sanitizeMeasurementValues);

export function countSetMeasurements(
  measurements: Record<string, number> | null | undefined
): number {
  if (!measurements) return 0;
  return MEASUREMENT_FIELD_KEYS.filter((key) =>
    isMeasurementValueSet(measurements[key])
  ).length;
}

export function assertNonEmptyMeasurements(
  measurements: Record<string, number> | null | undefined,
  message = "Add at least one measurement"
): void {
  if (countSetMeasurements(measurements) === 0) {
    throw new Error(message);
  }
}

export const measurementProfileInputSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Label is required")
    .max(80, "Label is too long"),
  gender: z.enum(MEASUREMENT_GENDERS).optional(),
  unit: z.enum(MEASUREMENT_UNITS).default("cm"),
  measurements: measurementsMapSchema,
  isDefault: z.boolean().optional(),
});

export type MeasurementProfileInput = z.infer<
  typeof measurementProfileInputSchema
>;

/** PUT body — when `measurements` is sent it replaces the stored map. */
export const measurementProfileUpdateSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Label is required")
    .max(80, "Label is too long")
    .optional(),
  gender: z.enum(MEASUREMENT_GENDERS).optional().nullable(),
  unit: z.enum(MEASUREMENT_UNITS).optional(),
  measurements: measurementsPartialMapSchema.optional(),
  isDefault: z.boolean().optional(),
});

export type MeasurementProfileUpdateInput = z.infer<
  typeof measurementProfileUpdateSchema
>;

export const measurementCategoryPatchSchema = z
  .object({
    categoryId: z.enum(MEASUREMENT_CATEGORY_IDS),
    measurements: z.record(z.string().min(1).max(40), measurementValueSchema),
    unit: z.enum(MEASUREMENT_UNITS).optional(),
  })
  .superRefine((data, ctx) => {
    const keys = Object.keys(data.measurements);
    if (keys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add at least one measurement for this category",
        path: ["measurements"],
      });
      return;
    }
    for (const key of keys) {
      if (!isCategoryFieldKey(data.categoryId, key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${key}" is not valid for category ${data.categoryId}`,
          path: ["measurements", key],
        });
      }
    }
  });

export type MeasurementCategoryPatchInput = z.infer<
  typeof measurementCategoryPatchSchema
>;

export type MeasurementProfileDto = {
  _id: string;
  user: string;
  label: string;
  gender?: MeasurementGender;
  measurements: Record<string, number>;
  unit: MeasurementUnit;
  isDefault: boolean;
  createdAt?: string;
  updatedAt?: string;
};

/** AI body-measurement scan — pose photos (front / back / side). */
export const AI_SCAN_POSE_IDS = ["front", "back", "side"] as const;
export type AiScanPoseId = (typeof AI_SCAN_POSE_IDS)[number];

export const AI_SCAN_POSE_LABELS: Record<AiScanPoseId, string> = {
  front: "Front",
  back: "Back",
  side: "Side",
};

export const MEASUREMENT_AI_SCAN_PRIVACY =
  "Your photos are used only to estimate body measurements and are not stored after analysis. They are discarded once processing completes.";

const aiScanImageSchema = z
  .string()
  .min(64, "Photo is required")
  .max(6_000_000, "Photo is too large — use a smaller image")
  .refine(
    (v) => v.startsWith("data:image/"),
    "Photo must be JPEG or PNG"
  );

export const measurementAiScanInputSchema = z.object({
  frontImage: aiScanImageSchema,
  backImage: aiScanImageSchema,
  sideImage: aiScanImageSchema,
  /** When set, one sponsored scan credit is consumed server-side. */
  campaignSlug: z.string().trim().min(1).max(120).optional(),
  inviteToken: z.string().trim().max(200).optional(),
});

export type MeasurementAiScanInput = z.infer<
  typeof measurementAiScanInputSchema
>;

export type MeasurementAiScanResult = {
  profile: MeasurementProfileDto;
  fieldsUpdated: number;
  /** True when the server used the built-in stub (no vision provider). */
  stub: boolean;
  sponsoredScanConsumed?: boolean;
  scansRemaining?: number;
};
