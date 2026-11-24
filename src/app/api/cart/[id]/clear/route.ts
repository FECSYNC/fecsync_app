export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest, authErrorToResponse } from "@/lib/response";
import { clearAllCartLines } from "@/lib/cartLines";
import { saveCartDoc } from "@/lib/cartPersistence";
import { isOwnedCartDenied, requireOwnedCart } from "@/lib/cartAccess";

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    await connectDB();
    try {
        const access = await requireOwnedCart(request, id);
        if (isOwnedCartDenied(access)) return access.response;
        const { cart } = access;

        clearAllCartLines(cart);
        const saved = await saveCartDoc(cart);

        return ok({ message: "Cart cleared successfully", cart: saved });
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        console.error("Clear cart error:", error);
        return badRequest("Error clearing cart: " + error);
    }
}
