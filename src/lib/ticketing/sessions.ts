/**
 * Ticket sessions / slots.
 */
import type { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import prisma from "@/lib/prisma";
import { isValidId, requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  assertTicketingStaffMutate,
  assertTicketingStaffRead,
  assertLocationInHqScope,
  assertVenueActiveForTicketingMutate,
  locationScopeFilter,
  applyTicketingLocationScope,
  rejectClientOrgFields,
  SESSION_NOT_FOUND,
  PRODUCT_NOT_FOUND,
  type TicketingActor,
} from "@/lib/ticketing/common";
import {
  BULK_SESSION_CREATE_CHUNK,
  BULK_SESSION_LIMIT,
} from "@/lib/ticketing/sessionLimits";
import { enrichSessionsWithHoldState } from "@/lib/ticketing/availabilityEnrich";
import { expireBookingHolds } from "@/lib/ticketing/expireHolds";
import {
  visitDayEndExclusive,
  visitDayStart,
} from "@/lib/ticketing/visitDayBounds";

export type CreateSessionInput = {
  productId: string;
  resourceId?: string | null;
  /** Guest-facing slot name */
  label?: string | null;
  startsAt: string;
  endsAt: string;
  capacity: number;
  priceOverride?: number | null;
};

export type CreateSessionSeriesInput = CreateSessionInput & {
  /** 0=Sun … 6=Sat */
  weekdays: number[];
  untilDate: string;
};

export type BulkSessionSlotInput = {
  startsAt: string;
  endsAt: string;
  label?: string | null;
  /** Per-slot capacity; falls back to bulk `capacity` when omitted. */
  capacity?: number;
};

export type CreateSessionBulkInput = {
  productId: string;
  resourceId?: string | null;
  capacity: number;
  priceOverride?: number | null;
  slots: BulkSessionSlotInput[];
};

function requireCapacity(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 2_147_483_647) {
    throw new Error("capacity must be a non-negative integer");
  }
  return n;
}

export function toSessionDto(row: {
  id: string;
  orgId: string;
  locationId: string;
  productId: string;
  resourceId: string | null;
  label?: string | null;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  remaining: number;
  priceOverride: Decimal | null;
  isClosed: boolean;
  createdAt: Date;
  updatedAt: Date;
  product?: { id: string; name: string; type: string } | null;
  resource?: { id: string; name: string } | null;
}) {
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    productId: row.productId,
    resourceId: row.resourceId,
    label: row.label ?? null,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    capacity: row.capacity,
    remaining: row.remaining,
    priceOverride:
      row.priceOverride != null ? Number(row.priceOverride.toString()) : null,
    isClosed: row.isClosed,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    product: row.product ?? null,
    resource: row.resource ?? null,
  };
}

export async function listTicketSessions(
  actor: TicketingActor,
  filters: {
    productId?: string;
    from?: string;
    to?: string;
    includeClosed?: boolean;
    /** When true, `to` is exclusive (startsAt < to). */
    toExclusive?: boolean;
  } = {}
) {
  await assertTicketingStaffRead(actor);
  const scope = await locationScopeFilter(actor);
  const where: Prisma.TicketSessionWhereInput = {
    orgId: scope.orgId,
    product: { archivedAt: null },
  };
  applyTicketingLocationScope(scope, where);
  if (filters.productId !== undefined && filters.productId !== "") {
    if (!isValidId(filters.productId)) {
      throw new Error("Invalid productId");
    }
    where.productId = filters.productId;
  }
  if (!filters.includeClosed) where.isClosed = false;
  if (filters.from || filters.to) {
    where.startsAt = {};
    if (filters.from) {
      const from = new Date(filters.from);
      if (Number.isNaN(from.getTime())) throw new Error("Invalid from date");
      where.startsAt.gte = from;
    }
    if (filters.to) {
      const to = new Date(filters.to);
      if (Number.isNaN(to.getTime())) throw new Error("Invalid to date");
      if (filters.toExclusive) where.startsAt.lt = to;
      else where.startsAt.lte = to;
    }
  }

  const rows = await prisma.ticketSession.findMany({
    where,
    select: {
      id: true,
      orgId: true,
      locationId: true,
      productId: true,
      resourceId: true,
      label: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      remaining: true,
      priceOverride: true,
      isClosed: true,
      createdAt: true,
      updatedAt: true,
      product: { select: { id: true, name: true, type: true } },
      resource: { select: { id: true, name: true } },
    },
    orderBy: [{ startsAt: "asc" }, { label: "asc" }],
    // Product-scoped lists need the full schedule; global lists stay capped.
    // Prefer from/to on the client (calendar month) for near-instant loads.
    take: filters.productId
      ? filters.from || filters.to
        ? Math.min(BULK_SESSION_LIMIT, 2_000)
        : BULK_SESSION_LIMIT
      : 500,
  });
  // Live hold/paid split so calendars and boards match booking capacity.
  return enrichSessionsWithHoldState(rows.map(toSessionDto), 1);
}

