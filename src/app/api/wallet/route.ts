export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import prisma from "@/lib/prisma";
import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, created, badRequest, serverError, authErrorToResponse } from "@/lib/response";
import { requireAuthActiveAccount, requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { prismaOwnedByFilter, serializeWallet, walletWithTransactionsInclude } from "@/lib/commerceSerialize";
import { P } from "@/lib/auth/permissions";
import { ensureOwnedWallet } from "@/lib/wallet";
import { assertStorefrontStaffOrg } from "@/lib/staffOrg";

export async function GET(request: NextRequest) {
    let actor;
    try {
        actor = await requirePermissionFresh(request, P.WalletRead);
        await assertStorefrontStaffOrg(actor);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    await connectDB();
    try {
        // No Wallet.orgId — storefront staff only (not registered companies).
        const wallets = await prisma.wallet.findMany({
            include: {
                ...walletWithTransactionsInclude,
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
        const data = wallets.map((w) => ({
            ...serializeWallet(w),
            user: w.user
                ? { ...w.user, _id: w.user.id }
                : w.userId,
        }));
        return ok({
            success: true,
            message: "Wallets fetched successfully",
            data,
        });
    } catch (error) {
        console.error("Failed to fetch wallets:", error);
        return badRequest("Failed to fetch wallets: " + error);
    }
}

export async function POST(request: NextRequest) {
    let actor;
    try {
        actor = await requireAuthActiveAccount(request);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    try {
        await connectDB();
        const existingWallet = await prisma.wallet.findFirst({
            where: prismaOwnedByFilter(actor),
        });
        if (existingWallet) {
            return badRequest("Wallet already exists for this user.");
        }

        const newWallet = await ensureOwnedWallet(actor.sub);

        return created({
            success: true,
            message: "Wallet created successfully",
            data: newWallet,
        });
    } catch (error) {
        console.error("Failed to create wallet:", error);
        return serverError("Failed to create wallet: " + error);
    }
}
