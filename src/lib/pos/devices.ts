import prisma from "@/lib/prisma";
import { assertWithinPlanLimit } from "@/lib/planLimits";
import { ForbiddenError } from "@/lib/auth/http-error";
import { PosError } from "@/lib/pos/errors";
import {
  actorUserId,
  posListLocationWhere,
  requirePosVenue,
  type PosActor,
} from "@/lib/pos/scope";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";

function deviceDto(row: {
  id: string;
  orgId: string;
  locationId: string;
  name: string;
  code: string;
  templateKey: string;
  registeredAt: Date;
  lastSeenAt: Date | null;
  archivedAt: Date | null;
  printEnabled: boolean;
  cashDrawerEnabled: boolean;
  stripeTerminalId: string | null;
  printAgentUrl: string | null;
  settingsOverride: unknown;
}) {
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    name: row.name,
    code: row.code,
    templateKey: row.templateKey,
    registeredAt: row.registeredAt.toISOString(),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    printEnabled: row.printEnabled,
    cashDrawerEnabled: row.cashDrawerEnabled,
    stripeTerminalId: row.stripeTerminalId,
    printAgentUrl: row.printAgentUrl,
    settingsOverride: row.settingsOverride ?? null,
  };
}

export async function listPosDevices(actor: PosActor, locationId?: string | null) {
  const where = await posListLocationWhere(actor);
  if (locationId) {
    await requirePosVenue(actor, locationId);
  }
  const rows = await prisma.posDevice.findMany({
    where: {
      ...where,
      ...(locationId ? { locationId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(deviceDto);
}

export async function createPosDevice(
  actor: PosActor,
  body: Record<string, unknown>
) {
  const locationId = String(body.locationId || "");
  const { orgId } = await requirePosVenue(actor, locationId);
  const name = String(body.name || "").trim();
  const code = String(body.code || "").trim();
  if (!name || !code) throw new PosError("DEVICE_FIELDS", "name and code are required");
  await assertWithinPlanLimit(orgId, "posTerminals");
  try {
    const row = await prisma.posDevice.create({
      data: {
        orgId,
        locationId,
        name,
        code,
        templateKey: String(body.templateKey || "default"),
        printEnabled: body.printEnabled !== false,
        cashDrawerEnabled: body.cashDrawerEnabled === true,
        stripeTerminalId:
          body.stripeTerminalId == null ? null : String(body.stripeTerminalId),
        printAgentUrl: body.printAgentUrl == null ? null : String(body.printAgentUrl),
      },
    });
    logStaffActivityEntry(actor, {
      action: "pos.device.create",
      entityType: "PosDevice",
      entityId: row.id,
      description: `Registered POS device ${row.code}`,
    });
    return deviceDto(row);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("Unique constraint")) {
      throw new PosError("DEVICE_CODE", "Device code is already used in this company", 409);
    }
    throw err;
  }
}

export async function updatePosDevice(
  actor: PosActor,
  id: string,
  body: Record<string, unknown>
) {
  const where = await posListLocationWhere(actor);
  const existing = await prisma.posDevice.findFirst({ where: { ...where, id } });
  if (!existing) {
    const foreign = await prisma.posDevice.findFirst({ where: { id }, select: { id: true } });
    if (foreign) throw new ForbiddenError("Device is outside this company");
    throw new PosError("NOT_FOUND", "Device not found", 404);
  }
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string") data.name = body.name.trim();
  if (typeof body.templateKey === "string") data.templateKey = body.templateKey;
  if (typeof body.printEnabled === "boolean") data.printEnabled = body.printEnabled;
  if (typeof body.cashDrawerEnabled === "boolean") data.cashDrawerEnabled = body.cashDrawerEnabled;
  if (body.printAgentUrl !== undefined) {
    data.printAgentUrl = body.printAgentUrl == null ? null : String(body.printAgentUrl);
  }
  if (body.stripeTerminalId !== undefined) {
    data.stripeTerminalId =
      body.stripeTerminalId == null ? null : String(body.stripeTerminalId);
  }
  if (body.archived === true) data.archivedAt = new Date();
  if (body.archived === false) data.archivedAt = null;
  const row = await prisma.posDevice.update({ where: { id: existing.id }, data });
  return deviceDto(row);
}

export async function kickDrawer(actor: PosActor, deviceId: string, saleId?: string | null) {
  const where = await posListLocationWhere(actor);
  const device = await prisma.posDevice.findFirst({ where: { ...where, id: deviceId } });
  if (!device) throw new PosError("NOT_FOUND", "Device not found", 404);
  const userId = actorUserId(actor);
  if (!device.printAgentUrl) {
    await prisma.posDrawerEvent.create({
      data: {
        orgId: device.orgId,
        deviceId: device.id,
        saleId: saleId ?? null,
        requestedById: userId,
        result: "not_kicked",
        reason: "NO_DRAWER_AGENT",
      },
    });
    return { kicked: false as const, reason: "NO_DRAWER_AGENT" };
  }
  await prisma.posDrawerEvent.create({
    data: {
      orgId: device.orgId,
      deviceId: device.id,
      saleId: saleId ?? null,
      requestedById: userId,
      result: "kicked",
      reason: "AGENT_REQUESTED",
    },
  });
  return { kicked: true as const, reason: "AGENT_REQUESTED", agentUrl: device.printAgentUrl };
}
