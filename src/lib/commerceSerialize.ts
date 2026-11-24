/**
 * Prisma ↔ legacy Mongo API shapes for commerce models.
 * Clients may still expect `_id`, `user`, nested `product`/`fabric`, `carts`, etc.
 */

import type {
  Cart,
  CartLine,
  CustomRequest,
  CustomRequestStatus,
  Fabric,
  Order,
  Product,
  Review,
  ReviewLike,
  Shipment,
  User,
  Wallet,
  WalletTransaction,
  Wishlist,
  WishlistItem,
  Customization,
} from "@prisma/client";
import { withMongoIdAlias } from "@/lib/ids";
import {
  parseOrderShippingMethodJson,
  parseShippingAddressJson,
  toPublicShippingMethod,
} from "@/lib/shipping/address";
import { findActiveShipment } from "@/lib/shipping/consistency";
import { serializeShipment } from "@/lib/shipping/serialize";
import type {
  PublicOrderShippingMethod,
  SerializedShipment,
  ShippingAddressSnapshot,
} from "@/lib/shipping/types";

function normalizeOrderShippingFee(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

// ─── Prisma includes ─────────────────────────────────────────────────────────

export const productCartSelect = {
  id: true,
  name: true,
  price: true,
  images: true,
  description: true,
  orgId: true,
  taxRate: true,
  taxExempt: true,
  remainingInStock: true,
} as const;

export const productListSelect = {
  id: true,
  name: true,
  price: true,
  images: true,
} as const;

export const fabricCartSelect = {
  id: true,
  name: true,
  image: true,
  bundlePrice: true,
  yardBundle: true,
  color: true,
  type: true,
  orgId: true,
  taxRate: true,
  taxExempt: true,
  stockBundles: true,
  inStock: true,
  isSellable: true,
} as const;

export const fabricListSelect = {
  id: true,
  name: true,
  image: true,
  bundlePrice: true,
  yardBundle: true,
} as const;

export const cartLinesInclude = {
  lines: {
    include: {
      product: { select: productCartSelect },
      fabric: { select: fabricCartSelect },
    },
    orderBy: { id: "asc" as const },
  },
} as const;

export const walletWithTransactionsInclude = {
  transactions: { orderBy: { date: "desc" as const } },
} as const;

export const wishlistWithItemsInclude = {
  items: { include: { product: { select: productCartSelect } } },
} as const;

export const reviewWithLikesInclude = {
  likes: true,
  user: {
    select: {
      id: true,
      username: true,
      firstName: true,
      lastName: true,
    },
  },
} as const;

// ─── Filters (Prisma userId vs legacy `user`) ────────────────────────────────

export function prismaOwnedByFilter(token: { sub: string }): { userId: string } {
  return { userId: token.sub };
}

export function legacyUserFromRow(row: { userId: string }): { user: string } {
  return { user: row.userId };
}

// ─── Catalog ref aliases ─────────────────────────────────────────────────────

export function serializeProductRef<T extends { id: string }>(
  product: T | null | undefined
): (T & { _id: string }) | null | undefined {
  if (!product) return product;
  return withMongoIdAlias(product);
}

export function serializeFabricRef<T extends { id: string }>(
  fabric: T | null | undefined
): (T & { _id: string }) | null | undefined {
  if (!fabric) return fabric;
  return withMongoIdAlias(fabric);
}

// ─── Cart ────────────────────────────────────────────────────────────────────

export type SerializedCartLine = {
  _id: string;
  lineType: "product" | "fabric";
  product?: string | (Record<string, unknown> & { _id: string });
  fabric?: string | (Record<string, unknown> & { _id: string });
  quantity: number;
  productNote?: string[];
  bundlePrice?: number | null;
  yardBundle?: number | null;
};

export type SerializedCart = {
  _id: string;
  id: string;
  user: string;
  userId: string;
  lines: SerializedCartLine[];
  products: Array<{
    product: string | (Record<string, unknown> & { _id: string });
    quantity: number;
    productNote?: string[];
  }>;
  createdAt: Date;
  updatedAt: Date;
};

export function legacyProductsFromLines(
  lines: SerializedCartLine[]
): SerializedCart["products"] {
  return lines
    .filter((l) => l.lineType === "product" && l.product)
    .map((l) => ({
      product: l.product!,
      quantity: Number(l.quantity) || 1,
      productNote: l.productNote ?? [],
    }));
}

export function serializeCartLine(
  line: CartLine & {
    product?: Pick<Product, keyof typeof productCartSelect> | null;
    fabric?: Pick<Fabric, keyof typeof fabricCartSelect> | null;
  }
): SerializedCartLine {
  const base: SerializedCartLine = {
    _id: line.id,
    lineType: line.lineType,
    quantity: line.quantity,
    productNote: line.productNote ?? [],
    bundlePrice: line.bundlePrice,
    yardBundle: line.yardBundle,
  };
  if (line.lineType === "product") {
    base.product = line.product
      ? serializeProductRef(line.product)!
      : line.productId ?? undefined;
  } else {
    base.fabric = line.fabric
      ? serializeFabricRef(line.fabric)!
      : line.fabricId ?? undefined;
  }
  return base;
}

export function serializeCart(
  cart: Cart & {
    lines?: Array<
      CartLine & {
        product?: Pick<Product, keyof typeof productCartSelect> | null;
        fabric?: Pick<Fabric, keyof typeof fabricCartSelect> | null;
      }
    >;
  }
): SerializedCart {
  const lines = (cart.lines ?? []).map(serializeCartLine);
  return {
    _id: cart.id,
    id: cart.id,
    user: cart.userId,
    userId: cart.userId,
    lines,
    products: legacyProductsFromLines(lines),
    createdAt: cart.createdAt,
    updatedAt: cart.updatedAt,
  };
}

/** In-memory cart document for line mutations before persist. */
export type CartDoc = SerializedCart;

export function prismaCartToDoc(
  cart: Cart & {
    lines?: Array<
      CartLine & {
        product?: Pick<Product, keyof typeof productCartSelect> | null;
        fabric?: Pick<Fabric, keyof typeof fabricCartSelect> | null;
      }
    >;
  }
): CartDoc {
  return serializeCart(cart);
}

// ─── Wallet ──────────────────────────────────────────────────────────────────

export type SerializedWalletTransaction = {
  _id: string;
  type: "credit" | "debit";
  amount: number;
  description?: string | null;
  reference: string;
  transferCode?: string | null;
  status: "pending" | "failed" | "success";
  date: Date;
};

export type SerializedWallet = {
  _id: string;
  id: string;
  user: string;
  userId: string;
  balance: number;
  beneficiary?: unknown;
  transactions: SerializedWalletTransaction[];
  createdAt: Date;
  updatedAt: Date;
};

export function serializeWalletTransaction(
  tx: WalletTransaction
): SerializedWalletTransaction {
  return {
    _id: tx.id,
    type: tx.type,
    amount: tx.amount,
    description: tx.description,
    reference: tx.reference,
    transferCode: tx.transferCode,
    status: tx.status,
    date: tx.date,
  };
}

export function serializeWallet(
  wallet: Wallet & { transactions?: WalletTransaction[] }
): SerializedWallet {
  return {
    _id: wallet.id,
    id: wallet.id,
    user: wallet.userId,
    userId: wallet.userId,
    balance: wallet.balance,
    beneficiary: wallet.beneficiary ?? undefined,
    transactions: (wallet.transactions ?? []).map(serializeWalletTransaction),
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
  };
}

// ─── Order ───────────────────────────────────────────────────────────────────

export type SerializedOrder = {
  _id: string;
  id: string;
  user: string | Record<string, unknown>;
  userId: string;
  orgId: string;
  venueLocationId?: string | null;
  carts: string | SerializedCart;
  cartId: string;
  walletId: string;
  subtotal: number;
  taxAmount: number;
  taxRate: number | null;
  taxLabel: string;
  amount: number;
  shippingFee: number;
  shippingMethod?: PublicOrderShippingMethod | null;
  shippingAddress?: ShippingAddressSnapshot | null;
  shipment?: SerializedShipment | null;
  status: Order["status"];
  address: string;
  paymentReference?: string | null;
  paymentProvider?: Order["paymentProvider"];
  fulfilledAt?: Date | null;
  paidNotifiedAt?: Date | null;
  updatedBy?: string | null;
  updatedById?: string | null;
  updatedByName?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SerializeOrderOptions = {
  /** Staff/ops order views may include shipment.failureReason. */
  includeShipmentOpsFields?: boolean;
};

export function serializeOrder(
  order: Order & {
    user?: Pick<User, "id" | "username" | "email" | "phoneNumber" | "firstName" | "lastName"> & {
      profile?: { firstName?: string | null; lastName?: string | null; profilePicture?: string | null };
    };
    cart?: Parameters<typeof serializeCart>[0];
    shipments?: Shipment[];
  },
  cartOverride?: SerializedCart | string,
  options?: SerializeOrderOptions
): SerializedOrder {
  const userField = order.user
    ? {
        ...withMongoIdAlias(order.user),
        _id: order.user.id,
        profile: (order.user as { profile?: unknown }).profile,
      }
    : order.userId;

  let carts: string | SerializedCart = order.cartId;
  if (cartOverride !== undefined) {
    carts = cartOverride;
  } else if (order.cart) {
    carts = serializeCart(order.cart);
  }

  const activeShipment = findActiveShipment(
    order.shipments ?? [],
    parseOrderShippingMethodJson(order.shippingMethod)?.provider
  );

  return {
    _id: order.id,
    id: order.id,
    user: userField,
    userId: order.userId,
    orgId: order.orgId,
    venueLocationId: order.venueLocationId ?? null,
    carts,
    cartId: order.cartId,
    walletId: order.walletId,
    subtotal: order.subtotal,
    taxAmount: order.taxAmount,
    taxRate: order.taxRate,
    taxLabel: order.taxLabel,
    amount: order.amount,
    shippingFee: normalizeOrderShippingFee(order.shippingFee),
    shippingMethod: toPublicShippingMethod(order.shippingMethod),
    shippingAddress: parseShippingAddressJson(order.shippingAddress),
    shipment: activeShipment
      ? serializeShipment(activeShipment, {
          includeOpsFields: Boolean(options?.includeShipmentOpsFields),
        })
      : null,
    status: order.status,
    address: order.address,
    paymentReference: order.paymentReference,
    paymentProvider: order.paymentProvider,
    fulfilledAt: order.fulfilledAt,
    paidNotifiedAt: order.paidNotifiedAt,
    updatedBy: order.updatedById,
    updatedById: order.updatedById,
    updatedByName: order.updatedByName,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export function orderWhereFromLegacyFilter(
  filter: Record<string, unknown>
): {
  id?: string;
  userId?: string;
  orgId?: string;
} {
  const where: { id?: string; userId?: string; orgId?: string } = {};
  if (filter._id != null) where.id = String(filter._id);
  if (filter.id != null && !where.id) where.id = String(filter.id);
  if (filter.user != null) where.userId = String(filter.user);
  if (filter.userId != null) where.userId = String(filter.userId);
  if (filter.orgId != null) where.orgId = String(filter.orgId);
  return where;
}

// ─── Wishlist ────────────────────────────────────────────────────────────────

export type SerializedWishlist = {
  _id: string;
  id: string;
  user: string;
  userId: string;
  products: string[];
  items?: Array<{ _id: string; productId: string; product?: unknown }>;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeWishlist(
  wishlist: Wishlist & {
    items?: Array<WishlistItem & { product?: Pick<Product, keyof typeof productCartSelect> | null }>;
  }
): SerializedWishlist {
  const productIds = (wishlist.items ?? []).map((i) => i.productId);
  return {
    _id: wishlist.id,
    id: wishlist.id,
    user: wishlist.userId,
    userId: wishlist.userId,
    products: productIds,
    items: wishlist.items?.map((item) => ({
      _id: item.id,
      productId: item.productId,
      product: item.product ? serializeProductRef(item.product) : undefined,
    })),
    createdAt: wishlist.createdAt,
    updatedAt: wishlist.updatedAt,
  };
}

// ─── Review ──────────────────────────────────────────────────────────────────

export type SerializedReview = {
  _id: string;
  id: string;
  user: string | Record<string, unknown>;
  userId: string;
  product: string | Record<string, unknown>;
  productId: string;
  order?: string | null;
  orderId?: string | null;
  rating: number;
  comment?: string | null;
  images: string[];
  likes: string[];
  createdAt: Date;
  updatedAt: Date;
};

export function serializeReview(
  review: Review & {
    user?: Pick<User, "id" | "username" | "firstName" | "lastName">;
    likes?: ReviewLike[];
  }
): SerializedReview {
  return {
    _id: review.id,
    id: review.id,
    user: review.user
      ? { ...review.user, _id: review.user.id }
      : review.userId,
    userId: review.userId,
    product: review.productId,
    productId: review.productId,
    order: review.orderId,
    orderId: review.orderId,
    rating: review.rating,
    comment: review.comment,
    images: review.images ?? [],
    likes: (review.likes ?? []).map((l) => l.userId),
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}

// ─── Customization ───────────────────────────────────────────────────────────

export type SerializedCustomization = {
  _id: string;
  id: string;
  user: string | Record<string, unknown>;
  userId: string;
  outfit: string;
  fabricType: string;
  size: string;
  preferredColor: string;
  outfitOption?: string | null;
  additionalNotes?: string | null;
  productId?: string | null;
  fabricImage?: string | null;
  referenceImage: string[];
  selections?: unknown;
  updatedBy?: string | null;
  updatedById?: string | null;
  updatedByName?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeCustomization(
  row: Customization & {
    user?: Pick<User, "id" | "username" | "email" | "firstName" | "lastName">;
  }
): SerializedCustomization {
  return {
    _id: row.id,
    id: row.id,
    user: row.user ? { ...row.user, _id: row.user.id } : row.userId,
    userId: row.userId,
    outfit: row.outfit,
    fabricType: row.fabricType,
    size: row.size,
    preferredColor: row.preferredColor,
    outfitOption: row.outfitOption,
    additionalNotes: row.additionalNotes,
    productId: row.productId,
    fabricImage: row.fabricImage,
    referenceImage: row.referenceImage ?? [],
    selections: row.selections ?? undefined,
    updatedBy: row.updatedById,
    updatedById: row.updatedById,
    updatedByName: row.updatedByName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Custom request ──────────────────────────────────────────────────────────

export function customRequestStatusToApi(status: CustomRequestStatus): string {
  return status === "in_progress" ? "in-progress" : status;
}

export function customRequestStatusFromApi(
  status: string
): CustomRequestStatus {
  if (status === "in-progress") return "in_progress";
  return status as CustomRequestStatus;
}

export type SerializedCustomRequest = {
  _id: string;
  id: string;
  user: string;
  userId: string;
  gender: CustomRequest["gender"];
  size: CustomRequest["size"];
  style: string;
  eventType: string;
  fitType: string;
  color: string;
  description: string;
  image: string;
  budget: number;
  referenceImage: string[];
  fabricImage?: string | null;
  status: string;
  history?: unknown;
  updatedBy?: string | null;
  updatedById?: string | null;
  updatedByName?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeCustomRequest(row: CustomRequest): SerializedCustomRequest {
  return {
    _id: row.id,
    id: row.id,
    user: row.userId,
    userId: row.userId,
    gender: row.gender,
    size: row.size,
    style: row.style,
    eventType: row.eventType,
    fitType: row.fitType,
    color: row.color,
    description: row.description,
    image: row.image,
    budget: row.budget,
    referenceImage: row.referenceImage ?? [],
    fabricImage: row.fabricImage,
    status: customRequestStatusToApi(row.status),
    history: row.history ?? undefined,
    updatedBy: row.updatedById,
    updatedById: row.updatedById,
    updatedByName: row.updatedByName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

export function isUnreachableDbError(error: unknown): boolean {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code: unknown }).code === "P1001"
  ) {
    return true;
  }
  if (!(error instanceof Error)) return false;
  return error.message.includes("Can't reach database server");
}

export function isTransientDbError(error: unknown): boolean {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    const code = (error as { code: string }).code;
    if (
      code === "P2024" ||
      code === "P2028" ||
      code === "P1001" ||
      code === "P1017" ||
      code === "P2034"
    )
      return true;
  }
  if (!(error instanceof Error)) return false;
  const message = error.message;
  return (
    message.includes("ETIMEDOUT") ||
    message.includes("ECONNRESET") ||
    message.includes("Connection") ||
    message.includes("timeout") ||
    message.includes("Can't reach database server") ||
    message.includes("P2024") ||
    message.includes("P1001") ||
    message.includes("P1017") ||
    message.includes("P2034") ||
    message.includes("Server has closed the connection") ||
    message.includes("Engine is not yet connected") ||
    message.includes("EMAXCONNSESSION") ||
    message.includes("max clients reached") ||
    message.includes("too many connections") ||
    message.includes("remaining connection slots")
  );
}
