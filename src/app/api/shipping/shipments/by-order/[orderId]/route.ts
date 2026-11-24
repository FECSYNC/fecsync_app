export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import prisma from "@/lib/prisma";
import {
  ok,
  notFound,
  forbidden,
  badRequest,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requireAuthFresh } from "@/lib/middleware/requireAuth";
import { P, hasPermission } from "@/lib/auth/permissions";
import {
  requireActorOrgId,
  actorHasCompanyWideView,
} from "@/lib/staffOrg";
import { getShipmentByOrderId } from "@/lib/shipping/shipmentsApi";
import { assertOrganizationActive } from "@/lib/org";

type Ctx = { params: Promise<{ orderId: string }> };

/**
 * GET /api/shipping/shipments/by-order/[orderId]
 * Staff with deliveries:read or orders:read (org + CWV) OR the order owner.
 */
export async function GET(request: NextRequest, context: Ctx) {
  let actor;
  try {
    actor = await requireAuthFresh(request, { allowSuspendedOrg: true });
  } catch (err) {
    return authErrorToResponse(err) ?? serverError("Failed to authorize");
  }

  try {
    await connectDB();
    const { orderId: raw } = await context.params;
    const orderId = String(raw || "").trim();
    if (!orderId) return notFound("Order not found");

    const staffCanRead =
      hasPermission(actor.permissions, P.DeliveriesRead) ||
      hasPermission(actor.permissions, P.OrdersRead);

    let tryStaffScope = staffCanRead;
    if (tryStaffScope && actor.orgId) {
      try {
        await assertOrganizationActive(actor.orgId);
      } catch {
        // Pending/suspended company staff still track their own orders as customers.
        tryStaffScope = false;
      }
    }

    if (tryStaffScope) {
      try {
        const orgId = requireActorOrgId(actor);
        if (orderId.length > 128) return badRequest("Invalid order id");
        const includeOps = hasPermission(actor.permissions, P.DeliveriesRead);
        const ownOnly = !actorHasCompanyWideView(actor);
        const shipment = await getShipmentByOrderId({
          orderId,
          orgId,
          ownerUserId: ownOnly ? actor.sub : undefined,
          includeOpsFields: includeOps,
        });
        if (shipment) return ok(shipment);

        const inOrg = await prisma.order.findFirst({
          where: {
            id: orderId,
            orgId,
            ...(ownOnly ? { userId: actor.sub } : {}),
          },
          select: { id: true },
        });
        if (inOrg) {
          return notFound("No shipment for this order yet");
        }
        // Order not in staff org / own-scope — fall through to owner path (e.g. staff
        // shopping as a customer on another org's storefront).
      } catch (err) {
        const authRes = authErrorToResponse(
          err,
          authAudit(request, "GET /api/shipping/shipments/by-order/[orderId]", {
            permission: P.DeliveriesRead,
          })
        );
        if (authRes) return authRes;
        console.error("Get shipment by order (staff) error:", err);
        return serverError("Failed to load shipment");
      }
    }

    if (orderId.length > 128) return badRequest("Invalid order id");

    const shipment = await getShipmentByOrderId({
      orderId,
      ownerUserId: actor.sub,
      includeOpsFields: false,
    });
    if (!shipment) {
      const owned = await prisma.order.findFirst({
        where: { id: orderId, userId: actor.sub },
        select: { id: true },
      });
      if (!owned) return forbidden("Not allowed to view this shipment");
      return notFound("No shipment for this order yet");
    }
    return ok(shipment);
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    console.error("Get shipment by order error:", err);
    return serverError("Failed to load shipment");
  }
}
