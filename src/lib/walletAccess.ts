/**
 * Owner-only wallet access for /api/wallet/[id]*.
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { requireAuthActiveAccount, assertOwnedDocument } from "@/lib/middleware/requireAuth";
import type { NormalizedAccessToken } from "@/lib/auth/claims";
import {
  serializeWallet,
  walletWithTransactionsInclude,
  type SerializedWallet,
} from "@/lib/commerceSerialize";
import { authErrorToResponse, notFound, serverError } from "@/lib/response";

export type OwnedWalletResult =
  | { actor: NormalizedAccessToken; wallet: SerializedWallet }
  | { response: NextResponse };

export function isOwnedWalletDenied(
  value: OwnedWalletResult
): value is { response: NextResponse } {
  return "response" in value;
}

export async function requireOwnedWallet(
  request: NextRequest,
  id: string
): Promise<OwnedWalletResult> {
  let actor: NormalizedAccessToken;
  try {
    actor = await requireAuthActiveAccount(request);
  } catch (err) {
    return {
      response: authErrorToResponse(err) ?? serverError("Failed to authorize"),
    };
  }

  if (!isValidId(id)) {
    return { response: notFound("Wallet not found") };
  }

  let row;
  try {
    row = await prisma.wallet.findUnique({
      where: { id },
      include: walletWithTransactionsInclude,
    });
  } catch (err) {
    console.error("Load wallet error:", err);
    return { response: serverError("Failed to load wallet") };
  }

  if (!row) {
    return { response: notFound("Wallet not found") };
  }

  try {
    assertOwnedDocument(actor, { user: row.userId });
  } catch (err) {
    return {
      response: authErrorToResponse(err) ?? serverError("Failed to authorize"),
    };
  }

  return { actor, wallet: serializeWallet(row) };
}
