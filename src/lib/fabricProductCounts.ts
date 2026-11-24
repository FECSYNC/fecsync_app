import prisma from "@/lib/prisma";

type FabricDoc = {
  _id?: unknown;
  id?: string;
  [key: string]: unknown;
};

function fabricKey(f: FabricDoc): string {
  if (typeof f.id === "string") return f.id;
  if (f._id != null) return String(f._id);
  return "";
}

/**
 * Attach live `productCount` for each fabric (products.fabricTypeId → fabric.id).
 * Scoped to the same org as the fabric list.
 */
export async function attachFabricProductCounts<T extends FabricDoc>(
  fabrics: T[],
  orgId: string
): Promise<Array<T & { productCount: number }>> {
  if (!fabrics.length) return [];

  const ids = fabrics.map(fabricKey).filter(Boolean);
  if (!ids.length) {
    return fabrics.map((f) => ({ ...f, productCount: 0 }));
  }

  try {
    const rows = await prisma.product.groupBy({
      by: ["fabricTypeId"],
      where: { orgId, fabricTypeId: { in: ids } },
      _count: { _all: true },
    });

    const countById = new Map(
      rows.map((r) => [r.fabricTypeId, r._count._all])
    );

    return fabrics.map((f) => ({
      ...f,
      productCount: countById.get(fabricKey(f)) ?? 0,
    }));
  } catch (err) {
    console.warn("[fabricProductCounts] aggregate failed:", err);
    return fabrics.map((f) => ({ ...f, productCount: 0 }));
  }
}
