import type { Prisma, WaiverExpiryRule } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ForbiddenError } from "@/lib/auth/http-error";
import { logActivityEntryAsync } from "@/lib/audit/activityLog";
import {
  assertWaiversStaff,
  rethrowUniqueConflict,
  rejectClientOrgFields,
  PRIVILEGED_ORG_FIELD,
  assertMutableWaiverLocation,
  requireActorVenueInScope,
  type WaiversActor,
} from "@/lib/waivers/common";

const JURISDICTIONS = new Set([
  "US-FL",
  "US-TX",
  "US-CA",
  "US-NY",
  "US-OTHER",
  "OTHER",
]);

const EXPIRY_RULES = new Set([
  "never",
  "days",
  "calendar_year",
  "visit",
  "until_date",
]);

export type WaiverSettingsDto = {
  id: string;
  orgId: string;
  locationId: string | null;
  jurisdictionCode: string;
  ageOfMajorityYears: number;
  requireGuardianForMinors: boolean;
  allowAdultSelfSign: boolean;
  allowGroupSigning: boolean;
  maxMinorsPerGuardianSession: number;
  expiryRule: WaiverExpiryRule;
  expiryDays: number | null;
  remindBeforeDays: number[];
  retentionYears: number;
  requireIntentCheckbox: boolean;
  allowTypedSignature: boolean;
  allowDrawnSignature: boolean;
  optionalWitness: boolean;
  blockCheckInWhenMissing: boolean;
  kioskRequireStaffPin: boolean;
  kioskSessionMinutes: number;
  defaultLocale: string;
  notifyEmail: string | null;
  persisted: boolean;
  createdAt: string;
  updatedAt: string;
};

const DEFAULTS = {
  jurisdictionCode: "US-FL",
  ageOfMajorityYears: 18,
  requireGuardianForMinors: true,
  allowAdultSelfSign: true,
  allowGroupSigning: true,
  maxMinorsPerGuardianSession: 8,
  expiryRule: "calendar_year" as WaiverExpiryRule,
  expiryDays: null as number | null,
  remindBeforeDays: [14, 3],
  retentionYears: 7,
  requireIntentCheckbox: true,
  allowTypedSignature: true,
  allowDrawnSignature: true,
  optionalWitness: false,
  blockCheckInWhenMissing: true,
  kioskRequireStaffPin: true,
  kioskSessionMinutes: 5,
  defaultLocale: "en",
  notifyEmail: null as string | null,
};

function asRemindDays(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return [...fallback];
  return value
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 365)
    .slice(0, 10);
}