/**
 * Availability preview — all sessions in range (including held / sold out).
 * Temporary unpaid holds free seats at nextReleaseAt; paid stays taken.
 */
export async function listAvailableSessions(
  actor: TicketingActor,
  opts: {
    productId: string;
    requestedQty?: number;
    from?: string;
    to?: string;
    date?: string;
  }
) {
  if (!opts.productId || !isValidId(opts.productId)) {
    throw new Error("Invalid productId");
  }
  let qty = 1;
  if (opts.requestedQty !== undefined && opts.requestedQty !== null) {
    const n = Number(opts.requestedQty);
    if (!Number.isInteger(n) || n < 1 || n > 2_147_483_647) {
      throw new Error("requestedQty must be an integer 1–2147483647");
    }
    qty = n;
  }

  const product = await prisma.admissionProduct.findFirst({
    where: { id: opts.productId },
    select: {
      id: true,
      orgId: true,
      locationId: true,
      location: { select: { timezone: true } },
    },
  });
  if (!product) throw new ForbiddenError(PRODUCT_NOT_FOUND);
  await assertLocationInHqScope(actor, product.locationId);

  void expireBookingHolds({ orgId: product.orgId, limit: 50 }).catch(
    () => undefined
  );

  let from = opts.from;
  let to = opts.to;
  let toExclusive = false;
  if (opts.date?.trim()) {
    const tz = product.location?.timezone;
    const start = visitDayStart(opts.date, tz);
    const endEx = visitDayEndExclusive(opts.date, tz);
    if (!start || !endEx) throw new Error("Invalid date");
    from = start.toISOString();
    to = endEx.toISOString();
    toExclusive = true;
  } else if (opts.from || opts.to) {
    const tz = product.location?.timezone;
    if (opts.from) {
      const fromYmd = String(opts.from).slice(0, 10);
      const start =
        visitDayStart(fromYmd, tz) ?? new Date(opts.from);
      if (Number.isNaN(start.getTime())) throw new Error("Invalid from");
      from = start.toISOString();
    }
    if (opts.to) {
      const toYmd = String(opts.to).slice(0, 10);
      const endEx = visitDayEndExclusive(toYmd, tz);
      if (endEx) {
        to = endEx.toISOString();
        toExclusive = true;
      } else {
        const end = new Date(opts.to);
        if (Number.isNaN(end.getTime())) throw new Error("Invalid to");
        to = end.toISOString();
      }
    }
  }

  const sessions = await listTicketSessions(actor, {
    productId: opts.productId,
    from,
    to,
    includeClosed: true,
    toExclusive,
  });

  const enriched = await enrichSessionsWithHoldState(
    sessions.map((s) => ({ ...s, isClosed: s.isClosed })),
    qty
  );
  return enriched.sort(
    (a, b) =>
      new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() ||
      String(a.label ?? "").localeCompare(String(b.label ?? ""))
  );
}

type DbClient = Prisma.TransactionClient | typeof prisma;

