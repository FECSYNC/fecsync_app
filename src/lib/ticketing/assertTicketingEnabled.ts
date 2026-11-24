/**
 * Thin ticketing-specific wrapper around assertModuleEnabled.
 * Platform software owner may run ticketing on the storefront host org.
 */
import {
  assertModuleEnabled,
  MODULE_NOT_ENABLED_MESSAGE,
  MODULE_STOREFRONT_MESSAGE,
} from "@/lib/moduleEntitlement";
import type { PlatformOwnerActor } from "@/lib/platformSoftwareOwner";
import { resolveIsPlatformSoftwareOwner } from "@/lib/resolvePlatformSoftwareOwner";
import { assertOrganizationActive } from "@/lib/org";
import { requireId } from "@/lib/ids";

export { MODULE_NOT_ENABLED_MESSAGE, MODULE_STOREFRONT_MESSAGE };

export async function assertTicketingEnabled(
  orgId: string,
  actor?: PlatformOwnerActor | null
): Promise<void> {
  const id = requireId(orgId, "orgId");
  if (actor && (await resolveIsPlatformSoftwareOwner(actor))) {
    const ownerOrg =
      typeof actor.orgId === "string" ? actor.orgId.trim() : "";
    if (ownerOrg && ownerOrg === id) {
      await assertOrganizationActive(id);
      return;
    }
  }
  await assertModuleEnabled(id, "ticketing");
}