function toDto(
  row: {
    id: string;
    orgId: string;
    locationId: string | null;
    jurisdictionCode: string;
    ageOfMajorityYears: number;
    requireGuardianForMinors: boolean;
    allowAdultSelfSign: boolean;
    allowGroupSigning: boolean;
    maxMinorsPerGuardianSession: number;
    expiryRule: WaiverExpiryRule;
    expiryDays: number | null;
    remindBeforeDays: unknown;
    retentionYears: number;
    requireIntentCheckbox: boolean;
    allowTypedSignature: boolean;
    allowDrawnSignature: boolean;
    optionalWitness: boolean;
    blockCheckInWhenMissing: boolean;
    kioskRequireStaffPin: boolean;
    kioskSessionMinutes: number;
    defaultLocale: string;
    notifyEmail: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  persisted = true
): WaiverSettingsDto {
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    jurisdictionCode: row.jurisdictionCode,
    ageOfMajorityYears: row.ageOfMajorityYears,
    requireGuardianForMinors: row.requireGuardianForMinors,
    allowAdultSelfSign: row.allowAdultSelfSign,
    allowGroupSigning: row.allowGroupSigning,
    maxMinorsPerGuardianSession: row.maxMinorsPerGuardianSession,
    expiryRule: row.expiryRule,
    expiryDays: row.expiryDays,
    remindBeforeDays: asRemindDays(row.remindBeforeDays, DEFAULTS.remindBeforeDays),
    retentionYears: row.retentionYears,
    requireIntentCheckbox: row.requireIntentCheckbox,
    allowTypedSignature: row.allowTypedSignature,
    allowDrawnSignature: row.allowDrawnSignature,
    optionalWitness: row.optionalWitness,
    blockCheckInWhenMissing: row.blockCheckInWhenMissing,
    kioskRequireStaffPin: row.kioskRequireStaffPin,
    kioskSessionMinutes: row.kioskSessionMinutes,
    defaultLocale: row.defaultLocale,
    notifyEmail: row.notifyEmail,
    persisted,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function unsaved(orgId: string, locationId: string | null): WaiverSettingsDto {
  return {
    id: "",
    orgId,
    locationId,
    ...DEFAULTS,
    persisted: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function intIn(name: string, value: unknown, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return n;
}

export async function getWaiverSettings(
  actor: WaiversActor,
  locationId?: string | null
): Promise<WaiverSettingsDto> {
  const orgId = await assertWaiversStaff(actor);
  let loc: string | null = null;
  if (locationId && locationId.trim()) {
    await requireActorVenueInScope(actor, locationId.trim(), {
      allowArchived: true,
    });
    loc = locationId.trim();
  }
  const row = await prisma.waiverSettings.findFirst({
    where: { orgId, locationId: loc },
  });
  if (!row) return unsaved(orgId, loc);
  return toDto(row);
}

export async function upsertWaiverSettings(
  actor: WaiversActor,
  body: unknown
): Promise<WaiverSettingsDto> {
  const orgId = await assertWaiversStaff(actor);
  rejectClientOrgFields(body);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid settings body");
  }
  const b = body as Record<string, unknown>;
  let locationId: string | null = null;
  if (typeof b.locationId === "string" && b.locationId.trim()) {
    await requireActorVenueInScope(actor, b.locationId.trim(), {
      allowArchived: true,
    });
    locationId = b.locationId.trim();
  } else if (b.locationId === undefined || b.locationId === null || b.locationId === "") {
    locationId = null;
  } else {
    throw new Error("locationId must be a venue id or null for the company default");
  }
  await assertMutableWaiverLocation(actor, locationId);

  const existing = await prisma.waiverSettings.findFirst({
    where: { orgId, locationId },
  });

  const jurisdictionCode =
    typeof b.jurisdictionCode === "string" && b.jurisdictionCode.trim()
      ? b.jurisdictionCode.trim().toUpperCase()
      : (existing?.jurisdictionCode ?? DEFAULTS.jurisdictionCode);
  if (!JURISDICTIONS.has(jurisdictionCode)) {
    throw new Error(
      "jurisdictionCode must be US-FL, US-TX, US-CA, US-NY, US-OTHER, or OTHER"
    );
  }

  const pickInt = (
    key: string,
    current: number | undefined,
    fallback: number,
    min: number,
    max: number
  ) => {
    if (b[key] == null || b[key] === "") return intIn(key, current ?? fallback, min, max);
    return intIn(key, b[key], min, max);
  };

  const ageOfMajorityYears = pickInt(
    "ageOfMajorityYears",
    existing?.ageOfMajorityYears,
    DEFAULTS.ageOfMajorityYears,
    16,
    21
  );
  const maxMinorsPerGuardianSession = pickInt(
    "maxMinorsPerGuardianSession",
    existing?.maxMinorsPerGuardianSession,
    DEFAULTS.maxMinorsPerGuardianSession,
    1,
    20
  );
  const retentionYears = pickInt(
    "retentionYears",
    existing?.retentionYears,
    DEFAULTS.retentionYears,
    1,
    25
  );
  const kioskSessionMinutes = pickInt(
    "kioskSessionMinutes",
    existing?.kioskSessionMinutes,
    DEFAULTS.kioskSessionMinutes,
    1,
    60
  );

  const expiryRuleRaw =
    typeof b.expiryRule === "string" && b.expiryRule.trim()
      ? b.expiryRule
      : (existing?.expiryRule ?? DEFAULTS.expiryRule);
  if (!EXPIRY_RULES.has(expiryRuleRaw)) {
    throw new Error("Invalid expiry rule");
  }
  const expiryRule = expiryRuleRaw as WaiverExpiryRule;
  let expiryDays: number | null = existing?.expiryDays ?? null;
  if (Object.prototype.hasOwnProperty.call(b, "expiryDays")) {
    expiryDays =
      b.expiryDays == null || b.expiryDays === ""
        ? null
        : intIn("expiryDays", b.expiryDays, 1, 3650);
  }
  if (expiryRule === "days" && expiryDays == null) {
    throw new Error("expiryDays is required when the expiry rule is days");
  }

  const remindBeforeDays = Object.prototype.hasOwnProperty.call(b, "remindBeforeDays")
    ? asRemindDays(b.remindBeforeDays, [])
    : asRemindDays(existing?.remindBeforeDays, DEFAULTS.remindBeforeDays);
  const defaultLocale =
    typeof b.defaultLocale === "string" && /^[a-z]{2}(-[a-z]{2})?$/i.test(b.defaultLocale.trim())
      ? b.defaultLocale.trim().toLowerCase()
      : (existing?.defaultLocale ?? DEFAULTS.defaultLocale);

  let notifyEmail = existing?.notifyEmail ?? DEFAULTS.notifyEmail;
  if (Object.prototype.hasOwnProperty.call(b, "notifyEmail")) {
    if (b.notifyEmail == null || b.notifyEmail === "") {
      notifyEmail = null;
    } else if (typeof b.notifyEmail !== "string") {
      throw new Error("notifyEmail must be an email or empty");
    } else {
      const email = b.notifyEmail.trim().toLowerCase();
      if (!email) {
        notifyEmail = null;
      } else if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("notifyEmail must be an email or empty");
      } else {
        notifyEmail = email;
      }
    }
  }

  const bool = (key: keyof typeof DEFAULTS, current: boolean | undefined, fallback: boolean) =>
    typeof b[key] === "boolean" ? (b[key] as boolean) : (current ?? fallback);

  const data = {
    jurisdictionCode,
    ageOfMajorityYears,
    requireGuardianForMinors: bool(
      "requireGuardianForMinors",
      existing?.requireGuardianForMinors,
      DEFAULTS.requireGuardianForMinors
    ),
    allowAdultSelfSign: bool(
      "allowAdultSelfSign",
      existing?.allowAdultSelfSign,
      DEFAULTS.allowAdultSelfSign
    ),
    allowGroupSigning: bool(
      "allowGroupSigning",
      existing?.allowGroupSigning,
      DEFAULTS.allowGroupSigning
    ),
    maxMinorsPerGuardianSession,
    expiryRule,
    expiryDays,
    remindBeforeDays: remindBeforeDays as unknown as Prisma.InputJsonValue,
    retentionYears,
    requireIntentCheckbox: bool(
      "requireIntentCheckbox",
      existing?.requireIntentCheckbox,
      DEFAULTS.requireIntentCheckbox
    ),
    allowTypedSignature: bool(
      "allowTypedSignature",
      existing?.allowTypedSignature,
      DEFAULTS.allowTypedSignature
    ),
    allowDrawnSignature: bool(
      "allowDrawnSignature",
      existing?.allowDrawnSignature,
      DEFAULTS.allowDrawnSignature
    ),
    optionalWitness: bool(
      "optionalWitness",
      existing?.optionalWitness,
      DEFAULTS.optionalWitness
    ),
    blockCheckInWhenMissing: bool(
      "blockCheckInWhenMissing",
      existing?.blockCheckInWhenMissing,
      DEFAULTS.blockCheckInWhenMissing
    ),
    kioskRequireStaffPin: bool(
      "kioskRequireStaffPin",
      existing?.kioskRequireStaffPin,
      DEFAULTS.kioskRequireStaffPin
    ),
    kioskSessionMinutes,
    defaultLocale,
    notifyEmail,
  };

  if (!data.allowTypedSignature && !data.allowDrawnSignature) {
    throw new Error("At least one signature method must stay on");
  }

  let row;
  if (existing) {
    row = await prisma.waiverSettings.update({
      where: { id: existing.id },
      data,
    });
  } else {
    try {
      row = await prisma.waiverSettings.create({
        data: { orgId, locationId, ...data },
      });
    } catch (err) {
      let conflict: unknown;
      try {
        rethrowUniqueConflict(
          err,
          "Waiver settings were just saved. Reload and try again."
        );
      } catch (caught) {
        conflict = caught;
      }
      if (conflict === err || !conflict) throw err;
      const raced = await prisma.waiverSettings.findFirst({
        where: { orgId, locationId },
      });
      if (!raced) throw conflict;
      row = await prisma.waiverSettings.update({
        where: { id: raced.id },
        data,
      });
    }
  }

  await logActivityEntryAsync({
    actorSub: actor.sub,
    orgId,
    action: "waiver_settings_save",
    entityType: "Settings",
    entityId: row.id,
    description: locationId
      ? "Updated venue waiver settings"
      : "Updated company default waiver settings",
    metadata: { locationId },
  });

  return toDto(row);
}

export async function loadEffectiveWaiverSettings(
  orgId: string,
  locationId?: string | null
) {
  if (locationId) {
    const venue = await prisma.waiverSettings.findFirst({
      where: { orgId, locationId },
    });
    if (venue) return venue;
  }
  return prisma.waiverSettings.findFirst({
    where: { orgId, locationId: null },
  });
}

export function assertNotClientOrgOnQuery(search: URLSearchParams): void {
  if (search.has("orgId") || search.has("organizationId")) {
    throw new ForbiddenError(PRIVILEGED_ORG_FIELD);
  }
}
