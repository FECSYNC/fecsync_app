/**
 * Guest-safe payloads for the company category site (/{orgSlug}/{categorySlug}).
 * Never includes bank, tax, billing email, or internal ids beyond catalog ids.
 */
import type { PublicCategoryKindName } from "@/lib/publicCategory/pages";
import type { PublicCategoryLayout } from "@/lib/publicCategory/snippet";
import { CURRENCY_CONFIG } from "@/utils/currency";

export type CompanySiteHeaderDto = {
  name: string;
  logoUrl: string | null;
  phone: string | null;
  supportEmail: string | null;
  website: string | null;
  address: string | null;
};

export type CompanySiteDto = {
  orgSlug: string;
  categorySlug: string;
  categoryName: string;
  categoryDescription: string | null;
  kind: PublicCategoryKindName;
  layout: PublicCategoryLayout;
  header: CompanySiteHeaderDto;
};

export type CompanyBookingCardDto = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  type: string;
  party: boolean;
  priceFrom: number | null;
  currency: string | null;
  soldOut: boolean;
  /** Set only when this category spans more than one park. */
  parkName: string | null;
};

export type CompanyMenuItemDto = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  /** Same Product.price the shop shows and the cart charges. */
  price: number;
};

export type CompanyMembershipCardDto = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  price: number;
  currency: string;
  billing: string;
  intervalCount: number | null;
  intervalUnit: string | null;
};

/** Only switched-on public fields. Bank, tax, and billing email are never read. */
export type CompanyProfilePublicSource = {
  tradingName: string | null;
  logoUrl: string | null;
  supportEmail: string | null;
  phone: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  publicLogo: boolean;
  publicPhone: boolean;
  publicSupportEmail: boolean;
  publicWebsite: boolean;
  publicAddress: boolean;
};

export const COMPANY_PROFILE_PUBLIC_SELECT = {
  tradingName: true,
  logoUrl: true,
  supportEmail: true,
  phone: true,
  website: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  country: true,
  postalCode: true,
  publicLogo: true,
  publicPhone: true,
  publicSupportEmail: true,
  publicWebsite: true,
  publicAddress: true,
} as const;

/** Menu Product rows have no currency column, so they use the app catalog currency. */
export function formatPublicMoney(
  amount: number,
  currency: string = CURRENCY_CONFIG.code
): string {
  try {
    return new Intl.NumberFormat(CURRENCY_CONFIG.locale, { style: "currency", currency }).format(
      amount
    );
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function safeWebsite(value: string | null | undefined): string | null {
  const raw = clean(value);
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safeLogo(value: string | null | undefined): string | null {
  const raw = clean(value);
  if (!raw) return null;
  if (raw.startsWith("/")) return raw;
  return /^https:\/\//i.test(raw) ? raw : null;
}

export function toCompanySiteHeaderDto(
  org: { name: string },
  profile: CompanyProfilePublicSource | null
): CompanySiteHeaderDto {
  if (!profile) {
    return {
      name: org.name,
      logoUrl: null,
      phone: null,
      supportEmail: null,
      website: null,
      address: null,
    };
  }
  const address = profile.publicAddress
    ? [
        profile.addressLine1,
        profile.addressLine2,
        profile.city,
        profile.state,
        profile.postalCode,
        profile.country,
      ]
        .map(clean)
        .filter(Boolean)
        .join(", ") || null
    : null;
  return {
    name: clean(profile.tradingName) ?? org.name,
    logoUrl: profile.publicLogo ? safeLogo(profile.logoUrl) : null,
    phone: profile.publicPhone ? clean(profile.phone) : null,
    supportEmail: profile.publicSupportEmail
      ? clean(profile.supportEmail)
      : null,
    website: profile.publicWebsite ? safeWebsite(profile.website) : null,
    address,
  };
}

export function toCompanyBookingCardDto(
  product: {
    id: string;
    name: string;
    description: string | null;
    images: string[];
    type: string;
    priceFrom: number | null;
    prices: { currency: string }[];
    soldOut?: boolean;
  },
  parkName: string | null
): CompanyBookingCardDto {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    imageUrl: safeLogo(product.images?.[0]),
    type: product.type,
    party: product.type === "party_package",
    priceFrom: product.priceFrom,
    currency: product.prices[0]?.currency ?? null,
    soldOut: Boolean(product.soldOut),
    parkName,
  };
}

export function toCompanyMenuItemDto(product: {
  id: string;
  name: string;
  description: string;
  images: string[];
  price: number;
}): CompanyMenuItemDto {
  return {
    id: product.id,
    name: product.name,
    description: clean(product.description),
    imageUrl: safeLogo(product.images?.[0]),
    price: product.price,
  };
}

export function toCompanyMembershipCardDto(plan: {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  price: { toString(): string };
  currency: string;
  billing: string;
  intervalCount: number | null;
  intervalUnit: string | null;
}): CompanyMembershipCardDto {
  return {
    id: plan.id,
    name: plan.name,
    description: clean(plan.description),
    imageUrl: safeLogo(plan.imageUrl),
    price: Number(plan.price.toString()),
    currency: plan.currency,
    billing: plan.billing,
    intervalCount: plan.intervalCount,
    intervalUnit: plan.intervalUnit,
  };
}
