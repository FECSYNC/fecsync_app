import { createHash, randomBytes, scryptSync } from "crypto";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ForbiddenError } from "@/lib/auth/http-error";
import { P } from "@/lib/auth/permissions";
import { assertWaiverPermission } from "@/lib/waivers/access";
import { isValidId, requireId } from "@/lib/ids";
import { logActivityEntryAsync } from "@/lib/audit/activityLog";
import {
  assertLocationInWaiverScope,
  assertWaiversStaff,
  rethrowUniqueConflict,
  rejectClientOrgFields,
  requireActorVenueInScope,
  waiverStampedLocationWhere,
  type WaiversActor,
} from "@/lib/waivers/common";

export type WaiverKioskDto = {
  id: string;
  orgId: string;
  locationId: string;
  name: string;
  code: string;
  status: string;
  templateIds: string[];
  lastSeenAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present only on the create response. */
  deviceToken?: string;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashPin(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function toDto(row: {
  id: string;
  orgId: string;
  locationId: string;
  name: string;
  code: string;
  status: string;
  templateIds: unknown;
  lastSeenAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): WaiverKioskDto {
  const templateIds = Array.isArray(row.templateIds)
    ? row.templateIds.filter((id) => typeof id === "string")
    : [];
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    name: row.name,
    code: row.code,
    status: row.status,
    templateIds,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Kiosk template ids must be published, in the actor's park scope, and either
 * company-wide or for this kiosk's venue. Duplicates are collapsed.
 */
async function assertTemplateIdsForKiosk(
  actor: WaiversActor,
  orgId: string,
  templateIds: string[],
  kioskLocationId: string
): Promise<string[]> {
  const unique = [...new Set(templateIds)];
  if (!unique.length) return [];
  const rows = await prisma.waiverTemplate.findMany({
    where: { orgId, id: { in: unique } },
    select: { id: true, locationId: true, status: true, archivedAt: true },
  });
  if (rows.length !== unique.length) {
    throw new ForbiddenError("One or more templates were not found");
  }
  for (const row of rows) {
    await assertLocationInWaiverScope(actor, row.locationId);
    if (row.locationId && row.locationId !== kioskLocationId) {
      throw new Error(
        "A kiosk can only use templates for its own venue or company-wide templates"
      );
    }
    if (row.status !== "published" || row.archivedAt) {
      throw new Error("Only published templates can be assigned to a kiosk");
    }
  }
  return unique;
}

/** Drop a template id from every kiosk in the company. Used when the template is archived. */
export async function detachTemplateFromKiosks(
  db: Prisma.TransactionClient,
  orgId: string,
  templateId: string
): Promise<void> {
  const rows = await db.waiverKioskDevice.findMany({
    where: { orgId },
    select: { id: true, templateIds: true },
  });
  for (const row of rows) {
    if (!Array.isArray(row.templateIds)) continue;
    const next = row.templateIds.filter((id) => id !== templateId);
    if (next.length === row.templateIds.length) continue;
    await db.waiverKioskDevice.update({
      where: { id: row.id },
      data: { templateIds: next },
    });
  }
}

export async function listKioskDevices(actor: WaiversActor): Promise<WaiverKioskDto[]> {
  const orgId = await assertWaiversStaff(actor);
  const loc = await waiverStampedLocationWhere(actor);
  const rows = await prisma.waiverKioskDevice.findMany({
    where: { orgId, ...loc },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toDto);
}

export async function createKioskDevice(
  actor: WaiversActor,
  body: unknown
): Promise<WaiverKioskDto> {
  const orgId = await assertWaiversStaff(actor);
  rejectClientOrgFields(body);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid kiosk body");
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 120) : "";
  if (!name) throw new Error("Name is required");
  const locationId = typeof b.locationId === "string" ? b.locationId.trim() : "";
  if (!locationId) throw new Error("Venue location is required");
  await requireActorVenueInScope(actor, locationId);

  const codeRaw =
    typeof b.code === "string" && b.code.trim()
      ? b.code.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40)
      : `kiosk-${randomBytes(3).toString("hex")}`;
  if (!codeRaw) throw new Error("Code is required");
  const taken = await prisma.waiverKioskDevice.findFirst({
    where: { orgId, code: codeRaw },
    select: { id: true },
  });
  if (taken) throw new Error("That kiosk code is already used in this company");

  const requestedIds = Array.isArray(b.templateIds)
    ? b.templateIds.filter((id) => typeof id === "string" && isValidId(id))
    : [];
  const templateIds = await assertTemplateIdsForKiosk(
    actor,
    orgId,
    requestedIds,
    locationId
  );

  let pinHash: string | null = null;
  if (typeof b.pin === "string" && b.pin.trim()) {
    if (!/^\d{4,8}$/.test(b.pin.trim())) {
      throw new Error("PIN must be 4–8 digits");
    }
    pinHash = hashPin(b.pin.trim());
  }

  const deviceToken = randomBytes(32).toString("hex");
  let row;
  try {
    row = await prisma.waiverKioskDevice.create({
      data: {
        orgId,
        locationId,
        name,
        code: codeRaw,
        status: "active",
        deviceTokenHash: hashToken(deviceToken),
        pinHash,
        templateIds,
      },
    });
  } catch (err) {
    rethrowUniqueConflict(err, "That kiosk code is already used in this company");
  }

  await logActivityEntryAsync({
    actorSub: actor.sub,
    orgId,
    action: "waiver_kiosk_create",
    entityType: "WaiverKioskDevice",
    entityId: row.id,
    description: `Created waiver kiosk ${name}`,
    metadata: { locationId },
  });

  return { ...toDto(row), deviceToken };
}

export async function updateKioskDevice(
  actor: WaiversActor,
  deviceId: string,
  body: unknown
): Promise<WaiverKioskDto> {
  const orgId = await assertWaiversStaff(actor);
  rejectClientOrgFields(body);
  const id = requireId(deviceId, "deviceId");
  const existing = await prisma.waiverKioskDevice.findFirst({
    where: { id, orgId },
  });
  if (!existing) throw new ForbiddenError("Kiosk device not found");
  await assertLocationInWaiverScope(actor, existing.locationId);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid kiosk body");
  }
  const b = body as Record<string, unknown>;
  const data: {
    name?: string;
    status?: "active" | "disabled" | "archived";
    archivedAt?: Date | null;
    templateIds?: string[];
    pinHash?: string | null;
  } = {};
  if (typeof b.name === "string" && b.name.trim()) data.name = b.name.trim().slice(0, 120);
  if (b.status === "active" || b.status === "disabled" || b.status === "archived") {
    data.status = b.status;
    data.archivedAt = b.status === "archived" ? new Date() : null;
  }
  if (Array.isArray(b.templateIds)) {
    const templateIds = b.templateIds.filter(
      (tid) => typeof tid === "string" && isValidId(tid)
    );
    data.templateIds = await assertTemplateIdsForKiosk(
      actor,
      orgId,
      templateIds,
      existing.locationId
    );
  }
  if (b.pin === null) data.pinHash = null;
  if (typeof b.pin === "string" && b.pin.trim()) {
    if (!/^\d{4,8}$/.test(b.pin.trim())) throw new Error("PIN must be 4–8 digits");
    data.pinHash = hashPin(b.pin.trim());
  }
  const row = await prisma.waiverKioskDevice.update({
    where: { id: existing.id },
    data,
  });
  return toDto(row);
}

/** Replaces the device token hash. The previous token stops working. Raw token returned once. */
export async function rotateKioskDeviceToken(actor: WaiversActor, deviceId: string) {
  const orgId = await assertWaiverPermission(actor, P.WaiversAdmin);
  const id = requireId(deviceId, "deviceId");
  const existing = await prisma.waiverKioskDevice.findFirst({
    where: { id, orgId },
  });
  if (!existing) throw new ForbiddenError("Kiosk device not found");
  await assertLocationInWaiverScope(actor, existing.locationId);
  const deviceToken = randomBytes(32).toString("hex");
  const row = await prisma.waiverKioskDevice.update({
    where: { id: existing.id },
    data: { deviceTokenHash: hashToken(deviceToken) },
  });
  await logActivityEntryAsync({
    actorSub: actor.sub,
    orgId,
    action: "waiver_kiosk_rotate",
    entityType: "WaiverKioskDevice",
    entityId: row.id,
    description: `Rotated waiver kiosk token ${row.name}`,
    metadata: { locationId: row.locationId },
  });
  return { ...toDto(row), deviceToken };
}
