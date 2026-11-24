export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import prisma from "@/lib/prisma";
import {
  ok,
  badRequest,
  serverError,
  authErrorToResponse,
} from "@/lib/response";
import { requireAuthActiveAccount } from "@/lib/middleware/requireAuth";
import { apiRateLimited } from "@/lib/rateLimit";
import {
  assertCartNotEmpty,
  loadCartForCheckout,
  resolveOrderOrgId,
} from "@/lib/orderFulfillment";
import { normalizeAddresses } from "@/lib/models/Profile";
import {
  createQuoteSession,
  fingerprintCart,
  isShippingError,
  resolveDestinationSnapshot,
  getOrCreateShippingSettings,
  isShippingCheckoutRequired,
  fetchRatesForCheckout,
  validateShippingAddress,
  ShippingNotConfiguredError,
  ShippingProviderError,
  type ProfileShippingAddress,
} from "@/lib/shipping";

type RatesBody = {
  address?: ProfileShippingAddress;
  addressId?: string;
  cartId?: string;
};

/**
 * POST /api/shipping/rates
 * Live courier quotes (Shipbubble primary → Fez fallback) + server-side quoteSessionId
 * (tokens never leave the server).
 */
export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requireAuthActiveAccount(request);
  } catch (err) {
    return authErrorToResponse(err) ?? serverError("Failed to authorize");
  }

  const limited = apiRateLimited(
    request,
    "shipping-rates",
    30,
    60_000,
    actor.sub
  );
  if (limited) return limited;

  let body: RatesBody;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  try {
    await connectDB();

    let addressInput: ProfileShippingAddress | null = null;

    const addressId = String(body.addressId ?? "").trim();
    if (addressId) {
      const profile = await prisma.profile.findUnique({
        where: { userId: actor.sub },
        select: { addresses: true },
      });
      const addresses = normalizeAddresses(profile?.addresses);
      const found = addresses.find((a) => a._id === addressId) ?? null;
      if (!found) {
        return badRequest("Address not found on profile");
      }
      addressInput = found as ProfileShippingAddress;
    } else if (
      body.address &&
      typeof body.address === "object" &&
      !Array.isArray(body.address)
    ) {
      addressInput = body.address;
    } else {
      return badRequest("Address must be a JSON object or addressId");
    }

    // Load user before resolve — phone/name fallbacks must run before validation
    // (previously applied after resolveDestinationSnapshot rejected missing phone).
    const user = await prisma.user.findUnique({
      where: { id: actor.sub },
      select: {
        email: true,
        phoneNumber: true,
        firstName: true,
        lastName: true,
      },
    });
    const fallbackName = [user?.firstName, user?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();

    const destination = resolveDestinationSnapshot(
      addressInput,
      user?.phoneNumber,
      fallbackName
    );
    if (!destination) {
      return badRequest(
        "A complete delivery address with phone is required for shipping rates"
      );
    }

    const validation = validateShippingAddress(destination);
    if (!validation.ok) {
      return badRequest(validation.errors.join("; "));
    }

    let cartId = String(body.cartId ?? "").trim();
    if (!cartId) {
      const row = await prisma.cart.findFirst({
        where: { userId: actor.sub },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      cartId = row?.id ?? "";
    }
    if (!cartId) {
      return badRequest("Cart not found");
    }
    const cart = await loadCartForCheckout(cartId, actor.sub);
    const orgId = await resolveOrderOrgId(cart);
    const settings = await getOrCreateShippingSettings(orgId);

    if (!isShippingCheckoutRequired(settings)) {
      return ok({
        ratesAvailable: false,
        shippingRequired: false,
        quoteSessionId: null,
        expiresAt: null,
        options: [],
        message: "Shipping rates are not configured",
      });
    }

    const origin = settings.originAddress;

    // Only require items once we know live rates will be fetched.
    assertCartNotEmpty(cart);

    const live = await fetchRatesForCheckout({
      cart,
      settings,
      origin,
      destination,
      recipientEmail: user?.email,
    });

    // Defense in depth — empty quotes must never look like a successful quote session.
    if (!live.quotes.length) {
      return ok({
        ratesAvailable: true,
        shippingRequired: true,
        quoteSessionId: null,
        expiresAt: null,
        options: [],
        message: "No delivery available to this address",
      });
    }

    const session = createQuoteSession({
      userId: actor.sub,
      orgId,
      cartId: cart._id,
      cartFingerprint: fingerprintCart(cart),
      destination,
      quotes: live.quotes,
      expiresAt: live.expiresAt,
      parcel: live.parcel,
    });

    return ok({
      ratesAvailable: true,
      shippingRequired: true,
      quoteSessionId: session.quoteSessionId,
      expiresAt: session.expiresAt,
      options: session.options,
    });
  } catch (error) {
    if (error instanceof ShippingNotConfiguredError) {
      return ok({
        ratesAvailable: false,
        shippingRequired: false,
        quoteSessionId: null,
        expiresAt: null,
        options: [],
        message: error.message,
      });
    }
    if (error instanceof ShippingProviderError) {
      if (error.code === "phone_required" || error.code === "address_invalid") {
        return badRequest(error.message);
      }
      // Empty coverage — 200 with [] (not 500). Shipping still required.
      return ok({
        ratesAvailable: true,
        shippingRequired: true,
        quoteSessionId: null,
        expiresAt: null,
        options: [],
        message:
          error.message || "No delivery available to this address",
      });
    }
    if (isShippingError(error)) {
      return badRequest(error.message);
    }
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("Cart") ||
      message.includes("empty") ||
      message.includes("stock")
    ) {
      return badRequest(message);
    }
    console.error("Shipping rates error:", error);
    return serverError("Failed to fetch shipping rates");
  }
}
