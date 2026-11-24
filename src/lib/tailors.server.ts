import { cache } from "react";
import { getPublicTailorBySlug } from "@/lib/tailors";

/** Dedupe metadata + page fetches within one RSC request. */
export const getCachedPublicTailorBySlug = cache(async (slug: string) => {
  try {
    return await getPublicTailorBySlug(slug);
  } catch {
    return null;
  }
});
