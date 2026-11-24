import prisma from "@/lib/prisma";
import { num } from "@/lib/pos/money";
import { issueGiftCard } from "@/lib/ticketing/giftCards";
import { createKitchenTicket, resolveKitchenStation } from "@/lib/pos/kitchen";
import { syncPartyMoney } from "@/lib/parties/deposits";
import {
  posDowngradeMembership,
  posRenewMembership,
  posSellMembership,
  posUpgradeMembership,
} from "@/lib/memberships/posAdapter";

function modifierField(modifiers: unknown, key: string): string {
  if (!modifiers || typeof modifiers !== "object" || Array.isArray(modifiers)) return "";
  const value = (modifiers as Record<string, unknown>)[key];
  return value == null ? "" : String(value);
}

/**
 * Idempotent post-payment fulfillment for gift cards, guest memberships,
 * and kitchen tickets (deferred until the sale is completed).
 * Safe to call from checkout (cash/settled) and from the Stripe webhook.
 */
export async function fulfillCompletedPosSale(opts: {
  saleId: string;
  actorUserId?: string | null;
}): Promise<{ issuedGiftCodes: string[] }> {
  const sale = await prisma.posSale.findFirst({
    where: { id: opts.saleId },
    include: { lines: true, bookings: { select: { bookingId: true } } },
  });
  if (!sale || sale.status !== "completed") {
    return { issuedGiftCodes: [] };
  }
  for (const link of sale.bookings) {
    await syncPartyMoney(prisma, link.bookingId);
  }

  const issuedGiftCodes: string[] = [];
  const userId = opts.actorUserId ?? sale.cashierUserId;

  // Kitchen tickets: create once when card/link settle completes the sale.
  const existingKitchen = await prisma.kitchenTicket.findFirst({
    where: { saleId: sale.id },
    select: { id: true },
  });
  if (!existingKitchen) {
    const productIds = sale.lines
      .map((l) => l.productId)
      .filter((id): id is string => Boolean(id));
    const kitchenProducts =
      productIds.length > 0
        ? await prisma.posProduct.findMany({
            where: {
              id: { in: productIds },
              OR: [
                { kind: { in: ["food", "beverage"] } },
                { kitchenRoute: { not: null } },
              ],
            },
            select: { id: true, kitchenRoute: true },
          })
        : [];
    const kitchenById = new Map(kitchenProducts.map((p) => [p.id, p]));
    const kitchenLines = sale.lines.filter(
      (l) => l.productId && kitchenById.has(l.productId)
    );
    if (kitchenLines.length) {
      await createKitchenTicket(prisma, {
        orgId: sale.orgId,
        locationId: sale.locationId,
        saleId: sale.id,
        station: resolveKitchenStation(
          kitchenLines.map((l) => kitchenById.get(l.productId!)?.kitchenRoute)
        ),
        items: kitchenLines.map((l) => ({ name: l.name, qty: l.qty })),
      });
    }
  }

  for (const line of sale.lines) {
    if (line.kind !== "gift_card_issue") continue;
    const amount = num(line.unitPrice) * line.qty;
    if (!(amount > 0)) continue;
    const key = `pos:${sale.id}:issue:${line.id}`;
    const prior = await prisma.giftCardLedger.findFirst({
      where: { orgId: sale.orgId, idempotencyKey: key },
    });
    if (prior) continue;
    const issued = await issueGiftCard({
      orgId: sale.orgId,
      locationId: sale.locationId,
      amount,
      issuedToGuestId: sale.guestProfileId,
      issuedSaleId: sale.id,
      saleId: sale.id,
      createdById: userId,
      idempotencyKey: key,
    });
    issuedGiftCodes.push(issued.code);
  }

  for (const line of sale.lines) {
    if (line.kind !== "membership") continue;
    const planId = line.refId || modifierField(line.modifiers, "membershipPlanId");
    if (!planId || !sale.guestProfileId) continue;
    const action = (
      modifierField(line.modifiers, "membershipAction") || "sell"
    ).toLowerCase();
    const amount = num(line.unitPrice) * line.qty;
    const key = `pos:${sale.id}:${line.id}`.slice(0, 120);
    const guestMembershipId = modifierField(line.modifiers, "guestMembershipId");

    if (action === "renew" && guestMembershipId) {
      await posRenewMembership({
        orgId: sale.orgId,
        membershipId: guestMembershipId,
        actorUserId: userId,
        paymentMethod: "collected",
        collectedAmount: amount,
        idempotencyKey: key,
      });
    } else if (action === "upgrade" && guestMembershipId) {
      await posUpgradeMembership({
        orgId: sale.orgId,
        membershipId: guestMembershipId,
        newPlanId: planId,
        actorUserId: userId,
        paymentMethod: "collected",
        collectedAmount: amount,
        idempotencyKey: key,
      });
    } else if (action === "downgrade" && guestMembershipId) {
      await posDowngradeMembership({
        orgId: sale.orgId,
        membershipId: guestMembershipId,
        newPlanId: planId,
        actorUserId: userId,
        idempotencyKey: key,
      });
    } else {
      await posSellMembership({
        orgId: sale.orgId,
        actorUserId: userId,
        guestProfileId: sale.guestProfileId,
        planId,
        locationId: sale.locationId,
        homeLocationId: sale.locationId,
        paymentMethod: "collected",
        collectedAmount: amount,
        idempotencyKey: key,
        posSaleLineId: line.id,
        allowPendingWithoutStripe: true,
      });
    }
  }

  return { issuedGiftCodes };
}
