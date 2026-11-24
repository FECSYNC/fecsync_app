/**
 * Owner-only cart access for /api/cart/[id]*.
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { requireAuthActiveAccount, assertOwnedDocument } from "@/lib/middleware/requireAuth";
import { type NormalizedAccessToken } from "@/lib/auth/claims";
import { prismaOwnedByFilter } from "@/lib/commerceSerialize";
import { loadCartDocById, type CartDoc } from "@/lib/cartLines";
import { authErrorToResponse, notFound, serverError } from "@/lib/response";

export type OwnedCartResult =
  | { actor: NormalizedAccessToken; cart: CartDoc }
  | { response: NextResponse };

export function isOwnedCartDenied(
  value: OwnedCartResult
): value is { response: NextResponse } {
  return "response" in value;
}

export async function requireOwnedCart(
  request: NextRequest,
  id: string
): Promise<OwnedCartResult> {
  let actor: NormalizedAccessToken;
  try {
    actor = await requireAuthActiveAccount(request);
  } catch (err) {
    return {
      response: authErrorToResponse(err) ?? serverError("Failed to authorize"),
    };
  }

  if (!isValidId(id)) {
    return { response: notFound("Cart not found") };
  }

  let row;
  try {
    row = await prisma.cart.findUnique({ where: { id } });
  } catch (err) {
    console.error("Load cart error:", err);
    return { response: serverError("Failed to load cart") };
  }

  if (!row) {
    return { response: notFound("Cart not found") };
  }

  try {
    assertOwnedDocument(actor, { user: row.userId });
  } catch (err) {
    return {
      response: authErrorToResponse(err) ?? serverError("Failed to authorize"),
    };
  }

  const cart = await loadCartDocById(id, actor.sub);
  if (!cart) {
    return { response: notFound("Cart not found") };
  }

  return { actor, cart };
}

/** Reload after mutate — always re-scope by owner. */
export async function populateOwnedCart(
  actor: Pick<NormalizedAccessToken, "sub">,
  id: string
): Promise<CartDoc | null> {
  const row = await prisma.cart.findFirst({
    where: { id, ...prismaOwnedByFilter(actor) },
  });
  if (!row) return null;
  return loadCartDocById(row.id, actor.sub);
}
