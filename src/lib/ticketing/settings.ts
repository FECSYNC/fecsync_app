/**
 * BookingSettings — org default + per-location overrides.
 */
import type { BookingCreateMode, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  DEFAULT_TIME_CLOCK_FORMAT,
  TIME_CLOCK_FORMATS,
  normalizeTimeClockFormat,
  type TimeClockFormat as ClockFormat,
} from "@/lib/timeClock";
import {
  assertTicketingStaffMutate,
  assertTicketingStaffRead,
  locationScopeFilter,
  rejectClientOrgFields,
  requireActorVenue,
  LOCATION_OUT_OF_SCOPE,
  type TicketingActor,
} from "@/lib/ticketing/common";

const MODES = new Set(["hold", "reserve", "prompt"]);

export type BookingSettingsDto = {
  id: string;
  orgId: string;
  locationId: string | null;
  defaultCreateMode: BookingCreateMode;
  holdTtlMinutes: number;
  reserveTtlHours: number;
  requireReviewBeforeConfirm: boolean;
  allowOnlinePayLater: boolean;
  payLaterMarksConfirmed: boolean;
  pastEditGraceMinutes: number;
  cancelCutoffMinutes: number | null;
  defaultTaxExempt: boolean;
  smsEnabled: boolean;
  timeFormat: ClockFormat;
  createdAt: string;
  updatedAt: string;
};

