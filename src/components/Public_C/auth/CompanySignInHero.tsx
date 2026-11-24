"use client";

import { useState } from "react";
import Image from "next/image";

export type CompanySignInHeroBrand = {
  name: string;
  logoUrl: string | null;
  accentColor: string | null;
  backgroundUrl: string | null;
};

export const NEUTRAL_ACCENT = "#1f2937";

const PLAIN_GRADIENT =
  "linear-gradient(160deg, rgba(255,255,255,0.12), rgba(0,0,0,0.35))";

export function CompanyMark({
  brand,
  size,
}: {
  brand: Pick<CompanySignInHeroBrand, "name" | "logoUrl" | "accentColor">;
  size: number;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const initial = brand.name.trim().charAt(0).toUpperCase() || "C";
  if (brand.logoUrl && brand.logoUrl !== failedUrl) {
    return (
      <Image
        src={brand.logoUrl}
        alt={`${brand.name} logo`}
        width={size}
        height={size}
        unoptimized
        onError={() => setFailedUrl(brand.logoUrl)}
        className="rounded-xl bg-white object-contain shadow-sm"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex items-center justify-center rounded-xl font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.45,
        backgroundColor: brand.accentColor ?? NEUTRAL_ACCENT,
      }}
    >
      {initial}
    </span>
  );
}

/** Brand image layers: photo + brand-color tint + legibility gradient. */
export function CompanySignInBackdrop({
  backgroundUrl,
  accent,
  onError,
}: {
  backgroundUrl: string;
  accent: string;
  onError?: () => void;
}) {
  // Lazy (not priority): the desktop panel is display:none on phones, so the
  // browser skips the large photo there.
  return (
    <>
      <Image
        src={backgroundUrl}
        alt=""
        aria-hidden
        fill
        unoptimized
        sizes="50vw"
        onError={onError}
        className="-z-10 object-cover"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-40 mix-blend-multiply"
        style={{ backgroundColor: accent }}
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-t from-black/75 via-black/30 to-black/25"
      />
    </>
  );
}

/**
 * Left panel of a company's staff sign-in page. `preview` renders the same
 * composition at thumbnail scale for the Company Profile editor.
 * Callers set the display class (`flex` / `hidden lg:flex`).
 */
export default function CompanySignInHero({
  brand,
  variant = "page",
  className = "",
}: {
  brand: CompanySignInHeroBrand;
  variant?: "page" | "preview";
  className?: string;
}) {
  const accent = brand.accentColor ?? NEUTRAL_ACCENT;
  const [failedBg, setFailedBg] = useState<string | null>(null);
  const background =
    brand.backgroundUrl && brand.backgroundUrl !== failedBg
      ? brand.backgroundUrl
      : null;
  const preview = variant === "preview";

  return (
    <div
      className={`relative isolate flex-col items-center justify-center overflow-hidden text-white ${
        preview ? "gap-2 p-4" : "gap-6 p-12"
      } ${className}`}
      style={{
        backgroundColor: accent,
        backgroundImage: background ? undefined : PLAIN_GRADIENT,
      }}
    >
      {background ? (
        <CompanySignInBackdrop
          backgroundUrl={background}
          accent={accent}
          onError={() => setFailedBg(background)}
        />
      ) : null}
      <CompanyMark brand={brand} size={preview ? 36 : 112} />
      <p
        className={`text-center font-bold leading-tight ${
          preview ? "max-w-[90%] text-sm" : "max-w-sm text-3xl"
        }`}
        style={
          background ? { textShadow: "0 2px 16px rgba(0,0,0,0.45)" } : undefined
        }
      >
        {brand.name}
      </p>
      <p
        className={`absolute text-white/80 ${
          preview ? "bottom-2 left-3 text-[9px]" : "bottom-8 left-8 text-sm"
        }`}
      >
        © {new Date().getFullYear()} {brand.name}
      </p>
    </div>
  );
}
