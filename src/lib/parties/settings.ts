/**
 * Effective PartySettings = venue override → org default → schema defaults.
 * Venue rows list their overridden fields in `overrideFields`; every other
 * field inherits the org default, so the settings screen can show
 * "org default" vs "venue override" per field.
 */
import type { PartyBalanceDueMode, PartyDepositDueMode, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ForbiddenError } from "@/lib/auth/http-error";
import { isValidId } from "@/lib/ids";
import { LOCATION_OUT_OF_SCOPE, requireActorVenue } from "@/lib/ticketing/common";
import { partyStaffContext, type PartyActor, type PartyStaffContext } from "@/lib/parties/gate";
import { locationInPartyScope, rejectBodyOrgId } from "@/lib/parties/scope";
import { PartyValidationError } from "@/lib/parties/errors";
import { logPartyAudit } from "@/lib/parties/activity";

export const PARTY_SETTING_FIELDS = [
  "defaultDepositPercent",
  "defaultDepositFixedCents",
  "depositDueMode",
  "depositDaysBefore",
  "requireDepositToConfirm",
  "allowConfirmWithoutDeposit",
  "balanceDueMode",
  "balanceDaysBefore",
  "defaultPartyDurationMinutes",
  "defaultMinKids",
  "defaultMaxKids",
  "defaultIncludedAdults",
  "invitationExpiresHours",
  "allowOnlinePartyBooking",
  "allowHostEditGuestList",
  "allowHostEditFood",
  "foodOrderCutoffMinutes",
  "sendBalanceReminder",
  "balanceReminderDaysBefore",
  "hostCancelCutoffHours",
] as const;

export type PartySettingField = (typeof PARTY_SETTING_FIELDS)[number];

export type PartySettingsValues = {
  defaultDepositPercent: number | null;
  defaultDepositFixedCents: number | null;
  depositDueMode: PartyDepositDueMode;
  depositDaysBefore: number;
  requireDepositToConfirm: boolean;
  allowConfirmWithoutDeposit: boolean;
  balanceDueMode: PartyBalanceDueMode;
  balanceDaysBefore: number;
  defaultPartyDurationMinutes: number;
  defaultMinKids: number;
  defaultMaxKids: number;
  defaultIncludedAdults: number;
  invitationExpiresHours: number;
  allowOnlinePartyBooking: boolean;
  allowHostEditGuestList: boolean;
  allowHostEditFood: boolean;
  foodOrderCutoffMinutes: number;
  sendBalanceReminder: boolean;
  balanceReminderDaysBefore: number[];
  hostCancelCutoffHours: number;
};

export type SettingSource = "schema_default" | "org_default" | "venue_override";

export const PARTY_SETTINGS_DEFAULTS: PartySettingsValues = {
  defaultDepositPercent: null,
  defaultDepositFixedCents: null,
  depositDueMode: "at_booking",
  depositDaysBefore: 0,
  requireDepositToConfirm: true,
  allowConfirmWithoutDeposit: false,
  balanceDueMode: "on_arrival",
  balanceDaysBefore: 0,
  defaultPartyDurationMinutes: 120,
  defaultMinKids: 1,
  defaultMaxKids: 15,
  defaultIncludedAdults: 2,
  invitationExpiresHours: 168,
  allowOnlinePartyBooking: true,
  allowHostEditGuestList: true,
  allowHostEditFood: false,
  foodOrderCutoffMinutes: 60,
  sendBalanceReminder: true,
  balanceReminderDaysBefore: [7, 3, 1],
  hostCancelCutoffHours: 48,
};

type SettingsRow = Prisma.PartySettingsGetPayload<Record<string, never>>;

function isSettingField(value: unknown): value is PartySettingField {
  return (PARTY_SETTING_FIELDS as readonly string[]).includes(String(value));
}

