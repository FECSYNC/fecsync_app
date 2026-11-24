"use client";

import { useEffect } from "react";

/** Body class + cleanup for the marketing landing (kept out of the RSC page). */
export default function HomeLandingEffects() {
  useEffect(() => {
    document.documentElement.classList.add("vf-landing-page");
    document.body.classList.add("vf-landing-page");

    return () => {
      document.documentElement.classList.remove("vf-landing-page");
      document.body.classList.remove(
        "vf-landing-page",
        "announce-hidden",
        "drawer-open"
      );
    };
  }, []);

  return null;
}
