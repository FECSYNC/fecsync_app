export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest, authErrorToResponse } from "@/lib/response";
import {
    addProductLineToCart,
    migrateCartToLines,
    removeProductLine,
} from "@/lib/cartLines";
import { saveCartDoc } from "@/lib/cartPersistence";
import {
    isOwnedCartDenied,
    populateOwnedCart,
    requireOwnedCart,
} from "@/lib/cartAccess";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; productId: string }> }
) {
    const { id, productId } = await params;
    await connectDB();
    try {
        const access = await requireOwnedCart(request, id);
        if (isOwnedCartDenied(access)) return access.response;
        const { cart } = access;

        const body = await request.json().catch(() => ({}));
        const quantity = Math.max(1, Math.floor(Number(body?.quantity) || 1));

        migrateCartToLines(cart);
        await addProductLineToCart(cart, {
            lineType: "product",
            product: productId,
            quantity,
            productNote: body?.productNote,
        });
        await saveCartDoc(cart);

        const populated = await populateOwnedCart(access.actor, id);
        return ok(populated);
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        const msg = error instanceof Error ? error.message : String(error);
        console.error("Add product error:", error);
        if (/available|out of stock|not found|positive integer/i.test(msg)) {
            return badRequest(msg);
        }
        return badRequest("Error adding product: " + msg);
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; productId: string }> }
) {
    const { id, productId } = await params;
    await connectDB();
    try {
        const access = await requireOwnedCart(request, id);
        if (isOwnedCartDenied(access)) return access.response;
        const { cart } = access;

        removeProductLine(cart, productId);
        await saveCartDoc(cart);

        const populated = await populateOwnedCart(access.actor, id);
        return ok(populated);
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        console.error("Delete product error:", error);
        return badRequest("Error removing product: " + error);
    }
}
