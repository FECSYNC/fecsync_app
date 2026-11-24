/**
 * Digital Waivers module gate.
 * Thin wrapper around assertModuleEnabled — Growth + Enterprise only.
 * Never overload staff Membership seats as signers or guest park members.
 */
import {
  assertModuleEnabled,
  MODULE_NOT_ENABLED_MESSAGE,
  MODULE_STOREFRONT_MESSAGE,
} from "@/lib/moduleEntitlement";
import { requireId } from "@/lib/ids";

export { MODULE_NOT_ENABLED_MESSAGE, MODULE_STOREFRONT_MESSAGE };

export async function assertWaiversEnabled(orgId: string): Promise<void> {
  const id = requireId(orgId, "orgId");
  await assertModuleEnabled(id, "waivers");
}