function requireMoneyAmount(raw: unknown, label = "Price"): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${label} must be greater than 0`);
  }
  return n;
}

function normalizeSessionLabel(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const label = String(raw).trim();
  if (!label) return null;
  if (label.length > 120) {
    throw new Error("Slot name must be 120 characters or fewer");
  }
  return label;
}

async function createOneSession(
  orgId: string,
  product: { id: string; locationId: string; resourceId: string | null },
  input: CreateSessionInput,
  db: DbClient = prisma
) {
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new Error("Invalid session start/end");
  }
  if (endsAt <= startsAt) throw new Error("endsAt must be after startsAt");
  const capacity = requireCapacity(input.capacity);
  const label = normalizeSessionLabel(input.label);

  let resourceId = input.resourceId ?? product.resourceId ?? null;
  if (resourceId) {
    const resource = await db.capacityResource.findFirst({
      where: {
        id: resourceId,
        orgId,
        locationId: product.locationId,
        archivedAt: null,
      },
    });
    if (!resource) throw new ForbiddenError("Capacity resource not found");
    resourceId = resource.id;
  }

  return db.ticketSession.create({
    data: {
      orgId,
      locationId: product.locationId,
      productId: product.id,
      resourceId,
      label,
      startsAt,
      endsAt,
      capacity,
      remaining: capacity,
      priceOverride:
        input.priceOverride != null
          ? new Decimal(requireMoneyAmount(input.priceOverride, "priceOverride"))
          : null,
    },
    include: {
      product: { select: { id: true, name: true, type: true } },
      resource: { select: { id: true, name: true } },
    },
  });
}

export async function createTicketSession(
  actor: TicketingActor,
  input: CreateSessionInput
) {
  const orgId = await assertTicketingStaffMutate(actor);
  const product = await prisma.admissionProduct.findFirst({
    where: {
      id: requireId(input.productId, "productId"),
      orgId,
      archivedAt: null,
    },
  });
  if (!product) throw new ForbiddenError(PRODUCT_NOT_FOUND);
  await assertLocationInHqScope(actor, product.locationId);
  await assertVenueActiveForTicketingMutate(orgId, product.locationId);

  const row = await createOneSession(orgId, product, input);
  return toSessionDto(row);
}

export async function createTicketSessionSeries(
  actor: TicketingActor,
  input: CreateSessionSeriesInput
) {
  const orgId = await assertTicketingStaffMutate(actor);
  const product = await prisma.admissionProduct.findFirst({
    where: {
      id: requireId(input.productId, "productId"),
      orgId,
      archivedAt: null,
    },
  });
  if (!product) throw new ForbiddenError(PRODUCT_NOT_FOUND);
  await assertLocationInHqScope(actor, product.locationId);
  await assertVenueActiveForTicketingMutate(orgId, product.locationId);

  const weekdays = Array.isArray(input.weekdays)
    ? input.weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : [];
  if (!weekdays.length) throw new Error("weekdays required");

  const templateStart = new Date(input.startsAt);
  const templateEnd = new Date(input.endsAt);
  const until = new Date(input.untilDate);
  if (
    Number.isNaN(templateStart.getTime()) ||
    Number.isNaN(templateEnd.getTime()) ||
    Number.isNaN(until.getTime())
  ) {
    throw new Error("Invalid series dates");
  }
  const durationMs = templateEnd.getTime() - templateStart.getTime();
  if (durationMs <= 0) throw new Error("endsAt must be after startsAt");

  const created: Awaited<ReturnType<typeof toSessionDto>>[] = [];
  const payloads: Array<{
    startsAt: Date;
    endsAt: Date;
  }> = [];
  const cursor = new Date(templateStart);
  let guard = 0;
  while (cursor <= until && guard < 366) {
    guard += 1;
    if (weekdays.includes(cursor.getUTCDay())) {
      payloads.push({
        startsAt: new Date(cursor),
        endsAt: new Date(cursor.getTime() + durationMs),
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  if (!payloads.length) {
    throw new Error(
      "Series produced no sessions — check weekdays and untilDate (must be on or after startsAt)"
    );
  }

  await prisma.$transaction(async (tx) => {
    for (const slot of payloads) {
      const row = await createOneSession(orgId, product, {
        ...input,
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
      }, tx);
      created.push(toSessionDto(row));
    }
  });
  return created;
}

export async function createTicketSessionsBulk(
  actor: TicketingActor,
  input: CreateSessionBulkInput
): Promise<{ count: number }> {
  const orgId = await assertTicketingStaffMutate(actor);
  const product = await prisma.admissionProduct.findFirst({
    where: {
      id: requireId(input.productId, "productId"),
      orgId,
      archivedAt: null,
    },
  });
  if (!product) throw new ForbiddenError(PRODUCT_NOT_FOUND);
  await assertLocationInHqScope(actor, product.locationId);
  await assertVenueActiveForTicketingMutate(orgId, product.locationId);

  if (!Array.isArray(input.slots) || input.slots.length === 0) {
    throw new Error("slots required");
  }
  if (input.slots.length > BULK_SESSION_LIMIT) {
    throw new Error(
      `Too many slots (max ${BULK_SESSION_LIMIT}). Narrow the date range or split into multiple runs.`
    );
  }

  const defaultCapacity = requireCapacity(input.capacity);
  const priceOverride =
    input.priceOverride != null
      ? new Decimal(requireMoneyAmount(input.priceOverride, "priceOverride"))
      : null;

  let resourceId = input.resourceId ?? product.resourceId ?? null;
  if (resourceId) {
    const resource = await prisma.capacityResource.findFirst({
      where: {
        id: resourceId,
        orgId,
        locationId: product.locationId,
        archivedAt: null,
      },
    });
    if (!resource) throw new ForbiddenError("Capacity resource not found");
    resourceId = resource.id;
  }

  const rows: Prisma.TicketSessionCreateManyInput[] = [];
  for (const slot of input.slots) {
    const startsAt = new Date(slot.startsAt);
    const endsAt = new Date(slot.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new Error("Invalid session start/end");
    }
    if (endsAt <= startsAt) throw new Error("endsAt must be after startsAt");
    const capacity =
      slot.capacity != null ? requireCapacity(slot.capacity) : defaultCapacity;
    const label = normalizeSessionLabel(slot.label);
    rows.push({
      orgId,
      locationId: product.locationId,
      productId: product.id,
      resourceId,
      label,
      startsAt,
      endsAt,
      capacity,
      remaining: capacity,
      priceOverride,
    });
  }

  await prisma.$transaction(
    async (tx) => {
      for (let i = 0; i < rows.length; i += BULK_SESSION_CREATE_CHUNK) {
        await tx.ticketSession.createMany({
          data: rows.slice(i, i + BULK_SESSION_CREATE_CHUNK),
        });
      }
    },
    { timeout: 120_000, maxWait: 15_000 }
  );

  return { count: rows.length };
}

export async function updateTicketSession(
  actor: TicketingActor,
  sessionId: string,
  patch: {
    startsAt?: string;
    endsAt?: string;
    capacity?: number;
    remaining?: number;
    isClosed?: boolean;
    priceOverride?: number | null;
    resourceId?: string | null;
    label?: string | null;
  }
) {
  const orgId = await assertTicketingStaffMutate(actor);
  const existing = await prisma.ticketSession.findFirst({
    where: { id: requireId(sessionId, "sessionId"), orgId },
  });
  if (!existing) throw new ForbiddenError(SESSION_NOT_FOUND);
  await assertLocationInHqScope(actor, existing.locationId);

  const product = await prisma.admissionProduct.findFirst({
    where: { id: existing.productId, orgId },
    select: { id: true, archivedAt: true },
  });
  if (!product) throw new ForbiddenError(PRODUCT_NOT_FOUND);
  if (product.archivedAt) {
    throw new Error("Cannot edit sessions on an archived product");
  }

  const closingOnly =
    patch.isClosed === true &&
    patch.startsAt === undefined &&
    patch.endsAt === undefined &&
    patch.capacity === undefined &&
    patch.remaining === undefined &&
    patch.priceOverride === undefined &&
    patch.resourceId === undefined &&
    patch.label === undefined;

  await assertVenueActiveForTicketingMutate(orgId, existing.locationId, {
    allowArchived: closingOnly,
  });

  const data: Prisma.TicketSessionUpdateInput = {};
  if (patch.startsAt !== undefined || patch.endsAt !== undefined) {
    const nextStartsAt =
      patch.startsAt !== undefined ? new Date(patch.startsAt) : existing.startsAt;
    const nextEndsAt =
      patch.endsAt !== undefined ? new Date(patch.endsAt) : existing.endsAt;
    if (
      Number.isNaN(nextStartsAt.getTime()) ||
      Number.isNaN(nextEndsAt.getTime())
    ) {
      throw new Error("Invalid session start/end");
    }
    if (nextEndsAt <= nextStartsAt) {
      throw new Error("endsAt must be after startsAt");
    }
    data.startsAt = nextStartsAt;
    data.endsAt = nextEndsAt;
  }

  const nextCapacity =
    patch.capacity !== undefined
      ? requireCapacity(patch.capacity)
      : existing.capacity;
  let nextRemaining =
    patch.remaining !== undefined
      ? requireCapacity(patch.remaining)
      : existing.remaining;
  if (patch.remaining === undefined && patch.capacity !== undefined) {
    if (nextCapacity > existing.capacity) {
      nextRemaining =
        existing.remaining + (nextCapacity - existing.capacity);
    } else if (nextCapacity < existing.capacity) {
      nextRemaining = Math.min(existing.remaining, nextCapacity);
    }
  }
  if (nextRemaining > nextCapacity) {
    throw new Error("remaining cannot exceed capacity");
  }
  if (patch.capacity !== undefined || patch.remaining !== undefined) {
    data.capacity = nextCapacity;
    data.remaining = nextRemaining;
  }

  if (patch.isClosed !== undefined) data.isClosed = Boolean(patch.isClosed);
  if (patch.priceOverride !== undefined) {
    data.priceOverride =
      patch.priceOverride == null
        ? null
        : new Decimal(
            requireMoneyAmount(patch.priceOverride, "priceOverride")
          );
  }
  if (patch.resourceId !== undefined) {
    if (patch.resourceId) {
      const resource = await prisma.capacityResource.findFirst({
        where: {
          id: requireId(patch.resourceId, "resourceId"),
          orgId,
          locationId: existing.locationId,
          archivedAt: null,
        },
      });
      if (!resource) throw new ForbiddenError("Capacity resource not found");
      data.resource = { connect: { id: resource.id } };
    } else {
      data.resource = { disconnect: true };
    }
  }
  if (patch.label !== undefined) {
    data.label = normalizeSessionLabel(patch.label);
  }

  const row = await prisma.ticketSession.update({
    where: { id: existing.id },
    data,
    include: {
      product: { select: { id: true, name: true, type: true } },
      resource: { select: { id: true, name: true } },
    },
  });
  return toSessionDto(row);
}

export async function deleteTicketSession(
  actor: TicketingActor,
  sessionId: string
) {
  // Soft-close rather than hard-delete (keep remaining for reopen).
  return updateTicketSession(actor, sessionId, { isClosed: true });
}

/**
 * Transactional remaining decrement — see capacity.ts (Phase 2 SSOT).
 * @deprecated Prefer import from `@/lib/ticketing/capacity`.
 */
export { tryConsumeSessionCapacity } from "@/lib/ticketing/capacity";

export function parseCreateSessionBody(body: unknown): CreateSessionInput & {
  series?: boolean;
  weekdays?: number[];
  untilDate?: string;
  slots?: BulkSessionSlotInput[];
} {
  if (!body || typeof body !== "object") throw new Error("Invalid JSON");
  const b = body as Record<string, unknown>;
  rejectClientOrgFields(b);

  let slots: BulkSessionSlotInput[] | undefined;
  if (Array.isArray(b.slots)) {
    slots = b.slots.map((raw) => {
      if (!raw || typeof raw !== "object") {
        throw new Error("Each slot needs startsAt and endsAt");
      }
      const s = raw as Record<string, unknown>;
      const slot: BulkSessionSlotInput = {
        startsAt: String(s.startsAt ?? ""),
        endsAt: String(s.endsAt ?? ""),
        label:
          s.label == null || s.label === ""
            ? null
            : String(s.label),
      };
      if (s.capacity != null && s.capacity !== "") {
        slot.capacity = Number(s.capacity);
      }
      return slot;
    });
  }

  return {
    productId: String(b.productId ?? ""),
    resourceId:
      b.resourceId == null || b.resourceId === ""
        ? null
        : String(b.resourceId),
    label:
      b.label == null || b.label === ""
        ? null
        : String(b.label),
    startsAt: String(b.startsAt ?? ""),
    endsAt: String(b.endsAt ?? ""),
    capacity: Number(b.capacity ?? 0),
    priceOverride:
      b.priceOverride == null || b.priceOverride === ""
        ? null
        : Number(b.priceOverride),
    series: Boolean(b.series),
    weekdays: Array.isArray(b.weekdays) ? (b.weekdays as number[]) : undefined,
    untilDate: typeof b.untilDate === "string" ? b.untilDate : undefined,
    slots,
  };
}
