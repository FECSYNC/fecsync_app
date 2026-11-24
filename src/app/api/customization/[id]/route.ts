export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import prisma from "@/lib/prisma";
import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, notFound, badRequest, authErrorToResponse } from "@/lib/response";
import { P, hasPermission } from "@/lib/auth/permissions";
import {
    isCustomizationAccessDenied,
    pickCustomizationFields,
    requireCustomizationAccess,
} from "@/lib/customizationAccess";
import { stampUpdate } from "@/lib/audit/recordAudit";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import { prismaOwnedByFilter, serializeCustomization } from "@/lib/commerceSerialize";

function customizationWriteWhere(
    actor: { sub: string; permissions?: Iterable<string> | null },
    id: string
) {
    if (hasPermission(actor.permissions, P.CustomizationsManage)) {
        return { id };
    }
    return { id, ...prismaOwnedByFilter(actor) };
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    await connectDB();

    try {
        const access = await requireCustomizationAccess(request, id, [
            P.CustomizationsRead,
        ]);
        if (isCustomizationAccessDenied(access)) return access.response;

        const row = await prisma.customization.findUnique({
            where: { id },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                    },
                },
            },
        });

        return ok(row ? serializeCustomization(row) : access.customization);
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        console.error("Failed to fetch customization:", error);
        return badRequest("Failed to fetch customization: " + error);
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    await connectDB();

    try {
        const access = await requireCustomizationAccess(
            request,
            id,
            [P.CustomizationsManage],
            { refreshMembership: true }
        );
        if (isCustomizationAccessDenied(access)) return access.response;
        const { actor } = access;

        let body: Record<string, unknown>;
        try {
            body = await request.json();
        } catch {
            return badRequest("Invalid JSON");
        }

        const fields = pickCustomizationFields(body);
        const isStaffManage = hasPermission(
            actor.permissions,
            P.CustomizationsManage
        );
        const data: Record<string, unknown> = { ...fields };
        if (isStaffManage) {
            const audit = await stampUpdate(actor.sub);
            data.updatedById = audit.updatedBy;
            data.updatedByName = audit.updatedByName;
        }

        const updatedCount = await prisma.customization.updateMany({
            where: customizationWriteWhere(actor, id),
            data: data as never,
        });
        if (updatedCount.count === 0) {
            return notFound("Customization request not found");
        }

        const updated = await prisma.customization.findFirst({
            where: { id },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                    },
                },
            },
        });
        if (!updated) {
            return notFound("Customization request not found");
        }

        const serialized = serializeCustomization(updated);
        if (isStaffManage) {
            logStaffActivityEntry(actor, {
                action: "Customization Updated",
                entityType: "Customization",
                entityId: serialized._id,
                description: `Updated customization ${id}`,
                request,
            });
        }
        return ok(serialized);
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        return badRequest("Invalid customization data: " + error);
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    await connectDB();

    try {
        const access = await requireCustomizationAccess(
            request,
            id,
            [P.CustomizationsManage],
            { refreshMembership: true }
        );
        if (isCustomizationAccessDenied(access)) return access.response;

        const deleted = await prisma.customization.deleteMany({
            where: customizationWriteWhere(access.actor, id),
        });
        if (deleted.count === 0) {
            return notFound("Customization request not found");
        }
        logStaffActivityEntry(access.actor, {
            action: "Customization Deleted",
            entityType: "Customization",
            entityId: id,
            description: "Deleted customization request",
            request,
        });
        return ok(access.customization);
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        return badRequest("Error deleting customization: " + error);
    }
}
