import bcrypt from "bcrypt";
import prisma from "@/lib/prisma";
import { ForbiddenError } from "@/lib/auth/http-error";
import { consumeRateLimit } from "@/lib/rateLimit";
import { PosError } from "@/lib/pos/errors";
import { actorUserId, assertPosStaff, type PosActor } from "@/lib/pos/scope";
import { resolvePosSettings } from "@/lib/pos/settings";

const LOCK_AFTER = 8;
const LOCK_MS = 15 * 60 * 1000;

export async function setManagerPin(actor: PosActor, pin: string) {
  const orgId = await assertPosStaff(actor);
  const userId = actorUserId(actor);
  const trimmed = pin.trim();
  if (!/^\d{4,8}$/.test(trimmed)) {
    throw new PosError("PIN_FORMAT", "Manager PIN must be 4 to 8 digits");
  }
  const pinHash = await bcrypt.hash(trimmed, 10);
  await prisma.membership.update({
    where: { userId_orgId: { userId, orgId } },
    data: {
      pinHash,
      pinSetAt: new Date(),
      pinFailedAttempts: 0,
      pinLockedUntil: null,
    },
  });
  return { ok: true as const };
}

/** Venue-level shared override PIN (PosSettings.managerOverridePinHash). */
export async function setVenueOverridePin(
  actor: PosActor,
  locationId: string,
  pin: string
) {
  const { requirePosVenue } = await import("@/lib/pos/scope");
  const { orgId } = await requirePosVenue(actor, locationId);
  const trimmed = pin.trim();
  if (!/^\d{4,8}$/.test(trimmed)) {
    throw new PosError("PIN_FORMAT", "Manager PIN must be 4 to 8 digits");
  }
  const pinHash = await bcrypt.hash(trimmed, 10);
  const existing = await prisma.posSettings.findFirst({
    where: { orgId, locationId },
  });
  if (existing) {
    await prisma.posSettings.update({
      where: { id: existing.id },
      data: { managerOverridePinHash: pinHash },
    });
  } else {
    await prisma.posSettings.create({
      data: {
        orgId,
        locationId,
        tipSuggestedPercents: [15, 18, 20],
        managerOverridePinHash: pinHash,
      },
    });
  }
  return { ok: true as const, hasManagerOverridePin: true as const };
}

export async function verifyManagerPin(
  actor: PosActor,
  pin: string | null | undefined,
  locationId?: string | null
): Promise<{ userId: string }> {
  const orgId = await assertPosStaff(actor);
  const userId = actorUserId(actor);
  const limited = consumeRateLimit(`pos-pin:${orgId}:${userId}`, 10, 60_000);
  if (!limited.allowed) {
    throw new PosError("PIN_RATE_LIMIT", "Too many PIN attempts", 429);
  }
  const membership = await prisma.membership.findUnique({
    where: { userId_orgId: { userId, orgId } },
    select: {
      pinHash: true,
      pinFailedAttempts: true,
      pinLockedUntil: true,
    },
  });
  if (membership?.pinLockedUntil && membership.pinLockedUntil.getTime() > Date.now()) {
    throw new PosError("PIN_LOCKED", "Manager PIN is locked. Try again later", 403);
  }
  const candidate = (pin ?? "").trim();
  let ok = false;
  if (membership?.pinHash && candidate) {
    ok = await bcrypt.compare(candidate, membership.pinHash);
  }
  if (!ok && locationId !== undefined) {
    const settings = await resolvePosSettings(orgId, locationId ?? null);
    if (settings.managerOverridePinHash && candidate) {
      ok = await bcrypt.compare(candidate, settings.managerOverridePinHash);
    }
  }
  if (!ok) {
    const fails = (membership?.pinFailedAttempts ?? 0) + 1;
    await prisma.membership.update({
      where: { userId_orgId: { userId, orgId } },
      data: {
        pinFailedAttempts: fails,
        pinLockedUntil: fails >= LOCK_AFTER ? new Date(Date.now() + LOCK_MS) : null,
      },
    });
    throw new ForbiddenError("Manager PIN is required");
  }
  await prisma.membership.update({
    where: { userId_orgId: { userId, orgId } },
    data: { pinFailedAttempts: 0, pinLockedUntil: null },
  });
  return { userId };
}

export function readManagerPin(body: Record<string, unknown>, header: string | null): string {
  const fromBody = typeof body.managerPin === "string" ? body.managerPin : "";
  return (header || fromBody || "").trim();
}
