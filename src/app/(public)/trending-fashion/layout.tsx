import type { ReactNode } from "react";
import { getPublicAdBanners } from "@/lib/adBanners";
import AdBannersBootstrap from "@/components/Public_C/Home/AdBannersBootstrap";

/** Seed ad banners for the dedicated Trending Fashion page. */
export default async function TrendingFashionLayout({
  children,
}: {
  children: ReactNode;
}) {
  let banners: Awaited<ReturnType<typeof getPublicAdBanners>> = [];
  try {
    banners = await getPublicAdBanners();
  } catch (err) {
    console.error("Trending fashion layout: failed to load ad banners", err);
  }

  const preload = [
    ...new Set(
      banners
        .slice(0, 2)
        .map((b) => b.image)
        .filter((src) => typeof src === "string" && src.trim().length > 0)
    ),
  ];

  return (
    <>
      {preload.map((href) => (
        <link key={href} rel="preload" as="image" href={href} />
      ))}
      <AdBannersBootstrap initial={banners}>{children}</AdBannersBootstrap>
    </>
  );
}
