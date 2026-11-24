import prisma from "@/lib/prisma";

type CategoryDoc = {
  _id?: unknown;
  id?: string;
  [key: string]: unknown;
};

export type CategoryWithProductCounts<T extends CategoryDoc> = T & {
  /** Shop products linked to this category. */
  productCount: number;
  shopProductCount: number;
  /** @deprecated Booking categories are separate — always 0 for shop Catalog. */
  bookingProductCount: number;
};

/**
 * Attach live shop product counts for each Catalog ProductCategory.
 * Online Booking uses BookingCategory — not counted here.
 */
export async function attachCategoryProductCounts<T extends CategoryDoc>(
  categories: T[],
  orgId: string
): Promise<Array<CategoryWithProductCounts<T>>> {
  if (!categories.length) return [];

  const ids = categories
    .map((c) => (c._id != null ? String(c._id) : typeof c.id === "string" ? c.id : ""))
    .filter(Boolean);

  if (!ids.length) {
    return categories.map((c) => ({
      ...c,
      productCount: 0,
      shopProductCount: 0,
      bookingProductCount: 0,
    }));
  }

  try {
    const shopRows = await prisma.product.groupBy({
      by: ["categoryId"],
      where: { orgId, categoryId: { in: ids } },
      _count: { _all: true },
    });

    const shopById = new Map<string, number>();
    for (const r of shopRows) {
      shopById.set(r.categoryId, r._count._all);
    }

    return categories.map((c) => {
      const key = c._id != null ? String(c._id) : typeof c.id === "string" ? c.id : "";
      const shopProductCount = shopById.get(key) ?? 0;
      return {
        ...c,
        shopProductCount,
        bookingProductCount: 0,
        productCount: shopProductCount,
      };
    });
  } catch (err) {
    console.warn("[categoryProductCounts] aggregate failed:", err);
    return categories.map((c) => ({
      ...c,
      productCount: 0,
      shopProductCount: 0,
      bookingProductCount: 0,
    }));
  }
}
