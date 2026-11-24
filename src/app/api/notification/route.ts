export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import prisma from "@/lib/prisma";
import { ok, badRequest, notFound, serverError, authErrorToResponse } from "@/lib/response";
import { requireAuthActiveAccount, assertOwnedDocument } from "@/lib/middleware/requireAuth";
import { NextRequest } from "next/server";
import { isValidId, withMongoIdAlias } from "@/lib/ids";

/*
 * Step 3.5 checklist (no test runner):
 * - GET /api/notification → requireAuth + ownedByFilter; ignore ?userId=.
 * - PATCH mark-read → requireAuth + owner (403 IDOR). Never findByIdAndUpdate(id) alone.
 * - POST /api/reviews → requireAuth; user=sub. GET ?productId= stays public (no auth).
 * - PATCH/DELETE /api/reviews/[id] → owner OR reviews:moderate. Like-toggle is any auth user.
 * - Profile/picture/address/me → session user only. Never body.user / body.role.
 * - Fashion-chat GET/POST when authenticated → user=sub only. Guest stays IP-keyed.
 * - Logout clears ['fashionChat'] cache (account-switch).
 * - Live guards use requireAuth + ownership (staff lack *_own); not requirePermission(*_own).
 */

// GET /api/notification — own rows only. Ignore ?userId=.
export async function GET(req: NextRequest) {
    let actor;
    try {
        actor = await requireAuthActiveAccount(req);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    void req.nextUrl.searchParams.get("userId");

    try {
        const notifications = await prisma.notification.findMany({
            where: { userId: actor.sub },
            select: {
                id: true,
                title: true,
                message: true,
                type: true,
                read: true,
                metadata: true,
                createdAt: true,
                updatedAt: true,
                userId: true,
            },
            orderBy: { createdAt: "desc" },
            take: 50,
        });

        return ok({
            notifications: notifications.map((n) =>
                withMongoIdAlias({ ...n, user: n.userId })
            ),
        });
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        console.error("Fetch notifications error:", error);
        return badRequest("Failed to fetch notifications");
    }
}

// PATCH /api/notification — mark own notification read, or markAll.
export async function PATCH(req: NextRequest) {
    let actor;
    try {
        actor = await requireAuthActiveAccount(req);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    let body: { id?: unknown; markAll?: unknown };
    try {
        body = await req.json();
    } catch {
        return badRequest("Invalid JSON");
    }

    if (body?.markAll === true) {
        try {
            const result = await prisma.notification.updateMany({
                where: { userId: actor.sub, read: false },
                data: { read: true },
            });
            return ok({
                message: "All notifications marked as read",
                data: { modifiedCount: result.count },
            });
        } catch (error) {
            const authRes = authErrorToResponse(error);
            if (authRes) return authRes;
            console.error("Mark all notifications error:", error);
            return badRequest("Failed to mark notifications as read");
        }
    }

    const id = body?.id;
    if (!id || typeof id !== "string") {
        return badRequest("Notification id is required");
    }
    if (!isValidId(id)) {
        return notFound("Notification not found");
    }

    try {
        const existing = await prisma.notification.findUnique({
            where: { id },
            select: { userId: true },
        });
        if (!existing) {
            return notFound("Notification not found");
        }
        try {
            assertOwnedDocument(actor, { user: existing.userId });
        } catch (err) {
            return authErrorToResponse(err) ?? serverError("Failed to authorize");
        }

        await prisma.notification.updateMany({
            where: { id, userId: actor.sub },
            data: { read: true },
        });
        return ok({ message: "Notification marked as read" });
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        console.error("Update notification error:", error);
        return badRequest("Failed to update notification");
    }
}

// DELETE /api/notification — delete own notification by id in body.
export async function DELETE(req: NextRequest) {
    let actor;
    try {
        actor = await requireAuthActiveAccount(req);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    let body: { id?: unknown };
    try {
        body = await req.json();
    } catch {
        return badRequest("Invalid JSON");
    }

    const id = body?.id;
    if (!id || typeof id !== "string" || !isValidId(id)) {
        return badRequest("Notification id is required");
    }

    try {
        const result = await prisma.notification.deleteMany({
            where: { id, userId: actor.sub },
        });
        if (result.count === 0) {
            return notFound("Notification not found");
        }
        return ok({ message: "Notification deleted" });
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        console.error("Delete notification error:", error);
        return badRequest("Failed to delete notification");
    }
}
