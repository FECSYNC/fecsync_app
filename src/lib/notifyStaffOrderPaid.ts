/**
 * Create in-app notifications for active org staff when an order is paid.
 */

import prisma from "@/lib/prisma";
import {
  effectiveMembershipPermissions,
  templatePermissionsForMembership,
} from "@/lib/membership";
import { P } from "@/lib/auth/permissions";
import { createNotification } from "@/services/notificationService";
import { formatPrice } from "@/utils/currency";

export async function notifyStaffOfPaidOrder(input: {
  orderId: string;
  orgId?: string | null;
  amount?: number;
  customerLabel: string;
}): Promise<void> {
  const { orderId, orgId, amount, customerLabel } = input;
  if (!orgId) {
    console.warn(
      "[notifyStaffOfPaidOrder] missing orgId; skipping staff notifications"
    );
    return;
  }

  try {
    const members = await prisma.membership.findMany({
      where: {
        orgId: String(orgId),
        status: "active",
      },
      select: {
        userId: true,
        orgId: true,
        rolePreset: true,
        roleTemplateId: true,
        permissionsOverride: true,
      },
    });

    if (!members.length) return;

    const orderIdStr = String(orderId);
    const shortId = orderIdStr.slice(-8);
    const amountText =
      typeof amount === "number" ? ` for ${formatPrice(amount)}` : "";
    const title = "New paid order";
    const message = `${customerLabel} completed payment${amountText} — Order #${shortId}`;

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
        if (!permissions.includes(P.OrdersRead)) return;

        const userId = String(member.userId);
        const existing = await prisma.notification.findFirst({
          where: {
            userId,
            type: "order",
            metadata: {
              path: ["orderId"],
              equals: orderIdStr,
            },
          },
          select: { id: true },
        });
        if (existing) return;

        await createNotification(userId, title, message, "order", {
          orderId: orderIdStr,
          amount,
        });
      })
    );
  } catch (err) {
    console.error("[notifyStaffOfPaidOrder] failed:", err);
  }
}
