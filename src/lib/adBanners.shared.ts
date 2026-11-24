/** Client-safe types + normalize helpers for shop ad banners. */

export type AdBannerDto = {
  _id: string;
  image: string;
  heading: string;
  paragraph: string;
  /** Optional CTA link (storefront path or absolute URL). */
  href?: string;
  order: number;
  active: boolean;
  createdByName?: string;
  updatedByName?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type AdBannerInput = {
  image?: string;
  heading?: string;
  paragraph?: string;
  /** Pass "" or null to clear an existing link. Omit to leave unchanged on update. */
  href?: string | null;
  order?: number;
  active?: boolean;
};

export type NormalizedAdBannerFields = {
  image: string;
  heading: string;
  paragraph: string;
  /** Empty string means clear/no href. */
  href: string;
  order: number;
  active: boolean;
};

export function normalizeAdBannerInput(
  input: AdBannerInput,
  fallbackOrder = 0
): NormalizedAdBannerFields {
  const image = typeof input.image === "string" ? input.image.trim() : "";
  const heading = typeof input.heading === "string" ? input.heading.trim() : "";
  const paragraph =
    typeof input.paragraph === "string" ? input.paragraph.trim() : "";
  const href =
    input.href === null || input.href === undefined
      ? ""
      : String(input.href).trim();
  const order =
    typeof input.order === "number" && Number.isFinite(input.order)
      ? Math.max(0, Math.floor(input.order))
      : fallbackOrder;

  return {
    image,
    heading,
    paragraph,
    href,
    order,
    active: input.active !== false,
  };
}

export function sortAdBanners<T extends { order: number; _id: string }>(
  banners: T[]
): T[] {
  return [...banners].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a._id.localeCompare(b._id);
  });
}
