import { ok } from "@/lib/response";
import { getPublicAdBanners } from "@/lib/adBanners";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Public active ad banners for the storefront org (slider). */
export async function GET() {
  // getPublicAdBanners retries transient DB errors and falls back to cache/[].
  const banners = await getPublicAdBanners();
  return ok({ banners });
}
