/**
 * Party Management rides the ticketing module (no separate module id or SKU).
 * Calls assertModuleEnabled directly so the storefront / isDefault org never
 * runs parties — the platform-owner storefront bypass in assertTicketingEnabled
 * does not apply here.
 */
import { assertModuleEnabled } from "@/lib/moduleEntitlement";

export async function assertPartiesEnabled(orgId: string): Promise<void> {
  await assertModuleEnabled(orgId, "ticketing");
}
