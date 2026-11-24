export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import prisma from "@/lib/prisma";
import { ok, badRequest, notFound, serverError, authErrorToResponse } from "@/lib/response";
import { requireAuthActiveAccount, requireAuthFresh, assertOwnedDocument } from "@/lib/middleware/requireAuth";
import { P, hasPermission } from "@/lib/auth/permissions";
import { ownsResource, type NormalizedAccessToken } from "@/lib/auth/claims";
import { prismaOwnedByFilter } from "@/lib/commerceSerialize";
import { isValidId } from "@/lib/ids";
import {
    assertActorOrgMatch,
    requireActorOrgId,
    assertStaffProductOwnScope,
} from "@/lib/staffOrg";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import { serializeReview } from "@/lib/commerceSerialize";
import { assertOrganizationActive } from "@/lib/org";

function reviewWriteWhere(
    actor: { sub: string; permissions?: Iterable<string> | null },
    id: string
) {
    if (hasPermission(actor.permissions, P.ReviewsModerate)) {
        return { id };
    }
    return { id, ...prismaOwnedByFilter(actor) };
}

/**
 * Owner edits own review freely.
 * Moderators: product must be in actor.orgId; CWV=false also requires
 * product own-scope (sellerId/createdById) so moderate cannot exceed catalog CWV.
 */
async function assertModeratorProductOrg(
    actor: NormalizedAccessToken,
    reviewOwner: unknown,
    productId: unknown
): Promise<ReturnType<typeof authErrorToResponse> | ReturnType<typeof notFound> | null> {
    if (ownsResource(actor, reviewOwner)) {
        return null;
    }
    if (!hasPermission(actor.permissions, P.ReviewsModerate)) {
        return null;
    }
    const id = String(productId ?? "");
    if (!isValidId(id)) {
        return notFound("Review not found");
    }
    const product = await prisma.product.findUnique({
        where: { id },
        select: { orgId: true, sellerId: true, createdById: true },
    });
    if (!product) {
        return notFound("Review not found");
    }
    try {
        if (actor.orgId) {
            await assertOrganizationActive(actor.orgId);
        }
        assertActorOrgMatch(requireActorOrgId(actor), product.orgId);
        assertStaffProductOwnScope(actor, product);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }
    return null;
}

export async function PATCH(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const { id } = await context.params;

    let actor;
    try {
        actor = await requireAuthActiveAccount(req);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    if (!isValidId(id)) {
        return notFound("Review not found");
    }

    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        body = {};
    }

    try {
        await connectDB();
        const review = await prisma.review.findUnique({
            where: { id },
            include: { likes: true },
        });
        if (!review) return notFound("Review not found");

        if (Object.keys(body).length === 0) {
            const existingLike = await prisma.reviewLike.findUnique({
                where: { reviewId_userId: { reviewId: id, userId: actor.sub } },
            });
            if (existingLike) {
                await prisma.reviewLike.delete({ where: { id: existingLike.id } });
            } else {
                await prisma.reviewLike.create({
                    data: { reviewId: id, userId: actor.sub },
                });
            }
            const updated = await prisma.review.findUniqueOrThrow({
                where: { id },
                include: { likes: true },
            });
            return ok({ message: "Like toggled", review: serializeReview(updated) });
        }

        try {
            actor = await requireAuthFresh(req, { allowSuspendedOrg: true });
            if (!hasPermission(actor.permissions, P.ReviewsModerate)) {
                assertOwnedDocument(actor, { user: review.userId });
            }
        } catch (err) {
            return authErrorToResponse(err) ?? serverError("Failed to authorize");
        }

        const orgDenied = await assertModeratorProductOrg(
            actor,
            review.userId,
            review.productId
        );
        if (orgDenied) return orgDenied;

        void body.user;
        const data: { rating?: number; comment?: string } = {};
        if (body.rating !== undefined) data.rating = Number(body.rating);
        if (body.comment !== undefined) data.comment = String(body.comment);

        const updated = await prisma.review.update({
            where: { id },
            data,
            include: { likes: true, user: { select: { id: true, username: true, firstName: true, lastName: true } } },
        });

        return ok({ message: "Review updated successfully", review: serializeReview(updated) });
    } catch (err: unknown) {
        const authRes = authErrorToResponse(err);
        if (authRes) return authRes;
        console.error("Error updating review:", err);
        return badRequest(`Failed to update review: ${err}`);
    }
}

export async function DELETE(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const { id } = await context.params;

    let actor;
    try {
        actor = await requireAuthActiveAccount(req);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    if (!isValidId(id)) {
        return notFound("Review not found");
    }

    try {
        await connectDB();
        const existing = await prisma.review.findUnique({
            where: { id },
            select: { userId: true, productId: true },
        });
        if (!existing) return notFound("Review not found");

        try {
            actor = await requireAuthFresh(req, { allowSuspendedOrg: true });
            if (!hasPermission(actor.permissions, P.ReviewsModerate)) {
                assertOwnedDocument(actor, { user: existing.userId });
            }
        } catch (err) {
            return authErrorToResponse(err) ?? serverError("Failed to authorize");
        }

        const orgDenied = await assertModeratorProductOrg(
            actor,
            existing.userId,
            existing.productId
        );
        if (orgDenied) return orgDenied;

        const deleted = await prisma.review.deleteMany({
            where: reviewWriteWhere(actor, id),
        });
        if (deleted.count === 0) return notFound("Review not found");

        const isOwner = ownsResource(actor, existing.userId);
        const isModerator =
            !isOwner && hasPermission(actor.permissions, P.ReviewsModerate);
        if (isModerator) {
            logStaffActivityEntry(actor, {
                action: "Review Deleted",
                entityType: "Review",
                entityId: id,
                description: "Staff moderated review deleted",
                request: req,
                metadata: {
                    productId: existing.productId,
                },
            });
        }

        return ok({ message: "Review deleted successfully", review: { _id: id } });
    } catch (err: unknown) {
        const authRes = authErrorToResponse(err);
        if (authRes) return authRes;
        console.error("Error deleting review:", err);
        return badRequest(`Failed to delete review: ${err}`);
    }
}
