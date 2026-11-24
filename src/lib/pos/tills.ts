import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { PosError } from "@/lib/pos/errors";
import { money, num, roundMoney } from "@/lib/pos/money";
import { actorUserId, posListLocationWhere, requirePosVenue, type PosActor } from "@/lib/pos/scope";
import { resolvePosSettings } from "@/lib/pos/settings";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  enqueueSource,
  flushAccountingQueueSoon,
} from "@/lib/accounting/enqueueHooks";

type Db = Prisma.TransactionClient | typeof prisma;

export async function expectedCashForSession(sessionId: string, db: Db = prisma) {
  const session = await db.tillSession.findFirst({ where: { id: sessionId } });
  if (!session) return 0;
  const movements = await db.tillMovement.findMany({ where: { sessionId } });
  let expected = num(session.openingFloat);
  for (const m of movements) {
    const amount = num(m.amount);
    if (m.kind === "cash_in" || m.kind === "sale_cash") {
      expected += amount;
    } else if (m.kind === "cash_out" || m.kind === "refund_cash" || m.kind === "drop" || m.kind === "pickup") {
      expected -= amount;
    }
  }
  return roundMoney(expected);
}

function tillDto(
  row: {
    id: string;
    orgId: string;
    locationId: string;
    deviceId: string;
    status: string;
    openingFloat: Prisma.Decimal;
    expectedCash: Prisma.Decimal;
    countedCash: Prisma.Decimal | null;
    variance: Prisma.Decimal | null;
    notes: string | null;
    closedAt: Date | null;
    editReason: string | null;
  },
  showExpected: boolean
) {
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    deviceId: row.deviceId,
    status: row.status,
    openingFloat: num(row.openingFloat),
    expectedCash: showExpected ? num(row.expectedCash) : null,
    countedCash: row.countedCash == null ? null : num(row.countedCash),
    variance: row.variance == null ? null : num(row.variance),
    notes: row.notes,
    closedAt: row.closedAt?.toISOString() ?? null,
    editReason: row.editReason,
  };
}

export async function listTills(actor: PosActor, canSeeExpected: boolean) {
  const where = await posListLocationWhere(actor);
  const rows = await prisma.tillSession.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const settingsCache = new Map<string, boolean>();
  const out = [];
  for (const row of rows) {
    let show = canSeeExpected;
    if (!canSeeExpected) {
      const key = row.locationId;
      if (!settingsCache.has(key)) {
        const settings = await resolvePosSettings(row.orgId, row.locationId);
        settingsCache.set(key, settings.showExpectedTillTotals);
      }
      show = settingsCache.get(key) === true;
    }
    out.push(tillDto(row, show || canSeeExpected));
  }
  return out;
}

export async function openTill(actor: PosActor, body: Record<string, unknown>) {
  const locationId = String(body.locationId || "");
  const deviceId = String(body.deviceId || "");
  const { orgId } = await requirePosVenue(actor, locationId);
  const device = await prisma.posDevice.findFirst({
    where: { id: deviceId, orgId, locationId, archivedAt: null },
  });
  if (!device) throw new PosError("NOT_FOUND", "Device not found", 404);
  const existing = await prisma.tillSession.findFirst({
    where: { deviceId, status: "open" },
  });
  if (existing) throw new PosError("TILL_OPEN", "This device already has an open till", 409);
  const openingFloat = roundMoney(Number(body.openingFloat ?? 0));
  if (!(openingFloat >= 0)) throw new PosError("FLOAT", "opening float is required");
  const userId = actorUserId(actor);
  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.tillSession.create({
      data: {
        orgId,
        locationId,
        deviceId,
        openedById: userId,
        openingFloat: money(openingFloat),
        expectedCash: money(openingFloat),
        notes: body.notes == null ? null : String(body.notes),
        movements: {
          create: {
            orgId,
            kind: "open_float",
            amount: money(openingFloat),
            reason: "open",
            createdById: userId,
          },
        },
      },
    });
    const openMove = await tx.tillMovement.findFirst({
      where: { sessionId: created.id, kind: "open_float" },
      orderBy: { createdAt: "asc" },
    });
    if (openMove) {
      await enqueueSource(tx, {
        orgId,
        locationId,
        sourceType: "till_movement",
        sourceId: openMove.id,
        sourceEvent: "open_float",
        eventAt: openMove.createdAt,
      });
    }
    return created;
  });
  flushAccountingQueueSoon(orgId);
  return tillDto(session, true);
}

