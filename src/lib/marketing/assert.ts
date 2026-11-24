/**
 * Guest Marketing Automation module gate (Growth + Enterprise).
 */
import {
  assertModuleEnabled,
  MODULE_NOT_ENABLED_MESSAGE,
  MODULE_STOREFRONT_MESSAGE,
} from "@/lib/moduleEntitlement";
import { requireId } from "@/lib/ids";

export { MODULE_NOT_ENABLED_MESSAGE, MODULE_STOREFRONT_MESSAGE };

export async function assertMarketingEnabled(orgId: string): Promise<void> {
  const id = requireId(orgId, "orgId");
  await assertModuleEnabled(id, "marketing");
}
