/**
 * Guest park Memberships module gate.
 * Thin wrapper around assertModuleEnabled — Growth + Enterprise only.
 * Never overload staff seat helpers in src/lib/membership.ts.
 */
import {
  assertModuleEnabled,
  MODULE_NOT_ENABLED_MESSAGE,
  MODULE_STOREFRONT_MESSAGE,
} from "@/lib/moduleEntitlement";
import { requireId } from "@/lib/ids";

export { MODULE_NOT_ENABLED_MESSAGE, MODULE_STOREFRONT_MESSAGE };

export async function assertMembershipsEnabled(orgId: string): Promise<void> {
  const id = requireId(orgId, "orgId");
  await assertModuleEnabled(id, "memberships");
}
