/**
 * Step 4 — Harewa storefront actor acting on another company workspace.
 * ActivityLog.orgId stays the actor (storefront) for Recent Activity;
 * metadata.targetOrgId identifies the tenant under management.
 */

import type { NextRequest } from "next/server";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import { requireId } from "@/lib/ids";

export function logPlatformActionOnCompany(
  actor: { sub?: string | null; orgId?: string | null },
  input: {
    action: string;
    targetOrgId: string;
    entityType?: string;
    description: string;
    request?: NextRequest;
    metadata?: Record<string, unknown>;
  }
): void {
  const targetOrgId = requireId(input.targetOrgId, "targetOrgId");
  logStaffActivityEntry(actor, {
    action: input.action,
    entityType: input.entityType ?? "Settings",
    entityId: targetOrgId,
    description: input.description.slice(0, 500),
    request: input.request,
    metadata: {
      ...input.metadata,
      // Force after spread so callers cannot strip tenancy audit fields.
      domain: "platform-ops",
      targetOrgId,
    },
  });
}
