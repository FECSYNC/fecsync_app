export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import prisma from "@/lib/prisma";
import { ok, created, badRequest, serverError, authErrorToResponse } from "@/lib/response";
import { requireAuthActiveAccount, requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { serializeCart } from "@/lib/commerceSerialize";
import { assertStorefrontStaffOrg } from "@/lib/staffOrg";

export async function GET(request: NextRequest) {
    let actor;
    try {
        actor = await requirePermissionFresh(request, P.CartRead);
        await assertStorefrontStaffOrg(actor);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    await connectDB();
    try {
        // No Cart.orgId — storefront staff only (not registered companies).
        const carts = await prisma.cart.findMany({
            orderBy: { createdAt: "desc" },
            include: { lines: true },
        });
        return ok(carts.map(serializeCart));
    } catch (error) {
        console.error("Failed to fetch carts:", error);
        return badRequest("Failed to fetch carts: " + error);
    }
}

export async function POST(request: NextRequest) {
    let actor;
    try {
        actor = await requireAuthActiveAccount(request);
    } catch (err) {
        return authErrorToResponse(err) ?? serverError("Failed to authorize");
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return badRequest("Invalid JSON");
    }

    const products = Array.isArray(body)
        ? body
        : Array.isArray((body as { products?: unknown })?.products)
          ? (body as { products: unknown[] }).products
          : [];

    try {
        await connectDB();
        if (products.length > 0) {
            const { addLinesToUserCart } = await import("@/lib/cartPersistence");
            const { cart, created: wasCreated } = await addLinesToUserCart(
                actor.sub,
                products as never
            );
            return wasCreated ? created(cart) : ok(cart);
        }

        const existing = await prisma.cart.findFirst({
            where: { userId: actor.sub },
            include: { lines: true },
            orderBy: { createdAt: "desc" },
        });
        if (existing) {
            return ok(serializeCart(existing));
        }

        try {
            const newCart = await prisma.cart.create({
                data: { userId: actor.sub },
                include: { lines: true },
            });
            return created(serializeCart(newCart));
        } catch (createErr: unknown) {
            const code =
                createErr &&
                typeof createErr === "object" &&
                "code" in createErr
                    ? (createErr as { code?: string }).code
                    : undefined;
            if (code === "P2002") {
                const raced = await prisma.cart.findFirst({
                    where: { userId: actor.sub },
                    include: { lines: true },
                    orderBy: { createdAt: "desc" },
                });
                if (raced) return ok(serializeCart(raced));
            }
            throw createErr;
        }
    } catch (error) {
        console.error("Create cart error:", error);
        return badRequest("Invalid cart data: " + error);
    }
}
