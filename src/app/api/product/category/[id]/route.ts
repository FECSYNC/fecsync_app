export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import connectDB from "@/lib/db";
import { ok, notFound, serverError } from "@/lib/response";
import { isProductObjectId } from "@/lib/productWrite";
import { getStorefrontOrgId } from "@/lib/org";
import {
  slimCatalogImages,
  toStorefrontFabricImage,
} from "@/lib/catalogImages";
import {
  PRODUCT_CATALOG_INCLUDE,
  shapeProductForApi,
  findCategoryInOrg,
} from "@/lib/productPopulate";

// GET /api/product/category/[id] — public storefront list by category.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isProductObjectId(id)) {
    return notFound("No products found for this category");
  }
  try {
    await connectDB();
    const orgId = await getStorefrontOrgId();
    const category = await findCategoryInOrg(orgId, id);
    if (!category) {
      return notFound("No products found for this category");
    }

    const products = await prisma.product.findMany({
      where: { orgId, categoryId: category.id },
      include: PRODUCT_CATALOG_INCLUDE,
    });

    if (!products || products.length === 0) {
      return notFound("No products found for this category");
    }

    const slimmed = products.map((product) => {
      const shaped = shapeProductForApi(product);
      return {
        ...shaped,
        images: slimCatalogImages(shaped.images, 480),
        fabricType:
          product.fabricType && typeof product.fabricType === "object"
            ? toStorefrontFabricImage(
                { ...product.fabricType, _id: product.fabricType.id },
                320
              )
            : shaped.fabricType,
      };
    });

    const response = ok(slimmed);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return serverError(
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}