function rowValues(row: SettingsRow): PartySettingsValues {
  const days = Array.isArray(row.balanceReminderDaysBefore)
    ? (row.balanceReminderDaysBefore as unknown[])
        .map((d) => Number(d))
        .filter((d) => Number.isInteger(d) && d >= 0)
    : PARTY_SETTINGS_DEFAULTS.balanceReminderDaysBefore;
  return {
    defaultDepositPercent:
      row.defaultDepositPercent == null ? null : Number(row.defaultDepositPercent.toString()),
    defaultDepositFixedCents: row.defaultDepositFixedCents,
    depositDueMode: row.depositDueMode,
    depositDaysBefore: row.depositDaysBefore,
    requireDepositToConfirm: row.requireDepositToConfirm,
    allowConfirmWithoutDeposit: row.allowConfirmWithoutDeposit,
    balanceDueMode: row.balanceDueMode,
    balanceDaysBefore: row.balanceDaysBefore,
    defaultPartyDurationMinutes: row.defaultPartyDurationMinutes,
    defaultMinKids: row.defaultMinKids,
    defaultMaxKids: row.defaultMaxKids,
    defaultIncludedAdults: row.defaultIncludedAdults,
    invitationExpiresHours: row.invitationExpiresHours,
    allowOnlinePartyBooking: row.allowOnlinePartyBooking,
    allowHostEditGuestList: row.allowHostEditGuestList,
    allowHostEditFood: row.allowHostEditFood,
    foodOrderCutoffMinutes: row.foodOrderCutoffMinutes,
    sendBalanceReminder: row.sendBalanceReminder,
    balanceReminderDaysBefore: days,
    hostCancelCutoffHours: row.hostCancelCutoffHours,
  };
}

function overrideList(row: SettingsRow | null): PartySettingField[] {
  if (!row || !Array.isArray(row.overrideFields)) return [];
  return (row.overrideFields as unknown[]).filter(isSettingField);
}

export type ResolvedPartySettings = {
  values: PartySettingsValues;
  sources: Record<PartySettingField, SettingSource>;
  orgDefaultId: string | null;
  venueOverrideId: string | null;
};

export async function resolvePartySettingsWithSources(
  orgId: string,
  locationId?: string | null
): Promise<ResolvedPartySettings> {
  const [orgRow, venueRow] = await Promise.all([
    prisma.partySettings.findFirst({
      where: { orgId, locationId: null },
      orderBy: { createdAt: "asc" },
    }),
    locationId
      ? prisma.partySettings.findFirst({ where: { orgId, locationId } })
      : Promise.resolve(null),
  ]);
  const values = { ...(orgRow ? rowValues(orgRow) : PARTY_SETTINGS_DEFAULTS) } as Record<
    PartySettingField,
    unknown
  >;
  const sources = {} as Record<PartySettingField, SettingSource>;
  for (const f of PARTY_SETTING_FIELDS) sources[f] = orgRow ? "org_default" : "schema_default";
  if (venueRow) {
    const venueValues = rowValues(venueRow);
    for (const f of overrideList(venueRow)) {
      values[f] = venueValues[f];
      sources[f] = "venue_override";
    }
  }
  return {
    values: values as PartySettingsValues,
    sources,
    orgDefaultId: orgRow?.id ?? null,
    venueOverrideId: venueRow?.id ?? null,
  };
}

/** Engine / public resolve (no staff auth). Caller already resolved the org. */
export async function resolvePartySettings(
  orgId: string,
  locationId?: string | null
): Promise<PartySettingsValues> {
  return (await resolvePartySettingsWithSources(orgId, locationId)).values;
}

