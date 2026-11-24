export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import prisma from "@/lib/prisma";
import { requireAuthActiveAccount } from "@/lib/middleware/requireAuth";
import {
  badRequest,
  ok,
  created,
  serverError,
  authErrorToResponse,
  notFound,
} from "@/lib/response";
import { storefrontOrgFilter } from "@/lib/org";
import { isValidId } from "@/lib/ids";
import { serializeReview } from "@/lib/commerceSerialize";

export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await requireAuthActiveAccount(req);
  } catch (err) {
    return authErrorToResponse(err) ?? serverError("Failed to authorize");
  }

  let body: {
    productId?: unknown;
    orderId?: unknown;
    rating?: unknown;
    comment?: unknown;
    images?: unknown;
    user?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  void body.user;

  const { productId, orderId, rating, comment, images } = body;
  if (!productId || rating == null) {
    return badRequest("Missing required fields");
  }
  if (typeof productId !== "string" || !isValidId(productId)) {
    return notFound("Product not found");
  }

  try {
    await connectDB();
    const orgFilter = await storefrontOrgFilter();
    const product = await prisma.product.findFirst({
      where: { id: productId, ...orgFilter },
      select: { id: true },
    });
    if (!product) {
      return notFound("Product not found");
    }

    const review = await prisma.review.create({
      data: {
        userId: actor.sub,
        productId,
        orderId: typeof orderId === "string" && isValidId(orderId) ? orderId : null,
        rating: Number(rating),
        comment: typeof comment === "string" ? comment : undefined,
        images: Array.isArray(images) ? images.filter((i) => typeof i === "string") : [],
      },
      include: { likes: true },
    });

    return created(serializeReview(review));
  } catch (err) {
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    console.error("Error creating review:", err);
    return badRequest("Failed to create review: " + err);
  }
}

export async function GET(req: NextRequest) {
  void req.nextUrl.searchParams.get("userId");
  const productId = req.nextUrl.searchParams.get("productId");
  if (!productId) {
    return badRequest("Missing productId");
  }
  if (!isValidId(productId)) {
    return notFound("Product not found");
  }

  try {
    await connectDB();
    const orgFilter = await storefrontOrgFilter();
    const product = await prisma.product.findFirst({
      where: { id: productId, ...orgFilter },
      select: { id: true },
    });
    if (!product) {
      return notFound("Product not found");
    }

    const reviews = await prisma.review.findMany({
      where: { productId },
      include: {
        user: {
          select: { id: true, username: true, firstName: true, lastName: true },
        },
        likes: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return ok(reviews.map(serializeReview));
  } catch (err) {
    console.error("Error fetching reviews:", err);
    return badRequest("Failed to fetch reviews: " + err);
  }
}
