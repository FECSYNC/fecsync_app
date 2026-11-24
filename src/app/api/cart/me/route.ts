export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, created, serverError, badRequest, authErrorToResponse } from "@/lib/response";
import { requireAuthActiveAccount } from "@/lib/middleware/requireAuth";
import {
    type CartLineInput,
} from "@/lib/cartLines";
import {
    addLinesToUserCart,
    isTransientMongoError,
    persistLegacyCartSync,
} from "@/lib/cartPersistence";
import { loadCartDocById } from "@/lib/cartLines";
import { prismaOwnedByFilter } from "@/lib/commerceSerialize";
import prisma from "@/lib/prisma";

export async function GET(request: NextRequest) {
    let decoded;
    try {
        decoded = await requireAuthActiveAccount(request);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    await connectDB();

    try {
        const row = await prisma.cart.findFirst({
            where: prismaOwnedByFilter(decoded),
            orderBy: { createdAt: "desc" },
        });

        if (!row) {
            return ok({ cart: { products: [], lines: [] } });
        }

        const cart = await loadCartDocById(row.id, decoded.sub);
        if (cart) {
            await persistLegacyCartSync(cart);
        }

        return ok({ cart: cart ?? { products: [], lines: [] } });
    } catch (error) {
        console.error("Cart fetch error:", error);
        if (isTransientMongoError(error)) {
            return serverError(
                "Database temporarily unavailable. Please refresh and try again."
            );
        }
        return serverError("Failed to fetch cart: " + error);
    }
}

export async function POST(request: NextRequest) {
    let decoded;
    try {
        decoded = await requireAuthActiveAccount(request);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return badRequest("Invalid JSON");
    }

    if (!Array.isArray(body) || body.length === 0) {
        return badRequest("Request body must be a non-empty array of cart lines");
    }

    try {
        await connectDB();

        const { cart, created: isNewCart } = await addLinesToUserCart(
            decoded.sub,
            body as CartLineInput[]
        );
        const populated = await loadCartDocById(cart.id, decoded.sub);

        return isNewCart ? created(populated) : ok(populated);
    } catch (error) {
        console.error("Cart add error:", error);
        if (isTransientMongoError(error)) {
            return serverError(
                "Database temporarily unavailable. Please wait a moment and try again."
            );
        }
        const message = error instanceof Error ? error.message : String(error);
        return badRequest(message);
    }
}
