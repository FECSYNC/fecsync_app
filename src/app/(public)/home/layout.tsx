import type { ReactNode } from "react";
import "@/components/Public_C/venueflow/logo-lock.css";

/**
 * Landing-only extras. Shared VenueFlow CSS + Manrope come from
 * `(public)/layout` → VenueFlowPublicStyles (do not duplicate here).
 */
export default function HomeLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <link
        rel="preload"
        as="image"
        href="/venueflow/img/hero.jpg"
        // @ts-expect-error React DOM supports fetchPriority on link
        fetchPriority="high"
      />
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){document.documentElement.classList.add("vf-landing-page");function a(){if(document.body)document.body.classList.add("vf-landing-page")}a();document.addEventListener("DOMContentLoaded",a);})();`,
        }}
      />
      {children}
    </>
  );
}
