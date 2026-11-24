export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import prisma from "@/lib/prisma";
import dbConnect from "@/lib/db";
import { NextRequest } from "next/server";
import { requireAuthActiveAccount } from "@/lib/middleware/requireAuth";
import { prismaOwnedByFilter, serializeWishlist } from "@/lib/commerceSerialize";
import { ok, badRequest, notFound, serverError, authErrorToResponse } from "@/lib/response";
import { storefrontOrgFilter } from "@/lib/org";
import { isValidId } from "@/lib/ids";

export async function POST(req: NextRequest) {
    let decoded;
    try {
        decoded = await requireAuthActiveAccount(req);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    let body: { productId?: unknown };
    try {
        body = await req.json();
    } catch {
        return badRequest("Invalid JSON");
    }

    const productId = body?.productId;
    if (!productId || typeof productId !== "string" || !isValidId(productId)) {
        return badRequest("Product ID is required");
    }

    try {
        await dbConnect();

        const orgFilter = await storefrontOrgFilter();
        const product = await prisma.product.findFirst({
            where: { id: productId, ...orgFilter },
        });
        if (!product) {
            return notFound("Product not found");
        }

        let wishlist = await prisma.wishlist.findFirst({
            where: prismaOwnedByFilter(decoded),
            include: { items: true },
        });

        if (!wishlist) {
            wishlist = await prisma.wishlist.create({
                data: {
                    userId: decoded.sub,
                    items: { create: [{ productId }] },
                },
                include: { items: true },
            });
            return ok({
                message: "Product added to wishlist",
                wishlist: serializeWishlist(wishlist),
                added: true,
            });
        }

        const existingItem = wishlist.items.find((i) => i.productId === productId);

        if (existingItem) {
            await prisma.wishlistItem.delete({ where: { id: existingItem.id } });
            const refreshed = await prisma.wishlist.findUniqueOrThrow({
                where: { id: wishlist.id },
                include: { items: true },
            });
            return ok({
                message: "Product removed from wishlist",
                wishlist: serializeWishlist(refreshed),
                added: false,
            });
        }

        await prisma.wishlistItem.create({
            data: { wishlistId: wishlist.id, productId },
        });
        const refreshed = await prisma.wishlist.findUniqueOrThrow({
            where: { id: wishlist.id },
            include: { items: true },
        });
        return ok({
            message: "Product added to wishlist",
            wishlist: serializeWishlist(refreshed),
            added: true,
        });
    } catch (err) {
        console.error("Wishlist update error:", err);
        return serverError("Failed to update wishlist");
    }
}

export async function GET(req: NextRequest) {
    let decoded;
    try {
        decoded = await requireAuthActiveAccount(req);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    try {
        await dbConnect();

        const wishlist = await prisma.wishlist.findFirst({
            where: prismaOwnedByFilter(decoded),
            include: { items: true },
        });
        if (!wishlist || wishlist.items.length === 0) {
            return ok(wishlist ? serializeWishlist(wishlist) : null);
        }

        const orgFilter = await storefrontOrgFilter();
        const products = await prisma.product.findMany({
            where: {
                id: { in: wishlist.items.map((i) => i.productId) },
                ...orgFilter,
            },
        });

        return ok(
            products.map((p) => ({ ...p, _id: p.id }))
        );
    } catch (err) {
        console.error("Wishlist fetch error:", err);
        return serverError("Failed to fetch wishlist");
    }
}
