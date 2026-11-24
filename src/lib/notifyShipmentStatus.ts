/**
 * Phase 4 S7/S8 entrypoints — re-export shipping notify helpers under the
 * prompt path so callers can import from `@/lib/notifyShipmentStatus`.
 */

export {
  notifyCustomerShipmentStatus,
  type CustomerShipmentNotifyStatus,
} from "@/lib/shipping/notifyShipmentStatus";

import { notifyCustomerShipmentStatus } from "@/lib/shipping/notifyShipmentStatus";
import { createNotification } from "@/services/notificationService";
import {
  effectiveMembershipPermissions,
  templatePermissionsForMembership,
} from "@/lib/membership";
import { P } from "@/lib/auth/permissions";
import prisma from "@/lib/prisma";

/**
 * Customer in-app + used alongside mailer emails from webhook/statusSync.
 * Alias for notifyCustomerShipmentStatus (Phase 4 naming).
 */
export async function notifyCustomerShipmentUpdate(input: {
  userId: string;
  orderId: string;
  shipmentId: string;
  status:
    | "shipping"
    | "shipped"
    | "delivered"
    | "cancelled"
    | "failed";
  trackingUrl?: string | null;
}): Promise<void> {
  await notifyCustomerShipmentStatus(input);
}

/**
 * Staff in-app alert when booking/courier fails (deliveries:read|manage).
 */
export async function notifyStaffShipmentFailed(input: {
  orgId: string;
  orderId: string;
  shipmentId: string;
  reason?: string | null;
}): Promise<void> {
  const orgId = String(input.orgId || "").trim();
  const orderId = String(input.orderId || "").trim();
  const shipmentId = String(input.shipmentId || "").trim();
  if (!orgId || !orderId || !shipmentId) return;

  const short = orderId.slice(-8);
  const reason =
    String(input.reason || "Shipment booking or courier update failed").slice(
      0,
      400
    );

  try {
    const members = await prisma.membership.findMany({
      where: { orgId, status: "active" },
      select: {
        userId: true,
        orgId: true,
        rolePreset: true,
        roleTemplateId: true,
        permissionsOverride: true,
      },
    });

    await Promise.allSettled(
      members.map(async (member) => {
        const templatePermissions = await templatePermissionsForMembership({
          orgId: member.orgId,
          roleTemplateId: member.roleTemplateId,
        });
        const permissions = effectiveMembershipPermissions({
          rolePreset: String(member.rolePreset ?? ""),
          permissionsOverride: member.permissionsOverride,
          templatePermissions,
        });
        if (
          !permissions.includes(P.DeliveriesRead) &&
          !permissions.includes(P.DeliveriesManage)
        ) {
          return;
        }
        await createNotification(
          member.userId,
          "Shipment needs attention",
          `Order #${short}: ${reason}`,
          "order",
          {
            orderId,
            shipmentId,
            href: `/admin/deliveries/${shipmentId}`,
          }
        );
      })
    );
  } catch (err) {
    console.error(
      `[notifyStaffShipmentFailed] order=${orderId} shipment=${shipmentId}:`,
      err
    );
  }
}
