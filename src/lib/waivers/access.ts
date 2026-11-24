/**
 * Staff permission check for waiver actions that are not on every seat.
 * Effective grants = role preset plus membership overrides.
 */
import { ForbiddenError } from "@/lib/auth/http-error";
import { ROLE_PRESETS, type Permission, type RolePresetId } from "@/lib/auth/permissions";
import prisma from "@/lib/prisma";
import { assertWaiversStaff, type WaiversActor } from "@/lib/waivers/common";

export async function assertWaiverPermission(
  actor: WaiversActor,
  permission: Permission
): Promise<string> {
  const orgId = await assertWaiversStaff(actor);
  if (!actor.sub) throw new ForbiddenError("Missing required permission");
  const membership = await prisma.membership.findFirst({
    where: { userId: actor.sub, orgId, status: "active" },
    select: { rolePreset: true, permissionsOverride: true },
  });
  if (!membership) throw new ForbiddenError("Missing required permission");
  const preset =
    ROLE_PRESETS[membership.rolePreset as RolePresetId] ?? [];
  const granted = new Set<string>([
    ...preset,
    ...(membership.permissionsOverride ?? []),
  ]);
  if (!granted.has(permission)) {
    throw new ForbiddenError("Missing required permission");
  }
  return orgId;
}
