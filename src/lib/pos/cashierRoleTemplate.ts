/**
 * Documented POS cashier role template.
 * Bits: sell, read, cash, check-in, tabs, guests write, discount.
 * Created once per org when POS settings are read, if the role-template cap allows.
 */
import prisma from "@/lib/prisma";
import { P } from "@/lib/auth/permissions";
import { assertWithinPlanLimit } from "@/lib/planLimits";

export const POS_CASHIER_TEMPLATE_NAME = "POS cashier";

export const POS_CASHIER_TEMPLATE_PERMISSIONS = [
  P.PosSell,
  P.PosRead,
  P.PosCash,
  P.PosCheckin,
  P.PosTabs,
  P.PosGuestsWrite,
  P.PosDiscount,
] as const;

export async function ensurePosCashierRoleTemplate(orgId: string): Promise<void> {
  const existing = await prisma.roleTemplate.findFirst({
    where: { orgId, name: POS_CASHIER_TEMPLATE_NAME },
    select: { id: true },
  });
  if (existing) return;
  try {
    await assertWithinPlanLimit(orgId, "roleTemplates");
  } catch {
    return;
  }
  await prisma.roleTemplate.create({
    data: {
      orgId,
      name: POS_CASHIER_TEMPLATE_NAME,
      description:
        "Front desk cashier: sell, read, cash, check-in, tabs, guest records, and discounts. Refunds, voids, and till admin stay on manager presets.",
      permissions: [...POS_CASHIER_TEMPLATE_PERMISSIONS],
    },
  });
}