export async function addTillMovement(
  actor: PosActor,
  sessionId: string,
  body: Record<string, unknown>
) {
  const where = await posListLocationWhere(actor);
  const session = await prisma.tillSession.findFirst({
    where: { ...where, id: sessionId, status: "open" },
  });
  if (!session) throw new PosError("NOT_FOUND", "Open till not found", 404);
  const kind = String(body.kind || "");
  if (kind !== "cash_in" && kind !== "cash_out") {
    throw new PosError("MOVEMENT", "kind must be cash_in or cash_out");
  }
  const amount = roundMoney(Number(body.amount));
  if (!(amount > 0)) throw new PosError("AMOUNT", "amount must be greater than zero");
  const reason = String(body.reason || "").trim();
  if (!reason) throw new PosError("REASON", "reason is required");
  const { move, updated } = await prisma.$transaction(async (tx) => {
    const created = await tx.tillMovement.create({
      data: {
        sessionId: session.id,
        orgId: session.orgId,
        kind,
        amount: money(amount),
        reason,
        createdById: actorUserId(actor),
      },
    });
    await enqueueSource(tx, {
      orgId: session.orgId,
      locationId: session.locationId,
      sourceType: "till_movement",
      sourceId: created.id,
      sourceEvent: kind,
      eventAt: created.createdAt,
    });
    const expected = await expectedCashForSession(session.id, tx);
    const next = await tx.tillSession.update({
      where: { id: session.id },
      data: { expectedCash: money(expected) },
    });
    return { move: created, updated: next };
  });
  flushAccountingQueueSoon(session.orgId);
  void move;
  return tillDto(updated, true);
}

export async function closeTill(
  actor: PosActor,
  sessionId: string,
  body: Record<string, unknown>,
  opts: { noCount: boolean; allowNoCount: boolean }
) {
  if (opts.noCount && !opts.allowNoCount) {
    throw new PosError("TILL_NO_COUNT", "Close without a count is not allowed", 403);
  }
  const where = await posListLocationWhere(actor);
  const session = await prisma.tillSession.findFirst({
    where: { ...where, id: sessionId, status: "open" },
  });
  if (!session) throw new PosError("NOT_FOUND", "Open till not found", 404);
  const expected = await expectedCashForSession(session.id);
  const counted = opts.noCount ? null : roundMoney(Number(body.countedCash));
  if (!opts.noCount && !Number.isFinite(counted)) {
    throw new PosError("COUNT", "countedCash is required");
  }
  const variance = counted == null ? null : roundMoney(counted - expected);
  const updated = await prisma.$transaction(async (tx) => {
    const closed = await tx.tillSession.update({
      where: { id: session.id },
      data: {
        status: opts.noCount ? "closed_no_count" : "closed",
        expectedCash: money(expected),
        countedCash: counted == null ? null : money(counted),
        variance: variance == null ? null : money(variance),
        closedById: actorUserId(actor),
        closedAt: new Date(),
        notes: body.notes == null ? session.notes : String(body.notes),
      },
    });
    await enqueueSource(tx, {
      orgId: session.orgId,
      locationId: session.locationId,
      sourceType: "till_close",
      sourceId: session.id,
      sourceEvent: closed.status,
      eventAt: closed.closedAt ?? new Date(),
    });
    return closed;
  });
  flushAccountingQueueSoon(session.orgId);
  logStaffActivityEntry(actor, {
    action: "pos.till.close",
    entityType: "TillSession",
    entityId: session.id,
    description: opts.noCount
      ? "Closed till without a cash count"
      : `Closed till with variance ${variance}`,
  });
  return tillDto(updated, true);
}

export async function editClosedTill(
  actor: PosActor,
  sessionId: string,
  body: Record<string, unknown>
) {
  const where = await posListLocationWhere(actor);
  const session = await prisma.tillSession.findFirst({
    where: { ...where, id: sessionId },
  });
  if (!session) throw new PosError("NOT_FOUND", "Till not found", 404);
  if (session.status === "open") throw new PosError("TILL_OPEN", "Close the till before editing");
  const reason = String(body.editReason || "").trim();
  if (!reason) throw new PosError("REASON", "editReason is required");
  const counted =
    body.countedCash == null ? num(session.countedCash) : roundMoney(Number(body.countedCash));
  const expected = num(session.expectedCash);
  const nextVariance = roundMoney(counted - expected);
  const updated = await prisma.$transaction(async (tx) => {
    const edited = await tx.tillSession.update({
      where: { id: session.id },
      data: {
        countedCash: money(counted),
        variance: money(nextVariance),
        editReason: reason,
        editedAfterCloseAt: new Date(),
      },
    });
    await enqueueSource(tx, {
      orgId: session.orgId,
      locationId: session.locationId,
      sourceType: "till_close",
      sourceId: session.id,
      sourceEvent: `edit:${Math.round(nextVariance * 100)}`,
      eventAt: edited.editedAfterCloseAt ?? new Date(),
    });
    return edited;
  });
  flushAccountingQueueSoon(session.orgId);
  logStaffActivityEntry(actor, {
    action: "pos.till.edit",
    entityType: "TillSession",
    entityId: session.id,
    description: `Edited reconciled till: ${reason}`,
  });
  return tillDto(updated, true);
}

export async function requireOpenTill(orgId: string, deviceId: string, db: Db = prisma) {
  const session = await db.tillSession.findFirst({
    where: { orgId, deviceId, status: "open" },
  });
  if (!session) throw new PosError("TILL_REQUIRED", "Open a till before taking cash", 400);
  return session;
}
