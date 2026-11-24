import { NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { prismaOwnedByFilter } from "@/lib/commerceSerialize";
import {
  isUniqueConstraintError,
  serializeWallet,
  walletWithTransactionsInclude,
  type SerializedWallet,
} from "@/lib/commerceSerialize";
import { ok, created, badRequest, serverError } from "@/lib/response";
import {
  AuthenticatedRequest,
  AddFundsRequest,
  DeductFundsRequest,
  PaystackWebhookEvent,
  transactionRequest,
  ErrorResponse,
} from "../lib/types/wallet";
import { sendReceiptMail } from "./sendReceipts";
import { getUserFromUserid, getUserFromUuid } from "./utils";

export type IWallet = SerializedWallet;

/** Helpers in this file may return NextResponse (400/500) instead of a wallet. */
export function isWalletHelperResponse(
  result: unknown
): result is NextResponse {
  return (
    typeof result === "object" &&
    result !== null &&
    "headers" in result &&
    "status" in result
  );
}

async function loadWalletByUserId(userId: string): Promise<SerializedWallet | null> {
  const row = await prisma.wallet.findFirst({
    where: prismaOwnedByFilter({ sub: userId }),
    include: walletWithTransactionsInclude,
  });
  return row ? serializeWallet(row) : null;
}

/** Session user's wallet only. Never orgId/shop/seller. */
export async function ensureOwnedWallet(userId: string): Promise<SerializedWallet> {
  const existing = await loadWalletByUserId(userId);
  if (existing) return existing;

  try {
    const createdWallet = await prisma.wallet.create({
      data: { userId, balance: 0 },
      include: walletWithTransactionsInclude,
    });
    return serializeWallet(createdWallet);
  } catch (err) {
    // Concurrent AFTER / login / register can race on Wallet.userId unique.
    if (isUniqueConstraintError(err)) {
      const raced = await loadWalletByUserId(userId);
      if (raced) return raced;
    }
    throw err;
  }
}

export const getWalletForUser = async (userId: string) => {
  try {
    if (!userId) {
      return badRequest("User ID is required");
    }

    const wallet = await loadWalletByUserId(String(userId));
    if (!wallet) {
      return badRequest("Wallet not found");
    }

    return wallet;
  } catch (err: unknown) {
    console.error("Error fetching wallet for user:", err);
    return serverError("Internal server error: " + err);
  }
};

export const getWallet = async (req: AuthenticatedRequest) => {
  try {
    const wallet = await loadWalletByUserId(String(req.user._id));
    if (!wallet) {
      return badRequest("Wallet not found");
    }
    return wallet;
  } catch (error: unknown) {
    console.error("Error fetching wallet:", error);
    return serverError("Error fetching wallet: " + error);
  }
};

export const createWallet = async (req: AuthenticatedRequest) => {
  try {
    const walletExists = await loadWalletByUserId(String(req.user._id));
    if (walletExists) {
      return badRequest("Wallet already exists");
    }

    const wallet = await ensureOwnedWallet(String(req.user._id));
    return created({
      success: true,
      message: "Wallet created successfully",
      data: wallet,
    });
  } catch (error: unknown) {
    console.error("Error creating wallet:", error);
    return serverError("Error creating wallet: " + error);
  }
};

async function walletByUserId(userId: string) {
  return loadWalletByUserId(userId);
}

async function sendWalletReceipt(params: {
  userId: unknown;
  subject: string;
  receiptId: string;
  amountPaid: number;
  paymentMethod: string;
}) {
  try {
    const user = await getUserFromUserid(String(params.userId));
    if (!user?.email) return;
    await sendReceiptMail({
      to: user.email,
      subject: params.subject,
      data: {
        customerName: user.firstName
          ? user.lastName
            ? `${user.firstName} ${user.lastName}`
            : user.firstName
          : user.username || "Customer",
        receiptId: params.receiptId,
        amountPaid: params.amountPaid,
        paymentMethod: params.paymentMethod,
        date: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("[wallet] receipt email failed:", err);
  }
}

export const addFunds = async (req: AddFundsRequest) => {
  try {
    const { amount, description = "Funds added", userId, reference } = req;

    if (!amount || amount <= 0) {
      return badRequest("Invalid amount. Amount must be greater than 0");
    }

    if (!userId) {
      return badRequest("User ID is required");
    }

    const ownerId = String(userId);
    const amountInDollars = Math.floor(amount / 1);
    if (!Number.isFinite(amountInDollars) || amountInDollars <= 0) {
      return badRequest("Invalid amount. Amount must be greater than 0");
    }
    const txRef =
      (typeof reference === "string" && reference.trim()) ||
      `add-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

    const already = await getTransactionByReference({
      reference: txRef,
      userId: ownerId,
    });
    if (already) {
      const existingWallet = await walletByUserId(ownerId);
      return existingWallet || badRequest("Wallet not found");
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findFirst({
          where: prismaOwnedByFilter({ sub: ownerId }),
        });
        if (!wallet) return null;

        const dup = await tx.walletTransaction.findUnique({
          where: { reference: txRef },
        });
        if (dup) return wallet;

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: "credit",
            amount: amountInDollars,
            description,
            reference: txRef,
            status: "success",
          },
        });

        return tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: amountInDollars } },
          include: walletWithTransactionsInclude,
        });
      });

      if (!result) {
        const raced = await getTransactionByReference({
          reference: txRef,
          userId: ownerId,
        });
        if (raced) {
          return (await walletByUserId(ownerId)) || badRequest("Wallet not found");
        }
        return badRequest("Wallet not found");
      }

      const wallet = serializeWallet(result);
      await sendWalletReceipt({
        userId: wallet.user,
        subject: "Funds Added to Your Wallet",
        receiptId: txRef,
        amountPaid: amountInDollars,
        paymentMethod: "Wallet Credit",
      });

      return wallet;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const existingWallet = await walletByUserId(ownerId);
        if (existingWallet) return existingWallet;
      }
      throw error;
    }
  } catch (error: unknown) {
    if (isUniqueConstraintError(error) && req.userId && req.reference) {
      const existingWallet = await walletByUserId(String(req.userId));
      if (existingWallet) return existingWallet;
    }
    console.error("Error adding funds:", error);
    return serverError("Error adding funds: " + error);
  }
};

export const addFundPaystack = async (
  amount: number,
  reference: string
): Promise<IWallet | ErrorResponse> => {
  try {
    if (!amount || amount <= 0) {
      return { message: "Invalid amount", error: "Amount must be greater than 0" };
    }

    if (!reference) {
      return { message: "Invalid reference", error: "User reference is required" };
    }

    const wallet = await loadWalletByUserId(reference);
    if (!wallet) {
      return { message: "Wallet not found", error: "Invalid user reference" };
    }

    const newAmount = Math.floor(amount / 100);
    const credited = await addFunds({
      amount: newAmount,
      userId: reference,
      reference,
      description: "Wallet credited via paystack",
    });

    if (isWalletHelperResponse(credited)) {
      return { message: "Error adding funds", error: String(credited) };
    }
    return credited;
  } catch (error: unknown) {
    console.error("Error adding funds via Paystack:", error);
    return { message: "Error adding funds" + error };
  }
};

export const deductFunds = async (req: DeductFundsRequest) => {
  try {
    const { amount, description = "Funds deducted", userId, reference } = req;

    if (!amount || amount <= 0 || !Number.isFinite(Number(amount))) {
      return badRequest("Invalid amount. Amount must be greater than 0");
    }

    if (!userId) {
      return badRequest("User ID is required");
    }

    const ownerId = String(userId);
    const debitAmount = Number(amount);
    const txRef =
      (typeof reference === "string" && reference.trim()) ||
      `deduct-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

    const already = await getTransactionByReference({
      reference: txRef,
      userId: ownerId,
    });
    if (already) {
      const existingWallet = await walletByUserId(ownerId);
      return existingWallet || badRequest("Wallet not found");
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findFirst({
          where: {
            ...prismaOwnedByFilter({ sub: ownerId }),
            balance: { gte: debitAmount },
          },
        });
        if (!wallet) return null;

        const dup = await tx.walletTransaction.findUnique({
          where: { reference: txRef },
        });
        if (dup) return wallet;

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: "debit",
            amount: debitAmount,
            description,
            reference: txRef,
            status: "success",
            ...(typeof req.transferCode === "string" && req.transferCode
              ? { transferCode: req.transferCode }
              : {}),
          },
        });

        return tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { decrement: debitAmount } },
          include: walletWithTransactionsInclude,
        });
      });

      if (!result) {
        const raced = await getTransactionByReference({
          reference: txRef,
          userId: ownerId,
        });
        if (raced) {
          return (await walletByUserId(ownerId)) || badRequest("Wallet not found");
        }
        const exists = await walletByUserId(ownerId);
        if (!exists) return badRequest("Wallet not found");
        return badRequest("Insufficient balance");
      }

      const wallet = serializeWallet(result);
      await sendWalletReceipt({
        userId: wallet.user,
        subject: "Funds Deducted from Your Wallet",
        receiptId: txRef,
        amountPaid: debitAmount,
        paymentMethod: "Wallet Deduction",
      });

      return wallet;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const existingWallet = await walletByUserId(ownerId);
        if (existingWallet) return existingWallet;
      }
      throw error;
    }
  } catch (error: unknown) {
    if (isUniqueConstraintError(error) && req.userId && req.reference) {
      const existingWallet = await walletByUserId(String(req.userId));
      if (existingWallet) return existingWallet;
    }
    console.error("Error deducting funds:", error);
    return serverError("Error deducting funds: " + error);
  }
};

