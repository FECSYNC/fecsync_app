/**
 * Shared park-lock deny for company-HQ-only admin surfaces (billing, profile, …).
 * Also used for staff-admin lifecycle that must stay company-wide (invite seats,
 * archive venues, role templates) — park-locked seats operate parks, not HQ.
 */
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  resolveEffectiveParkScope,
  type ParkAdminActor,
} from "@/lib/parkAdminScope";

export const PARK_LOCKED_COMPANY_HQ_MESSAGE =
  "Park-locked admins cannot access company HQ surfaces";

export const PARK_LOCKED_STAFF_ADMIN_MESSAGE =
  "Park-locked admins cannot manage company-wide staff or role templates";

export async function assertNotParkLockedCompanyHq(
  actor: ParkAdminActor,
  message: string = PARK_LOCKED_COMPANY_HQ_MESSAGE
): Promise<void> {
  const scope = await resolveEffectiveParkScope(actor);
  if (scope.parkLocked) {
    throw new ForbiddenError(message);
  }
}
