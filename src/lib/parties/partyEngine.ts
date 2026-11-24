/**
 * Party orchestration. A party IS a booking: every capacity, hold, confirm,
 * cancel, reactivate, and payment path goes through ticketing/bookingEngine;
 * this module plans party lines + detail and calls the engine. No second
 * state machine — opsStatus is synced from Booking.status by engine hooks.
 */
import type { BookingCreateMode, PartyOpsStatus, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { P } from "@/lib/auth/permissions";
import {
  assertBookingNotPastLocked,
  cancelBooking,
  confirmBooking,
  createBooking,
  reactivateBooking,
  replaceBookingLines,
  type PartyDetailInput,
} from "@/lib/ticketing/bookingEngine";
import { createTicketSession } from "@/lib/ticketing/sessions";
import { resolveBookingSettings } from "@/lib/ticketing/settings";
import { expireBookingHolds } from "@/lib/ticketing/expireHolds";
import { syncPartyOpsFromBooking } from "@/lib/parties/bookingHooks";
import {
  TicketingError,
  BOOKING_PAST_LOCKED,
  INVALID_STATUS_TRANSITION,
  OVERBOOK_FORBIDDEN,
  PARTY_OPS_TRANSITION,
  PARTY_PAST_LOCKED,
  PARTY_REASON_REQUIRED,
  PARTY_ROOM_CONFLICT,
  SESSION_SOLD_OUT,
  isTicketingError,
  partyNotFound,
} from "@/lib/parties/errors";
import { actorCan, partyStaffContext, type PartyActor, type PartyStaffContext } from "@/lib/parties/gate";
import {
  assertVenueWritable,
  partyLocationWhere,
  rejectBodyOrgId,
  resolvePartyLocationId,
} from "@/lib/parties/scope";
import {
  effectivePackageConfig,
  loadPartyPackageRow,
  requireBookablePackage,
  type EffectivePackageConfig,
  type PartyPackageRow,
} from "@/lib/parties/packages";
import { findRoomConflicts, requireAssignableRoom } from "@/lib/parties/rooms";
import { resolvePartySettings, type PartySettingsValues } from "@/lib/parties/settings";
import { assertPartyCounts, buildPartyPricePlan } from "@/lib/parties/pricing";
import { computeDepositRequiredCents, computePartyDueDates, syncPartyMoney, toCents } from "@/lib/parties/deposits";
import { schedulePartyReminders } from "@/lib/parties/reminders";
import { logPartyActivity } from "@/lib/parties/activity";
import { isPartyLive, loadPartyById, loadStaffParty, type LoadedParty } from "@/lib/parties/load";
import {
  foodCutoffPassed,
  parseFoodLines,
  partyFoodPricing,
  resolveFoodLines,
  writeFoodDraft,
} from "@/lib/parties/food";
import { partyWaiversEnabled, recomputePartyWaiverStatusSafe } from "@/lib/parties/waivers";
import { smsProviderConfigured } from "@/lib/ticketing/sms";
import { toStaffPartyDto } from "@/lib/parties/serialize";

const STAFF_CHANNELS = ["phone", "walk_in", "pos"] as const;
type StaffChannel = (typeof STAFF_CHANNELS)[number];

export type CreatePartyInput = {
  channel: StaffChannel;
  locationId?: string | null;
  productId: string;
  sessionId?: string | null;
  startsAt?: string | null;
  roomResourceId?: string | null;
  kidCount: number;
  adultCount: number;
  partyName: string;
  honoreeName?: string | null;
  honoreeAge?: number | null;
  honoreeBirthDate?: string | null;
  contact: { name?: string | null; email?: string | null; phone?: string | null };
  accountId?: string | null;
  addOns?: Array<{ productId: string; qty?: number }>;
  foodLines?: unknown;
  notes?: string | null;
  posNotes?: string | null;
  createMode?: BookingCreateMode;
  overbook?: boolean;
  overbookReason?: string | null;
  hostStaffUserId?: string | null;
  hostNotes?: string | null;
  foodNotes?: string | null;
  holdIds?: string[];
};

function optString(v: unknown, max = 500): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

function optInt(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 150) throw new Error("Honoree age must be 0–150");
  return n;
}

function parseCount(v: unknown, field: string): number {
  const n = Number(v ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > 10_000) throw new Error(`${field} must be a whole number of 0 or more`);
  return n;
}

function parseAddOns(raw: unknown): Array<{ productId: string; qty?: number }> | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new Error("addOns must be an array");
  return raw
    .map((r) =>
      typeof r === "string"
        ? { productId: r, qty: 1 }
        : { productId: String((r as Record<string, unknown>)?.productId ?? ""), qty: Number((r as Record<string, unknown>)?.qty ?? 1) }
    )
    .filter((a) => isValidId(a.productId));
}

export function parseCreatePartyBody(raw: unknown): CreatePartyInput {
  const b = rejectBodyOrgId(raw);
  const channel = String(b.channel ?? "phone");
  if (!(STAFF_CHANNELS as readonly string[]).includes(channel)) {
    throw new Error("Staff parties use channel phone, walk_in, or pos (guest self-serve uses the public booking page)");
  }
  const contactRaw = (b.contact && typeof b.contact === "object" ? b.contact : {}) as Record<string, unknown>;
  const createMode = b.createMode === undefined ? undefined : String(b.createMode);
  if (createMode && !["hold", "reserve", "prompt"].includes(createMode)) throw new Error("Invalid createMode");
  const partyName = optString(b.partyName, 160);
  if (!partyName) throw new Error("Party name is required");
  return {
    channel: channel as StaffChannel,
    locationId: optString(b.locationId, 64),
    productId: String(b.productId ?? ""),
    sessionId: optString(b.sessionId, 64),
    startsAt: optString(b.startsAt, 64),
    roomResourceId: optString(b.roomResourceId, 64),
    kidCount: parseCount(b.kidCount, "kidCount"),
    adultCount: parseCount(b.adultCount, "adultCount"),
    partyName,
    honoreeName: optString(b.honoreeName, 160),
    honoreeAge: optInt(b.honoreeAge),
    honoreeBirthDate: optString(b.honoreeBirthDate, 40),
    contact: {
      name: optString(contactRaw.name ?? b.primaryContactName, 160),
      email: optString(contactRaw.email ?? b.primaryContactEmail, 200)?.toLowerCase() ?? null,
      phone: optString(contactRaw.phone ?? b.primaryContactPhone, 40),
    },
    accountId: optString(b.accountId, 64),
    addOns: parseAddOns(b.addOns ?? b.addOnProductIds),
    foodLines: b.foodLines,
    notes: optString(b.notes, 2000),
    posNotes: optString(b.posNotes, 2000),
    createMode: createMode as BookingCreateMode | undefined,
    overbook: b.overbook === true,
    overbookReason: optString(b.overbookReason, 500),
    hostStaffUserId: optString(b.hostStaffUserId, 64),
    hostNotes: optString(b.hostNotes, 2000),
    foodNotes: optString(b.foodNotes, 2000),
    holdIds: Array.isArray(b.holdIds) ? b.holdIds.map(String).filter((id) => isValidId(id)) : undefined,
  };
}

