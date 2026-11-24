export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import prisma from "@/lib/prisma";
import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, notFound, badRequest, authErrorToResponse } from "@/lib/response";
import { prismaOwnedByFilter } from "@/lib/commerceSerialize";
import { isOwnedWalletDenied, requireOwnedWallet } from "@/lib/walletAccess";
import { serializeWallet } from "@/lib/commerceSerialize";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    await connectDB();

    try {
        const access = await requireOwnedWallet(request, id);
        if (isOwnedWalletDenied(access)) return access.response;
        return ok({
            success: true,
            message: "Wallet fetched successfully",
            data: access.wallet,
        });
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        console.error("Failed to fetch wallet:", error);
        return badRequest("Failed to fetch wallet: " + error);
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    await connectDB();

    const access = await requireOwnedWallet(request, id);
    if (isOwnedWalletDenied(access)) return access.response;

    let body: { beneficiary?: unknown };
    try {
        body = await request.json();
    } catch {
        return badRequest("Invalid JSON");
    }

    try {
        if (!Array.isArray(body?.beneficiary)) {
            return badRequest("Only beneficiary updates are allowed");
        }

        const updated = await prisma.wallet.updateMany({
            where: { id, ...prismaOwnedByFilter(access.actor) },
            data: { beneficiary: body.beneficiary },
        });
        if (updated.count === 0) {
            return notFound("Wallet not found");
        }

        const wallet = await prisma.wallet.findFirst({
            where: { id, ...prismaOwnedByFilter(access.actor) },
            include: { transactions: { orderBy: { date: "desc" } } },
        });

        return ok({
            success: true,
            message: "Wallet updated successfully",
            data: wallet ? serializeWallet(wallet) : access.wallet,
        });
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        console.error("Failed to update wallet:", error);
        return badRequest("Invalid wallet data: " + error);
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    await connectDB();

    try {
        const access = await requireOwnedWallet(request, id);
        if (isOwnedWalletDenied(access)) return access.response;

        const deleted = await prisma.wallet.deleteMany({
            where: { id, ...prismaOwnedByFilter(access.actor) },
        });
        if (deleted.count === 0) {
            return notFound("Wallet not found");
        }

        return ok({
            success: true,
            message: "Wallet deleted successfully",
            data: access.wallet,
        });
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        console.error("Failed to delete wallet:", error);
        return badRequest("Failed to delete wallet: " + error);
    }
}
