export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import dbConnect from "@/lib/db";
import prisma from "@/lib/prisma";
import { requireAuthActiveAccount } from "@/lib/middleware/requireAuth";
import { badRequest, ok, notFound, serverError, authErrorToResponse } from "@/lib/response";
import { normalizeAddresses } from "@/lib/models/Profile";
import type { Prisma } from "@prisma/client";
// DELETE /api/auth/profile/address/[addressId] — session user's profile only.
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ addressId: string }> }
) {
    let actor;
    try {
        actor = await requireAuthActiveAccount(req);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    const { addressId } = await params;
    if (!addressId?.trim()) {
        return notFound("Address not found");
    }

    try {
        await dbConnect();

        const profile = await prisma.profile.findUnique({
            where: { userId: actor.sub },
        });
        if (!profile) {
            return notFound("Profile not found");
        }

        const addresses = normalizeAddresses(profile.addresses);
        if (addresses.length === 0) {
            return badRequest("No addresses found in profile");
        }

        const addressIndex = addresses.findIndex(
            (a) => a._id === addressId
        );

        if (addressIndex === -1) {
            return notFound("Address not found");
        }

        addresses.splice(addressIndex, 1);

        if (
            addresses.length > 0 &&
            !addresses.some((a) => a.isDefault)
        ) {
            addresses[0].isDefault = true;
        }

        const updated = await prisma.profile.update({
            where: { id: profile.id },
            data: { addresses: addresses as unknown as Prisma.InputJsonValue },
        });

        return ok({
            message: "Address deleted successfully",
            addresses: normalizeAddresses(updated.addresses),
        });
    } catch (err) {
        const authRes = authErrorToResponse(err);
        if (authRes) return authRes;
        console.error("Delete address error:", err);
        return badRequest(
            err instanceof Error ? err.message : "Failed to delete address"
        );
    }
}