function parseDate(raw: string | null | undefined, field: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error(`${field} is invalid`);
  return d;
}

/** Overbook needs bookings:overbook + a reason (logged). */
function assertOverbookAllowed(actor: PartyActor, overbook: boolean | undefined, reason: string | null | undefined) {
  if (!overbook) return;
  if (!actorCan(actor, P.BookingsOverbook)) throw new TicketingError(OVERBOOK_FORBIDDEN, 403);
  if (!reason?.trim()) throw new TicketingError(PARTY_REASON_REQUIRED, 400);
}

function mapPastLock(err: unknown): never {
  if (isTicketingError(err) && err.code === BOOKING_PAST_LOCKED) {
    throw new TicketingError(PARTY_PAST_LOCKED, 403);
  }
  throw err;
}

async function assertHostStaff(orgId: string, userId: string | null | undefined) {
  if (!userId) return null;
  if (!isValidId(userId)) throw new Error("Invalid hostStaffUserId");
  const membership = await prisma.membership.findFirst({
    where: { userId, orgId, status: "active" },
    select: { id: true },
  });
  if (!membership) throw new Error("Host must be an active staff member of this company");
  return userId;
}

/** sessionId, else an existing session at startsAt, else a one-party ad-hoc session. */
async function resolvePartySession(
  actor: PartyActor,
  pkg: PartyPackageRow,
  effective: EffectivePackageConfig,
  opts: { sessionId?: string | null; startsAt?: string | null; roomId: string | null; allowCreate: boolean }
) {
  if (opts.sessionId) {
    if (!isValidId(opts.sessionId)) throw new TicketingError(SESSION_SOLD_OUT, 409);
    const session = await prisma.ticketSession.findFirst({
      where: {
        id: opts.sessionId,
        orgId: pkg.orgId,
        locationId: pkg.locationId,
        productId: pkg.id,
        isClosed: false,
      },
    });
    if (!session) throw new TicketingError(SESSION_SOLD_OUT, 409);
    return session;
  }
  const startsAt = parseDate(opts.startsAt, "startsAt");
  if (!startsAt) throw new Error("Choose a session or a start time");
  const existing = await prisma.ticketSession.findFirst({
    where: { orgId: pkg.orgId, productId: pkg.id, startsAt, isClosed: false },
  });
  if (existing) return existing;
  if (!opts.allowCreate) throw new TicketingError(SESSION_SOLD_OUT, 409);
  const endsAt = new Date(startsAt.getTime() + effective.durationMinutes * 60_000);
  const created = await createTicketSession(actor, {
    productId: pkg.id,
    resourceId: opts.roomId,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    capacity: 1,
  });
  const row = await prisma.ticketSession.findFirst({ where: { id: created.id } });
  if (!row) throw new TicketingError(SESSION_SOLD_OUT, 409);
  return row;
}

async function resolveRoom(
  orgId: string,
  locationId: string,
  effective: EffectivePackageConfig,
  requested: string | null | undefined
) {
  const roomId = requested || (effective.roomAssignedAtBooking ? null : effective.roomResourceId);
  if (!roomId) return null;
  return requireAssignableRoom(orgId, locationId, roomId);
}

/** Non-locking early conflict answer; the engine re-checks under a row lock. */
async function precheckRoom(opts: {
  orgId: string;
  roomId: string | null;
  startsAt: Date;
  endsAt: Date;
  excludeBookingId?: string;
  overbook?: boolean;
}) {
  if (!opts.roomId || opts.overbook) return;
  const conflicts = await findRoomConflicts({
    orgId: opts.orgId,
    roomId: opts.roomId,
    startsAt: opts.startsAt,
    endsAt: opts.endsAt,
    excludeBookingId: opts.excludeBookingId,
  });
  if (conflicts.length) throw new TicketingError(PARTY_ROOM_CONFLICT, 409);
}

function partyMoneyDetail(opts: {
  totalCents: number;
  effective: EffectivePackageConfig;
  settings: PartySettingsValues;
  visitStartsAt: Date | null;
  timezone: string | null | undefined;
}) {
  const depositRequiredCents = computeDepositRequiredCents(
    opts.totalCents,
    {
      depositFixedCentsOverride: opts.effective.depositFixedCentsOverride,
      depositPercentOverride: opts.effective.depositPercentOverride,
    },
    opts.settings
  );
  return {
    depositRequiredCents,
    ...computePartyDueDates({
      visitStartsAt: opts.visitStartsAt,
      timezone: opts.timezone,
      settings: opts.settings,
      depositRequiredCents,
    }),
  };
}

/**
 * After any create / edit: deposit follows the actual Booking.total (engine
 * tax), due dates follow the visit, reminders + money mirror are refreshed.
 */
async function finalizePartyMoney(bookingId: string) {
  const party = await prisma.booking.findFirst({
    where: { id: bookingId },
    select: {
      orgId: true,
      locationId: true,
      total: true,
      visitStartsAt: true,
      location: { select: { timezone: true } },
      partyDetail: { select: { id: true, packageProductId: true } },
    },
  });
  if (!party?.partyDetail) return;
  const settings = await resolvePartySettings(party.orgId, party.locationId);
  const pkg = party.partyDetail.packageProductId
    ? await prisma.admissionProduct.findFirst({
        where: { id: party.partyDetail.packageProductId },
        include: { prices: true, partyConfig: true },
      })
    : null;
  const effective = pkg ? effectivePackageConfig(pkg, settings) : null;
  const money = partyMoneyDetail({
    totalCents: toCents(party.total),
    effective: effective ?? ({ depositFixedCentsOverride: null, depositPercentOverride: null } as EffectivePackageConfig),
    settings,
    visitStartsAt: party.visitStartsAt,
    timezone: party.location?.timezone,
  });
  await prisma.partyBookingDetail.update({ where: { id: party.partyDetail.id }, data: money });
  await syncPartyMoney(prisma, bookingId);
  await schedulePartyReminders(prisma, party.partyDetail.id);
}

