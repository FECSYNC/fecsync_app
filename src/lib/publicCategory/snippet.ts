/**
 * Staff copy helpers for the white-label category URL and embed snippet.
 * The script is served from public/embed/category.js.
 */
import { publicAppBaseUrl } from "@/lib/publicAppBaseUrl";

export type PublicCategoryLayout = "auto" | "grid" | "stack";

/** Staff payload for one category. Never includes bank, tax, or billing email. */
export type PublicCategoryPageDto = {
  slug: string;
  layout: PublicCategoryLayout;
  embedEnabled: boolean;
  active: boolean;
  url: string;
  embedSnippet: string;
};

const PRIVATE_PUBLIC_URL_KEYS = [
  "bankName",
  "bankAccount",
  "bankAccountName",
  "bankAccountNumber",
  "bankAccountLast4",
  "bankRoutingOrIban",
  "bankCurrency",
  "taxId",
  "billingEmail",
] as const;

export function publicCategoryUrl(
  orgSlug: string,
  categorySlug: string
): string {
  const base = publicAppBaseUrl().replace(/\/$/, "");
  return `${base}/${encodeURIComponent(orgSlug)}/${encodeURIComponent(categorySlug)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Marked container + iframe (width 100%, no border) + /embed/category.js, which
 * sizes the iframe to the container. Change the container's height/width to fit
 * the site. Layout is read from the saved page on each load, so it is not in here.
 * Slugs are escaped.
 */
export function publicCategoryEmbedSnippet(
  orgSlug: string,
  categorySlug: string
): string {
  const page = escapeHtml(
    `${publicCategoryUrl(orgSlug, categorySlug)}?embed=1`
  );
  const script = escapeHtml(
    `${publicAppBaseUrl().replace(/\/$/, "")}/embed/category.js`
  );
  const org = escapeHtml(orgSlug);
  const cat = escapeHtml(categorySlug);
  return [
    `<div data-company-category-embed data-org="${org}" data-category="${cat}" style="width:100%;height:640px">`,
    `<iframe src="${page}" width="100%" height="640" style="border:0;width:100%;display:block" title="Book" loading="lazy"></iframe>`,
    `</div>`,
    `<script src="${script}" async></script>`,
  ].join("\n");
}

export function toPublicCategoryPageDto(input: {
  slug: string;
  layout: PublicCategoryLayout;
  embedEnabled: boolean;
  active: boolean;
  orgSlug: string;
}): PublicCategoryPageDto {
  return {
    slug: input.slug,
    layout: input.layout,
    embedEnabled: input.embedEnabled,
    active: input.active,
    url: publicCategoryUrl(input.orgSlug, input.slug),
    embedSnippet: publicCategoryEmbedSnippet(input.orgSlug, input.slug),
  };
}

export function publicUrlPayloadHasPrivateFields(payload: unknown): boolean {
  const keys: string[] = [];
  const walk = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      keys.push(key);
      walk(child);
    }
  };
  walk(payload);
  return PRIVATE_PUBLIC_URL_KEYS.some((key) => keys.includes(key));
}
