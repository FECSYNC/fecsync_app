export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import prisma from "@/lib/prisma";
import dbConnect from "@/lib/db";
import { requireAuthActiveAccount, requirePermissionFresh, assertOwnedDocument } from "@/lib/middleware/requireAuth";
import {
    ok,
    badRequest,
    serverError,
    notFound,
    authErrorToResponse,
} from "@/lib/response";
import { NextRequest } from "next/server";
import { P } from "@/lib/auth/permissions";
import { isValidId } from "@/lib/ids";
import { stampUpdate } from "@/lib/audit/recordAudit";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
    customRequestStatusFromApi,
    customRequestStatusToApi,
    serializeCustomRequest,
} from "@/lib/commerceSerialize";
import { assertStorefrontStaffOrg } from "@/lib/staffOrg";
import type { Prisma } from "@prisma/client";

const CUSTOM_REQUEST_STATUSES = [
    "pending",
    "in-progress",
    "completed",
    "cancelled",
] as const;

function isCustomRequestStatus(
    value: string
): value is (typeof CUSTOM_REQUEST_STATUSES)[number] {
    return (CUSTOM_REQUEST_STATUSES as readonly string[]).includes(value);
}

export async function POST(req: NextRequest) {
    let actor;
    try {
        actor = await requireAuthActiveAccount(req);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    let body: {
        gender?: unknown;
        eventType?: unknown;
        style?: unknown;
        size?: unknown;
        fitType?: unknown;
        color?: unknown;
        budget?: unknown;
        description?: unknown;
        image?: unknown;
        referenceImage?: unknown;
        fabricImage?: unknown;
    };
    try {
        body = await req.json();
    } catch {
        return badRequest("Invalid JSON");
    }

    const {
        gender,
        eventType,
        style,
        size,
        fitType,
        color,
        budget,
        description,
        image,
        referenceImage,
        fabricImage,
    } = body;

    if (
        !gender ||
        !eventType ||
        !size ||
        !style ||
        !fitType ||
        !color ||
        !budget ||
        !description ||
        !image
    ) {
        return badRequest("All required fields must be provided");
    }

    try {
        await dbConnect();

        const customRequest = await prisma.customRequest.create({
            data: {
                userId: actor.sub,
                gender: gender as never,
                size: size as never,
                style: String(style),
                fitType: String(fitType),
                eventType: String(eventType),
                color: String(color),
                budget: Number(budget),
                description: String(description),
                image: String(image),
                referenceImage: Array.isArray(referenceImage)
                    ? referenceImage.filter((i) => typeof i === "string")
                    : [],
                fabricImage: fabricImage != null ? String(fabricImage) : undefined,
                history: [{ status: "pending", note: "Request created", updatedAt: new Date() }],
            },
        });

        return ok({
            message: "Custom request created successfully",
            customRequest: serializeCustomRequest(customRequest),
        });
    } catch (err) {
        const authRes = authErrorToResponse(err);
        if (authRes) return authRes;
        return serverError("Failed to create custom request: " + err);
    }
}

export async function GET(req: NextRequest) {
    let actor;
    try {
        actor = await requireAuthActiveAccount(req);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    try {
        await dbConnect();
        void req.nextUrl.searchParams;
        const requests = await prisma.customRequest.findMany({
            where: { userId: actor.sub },
            orderBy: { createdAt: "desc" },
        });
        return ok(requests.map(serializeCustomRequest));
    } catch (err) {
        const authRes = authErrorToResponse(err);
        if (authRes) return authRes;
        return serverError("Failed to fetch requests: " + err);
    }
}

export async function PATCH(req: NextRequest) {
    let actor;
    try {
        actor = await requirePermissionFresh(req, P.CustomizationsManage);
        await assertStorefrontStaffOrg(actor);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    let body: { requestId?: unknown; status?: unknown; note?: unknown };
    try {
        body = await req.json();
    } catch {
        return badRequest("Invalid JSON");
    }

    const { requestId, status, note } = body;

    if (!requestId || typeof requestId !== "string" || !status) {
        return badRequest("Request ID and status are required");
    }
    if (!isValidId(requestId)) {
        return notFound("Custom request not found");
    }
    if (typeof status !== "string" || !isCustomRequestStatus(status)) {
        return badRequest("Invalid status");
    }

    try {
        await dbConnect();

        const existing = await prisma.customRequest.findUnique({
            where: { id: requestId },
        });
        if (!existing) return notFound("Custom request not found");

        assertOwnedDocument(actor, { user: existing.userId }, [P.CustomizationsManage]);

        const audit = await stampUpdate(actor.sub);
        const prismaStatus = customRequestStatusFromApi(status);
        const history = Array.isArray(existing.history)
            ? [...(existing.history as Prisma.JsonArray)]
            : [];
        history.push({
            status,
            note: typeof note === "string" ? note : undefined,
            updatedAt: new Date().toISOString(),
        });

        const request = await prisma.customRequest.update({
            where: { id: requestId },
            data: {
                status: prismaStatus,
                updatedById: audit.updatedBy,
                updatedByName: audit.updatedByName,
                history,
            },
        });

        logStaffActivityEntry(actor, {
            action: "Customization Status Updated",
            entityType: "Customization",
            entityId: request.id,
            description: `Updated custom request status to "${customRequestStatusToApi(request.status)}"`,
            request: req,
            metadata: { status },
        });

        return ok({
            message: "Status updated successfully",
            request: serializeCustomRequest(request),
        });
    } catch (err) {
        const authRes = authErrorToResponse(err);
        if (authRes) return authRes;
        return serverError("Failed to update status: " + err);
    }
}
