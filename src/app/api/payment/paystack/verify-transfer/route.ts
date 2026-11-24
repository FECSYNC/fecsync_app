export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import prisma from "@/lib/prisma";
import {
  ok,
  badRequest,
  forbidden,
  serverError,
  authErrorToResponse,
} from "@/lib/response";
import { finalizePaystackTransfer } from "@/lib/paystack";
import { requireAuthActiveAccount } from "@/lib/middleware/requireAuth";
import { isPlainObject } from "@/lib/catalogWrite";
import { prismaOwnedByFilter } from "@/lib/commerceSerialize";

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
  if (!isPlainObject(body)) {
    return badRequest("Invalid JSON");
  }

  const otp = typeof body.otp === "string" ? body.otp : "";
  const transfer_code =
    typeof body.transfer_code === "string" ? body.transfer_code.trim() : "";
  if (!otp || !transfer_code) {
    return badRequest("OTP and transfer code are required");
  }

  try {
    await connectDB();
    const wallet = await prisma.wallet.findFirst({
      where: {
        ...prismaOwnedByFilter(actor),
        transactions: { some: { transferCode: transfer_code } },
      },
      select: { id: true },
    });
    if (!wallet) {
      return forbidden("Transfer not found");
    }

    const verifyPayment = await finalizePaystackTransfer(transfer_code, otp);
    return ok({
      success: true,
      message: "Transfer initialized",
      data: verifyPayment,
    });
  } catch (error) {
    console.error("Failed to verify transfer:", error);
    return serverError("Failed to initialize payment: " + error);
  }
}