async function partyActivities(bookingId: string) {
  return prisma.bookingActivity.findMany({
    where: { bookingId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
    select: { id: true, kind: true, payload: true, actorUserId: true, createdAt: true },
  });
}

export async function getPartyForStaff(actor: PartyActor, bookingId: string) {
  const ctx = await partyStaffContext(actor);
  const party = await loadStaffParty(ctx, bookingId);
  const [activities, settings, waiversEnabled] = await Promise.all([
    partyActivities(party.id),
    resolvePartySettings(ctx.orgId, party.locationId),
    partyWaiversEnabled(ctx.orgId),
  ]);
  return {
    ...toStaffPartyDto(party, { activities }),
    capabilities: {
      smsAvailable: smsProviderConfigured("party"),
      waiversEnabled,
      requireDepositToConfirm: settings.requireDepositToConfirm,
      allowConfirmWithoutDeposit: settings.allowConfirmWithoutDeposit,
      foodOrderCutoffMinutes: settings.foodOrderCutoffMinutes,
      foodCutoffPassed: foodCutoffPassed(party.visitStartsAt, settings.foodOrderCutoffMinutes),
    },
  };
}

async function staffDto(orgId: string, bookingId: string) {
  const party = await loadPartyById(orgId, bookingId);
  return toStaffPartyDto(party, { activities: await partyActivities(party.id) });
}

/**
 * Price + availability preview for the create wizard. Same validation and
 * pricing as createParty (counts, room, tax, deposit, due dates); writes nothing.
 */
export async function quoteParty(actor: PartyActor, input: CreatePartyInput) {
  const ctx = await partyStaffContext(actor);
  const locationId = await resolvePartyLocationId(actor, ctx.scope, input.locationId);
  const pkg = await requireBookablePackage(ctx.orgId, locationId, input.productId);
  const settings = await resolvePartySettings(ctx.orgId, locationId);
  const effective = effectivePackageConfig(pkg, settings);
  const room = await resolveRoom(ctx.orgId, locationId, effective, input.roomResourceId);
  assertPartyCounts({
    kidCount: input.kidCount,
    adultCount: input.adultCount,
    minGuests: pkg.minGuests,
    maxGuests: pkg.maxGuests,
    roomCapacity: room?.defaultCapacity,
  });
  let startsAt: Date;
  let endsAt: Date;
  let sessionRemaining: number | null = null;
  if (input.sessionId) {
    const session = isValidId(input.sessionId)
      ? await prisma.ticketSession.findFirst({
          where: { id: input.sessionId, orgId: ctx.orgId, locationId, productId: pkg.id, isClosed: false },
        })
      : null;
    if (!session) throw new TicketingError(SESSION_SOLD_OUT, 409);
    startsAt = session.startsAt;
    endsAt = session.endsAt;
    sessionRemaining = session.remaining;
  } else {
    const at = parseDate(input.startsAt, "startsAt");
    if (!at) throw new Error("Choose a session or a start time");
    startsAt = at;
    endsAt = new Date(at.getTime() + effective.durationMinutes * 60_000);
  }
  const conflicts = room
    ? await findRoomConflicts({ orgId: ctx.orgId, roomId: room.id, startsAt, endsAt })
    : [];
  const food = await resolveFoodLines(ctx.orgId, locationId, parseFoodLines(input.foodLines), {
    allowPriceOverride: actorCan(actor, P.PartiesFood),
  });
  const plan = await buildPartyPricePlan({
    orgId: ctx.orgId,
    pkg,
    effective,
    settings,
    sessionId: input.sessionId ?? "quote",
    roomResourceId: room?.id ?? null,
    visitStartsAt: startsAt,
    kidCount: input.kidCount,
    adultCount: input.adultCount,
    addOns: input.addOns,
    food: food.map((f) => ({ name: f.nameSnapshot, qty: f.qty, unitPriceCents: f.unitPriceCents })),
  });
  const money = partyMoneyDetail({
    totalCents: plan.preview.totalCents,
    effective,
    settings,
    visitStartsAt: startsAt,
    timezone: pkg.location?.timezone,
  });
  const bookingSettings = await resolveBookingSettings(ctx.orgId, locationId);
  return {
    ...plan.preview,
    depositRequiredCents: money.depositRequiredCents,
    depositDueAt: money.depositDueAt?.toISOString() ?? null,
    balanceDueAt: money.balanceDueAt?.toISOString() ?? null,
    visitStartsAt: startsAt.toISOString(),
    visitEndsAt: endsAt.toISOString(),
    timezone: pkg.location?.timezone ?? null,
    room: room ? { id: room.id, name: room.name, defaultCapacity: room.defaultCapacity } : null,
    roomConflict: conflicts.length > 0,
    sessionRemaining,
    soldOut: sessionRemaining != null && sessionRemaining < 1,
    createModePrompt: bookingSettings.defaultCreateMode === "prompt",
    defaultCreateMode: bookingSettings.defaultCreateMode,
  };
}

/** S1-F2: create Booking + PartyBookingDetail together through the booking engine. */
export async function createParty(actor: PartyActor, input: CreatePartyInput) {
  const ctx = await partyStaffContext(actor);
  assertOverbookAllowed(actor, input.overbook, input.overbookReason);
  const locationId = await resolvePartyLocationId(actor, ctx.scope, input.locationId);
  await assertVenueWritable(ctx.orgId, locationId);
  const pkg = await requireBookablePackage(ctx.orgId, locationId, input.productId);
  const settings = await resolvePartySettings(ctx.orgId, locationId);
  const effective = effectivePackageConfig(pkg, settings);
  const room = await resolveRoom(ctx.orgId, locationId, effective, input.roomResourceId);
  assertPartyCounts({
    kidCount: input.kidCount,
    adultCount: input.adultCount,
    minGuests: pkg.minGuests,
    maxGuests: pkg.maxGuests,
    roomCapacity: room?.defaultCapacity,
  });
  const session = await resolvePartySession(actor, pkg, effective, {
    sessionId: input.sessionId,
    startsAt: input.startsAt,
    roomId: room?.id ?? null,
    allowCreate: true,
  });
  await precheckRoom({
    orgId: ctx.orgId,
    roomId: room?.id ?? null,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    overbook: input.overbook,
  });
  const hostStaffUserId = await assertHostStaff(ctx.orgId, input.hostStaffUserId);
  const food = await resolveFoodLines(ctx.orgId, locationId, parseFoodLines(input.foodLines), {
    allowPriceOverride: actorCan(actor, P.PartiesFood),
  });
  const plan = await buildPartyPricePlan({
    orgId: ctx.orgId,
    pkg,
    effective,
    settings,
    sessionId: session.id,
    roomResourceId: room?.id ?? null,
    visitStartsAt: session.startsAt,
    kidCount: input.kidCount,
    adultCount: input.adultCount,
    addOns: input.addOns,
    food: food.map((f) => ({ name: f.nameSnapshot, qty: f.qty, unitPriceCents: f.unitPriceCents })),
  });
  const money = partyMoneyDetail({
    totalCents: plan.preview.totalCents,
    effective,
    settings,
    visitStartsAt: session.startsAt,
    timezone: pkg.location?.timezone,
  });
  // Staff-entered contact email links an existing account (never creates one).
  const userId = input.contact.email
    ? (
        await prisma.user.findFirst({
          where: { email: { equals: input.contact.email, mode: "insensitive" } },
          select: { id: true },
        })
      )?.id ?? null
    : null;
  const bookingSettings = await resolveBookingSettings(ctx.orgId, locationId);
  const createMode: BookingCreateMode =
    input.createMode && input.createMode !== "prompt"
      ? input.createMode
      : bookingSettings.defaultCreateMode === "reserve"
        ? "reserve"
        : "hold";

  const party: PartyDetailInput = {
    partyName: input.partyName,
    honoreeName: input.honoreeName ?? null,
    honoreeAge: input.honoreeAge ?? null,
    honoreeBirthDate: parseDate(input.honoreeBirthDate, "honoreeBirthDate"),
    kidCount: input.kidCount,
    adultCount: input.adultCount,
    roomResourceId: room?.id ?? null,
    roomNameSnapshot: room?.name ?? null,
    hostStaffUserId,
    hostNotes: input.hostNotes ?? null,
    foodNotes: input.foodNotes ?? null,
    ...money,
  };

  const booking = await createBooking(actor, {
    locationId,
    channel: input.channel,
    createMode,
    lines: plan.lines,
    customLines: plan.customLines,
    party,
    primaryContactName: input.contact.name ?? null,
    primaryContactEmail: input.contact.email ?? null,
    primaryContactPhone: input.contact.phone ?? null,
    accountId: input.accountId ?? null,
    notes: input.notes ?? null,
    posNotes: input.posNotes ?? null,
    userId,
    allowOverbook: Boolean(input.overbook),
    activate: true,
    holdIds: input.holdIds,
  });

  if (food.length) {
    const loaded = await loadPartyById(ctx.orgId, booking.id);
    await prisma.$transaction((tx) => writeFoodDraft(loaded, food, {}, tx));
  }
  await finalizePartyMoney(booking.id);
  await logPartyActivity({
    orgId: ctx.orgId,
    locationId,
    bookingId: booking.id,
    kind: "created",
    event: "party_created",
    payload: {
      channel: input.channel,
      productId: pkg.id,
      sessionId: session.id,
      roomResourceId: room?.id ?? null,
      kidCount: input.kidCount,
      adultCount: input.adultCount,
      ...(input.overbook ? { overbook: true, overbookReason: input.overbookReason } : {}),
    },
    actorUserId: actor.sub ?? null,
  });
  await recomputePartyWaiverStatusSafe(booking.id);
  return staffDto(ctx.orgId, booking.id);
}

export type EditPartyPatch = {
  kidCount?: number;
  adultCount?: number;
  roomResourceId?: string | null;
  sessionId?: string | null;
  startsAt?: string | null;
  addOns?: Array<{ productId: string; qty?: number }>;
  contact?: { name?: string | null; email?: string | null; phone?: string | null };
  partyName?: string;
  honoreeName?: string | null;
  honoreeAge?: number | null;
  honoreeBirthDate?: string | null;
  hostStaffUserId?: string | null;
  hostNotes?: string | null;
  foodNotes?: string | null;
  notes?: string | null;
  opsStatus?: PartyOpsStatus;
  overbook?: boolean;
  overbookReason?: string | null;
};

export function parseEditPartyBody(raw: unknown): EditPartyPatch {
  const b = rejectBodyOrgId(raw);
  const out: EditPartyPatch = {};
  if (b.kidCount !== undefined) out.kidCount = parseCount(b.kidCount, "kidCount");
  if (b.adultCount !== undefined) out.adultCount = parseCount(b.adultCount, "adultCount");
  if (b.roomResourceId !== undefined) out.roomResourceId = optString(b.roomResourceId, 64);
  if (b.sessionId !== undefined) out.sessionId = optString(b.sessionId, 64);
  if (b.startsAt !== undefined) out.startsAt = optString(b.startsAt, 64);
  if (b.addOns !== undefined || b.addOnProductIds !== undefined) {
    out.addOns = parseAddOns(b.addOns ?? b.addOnProductIds) ?? [];
  }
  if (b.contact !== undefined) {
    const c = (b.contact && typeof b.contact === "object" ? b.contact : {}) as Record<string, unknown>;
    out.contact = {
      ...(c.name !== undefined ? { name: optString(c.name, 160) } : {}),
      ...(c.email !== undefined ? { email: optString(c.email, 200)?.toLowerCase() ?? null } : {}),
      ...(c.phone !== undefined ? { phone: optString(c.phone, 40) } : {}),
    };
  }
  if (b.partyName !== undefined) {
    const name = optString(b.partyName, 160);
    if (!name) throw new Error("Party name is required");
    out.partyName = name;
  }
  if (b.honoreeName !== undefined) out.honoreeName = optString(b.honoreeName, 160);
  if (b.honoreeAge !== undefined) out.honoreeAge = optInt(b.honoreeAge);
  if (b.honoreeBirthDate !== undefined) out.honoreeBirthDate = optString(b.honoreeBirthDate, 40);
  if (b.hostStaffUserId !== undefined) out.hostStaffUserId = optString(b.hostStaffUserId, 64);
  if (b.hostNotes !== undefined) out.hostNotes = optString(b.hostNotes, 2000);
  if (b.foodNotes !== undefined) out.foodNotes = optString(b.foodNotes, 2000);
  if (b.notes !== undefined) out.notes = optString(b.notes, 2000);
  if (b.opsStatus !== undefined) out.opsStatus = String(b.opsStatus) as PartyOpsStatus;
  if (b.overbook !== undefined) out.overbook = b.overbook === true;
  if (b.overbookReason !== undefined) out.overbookReason = optString(b.overbookReason, 500);
  return out;
}

/**
 * Rebuild party lines (package + extras + add-ons + food) and replace them
 * through the engine. Releases the old session/room and takes the new ones.
 */
export async function repricePartyBooking(
  actor: PartyActor | null,
  bookingId: string,
  orgId: string,
  next: {
    kidCount?: number;
    adultCount?: number;
    roomResourceId?: string | null;
    sessionId?: string | null;
    startsAt?: string | null;
    addOns?: Array<{ productId: string; qty?: number }>;
    overbook?: boolean;
  }
) {
  const party = await loadPartyById(orgId, bookingId);
  if (!isPartyLive(party.status)) throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
  const d = party.partyDetail;
  if (!d.packageProductId) throw partyNotFound();
  const pkg = await loadPartyPackageRow(orgId, d.packageProductId);
  const settings = await resolvePartySettings(orgId, party.locationId);
  const effective = effectivePackageConfig(pkg, settings);
  const kidCount = next.kidCount ?? d.kidCount;
  const adultCount = next.adultCount ?? d.adultCount;

  const roomChanged = next.roomResourceId !== undefined && next.roomResourceId !== d.roomResourceId;
  const room = roomChanged
    ? next.roomResourceId
      ? await requireAssignableRoom(orgId, party.locationId, next.roomResourceId)
      : null
    : d.roomResourceId
      ? await prisma.capacityResource.findFirst({ where: { id: d.roomResourceId, orgId } })
      : null;
  assertPartyCounts({
    kidCount,
    adultCount,
    minGuests: pkg.minGuests,
    maxGuests: pkg.maxGuests,
    roomCapacity: room?.defaultCapacity,
  });

  const currentSessionId =
    party.lines.find((l) => l.productType === "party_package" && l.sessionId)?.sessionId ?? null;
  const sessionChanged = Boolean(next.sessionId || next.startsAt);
  const session = sessionChanged
    ? await resolvePartySession(actor ?? { orgId }, pkg, effective, {
        sessionId: next.sessionId,
        startsAt: next.startsAt,
        roomId: room?.id ?? null,
        allowCreate: Boolean(actor),
      })
    : currentSessionId
      ? await prisma.ticketSession.findFirst({ where: { id: currentSessionId, orgId } })
      : null;
  if (!session) throw new TicketingError(SESSION_SOLD_OUT, 409);
  if (roomChanged || sessionChanged) {
    await precheckRoom({
      orgId,
      roomId: room?.id ?? null,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      excludeBookingId: party.id,
      overbook: next.overbook,
    });
  }

  const addOns =
    next.addOns ??
    party.lines
      .filter((l) => l.productType === "add_on" && l.productId)
      .map((l) => ({ productId: l.productId!, qty: l.qty }));
  const plan = await buildPartyPricePlan({
    orgId,
    pkg,
    effective,
    settings,
    sessionId: session.id,
    roomResourceId: room?.id ?? null,
    visitStartsAt: session.startsAt,
    kidCount,
    adultCount,
    addOns,
    food: partyFoodPricing(party),
    taxExempt: party.taxExempt,
  });
  const money = partyMoneyDetail({
    totalCents: plan.preview.totalCents,
    effective,
    settings,
    visitStartsAt: session.startsAt,
    timezone: party.location?.timezone,
  });
  try {
    await replaceBookingLines(actor ?? { orgId }, party.id, plan.lines, {
      allowOverbook: Boolean(next.overbook),
      customLines: plan.customLines,
      party: {
        kidCount,
        adultCount,
        roomResourceId: room?.id ?? null,
        roomNameSnapshot: room?.name ?? null,
        ...money,
      },
      ...(actor ? {} : { orgId, skipStaffGate: true }),
    });
  } catch (err) {
    mapPastLock(err);
  }
  await finalizePartyMoney(party.id);
  return plan.preview;
}

const STRUCTURAL: Array<keyof EditPartyPatch> = [
  "kidCount",
  "adultCount",
  "roomResourceId",
  "sessionId",
  "startsAt",
  "addOns",
];

/** S1-F8: transactional edit through the engine; notes / names / host / ops are detail-only. */
export async function editParty(actor: PartyActor, bookingId: string, patch: EditPartyPatch) {
  const ctx = await partyStaffContext(actor);
  const party = await loadStaffParty(ctx, bookingId);
  assertOverbookAllowed(actor, patch.overbook, patch.overbookReason);
  const structural = STRUCTURAL.some((k) => patch[k] !== undefined);
  if (structural) {
    if (!isPartyLive(party.status)) throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
    await assertVenueWritable(ctx.orgId, party.locationId);
    const bookingSettings = await resolveBookingSettings(ctx.orgId, party.locationId);
    try {
      await assertBookingNotPastLocked(party, bookingSettings.pastEditGraceMinutes);
    } catch (err) {
      mapPastLock(err);
    }
    await repricePartyBooking(actor, party.id, ctx.orgId, {
      kidCount: patch.kidCount,
      adultCount: patch.adultCount,
      roomResourceId: patch.roomResourceId,
      sessionId: patch.sessionId,
      startsAt: patch.startsAt,
      addOns: patch.addOns,
      overbook: patch.overbook,
    });
  }

  const detailData: Prisma.PartyBookingDetailUpdateInput = {};
  if (patch.partyName !== undefined) detailData.partyName = patch.partyName;
  if (patch.honoreeName !== undefined) detailData.honoreeName = patch.honoreeName;
  if (patch.honoreeAge !== undefined) detailData.honoreeAge = patch.honoreeAge;
  if (patch.honoreeBirthDate !== undefined) {
    detailData.honoreeBirthDate = parseDate(patch.honoreeBirthDate, "honoreeBirthDate");
  }
  if (patch.hostNotes !== undefined) detailData.hostNotes = patch.hostNotes;
  if (patch.foodNotes !== undefined) detailData.foodNotes = patch.foodNotes;
  if (patch.hostStaffUserId !== undefined) {
    const hostId = await assertHostStaff(ctx.orgId, patch.hostStaffUserId);
    detailData.hostStaff = hostId ? { connect: { id: hostId } } : { disconnect: true };
  }
  if (Object.keys(detailData).length) {
    await prisma.partyBookingDetail.update({ where: { id: party.partyDetail.id }, data: detailData });
  }
  if (patch.contact || patch.notes !== undefined) {
    await prisma.booking.update({
      where: { id: party.id },
      data: {
        ...(patch.contact?.name !== undefined ? { primaryContactName: patch.contact.name } : {}),
        ...(patch.contact?.email !== undefined ? { primaryContactEmail: patch.contact.email } : {}),
        ...(patch.contact?.phone !== undefined ? { primaryContactPhone: patch.contact.phone } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        updatedById: actor.sub && isValidId(actor.sub) ? actor.sub : null,
      },
    });
  }
  if (patch.opsStatus !== undefined) {
    await applyOpsStatus(ctx, party, patch.opsStatus);
  }
  const changed = Object.keys(patch).filter((k) => k !== "overbookReason");
  if (patch.roomResourceId !== undefined && patch.roomResourceId !== party.partyDetail.roomResourceId) {
    await logPartyActivity({
      orgId: ctx.orgId,
      locationId: party.locationId,
      bookingId: party.id,
      kind: "edited",
      event: "room_moved",
      payload: { from: party.partyDetail.roomResourceId, to: patch.roomResourceId },
      actorUserId: actor.sub ?? null,
    });
  }
  await logPartyActivity({
    orgId: ctx.orgId,
    locationId: party.locationId,
    bookingId: party.id,
    kind: patch.hostStaffUserId !== undefined ? "staff_assign" : "edited",
    event: "party_edited",
    payload: {
      fields: changed,
      ...(patch.overbook ? { overbook: true, overbookReason: patch.overbookReason } : {}),
    },
    actorUserId: actor.sub ?? null,
  });
  return staffDto(ctx.orgId, party.id);
}

const MANUAL_OPS: PartyOpsStatus[] = ["confirmed", "checked_in", "in_progress", "completed", "no_show"];

/** checked_in / in_progress / completed / no_show (and back to confirmed) only on a confirmed booking. */
async function applyOpsStatus(ctx: PartyStaffContext, party: LoadedParty, next: PartyOpsStatus) {
  if (!MANUAL_OPS.includes(next)) throw new TicketingError(PARTY_OPS_TRANSITION, 400);
  const fresh = await prisma.booking.findFirst({ where: { id: party.id }, select: { status: true, visitStartsAt: true } });
  if (fresh?.status !== "confirmed") throw new TicketingError(PARTY_OPS_TRANSITION, 400);
  if (next === "no_show" && fresh.visitStartsAt && fresh.visitStartsAt.getTime() > Date.now()) {
    throw new TicketingError(PARTY_OPS_TRANSITION, 400);
  }
  const previous = party.partyDetail.opsStatus;
  if (previous === next) return;
  await prisma.partyBookingDetail.update({ where: { id: party.partyDetail.id }, data: { opsStatus: next } });
  await logPartyActivity({
    orgId: ctx.orgId,
    locationId: party.locationId,
    bookingId: party.id,
    kind: "status",
    event: "ops_status",
    payload: { from: previous, to: next },
    actorUserId: ctx.actor.sub ?? null,
  });
}

export async function setPartyOpsStatus(actor: PartyActor, bookingId: string, next: PartyOpsStatus) {
  const ctx = await partyStaffContext(actor);
  const party = await loadStaffParty(ctx, bookingId);
  await applyOpsStatus(ctx, party, next);
  return staffDto(ctx.orgId, party.id);
}

/** S1-F5 / F6: engine confirm (deposit gate, ticketsPerMonth, credentials for kidCount + adultCount). */
export async function confirmParty(
  actor: PartyActor,
  bookingId: string,
  opts: { overrideReason?: string | null } = {}
) {
  const ctx = await partyStaffContext(actor);
  const party = await loadStaffParty(ctx, bookingId);
  const reason = opts.overrideReason === undefined ? undefined : opts.overrideReason ?? "";
  if (reason !== undefined && !actorCan(actor, P.PartiesWrite)) {
    throw new ForbiddenError("Confirming below the deposit needs parties:write");
  }
  await confirmBooking(actor, party.id, {
    allowUnpaid: true,
    autoReview: true,
    partyDepositOverrideReason: reason,
  });
  await finalizePartyMoney(party.id);
  await logPartyActivity({
    orgId: ctx.orgId,
    locationId: party.locationId,
    bookingId: party.id,
    kind: "status",
    event: "party_confirmed",
    payload: reason ? { depositOverrideReason: reason } : {},
    actorUserId: actor.sub ?? null,
  });
  return staffDto(ctx.orgId, party.id);
}

/** S1-F9: cancel needs a reason; releases room + unredeemed session capacity; never refunds. */
export async function cancelParty(actor: PartyActor, bookingId: string, opts: { reason?: string | null }) {
  const ctx = await partyStaffContext(actor);
  const party = await loadStaffParty(ctx, bookingId);
  const reason = opts.reason?.trim() ?? "";
  if (!reason) throw new TicketingError(PARTY_REASON_REQUIRED, 400);
  try {
    await cancelBooking(actor, party.id, { reason });
  } catch (err) {
    mapPastLock(err);
  }
  await logPartyActivity({
    orgId: ctx.orgId,
    locationId: party.locationId,
    bookingId: party.id,
    kind: "status",
    event: "party_cancelled",
    payload: { reason, amountPaidCents: toCents(party.amountPaid) },
    actorUserId: actor.sub ?? null,
  });
  return staffDto(ctx.orgId, party.id);
}

/** Reactivate a cancelled party back to held (or confirmed, re-checking the deposit gate). */
export async function reactivateParty(
  actor: PartyActor,
  bookingId: string,
  opts: { target?: "held" | "confirmed"; overbook?: boolean; overbookReason?: string | null; overrideReason?: string | null }
) {
  const ctx = await partyStaffContext(actor);
  const party = await loadStaffParty(ctx, bookingId);
  if (party.status !== "cancelled") throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
  assertOverbookAllowed(actor, opts.overbook, opts.overbookReason);
  await assertVenueWritable(ctx.orgId, party.locationId);
  await reactivateBooking(actor, party.id, {
    targetStatus: "hold",
    allowOverbook: Boolean(opts.overbook),
  });
  await logPartyActivity({
    orgId: ctx.orgId,
    locationId: party.locationId,
    bookingId: party.id,
    kind: "status",
    event: "party_reactivated",
    payload: {
      target: opts.target ?? "held",
      ...(opts.overbook ? { overbook: true, overbookReason: opts.overbookReason } : {}),
    },
    actorUserId: actor.sub ?? null,
  });
  if (opts.target === "confirmed") {
    return confirmParty(actor, party.id, { overrideReason: opts.overrideReason ?? undefined });
  }
  await finalizePartyMoney(party.id);
  return staffDto(ctx.orgId, party.id);
}

/** Room move = structural edit (conflict check under the room lock). */
export async function movePartyRoom(
  actor: PartyActor,
  bookingId: string,
  opts: { roomResourceId: string | null; overbook?: boolean; overbookReason?: string | null }
) {
  return editParty(actor, bookingId, {
    roomResourceId: opts.roomResourceId,
    overbook: opts.overbook,
    overbookReason: opts.overbookReason,
  });
}

export async function assignPartyHostStaff(actor: PartyActor, bookingId: string, hostStaffUserId: string | null) {
  return editParty(actor, bookingId, { hostStaffUserId });
}

export type PartyListFilters = {
  date?: string | null;
  locationId?: string | null;
  q?: string | null;
  opsStatus?: string | null;
  amountDueOnly?: boolean;
  roomResourceId?: string | null;
  hostStaffUserId?: string | null;
  take?: number;
  skip?: number;
};

/** Visit-day window per venue (YYYY-MM-DD or "today" in each venue's timezone). */
async function dayWindows(
  orgId: string,
  scopeWhere: { locationId?: string | { in: string[] } },
  date: string
) {
  const { visitDayStart, visitDayEndExclusive } = await import("@/lib/ticketing/visitDayBounds");
  const moment = (await import("moment-timezone")).default;
  const venues = await prisma.venueLocation.findMany({
    where: {
      orgId,
      ...(typeof scopeWhere.locationId === "string"
        ? { id: scopeWhere.locationId }
        : scopeWhere.locationId
          ? { id: { in: scopeWhere.locationId.in } }
          : {}),
    },
    select: { id: true, timezone: true },
  });
  return venues
    .map((v) => {
      const ymd =
        date === "today"
          ? moment.tz(new Date(), v.timezone && moment.tz.zone(v.timezone) ? v.timezone : "UTC").format("YYYY-MM-DD")
          : date;
      const start = visitDayStart(ymd, v.timezone);
      const end = visitDayEndExclusive(ymd, v.timezone);
      return start && end ? { locationId: v.id, start, end } : null;
    })
    .filter((w): w is { locationId: string; start: Date; end: Date } => Boolean(w));
}

const CLOSED_BOOKING_STATUSES = ["cancelled", "expired", "refunded"] as const;

export type PartyListSummary = {
  parties: number;
  kids: number;
  adults: number;
  balanceDueCents: number;
  waiversMissing: number;
  unassignedRooms: number;
};

/**
 * Day totals for the list header. When every match is already on this page
 * (the normal case for one day) they come from the rows — no extra query.
 * Balance / waivers / rooms count live parties only.
 */
async function partyListSummary(
  where: Prisma.PartyBookingDetailWhereInput,
  rows: Array<{
    kidCount: number;
    adultCount: number;
    waiverMissingCount: number;
    roomResourceId: string | null;
    booking: { status: string; amountDue: Prisma.Decimal };
  }>,
  total: number,
  skip: number
): Promise<PartyListSummary> {
  const isLive = (status: string) => !(CLOSED_BOOKING_STATUSES as readonly string[]).includes(status);
  if (skip === 0 && rows.length === total) {
    const live = rows.filter((r) => isLive(r.booking.status));
    return {
      parties: total,
      kids: rows.reduce((s, r) => s + r.kidCount, 0),
      adults: rows.reduce((s, r) => s + r.adultCount, 0),
      balanceDueCents: live.reduce((s, r) => s + Math.max(0, toCents(r.booking.amountDue)), 0),
      waiversMissing: live.reduce((s, r) => s + r.waiverMissingCount, 0),
      unassignedRooms: live.filter((r) => !r.roomResourceId).length,
    };
  }
  const liveWhere: Prisma.PartyBookingDetailWhereInput = {
    AND: [where, { booking: { status: { notIn: [...CLOSED_BOOKING_STATUSES] } } }],
  };
  const [counts, liveCounts, due, unassigned] = await Promise.all([
    prisma.partyBookingDetail.aggregate({ where, _sum: { kidCount: true, adultCount: true } }),
    prisma.partyBookingDetail.aggregate({ where: liveWhere, _sum: { waiverMissingCount: true } }),
    prisma.booking.aggregate({
      where: { status: { notIn: [...CLOSED_BOOKING_STATUSES] }, partyDetail: { is: where } },
      _sum: { amountDue: true },
    }),
    prisma.partyBookingDetail.count({ where: { AND: [liveWhere, { roomResourceId: null }] } }),
  ]);
  return {
    parties: total,
    kids: counts._sum.kidCount ?? 0,
    adults: counts._sum.adultCount ?? 0,
    balanceDueCents: due._sum.amountDue ? Math.max(0, toCents(due._sum.amountDue)) : 0,
    waiversMissing: liveCounts._sum.waiverMissingCount ?? 0,
    unassignedRooms: unassigned,
  };
}

/** One query, no N+1: room, counts, amountDue, host, booking status, waiver missing count. */
export async function listPartiesCore(ctx: PartyStaffContext, filters: PartyListFilters) {
  const scopeWhere = partyLocationWhere(ctx.scope, filters.locationId);
  const where: Prisma.PartyBookingDetailWhereInput = { orgId: ctx.orgId, ...scopeWhere };
  const and: Prisma.PartyBookingDetailWhereInput[] = [];
  const date = filters.date?.trim() || null;
  if (date && date !== "today" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("date must be YYYY-MM-DD or today");
  }
  // Independent round trips run together (the pooler is slow; each one costs ~200 ms+).
  const [windows, waiversEnabled] = await Promise.all([
    date ? dayWindows(ctx.orgId, scopeWhere, date) : Promise.resolve(null),
    partyWaiversEnabled(ctx.orgId),
  ]);
  if (windows) {
    and.push({
      OR: windows.length
        ? windows.map((w) => ({
            locationId: w.locationId,
            booking: { visitStartsAt: { gte: w.start, lt: w.end } },
          }))
        : [{ id: "__none__" }],
    });
  }
  if (filters.opsStatus) {
    const statuses = filters.opsStatus.split(",").map((s) => s.trim()).filter(Boolean) as PartyOpsStatus[];
    if (statuses.length) where.opsStatus = { in: statuses };
  }
  if (filters.amountDueOnly) and.push({ booking: { amountDue: { gt: 0 } } });
  if (filters.roomResourceId && isValidId(filters.roomResourceId)) where.roomResourceId = filters.roomResourceId;
  if (filters.hostStaffUserId && isValidId(filters.hostStaffUserId)) where.hostStaffUserId = filters.hostStaffUserId;
  const q = filters.q?.trim();
  if (q) {
    and.push({
      OR: [
        { partyName: { contains: q, mode: "insensitive" } },
        { honoreeName: { contains: q, mode: "insensitive" } },
        { booking: { primaryContactEmail: { contains: q, mode: "insensitive" } } },
        { booking: { primaryContactPhone: { contains: q } } },
        { booking: { primaryContactName: { contains: q, mode: "insensitive" } } },
        { booking: { publicId: { equals: q.toUpperCase() } } },
      ],
    });
  }
  if (and.length) where.AND = and;
  const take = Math.min(Math.max(1, filters.take ?? 50), 200);
  const skip = Math.max(0, filters.skip ?? 0);
  const [rows, total] = await Promise.all([
    prisma.partyBookingDetail.findMany({
      where,
      orderBy: [{ booking: { visitStartsAt: "asc" } }, { id: "asc" }],
      take,
      skip,
      select: {
        id: true,
        bookingId: true,
        locationId: true,
        partyName: true,
        honoreeName: true,
        honoreeAge: true,
        kidCount: true,
        adultCount: true,
        opsStatus: true,
        roomResourceId: true,
        roomNameSnapshot: true,
        waiverMissingCount: true,
        depositRequiredCents: true,
        depositPaidCents: true,
        depositDueAt: true,
        balanceDueAt: true,
        roomResource: { select: { id: true, name: true } },
        packageProduct: { select: { id: true, name: true } },
        hostStaff: { select: { id: true, firstName: true, lastName: true, email: true } },
        location: { select: { id: true, name: true, timezone: true } },
        booking: {
          select: {
            publicId: true,
            status: true,
            channel: true,
            visitStartsAt: true,
            visitEndsAt: true,
            total: true,
            amountPaid: true,
            amountDue: true,
            primaryContactName: true,
            primaryContactEmail: true,
            primaryContactPhone: true,
          },
        },
      },
    }),
    prisma.partyBookingDetail.count({ where }),
  ]);
  const summary = await partyListSummary(where, rows, total, skip);
  return {
    total,
    take,
    skip,
    waiversEnabled,
    summary,
    parties: rows.map((r) => ({
      bookingId: r.bookingId,
      publicId: r.booking.publicId,
      status: r.booking.status,
      opsStatus: r.opsStatus,
      channel: r.booking.channel,
      locationId: r.locationId,
      location: { id: r.location.id, name: r.location.name },
      timezone: r.location.timezone,
      visitStartsAt: r.booking.visitStartsAt?.toISOString() ?? null,
      visitEndsAt: r.booking.visitEndsAt?.toISOString() ?? null,
      partyName: r.partyName,
      honoreeName: r.honoreeName,
      honoreeAge: r.honoreeAge,
      kidCount: r.kidCount,
      adultCount: r.adultCount,
      package: r.packageProduct,
      room: r.roomResourceId
        ? { id: r.roomResourceId, name: r.roomResource?.name ?? r.roomNameSnapshot ?? null }
        : null,
      host: r.hostStaff
        ? {
            id: r.hostStaff.id,
            name:
              [r.hostStaff.firstName, r.hostStaff.lastName].filter(Boolean).join(" ").trim() ||
              r.hostStaff.email,
          }
        : null,
      contactName: r.booking.primaryContactName,
      contactEmail: r.booking.primaryContactEmail,
      contactPhone: r.booking.primaryContactPhone,
      totalCents: toCents(r.booking.total),
      amountPaidCents: toCents(r.booking.amountPaid),
      amountDueCents: toCents(r.booking.amountDue),
      depositRequiredCents: r.depositRequiredCents,
      depositPaidCents: r.depositPaidCents,
      depositDueAt: r.depositDueAt?.toISOString() ?? null,
      balanceDueAt: r.balanceDueAt?.toISOString() ?? null,
      waiverMissingCount: r.waiverMissingCount,
    })),
  };
}

export async function listParties(actor: PartyActor, filters: PartyListFilters) {
  const ctx = await partyStaffContext(actor);
  return listPartiesCore(ctx, filters);
}

/**
 * S1-F7: wraps the booking hold TTL sweep (which releases session holds and,
 * via the status change, the party room) and re-syncs any party whose ops
 * overlay drifted. Callable from scripts; the hourly cron wiring is Step 2.
 */
export async function expirePartyHolds(opts?: { orgId?: string; now?: Date; limit?: number }) {
  const result = await expireBookingHolds(opts);
  const drifted = await prisma.partyBookingDetail.findMany({
    where: {
      ...(opts?.orgId ? { orgId: opts.orgId } : {}),
      booking: { status: { in: ["expired", "cancelled"] } },
      opsStatus: { not: "cancelled" },
    },
    select: { bookingId: true },
    take: opts?.limit ?? 200,
  });
  for (const row of drifted) {
    await syncPartyOpsFromBooking(prisma, row.bookingId);
  }
  return { expired: result.expired, partiesResynced: drifted.length };
}
