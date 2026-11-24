export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest, authErrorToResponse } from "@/lib/response";
import {
    addFabricLineToCart,
    migrateCartToLines,
    removeFabricLine,
} from "@/lib/cartLines";
import { saveCartDoc } from "@/lib/cartPersistence";
import {
    isOwnedCartDenied,
    populateOwnedCart,
    requireOwnedCart,
} from "@/lib/cartAccess";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; fabricId: string }> }
) {
    const { id, fabricId } = await params;
    await connectDB();
    try {
        const access = await requireOwnedCart(request, id);
        if (isOwnedCartDenied(access)) return access.response;
        const { cart } = access;

        const body = await request.json().catch(() => ({}));
        const quantity = Math.max(1, Math.floor(Number(body?.quantity) || 1));

        migrateCartToLines(cart);
        await addFabricLineToCart(cart, {
            lineType: "fabric",
            fabric: fabricId,
            quantity,
        });
        await saveCartDoc(cart);

        const populated = await populateOwnedCart(access.actor, id);
        return ok(populated);
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        console.error("Add fabric to cart error:", error);
        const message = error instanceof Error ? error.message : String(error);
        return badRequest(message);
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; fabricId: string }> }
) {
    const { id, fabricId } = await params;
    await connectDB();
    try {
        const access = await requireOwnedCart(request, id);
        if (isOwnedCartDenied(access)) return access.response;
        const { cart } = access;

        removeFabricLine(cart, fabricId);
        await saveCartDoc(cart);

        const populated = await populateOwnedCart(access.actor, id);
        return ok(populated);
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        console.error("Remove fabric from cart error:", error);
        return badRequest("Error removing fabric: " + error);
    }
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; fabricId: string }> }
) {
    const { id, fabricId } = await params;
    await connectDB();
    try {
        const access = await requireOwnedCart(request, id);
        if (isOwnedCartDenied(access)) return access.response;
        const { cart } = access;

        const body = await request.json().catch(() => ({}));
        const quantity = Math.floor(Number(body?.quantity));
        if (!Number.isInteger(quantity) || quantity < 1) {
            return badRequest("quantity must be a positive integer");
        }

        migrateCartToLines(cart);
        removeFabricLine(cart, fabricId);
        await addFabricLineToCart(cart, {
            lineType: "fabric",
            fabric: fabricId,
            quantity,
        });
        await saveCartDoc(cart);

        const populated = await populateOwnedCart(access.actor, id);
        return ok(populated);
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        const message = error instanceof Error ? error.message : String(error);
        return badRequest(message);
    }
}