function toDto(row: {
  id: string;
  orgId: string;
  locationId: string | null;
  defaultCreateMode: BookingCreateMode;
  holdTtlMinutes: number;
  reserveTtlHours: number;
  requireReviewBeforeConfirm: boolean;
  allowOnlinePayLater: boolean;
  payLaterMarksConfirmed: boolean;
  pastEditGraceMinutes: number;
  cancelCutoffMinutes: number | null;
  defaultTaxExempt: boolean;
  smsEnabled: boolean;
  timeFormat: string;
  createdAt: Date;
  updatedAt: Date;
}): BookingSettingsDto {
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    defaultCreateMode: row.defaultCreateMode,
    holdTtlMinutes: row.holdTtlMinutes,
    reserveTtlHours: row.reserveTtlHours,
    requireReviewBeforeConfirm: row.requireReviewBeforeConfirm,
    allowOnlinePayLater: row.allowOnlinePayLater,
    payLaterMarksConfirmed: row.payLaterMarksConfirmed,
    pastEditGraceMinutes: row.pastEditGraceMinutes,
    cancelCutoffMinutes: row.cancelCutoffMinutes,
    defaultTaxExempt: row.defaultTaxExempt,
    smsEnabled: row.smsEnabled,
    timeFormat: normalizeTimeClockFormat(row.timeFormat),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const DEFAULTS = {
  defaultCreateMode: "hold" as BookingCreateMode,
  holdTtlMinutes: 15,
  reserveTtlHours: 24,
  requireReviewBeforeConfirm: false,
  allowOnlinePayLater: false,
  payLaterMarksConfirmed: false,
  pastEditGraceMinutes: 0,
  cancelCutoffMinutes: null as number | null,
  defaultTaxExempt: false,
  smsEnabled: false,
  timeFormat: DEFAULT_TIME_CLOCK_FORMAT,
};

/**
 * Resolve effective settings without staff auth (engine / public paths).
 */
export async function resolveBookingSettings(
  orgId: string,
  locationId?: string | null
): Promise<BookingSettingsDto> {
  if (locationId) {
    const locRow = await prisma.bookingSettings.findFirst({
      where: { orgId, locationId },
    });
    if (locRow) return toDto(locRow);
  }
  const orgDefault = await prisma.bookingSettings.findFirst({
    where: { orgId, locationId: null },
    orderBy: { updatedAt: "desc" },
  });
  if (orgDefault) return toDto(orgDefault);
  return {
    id: "defaults",
    orgId,
    locationId: locationId ?? null,
    ...DEFAULTS,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

/**
 * Resolve effective settings: location override → org default → built-in defaults.
 * When locationId is provided, validates venue belongs to actor org.
 */
export async function getBookingSettings(
  actor: TicketingActor,
  locationId?: string | null
): Promise<BookingSettingsDto> {
  await assertTicketingStaffRead(actor);
  const scope = await locationScopeFilter(actor);
  let loc =
    locationId === undefined || locationId === null || locationId === ""
      ? scope.locationId
      : locationId;
  if (locationId !== undefined && locationId !== null && locationId !== "") {
    if (!isValidId(locationId)) {
      throw new Error("Invalid locationId");
    }
    loc = locationId;
  }

  if (loc) {
    await requireActorVenue(scope.orgId, loc, { allowArchived: true });
    if (scope.parkLocked) {
      const allowed = scope.locationIds?.length
        ? scope.locationIds
        : scope.locationId
          ? [scope.locationId]
          : [];
      if (!allowed.includes(loc)) {
        throw new ForbiddenError(LOCATION_OUT_OF_SCOPE);
      }
    } else if (scope.locationId && scope.locationId !== loc) {
      throw new ForbiddenError(LOCATION_OUT_OF_SCOPE);
    }
  }

  return resolveBookingSettings(scope.orgId, loc ?? null);
}

export type PatchBookingSettingsInput = {
  locationId?: string | null;
  defaultCreateMode?: BookingCreateMode;
  holdTtlMinutes?: number;
  reserveTtlHours?: number;
  requireReviewBeforeConfirm?: boolean;
  allowOnlinePayLater?: boolean;
  payLaterMarksConfirmed?: boolean;
  pastEditGraceMinutes?: number;
  cancelCutoffMinutes?: number | null;
  defaultTaxExempt?: boolean;
  smsEnabled?: boolean;
  timeFormat?: ClockFormat;
};

export async function upsertBookingSettings(
  actor: TicketingActor,
  input: PatchBookingSettingsInput
): Promise<BookingSettingsDto> {
  const orgId = await assertTicketingStaffMutate(actor);
  const scope = await locationScopeFilter(actor);

  let locationId: string | null =
    input.locationId === undefined
      ? scope.locationId ?? null
      : input.locationId === null || input.locationId === ""
        ? null
        : input.locationId;

  // Park-locked / HQ park scope: never allow rewriting org-default (null) settings
  // or mutating venues outside the assigned / filtered set.
  if (scope.parkLocked) {
    if (locationId == null || locationId === "") {
      throw new ForbiddenError(LOCATION_OUT_OF_SCOPE);
    }
    const allowed = scope.locationIds?.length
      ? scope.locationIds
      : scope.locationId
        ? [scope.locationId]
        : [];
    if (!allowed.includes(locationId)) {
      throw new ForbiddenError(LOCATION_OUT_OF_SCOPE);
    }
  } else if (scope.locationId) {
    if (locationId == null || locationId === "") {
      throw new ForbiddenError(LOCATION_OUT_OF_SCOPE);
    }
    if (locationId !== scope.locationId) {
      throw new ForbiddenError(LOCATION_OUT_OF_SCOPE);
    }
  }

  if (locationId) {
    if (!isValidId(locationId)) throw new Error("Invalid locationId");
    await requireActorVenue(orgId, locationId);
  }

  if (
    input.defaultCreateMode != null &&
    !MODES.has(input.defaultCreateMode)
  ) {
    throw new Error("Invalid defaultCreateMode");
  }
  if (
    input.timeFormat != null &&
    !TIME_CLOCK_FORMATS.includes(input.timeFormat)
  ) {
    throw new Error("Invalid timeFormat");
  }
  let holdTtlMinutes: number | undefined;
  if (input.holdTtlMinutes !== undefined) {
    const n = Number(input.holdTtlMinutes);
    if (!Number.isInteger(n) || n < 1 || n > 24 * 60) {
      throw new Error("holdTtlMinutes must be 1–1440");
    }
    holdTtlMinutes = n;
  }
  let reserveTtlHours: number | undefined;
  if (input.reserveTtlHours !== undefined) {
    const n = Number(input.reserveTtlHours);
    if (!Number.isInteger(n) || n < 1 || n > 24 * 30) {
      throw new Error("reserveTtlHours must be 1–720");
    }
    reserveTtlHours = n;
  }

  const existing = await prisma.bookingSettings.findFirst({
    where: { orgId, locationId },
    orderBy: { updatedAt: "desc" },
  });

  // Heal duplicate org-default rows (Postgres UNIQUE allows multiple NULLs).
  if (locationId == null) {
    const dupes = await prisma.bookingSettings.findMany({
      where: { orgId, locationId: null },
      orderBy: { updatedAt: "desc" },
    });
    if (dupes.length > 1) {
      const keepId = existing?.id ?? dupes[0]!.id;
      await prisma.bookingSettings.deleteMany({
        where: {
          orgId,
          locationId: null,
          id: { not: keepId },
        },
      });
    }
  }

  const data: Prisma.BookingSettingsUncheckedUpdateInput = {};
  if (input.defaultCreateMode !== undefined) {
    data.defaultCreateMode = input.defaultCreateMode;
  }
  if (holdTtlMinutes !== undefined) {
    data.holdTtlMinutes = holdTtlMinutes;
  }
  if (reserveTtlHours !== undefined) {
    data.reserveTtlHours = reserveTtlHours;
  }
  if (input.requireReviewBeforeConfirm !== undefined) {
    data.requireReviewBeforeConfirm = Boolean(input.requireReviewBeforeConfirm);
  }
  if (input.allowOnlinePayLater !== undefined) {
    data.allowOnlinePayLater = Boolean(input.allowOnlinePayLater);
  }
  if (input.payLaterMarksConfirmed !== undefined) {
    data.payLaterMarksConfirmed = Boolean(input.payLaterMarksConfirmed);
  }
  if (input.pastEditGraceMinutes !== undefined) {
    const n = Number(input.pastEditGraceMinutes);
    if (!Number.isInteger(n) || n < 0 || n > 24 * 60 * 30) {
      throw new Error("pastEditGraceMinutes must be an integer 0–43200");
    }
    data.pastEditGraceMinutes = n;
  }
  if (input.cancelCutoffMinutes !== undefined) {
    if (input.cancelCutoffMinutes == null) {
      data.cancelCutoffMinutes = null;
    } else {
      const n = Number(input.cancelCutoffMinutes);
      if (!Number.isInteger(n) || n < 0 || n > 24 * 60 * 30) {
        throw new Error("cancelCutoffMinutes must be an integer 0–43200 or null");
      }
      data.cancelCutoffMinutes = n;
    }
  }
  if (input.defaultTaxExempt !== undefined) {
    data.defaultTaxExempt = Boolean(input.defaultTaxExempt);
  }
  if (input.smsEnabled !== undefined) {
    data.smsEnabled = Boolean(input.smsEnabled);
  }
  if (input.timeFormat !== undefined) {
    (data as { timeFormat?: ClockFormat }).timeFormat = input.timeFormat;
  }

  if (existing) {
    const row = await prisma.bookingSettings.update({
      where: { id: existing.id },
      data,
    });
    return toDto(row);
  }

  const createData = {
    orgId,
    locationId,
    defaultCreateMode:
      input.defaultCreateMode ?? DEFAULTS.defaultCreateMode,
    holdTtlMinutes: holdTtlMinutes ?? DEFAULTS.holdTtlMinutes,
    reserveTtlHours: reserveTtlHours ?? DEFAULTS.reserveTtlHours,
    requireReviewBeforeConfirm:
      input.requireReviewBeforeConfirm ?? DEFAULTS.requireReviewBeforeConfirm,
    allowOnlinePayLater:
      input.allowOnlinePayLater ?? DEFAULTS.allowOnlinePayLater,
    payLaterMarksConfirmed:
      input.payLaterMarksConfirmed ?? DEFAULTS.payLaterMarksConfirmed,
    pastEditGraceMinutes:
      input.pastEditGraceMinutes ?? DEFAULTS.pastEditGraceMinutes,
    cancelCutoffMinutes:
      input.cancelCutoffMinutes === undefined
        ? DEFAULTS.cancelCutoffMinutes
        : input.cancelCutoffMinutes,
    defaultTaxExempt: input.defaultTaxExempt ?? DEFAULTS.defaultTaxExempt,
    smsEnabled: input.smsEnabled ?? DEFAULTS.smsEnabled,
    timeFormat: input.timeFormat ?? DEFAULTS.timeFormat,
  };

  const row = await prisma.bookingSettings.create({
    data: createData as Prisma.BookingSettingsUncheckedCreateInput,
  });
  return toDto(row);
}

export function parsePatchSettingsBody(body: unknown): PatchBookingSettingsInput {
  if (!body || typeof body !== "object") throw new Error("Invalid JSON");
  const b = body as Record<string, unknown>;
  rejectClientOrgFields(b);
  return {
    locationId:
      b.locationId === undefined
        ? undefined
        : b.locationId === null || b.locationId === ""
          ? null
          : String(b.locationId),
    defaultCreateMode:
      b.defaultCreateMode !== undefined
        ? (String(b.defaultCreateMode) as BookingCreateMode)
        : undefined,
    holdTtlMinutes:
      b.holdTtlMinutes !== undefined ? Number(b.holdTtlMinutes) : undefined,
    reserveTtlHours:
      b.reserveTtlHours !== undefined ? Number(b.reserveTtlHours) : undefined,
    requireReviewBeforeConfirm:
      b.requireReviewBeforeConfirm !== undefined
        ? Boolean(b.requireReviewBeforeConfirm)
        : undefined,
    allowOnlinePayLater:
      b.allowOnlinePayLater !== undefined
        ? Boolean(b.allowOnlinePayLater)
        : undefined,
    payLaterMarksConfirmed:
      b.payLaterMarksConfirmed !== undefined
        ? Boolean(b.payLaterMarksConfirmed)
        : undefined,
    pastEditGraceMinutes:
      b.pastEditGraceMinutes !== undefined
        ? Number(b.pastEditGraceMinutes)
        : undefined,
    cancelCutoffMinutes:
      b.cancelCutoffMinutes === undefined
        ? undefined
        : b.cancelCutoffMinutes === null || b.cancelCutoffMinutes === ""
          ? null
          : Number(b.cancelCutoffMinutes),
    defaultTaxExempt:
      b.defaultTaxExempt !== undefined
        ? Boolean(b.defaultTaxExempt)
        : undefined,
    smsEnabled:
      b.smsEnabled !== undefined ? Boolean(b.smsEnabled) : undefined,
    timeFormat:
      b.timeFormat === undefined
        ? undefined
        : TIME_CLOCK_FORMATS.includes(String(b.timeFormat) as ClockFormat)
          ? (String(b.timeFormat) as ClockFormat)
          : (() => {
              throw new Error("Invalid timeFormat");
            })(),
  };
}

export async function timeFormatsForVenues(
  pairs: Array<{ orgId: string; locationId: string }>
): Promise<Map<string, ClockFormat>> {
  const map = new Map<string, ClockFormat>();
  const pending = new Map<string, { orgId: string; locationId: string }>();
  for (const p of pairs) {
    pending.set(`${p.orgId}:${p.locationId}`, p);
  }
  await Promise.all(
    [...pending.entries()].map(async ([key, pair]) => {
      const settings = await resolveBookingSettings(pair.orgId, pair.locationId);
      map.set(key, settings.timeFormat);
    })
  );
  return map;
}
