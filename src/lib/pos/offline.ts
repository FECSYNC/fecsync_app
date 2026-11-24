import prisma from "@/lib/prisma";
import { PosError } from "@/lib/pos/errors";
import { requirePosVenue, type PosActor } from "@/lib/pos/scope";
import { openCart, addCartLine, checkoutCart } from "@/lib/pos/saleEngine";

const OFFLINE_KINDS = new Set(["merchandise", "food", "beverage", "open_price"]);

function parseOfflineEventAt(payload: Record<string, unknown>, fallback: Date): Date {
  const raw =
    payload.occurredAt ??
    payload.eventAt ??
    payload.clientCreatedAt ??
    payload.createdAt ??
    null;
  if (raw == null) return fallback;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export async function syncOffline(actor: PosActor, body: Record<string, unknown>) {
  const locationId = String(body.locationId || "");
  const deviceId = String(body.deviceId || "");
  const clientMutationId = String(body.clientMutationId || "").trim();
  const { orgId } = await requirePosVenue(actor, locationId);
  if (!clientMutationId) throw new PosError("MUTATION", "clientMutationId is required");
  const existing = await prisma.posOfflineMutation.findFirst({
    where: { deviceId, clientMutationId },
  });
  // Idempotent replay of a finished mutation; allow retry from syncing/failed.
  if (existing && (existing.status === "applied" || existing.status === "conflict")) {
    return existing;
  }
  const payload = (body.payload ?? body) as Record<string, unknown>;
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  const blocked = lines.some((line) => {
    const kind = String((line as Record<string, unknown>).kind || "");
    // Map UI "sku" to merchandise for offline gate.
    if (kind === "sku") return false;
    return kind && !OFFLINE_KINDS.has(kind);
  });
  if (blocked || payload.admissionProductId || payload.sessionId) {
    const row = await prisma.posOfflineMutation.upsert({
      where: { deviceId_clientMutationId: { deviceId, clientMutationId } },
      create: {
        orgId,
        locationId,
        deviceId,
        clientMutationId,
        payload: payload as object,
        status: "conflict",
        error: "Admission and capacity lines cannot sync offline",
      },
      update: { status: "conflict", error: "Admission and capacity lines cannot sync offline" },
    });
    return row;
  }
  const mutation = existing
    ? await prisma.posOfflineMutation.update({
        where: { id: existing.id },
        data: { status: "syncing", error: null },
      })
    : await prisma.posOfflineMutation.create({
        data: {
          orgId,
          locationId,
          deviceId,
          clientMutationId,
          payload: payload as object,
          status: "syncing",
        },
      });
  if (mutation.appliedSaleId) return mutation;
  try {
    const eventAt = parseOfflineEventAt(payload, mutation.createdAt);
    const cart = await openCart(actor, { locationId, deviceId });
    for (const line of lines as Array<Record<string, unknown>>) {
      const kind = String(line.kind || "");
      await addCartLine(actor, cart.id, {
        ...line,
        kind: kind === "sku" ? "merchandise" : line.kind,
      });
    }
    const sale = await checkoutCart(actor, cart.id, {
      idempotencyKey: `offline:${deviceId}:${clientMutationId}`,
      tenders: [{ tender: "cash", amount: Number(payload.total ?? payload.amount ?? 0) }],
      allowUnpaid: false,
      eventAt: eventAt.toISOString(),
    });
    return prisma.posOfflineMutation.update({
      where: { id: mutation.id },
      data: { status: "applied", appliedSaleId: sale.id, syncedAt: new Date(), error: null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Offline sync failed";
    return prisma.posOfflineMutation.update({
      where: { id: mutation.id },
      data: { status: "failed", error: message },
    });
  }
}
