/**
 * Owner-or-staff access for /api/customization/[id].
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import {
  requireAuthActiveAccount,
  requireAuthFresh,
} from "@/lib/middleware/requireAuth";
import { ownsResource, type NormalizedAccessToken } from "@/lib/auth/claims";
import { hasAnyPermission, type Permission } from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  serializeCustomization,
  type SerializedCustomization,
} from "@/lib/commerceSerialize";
import { authErrorToResponse, notFound, serverError } from "@/lib/response";
import { assertStorefrontStaffOrg } from "@/lib/staffOrg";
import { assertOrganizationActive } from "@/lib/org";

export type OwnedCustomizationResult =
  | { actor: NormalizedAccessToken; customization: SerializedCustomization }
  | { response: NextResponse };

export function isCustomizationAccessDenied(
  value: OwnedCustomizationResult
): value is { response: NextResponse } {
  return "response" in value;
}

export async function requireCustomizationAccess(
  request: NextRequest,
  id: string,
  allowPermissions: readonly Permission[],
  options?: { refreshMembership?: boolean }
): Promise<OwnedCustomizationResult> {
  let actor: NormalizedAccessToken;
  try {
    // Default Fresh so demotion / permission revoke cannot keep stale staff access.
    const useFresh = options?.refreshMembership !== false;
    actor = useFresh
      ? await requireAuthFresh(request, { allowSuspendedOrg: true })
      : await requireAuthActiveAccount(request);
  } catch (err) {
    return {
      response: authErrorToResponse(err) ?? serverError("Failed to authorize"),
    };
  }

  if (!isValidId(id)) {
    return { response: notFound("Customization request not found") };
  }

  let row;
  try {
    row = await prisma.customization.findUnique({ where: { id } });
  } catch (err) {
    console.error("Load customization error:", err);
    return { response: serverError("Failed to load customization") };
  }

  if (!row) {
    return { response: notFound("Customization request not found") };
  }

  try {
    // Owners always access their own. Staff without ownership must be on the
    // storefront org (Customization has no orgId — no cross-company list/detail).
    if (ownsResource(actor, row.userId)) {
      /* owner — allowed even when company Membership is suspended */
    } else if (hasAnyPermission(actor.permissions, allowPermissions)) {
      if (actor.orgId) {
        await assertOrganizationActive(actor.orgId);
      }
      await assertStorefrontStaffOrg(actor);
    } else {
      throw new ForbiddenError("Forbidden");
    }
  } catch (err) {
    return {
      response: authErrorToResponse(err) ?? serverError("Failed to authorize"),
    };
  }

  return { actor, customization: serializeCustomization(row) };
}

export const CUSTOMIZATION_WRITE_FIELDS = [
  "outfit",
  "outfitOption",
  "fabricType",
  "size",
  "preferredColor",
  "additionalNotes",
  "productId",
  "referenceImage",
  "fabricImage",
  "selections",
] as const;

export function pickCustomizationFields(
  body: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (!body) return fields;
  for (const key of CUSTOMIZATION_WRITE_FIELDS) {
    if (body[key] !== undefined) {
      fields[key] = body[key];
    }
  }
  return fields;
}