export async function attachWalletTransferCode(params: {
  userId: string;
  reference: string;
  transferCode: string;
}) {
  const wallet = await prisma.wallet.findFirst({
    where: prismaOwnedByFilter({ sub: params.userId }),
    select: { id: true },
  });
  if (!wallet) return;

  await prisma.walletTransaction.updateMany({
    where: { walletId: wallet.id, reference: params.reference },
    data: { transferCode: params.transferCode },
  });
}

export const getTransactions = async (req: AuthenticatedRequest) => {
  try {
    const wallet = await prisma.wallet.findFirst({
      where: prismaOwnedByFilter({ sub: String(req.user._id) }),
      include: walletWithTransactionsInclude,
    });

    if (!wallet) {
      return badRequest("Wallet not found");
    }

    return ok({
      success: true,
      message: "Transactions fetched successfully",
      data: { transactions: serializeWallet(wallet).transactions },
    });
  } catch (error: unknown) {
    console.error("Error fetching transactions:", error);
    return serverError("Error fetching transactions: " + error);
  }
};

export const getTransactionByReference = async (req: transactionRequest) => {
  const { reference, userId } = req;

  if (!reference || !userId) {
    return null;
  }

  const wallet = await prisma.wallet.findFirst({
    where: prismaOwnedByFilter({ sub: String(userId) }),
    include: {
      transactions: { where: { reference } },
    },
  });

  if (!wallet || wallet.transactions.length === 0) {
    return null;
  }

  return serializeWallet(wallet).transactions[0] ?? null;
};

export const paystackWebhook = async (event: PaystackWebhookEvent) => {
  try {
    if (event.event !== "charge.success") {
      return ok({
        success: true,
        message: "Event received",
      });
    }

    const metadata = event.data.metadata as { uuid?: unknown };
    const uuid = typeof metadata?.uuid === "string" ? metadata.uuid : "";
    if (!uuid) {
      return badRequest("User UUID not found in metadata");
    }

    const user = await getUserFromUuid(uuid);
    if (!user?.id) {
      return badRequest("Missing user from payment metadata");
    }

    const result = await addFunds({
      amount: event.data.amount,
      userId: user.id,
      reference: event.data.reference,
    });

    if (isWalletHelperResponse(result)) {
      return result;
    }

    return ok({
      success: true,
      message: "Transaction processed successfully",
      data: result,
    });
  } catch (error: unknown) {
    console.error("Error processing webhook:", error);
    return serverError("Error processing webhook: " + error);
  }
};

export const isErrorResponse = (
  result: IWallet | ErrorResponse
): result is ErrorResponse => {
  return "message" in result && "error" in result;
};
