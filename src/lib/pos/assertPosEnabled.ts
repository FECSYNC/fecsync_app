/**
 * Park POS gate. Growth and Enterprise only.
 * Does not copy the storefront-owner bypass used by ticketing.
 */
import { assertModuleEnabled } from "@/lib/moduleEntitlement";
import { requireId } from "@/lib/ids";

export async function assertPosEnabled(orgId: string): Promise<void> {
  await assertModuleEnabled(requireId(orgId, "orgId"), "pos");
}
