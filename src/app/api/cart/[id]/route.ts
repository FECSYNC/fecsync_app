export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import prisma from "@/lib/prisma";
import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, notFound, badRequest, authErrorToResponse } from "@/lib/response";
import { migrateCartToLines, syncLegacyProductsField, assertCartDocStock } from "@/lib/cartLines";
import { prismaOwnedByFilter } from "@/lib/commerceSerialize";
import { saveCartDoc } from "@/lib/cartPersistence";
import { isOwnedCartDenied, requireOwnedCart } from "@/lib/cartAccess";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    await connectDB();

    try {
        const access = await requireOwnedCart(request, id);
        if (isOwnedCartDenied(access)) return access.response;
        return ok(access.cart);
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        console.error("Failed to fetch cart:", error);
        return badRequest("Failed to fetch cart");
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    await connectDB();

    const access = await requireOwnedCart(request, id);
    if (isOwnedCartDenied(access)) return access.response;
    const { cart } = access;

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return badRequest("Invalid JSON");
    }

    try {
        if (Array.isArray((body as { lines?: unknown })?.lines)) {
            cart.lines = (body as { lines: typeof cart.lines }).lines;
            migrateCartToLines(cart);
            syncLegacyProductsField(cart);
        } else if (Array.isArray(body)) {
            cart.lines = (body as typeof cart.lines);
            migrateCartToLines(cart);
            syncLegacyProductsField(cart);
        } else if (Array.isArray((body as { products?: unknown })?.products)) {
            const products = (body as { products: Array<{ product: string; quantity: number; productNote?: string[] }> }).products;
            cart.lines = products.map((p) => ({
                _id: `tmp-${p.product}`,
                lineType: "product" as const,
                product: p.product,
                quantity: p.quantity,
                productNote: p.productNote ?? [],
            }));
            syncLegacyProductsField(cart);
        } else {
            return badRequest("Expected lines array or products array");
        }

        await assertCartDocStock(cart);
        const saved = await saveCartDoc(cart);
        return ok(saved);
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        const msg = error instanceof Error ? error.message : String(error);
        console.error("Update error:", error);
        if (
            /available|out of stock|not found|positive integer/i.test(msg)
        ) {
            return badRequest(msg);
        }
        return badRequest("Invalid cart data: " + msg);
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    await connectDB();
    try {
        const access = await requireOwnedCart(request, id);
        if (isOwnedCartDenied(access)) return access.response;

        const deleted = await prisma.cart.deleteMany({
            where: { id, ...prismaOwnedByFilter(access.actor) },
        });
        if (deleted.count === 0) {
            return notFound("Cart not found");
        }
        return ok(access.cart);
    } catch (error) {
        const authRes = authErrorToResponse(error);
        if (authRes) return authRes;
        return badRequest("Error deleting cart: " + error);
    }
}