function parseSettingsPatch(raw: Record<string, unknown>): Partial<PartySettingsValues> {
  const out: Partial<PartySettingsValues> = {};
  const fields: Record<string, string> = {};
  const put = (key: PartySettingField, value: unknown) => {
    (out as Record<string, unknown>)[key] = value;
  };
  const intField = (key: PartySettingField, min: number, max: number) => {
    if (raw[key] === undefined) return;
    const n = Number(raw[key]);
    if (!Number.isInteger(n) || n < min || n > max) {
      fields[key] = `Must be a whole number between ${min} and ${max}`;
      return;
    }
    put(key, n);
  };
  const boolField = (key: PartySettingField) => {
    if (raw[key] !== undefined) put(key, Boolean(raw[key]));
  };
  if (raw.defaultDepositPercent !== undefined) {
    if (raw.defaultDepositPercent === null || raw.defaultDepositPercent === "") {
      out.defaultDepositPercent = null;
    } else {
      const n = Number(raw.defaultDepositPercent);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        fields.defaultDepositPercent = "Must be between 0 and 100";
      } else out.defaultDepositPercent = Math.round(n * 100) / 100;
    }
  }
  if (raw.defaultDepositFixedCents !== undefined) {
    if (raw.defaultDepositFixedCents === null || raw.defaultDepositFixedCents === "") {
      out.defaultDepositFixedCents = null;
    } else {
      const n = Number(raw.defaultDepositFixedCents);
      if (!Number.isInteger(n) || n < 0) fields.defaultDepositFixedCents = "Must be 0 or more cents";
      else out.defaultDepositFixedCents = n;
    }
  }
  for (const key of ["depositDueMode", "balanceDueMode"] as const) {
    if (raw[key] === undefined) continue;
    const v = String(raw[key]);
    if (!["at_booking", "days_before_event", "on_arrival"].includes(v)) {
      fields[key] = "Choose at booking, days before the event, or on arrival";
    } else put(key, v);
  }
  intField("depositDaysBefore", 0, 365);
  intField("balanceDaysBefore", 0, 365);
  intField("defaultPartyDurationMinutes", 15, 24 * 60);
  intField("defaultMinKids", 0, 500);
  intField("defaultMaxKids", 0, 500);
  intField("defaultIncludedAdults", 0, 500);
  intField("invitationExpiresHours", 1, 24 * 90);
  intField("foodOrderCutoffMinutes", 0, 7 * 24 * 60);
  intField("hostCancelCutoffHours", 0, 24 * 90);
  boolField("requireDepositToConfirm");
  boolField("allowConfirmWithoutDeposit");
  boolField("allowOnlinePartyBooking");
  boolField("allowHostEditGuestList");
  boolField("allowHostEditFood");
  boolField("sendBalanceReminder");
  if (raw.balanceReminderDaysBefore !== undefined) {
    const arr = Array.isArray(raw.balanceReminderDaysBefore)
      ? raw.balanceReminderDaysBefore.map((d) => Number(d))
      : [];
    if (arr.length > 10 || !arr.every((d) => Number.isInteger(d) && d >= 0 && d <= 365)) {
      fields.balanceReminderDaysBefore = "Use up to 10 whole days between 0 and 365";
    } else out.balanceReminderDaysBefore = [...new Set(arr)].sort((a, b) => b - a);
  }
  if (out.defaultDepositPercent != null && out.defaultDepositFixedCents != null) {
    fields.defaultDepositFixedCents = "Use a deposit percent or a fixed amount, not both";
  }
  if (
    out.defaultMinKids != null &&
    out.defaultMaxKids != null &&
    out.defaultMinKids > out.defaultMaxKids
  ) {
    fields.defaultMinKids = "Minimum kids cannot exceed maximum kids";
  }
  if (Object.keys(fields).length) {
    throw new PartyValidationError("PARTY_SETTINGS_INVALID", fields);
  }
  return out;
}

function toPrismaData(values: Partial<PartySettingsValues>): Record<string, unknown> {
  const data: Record<string, unknown> = { ...values };
  if (values.balanceReminderDaysBefore) {
    data.balanceReminderDaysBefore = values.balanceReminderDaysBefore as Prisma.InputJsonValue;
  }
  return data;
}

