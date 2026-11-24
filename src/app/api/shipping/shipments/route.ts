export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import {
  ok,
  created,
  badRequest,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import {
  requireActorOrgId,
  actorHasCompanyWideView,
} from "@/lib/staffOrg";
import {
  bookShipmentForOrder,
  isShippingError,
} from "@/lib/shipping";
import {
  isShipmentStatus,
  listShipmentsForOrg,
} from "@/lib/shipping/shipmentsApi";

/**
 * GET /api/shipping/shipments — org-scoped list (deliveries:read)
 * POST /api/shipping/shipments — manual book/retry (deliveries:manage)
 * Body: { orderId: string }
 */
export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.DeliveriesRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/shipping/shipments", {
          permission: P.DeliveriesRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const sp = request.nextUrl.searchParams;
    const statusRaw = sp.get("status")?.trim() || "";
    const status =
      statusRaw && isShipmentStatus(statusRaw) ? statusRaw : undefined;
    const orderId = sp.get("orderId")?.trim() || undefined;
    const page = sp.get("page");
    const limit = sp.get("limit");

    const result = await listShipmentsForOrg(orgId, {
      status,
      orderId,
      orderUserId: actorHasCompanyWideView(actor) ? undefined : actor.sub,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return ok(result);
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    console.error("List shipments error:", err);
    return serverError("Failed to list shipments");
  }
}

export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.DeliveriesManage);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "POST /api/shipping/shipments", {
          permission: P.DeliveriesManage,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  let body: { orderId?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const orderId = String(body.orderId ?? "").trim();
    if (!orderId) return badRequest("orderId is required");
    if (orderId.length > 128) return badRequest("Invalid orderId");

    const prisma = (await import("@/lib/prisma")).default;
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        orgId,
        ...(actorHasCompanyWideView(actor) ? {} : { userId: actor.sub }),
      },
      select: { id: true },
    });
    if (!order) return badRequest("Order not found in your organization");

    const shipment = await bookShipmentForOrder(orderId, { expectedOrgId: orgId });

    if (shipment.status === "failed") {
      // Persist already done; return shipment for ops while signaling failure.
      return new Response(
        JSON.stringify({
          success: false,
          error: shipment.failureReason || "Shipment booking failed",
          data: { shipment },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    return created(shipment);
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    if (isShippingError(err)) {
      return badRequest(err.message);
    }
    console.error("Book shipment error:", err);
    return serverError("Failed to book shipment");
  }
}
