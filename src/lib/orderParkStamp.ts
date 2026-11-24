/**
 * Stamp Order.venueLocationId from cart product parks when all lines agree.
 */
import prisma from "@/lib/prisma";

export async function resolveOrderVenueLocationIdFromCart(
  cartId: string
): Promise<string | null> {
  const lines = await prisma.cartLine.findMany({
    where: { cartId, productId: { not: null } },
    select: {
      product: { select: { venueLocationId: true } },
    },
  });
  const parks = new Set<string>();
  let sawNull = false;
  for (const line of lines) {
    const id = line.product?.venueLocationId ?? null;
    if (id) parks.add(id);
    else sawNull = true;
  }
  if (parks.size === 1 && !sawNull) {
    return [...parks][0];
  }
  // Mixed parks or shared/null products → leave null (CWV-only visibility).
  return null;
}