async function assertSettingsLocation(ctx: PartyStaffContext, locationId: string | null) {
  if (locationId == null) {
    // Park-locked / HQ-filtered seats never rewrite the company default.
    if (ctx.scope.parkLocked || ctx.scope.locationId) {
      throw new ForbiddenError(LOCATION_OUT_OF_SCOPE);
    }
    return;
  }
  if (!isValidId(locationId)) throw new Error("Invalid locationId");
  await requireActorVenue(ctx.orgId, locationId, { allowArchived: true });
  if (!locationInPartyScope(ctx.scope, locationId)) {
    throw new ForbiddenError(LOCATION_OUT_OF_SCOPE);
  }
}

async function describeSettings(orgId: string, locationId: string | null) {
  const resolved = await resolvePartySettingsWithSources(orgId, locationId);
  return {
    locationId,
    values: resolved.values,
    sources: resolved.sources,
    orgDefaultId: resolved.orgDefaultId,
    venueOverrideId: resolved.venueOverrideId,
    defaults: PARTY_SETTINGS_DEFAULTS,
  };
}

export async function getPartySettingsForStaff(actor: PartyActor, locationId?: string | null) {
  const ctx = await partyStaffContext(actor);
  const loc = locationId && locationId.trim() ? locationId.trim() : null;
  if (loc) await assertSettingsLocation(ctx, loc);
  return describeSettings(ctx.orgId, loc);
}

/**
 * PATCH settings. Body: { locationId?: string|null, values: {...}, resetFields?: string[] }.
 * locationId null/absent = org default. One org-default row per org is serialized
 * with an advisory lock because Postgres treats NULL locationIds as distinct.
 */
export async function patchPartySettings(actor: PartyActor, raw: unknown) {
  const ctx = await partyStaffContext(actor);
  const body = rejectBodyOrgId(raw);
  const locationId =
    typeof body.locationId === "string" && body.locationId.trim()
      ? body.locationId.trim()
      : null;
  await assertSettingsLocation(ctx, locationId);
  const valuesRaw =
    body.values && typeof body.values === "object" && !Array.isArray(body.values)
      ? (body.values as Record<string, unknown>)
      : {};
  const patch = parseSettingsPatch(valuesRaw);
  const resetFields = Array.isArray(body.resetFields)
    ? body.resetFields.filter(isSettingField)
    : [];
  if (locationId == null && resetFields.length) {
    throw new PartyValidationError("PARTY_SETTINGS_INVALID", {
      resetFields: "Reset to default only applies to a venue override",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`party_settings:${ctx.orgId}:${locationId ?? "org"}`}))`;
    const existing = await tx.partySettings.findFirst({
      where: { orgId: ctx.orgId, locationId },
      orderBy: { createdAt: "asc" },
    });
    if (locationId == null) {
      if (existing) {
        await tx.partySettings.update({ where: { id: existing.id }, data: toPrismaData(patch) });
      } else {
        await tx.partySettings.create({
          data: { orgId: ctx.orgId, locationId: null, ...toPrismaData(patch) },
        });
      }
      return;
    }
    const overrides = new Set(overrideList(existing));
    for (const f of Object.keys(patch)) if (isSettingField(f)) overrides.add(f);
    for (const f of resetFields) overrides.delete(f);
    const data = {
      ...toPrismaData(patch),
      overrideFields: [...overrides] as Prisma.InputJsonValue,
    };
    if (existing) {
      await tx.partySettings.update({ where: { id: existing.id }, data });
    } else {
      await tx.partySettings.create({ data: { orgId: ctx.orgId, locationId, ...data } });
    }
  });

  logPartyAudit(actor, ctx.orgId, {
    action: "parties.settings.update",
    entityType: "Settings",
    entityId: locationId ?? ctx.orgId,
    description: locationId ? "Party venue settings updated" : "Party org settings updated",
    metadata: { locationId, fields: Object.keys(patch), resetFields },
  });
  return describeSettings(ctx.orgId, locationId);
}
