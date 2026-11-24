"use client";
import React, { useMemo } from "react";
import { motion, useReducedMotion, Variants } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { OpeningImg } from "@/components/common/OpeningImage";
import { usePublicHomepageContentQuery } from "@/hooks/useHomepageContent";
import {
  DEFAULT_HOMEPAGE_CONTENT,
  type HeroContent,
} from "@/lib/homepageContent.shared";

type HeroCtaVariant = "dark" | "gold";

function HeroCtaButton({
  label,
  href,
  variant,
  className = "",
}: {
  label: string;
  href: string;
  variant: HeroCtaVariant;
  className?: string;
}) {
  const buttonVariants: Variants = {
    hidden: { y: 16, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: { duration: 0.45, ease: "easeOut" },
    },
    hover: { transition: { staggerChildren: 0.05 } },
    tap: { scale: 0.98 },
  };

  const arrowVariants: Variants = {
    hidden: { x: 0, y: 0, opacity: 0.85 },
    visible: { x: 0, y: 0, opacity: 0.85 },
    hover: {
      x: 4,
      y: -4,
      opacity: 1,
      transition: { duration: 0.25, ease: "easeOut" },
    },
  };

  const isDark = variant === "dark";

  return (
    <motion.div
      variants={buttonVariants}
      initial="hidden"
      animate="visible"
      whileHover="hover"
      whileTap="tap"
      className="inline-flex"
    >
      <Link
        href={href}
        className={`group relative inline-flex cursor-pointer items-center gap-2 overflow-hidden rounded-full px-6 py-3 font-medium ${className} ${
          isDark
            ? "border-2 border-black bg-white text-black"
            : "border-2 border-[#FDC713] text-black"
        }`}
        style={isDark ? undefined : { backgroundColor: "#FFE181" }}
      >
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-0 scale-0 rounded-full transition-transform duration-300 ease-out group-hover:scale-100 ${
            isDark ? "bg-black" : "bg-[#FDC713]/35"
          }`}
        />
        <span
          className={`relative z-10 transition-colors duration-300 ${
            isDark ? "group-hover:text-white" : ""
          }`}
        >
          {label}
        </span>
        <motion.span
          className={`relative z-10 flex shrink-0 transition-colors duration-300 ${
            isDark ? "group-hover:text-white" : ""
          }`}
          variants={arrowVariants}
        >
          <ArrowUpRight size={20} strokeWidth={2.25} />
        </motion.span>
      </Link>
    </motion.div>
  );
}

const HERO_FRAME = [
  {
    frameClass:
      "absolute left-[1%] top-[10%] z-10 w-[32%] sm:left-[2%] sm:w-[30%] md:w-[29%] lg:left-[3%] lg:w-[28%] aspect-[5/4]",
    radiusClass: "rounded-xl sm:rounded-2xl",
  },
  {
    frameClass:
      "absolute left-1/2 top-[18%] z-20 w-[56%] sm:w-[52%] md:w-[50%] lg:w-[48%] aspect-[11/7] -translate-x-1/2",
    radiusClass: "rounded-2xl sm:rounded-3xl",
  },
  {
    frameClass:
      "absolute right-[1%] top-[10%] z-10 w-[32%] sm:right-[2%] sm:w-[30%] md:w-[29%] lg:right-[3%] lg:w-[28%] aspect-[5/4]",
    radiusClass: "rounded-xl sm:rounded-2xl",
  },
] as const;

function resolveHero(content?: HeroContent | null): HeroContent {
  const base = content ?? DEFAULT_HOMEPAGE_CONTENT.hero;
  const images =
    Array.isArray(base.images) && base.images.length > 0
      ? base.images
      : DEFAULT_HOMEPAGE_CONTENT.hero.images;
  return {
    ...base,
    headline: base.headline?.trim() || DEFAULT_HOMEPAGE_CONTENT.hero.headline,
    subtitle: base.subtitle?.trim() || DEFAULT_HOMEPAGE_CONTENT.hero.subtitle,
    ctaPrimary: {
      label:
        base.ctaPrimary?.label?.trim() ||
        DEFAULT_HOMEPAGE_CONTENT.hero.ctaPrimary.label,
      href:
        base.ctaPrimary?.href?.trim() ||
        DEFAULT_HOMEPAGE_CONTENT.hero.ctaPrimary.href,
    },
    ctaSecondary: {
      label:
        base.ctaSecondary?.label?.trim() ||
        DEFAULT_HOMEPAGE_CONTENT.hero.ctaSecondary.label,
      href:
        base.ctaSecondary?.href?.trim() ||
        DEFAULT_HOMEPAGE_CONTENT.hero.ctaSecondary.href,
    },
    images,
  };
}

const GOLD_TONES = ["#FFE181", "#FDC713", "#D4AF37", "#FFF8DC", "#FFECB3", "#E8C547"] as const;

/** Luxury gold glitter rain — wallpaper-style particles on a dark gold field. */
function HeroGlitter({ reduced }: { reduced: boolean }) {
  const particles = useMemo(
    () =>
      Array.from({ length: 72 }, (_, i) => {
        const size = 1.5 + (i % 7) * 0.85;
        const fall = 7 + (i % 11) * 1.15;
        return {
          id: i,
          left: `${(i * 13.7) % 100}%`,
          size,
          delay: `${-((i * 0.37) % fall)}s`,
          duration: `${fall}s`,
          drift: `${((i % 5) - 2) * 12}px`,
          tone: GOLD_TONES[i % GOLD_TONES.length],
          blur: i % 4 === 0 ? 0.4 : 0,
          opacity: 0.35 + (i % 5) * 0.12,
        };
      }),
    []
  );

  const sparks = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        id: `s-${i}`,
        left: `${6 + ((i * 17) % 88)}%`,
        delay: `${-((i * 1.1) % 8)}s`,
        duration: `${9 + (i % 5)}s`,
        size: 10 + (i % 5) * 3,
        tone: GOLD_TONES[i % GOLD_TONES.length],
      })),
    []
  );

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[5] overflow-hidden"
      aria-hidden
      style={{
        WebkitMaskImage:
          "linear-gradient(to bottom, #000 0%, #000 88%, transparent 100%)",
        maskImage:
          "linear-gradient(to bottom, #000 0%, #000 88%, transparent 100%)",
      }}
    >
      <style>{`
        @keyframes harewa-glitter-fall {
          0% {
            transform: translate3d(0, -12vh, 0) scale(0.7);
            opacity: 0;
          }
          8% { opacity: 1; }
          92% { opacity: 0.85; }
          100% {
            transform: translate3d(var(--drift, 0px), 112vh, 0) scale(1);
            opacity: 0;
          }
        }
        @keyframes harewa-spark-fall {
          0% {
            transform: translate3d(0, -15vh, 0) rotate(0deg) scale(0.4);
            opacity: 0;
          }
          12% { opacity: 1; }
          50% { opacity: 1; transform: translate3d(8px, 50vh, 0) rotate(180deg) scale(1); }
          100% {
            transform: translate3d(-6px, 115vh, 0) rotate(360deg) scale(0.5);
            opacity: 0;
          }
        }
        @keyframes harewa-gold-pulse {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 0.9; }
        }
        .harewa-glitter-fall {
          animation: harewa-glitter-fall var(--d, 10s) linear infinite;
          animation-delay: var(--delay, 0s);
          will-change: transform, opacity;
        }
        .harewa-spark-fall {
          animation: harewa-spark-fall var(--d, 12s) linear infinite;
          animation-delay: var(--delay, 0s);
          will-change: transform, opacity;
        }
        .harewa-gold-pulse {
          animation: harewa-gold-pulse 5.5s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .harewa-glitter-fall,
          .harewa-spark-fall,
          .harewa-gold-pulse {
            animation: none !important;
          }
        }
      `}</style>

      {/* Soft gold atmosphere only — base fade lives on the section */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 90% 55% at 50% 0%, rgba(253, 199, 19, 0.28) 0%, transparent 58%),
            radial-gradient(ellipse 60% 45% at 12% 70%, rgba(212, 175, 55, 0.12) 0%, transparent 55%),
            radial-gradient(ellipse 60% 45% at 88% 65%, rgba(255, 225, 129, 0.1) 0%, transparent 55%)
          `,
        }}
      />
      <div
        className={`absolute inset-0 ${reduced ? "" : "harewa-gold-pulse"}`}
        style={{
          background: `
            radial-gradient(circle at 30% 25%, rgba(253, 199, 19, 0.1), transparent 35%),
            radial-gradient(circle at 70% 35%, rgba(255, 225, 129, 0.08), transparent 40%)
          `,
          opacity: reduced ? 0.7 : undefined,
        }}
      />

      {/* Dense golden glitter rain */}
      {particles.map((p) => (
        <span
          key={p.id}
          className={reduced ? "" : "harewa-glitter-fall"}
          style={{
            position: "absolute",
            left: p.left,
            top: reduced ? `${(p.id * 11) % 95}%` : "-8%",
            width: p.size,
            height: p.size * (p.id % 3 === 0 ? 2.2 : 1),
            borderRadius: p.id % 3 === 0 ? "2px" : "9999px",
            background: `linear-gradient(180deg, #fff8dc 0%, ${p.tone} 45%, #b8860b 100%)`,
            boxShadow: `0 0 ${p.size * 2.5}px ${p.tone}, 0 0 ${p.size * 5}px rgba(253, 199, 19, 0.45)`,
            filter: p.blur ? `blur(${p.blur}px)` : undefined,
            opacity: reduced ? p.opacity * 0.7 : undefined,
            ["--delay" as string]: p.delay,
            ["--d" as string]: p.duration,
            ["--drift" as string]: p.drift,
          }}
        />
      ))}

      {/* Larger diamond sparkles in the rain */}
      {sparks.map((s) => (
        <svg
          key={s.id}
          className={reduced ? "" : "harewa-spark-fall"}
          viewBox="0 0 24 24"
          style={{
            position: "absolute",
            left: s.left,
            top: reduced ? `${(Number(s.id.split("-")[1]) * 13) % 90}%` : "-10%",
            width: s.size,
            height: s.size,
            ["--delay" as string]: s.delay,
            ["--d" as string]: s.duration,
            opacity: reduced ? 0.55 : undefined,
            filter: "drop-shadow(0 0 6px rgba(253, 199, 19, 0.9))",
          }}
        >
          <path
            d="M12 1.5 L14.1 9.1 L22 12 L14.1 14.9 L12 22.5 L9.9 14.9 L2 12 L9.9 9.1 Z"
            fill={s.tone}
          />
        </svg>
      ))}
    </div>
  );
}

const HeroSection = () => {
  const reduceMotion = useReducedMotion();
  const { data, isPending } = usePublicHomepageContentQuery();
  const section = data?.byKey?.hero;

  if (isPending && !data) {
    return (
      <div className="relative bg-white pb-5 sm:pb-6 md:pb-8">
        <div
          className="relative overflow-hidden rounded-b-[2.75rem] bg-[#0a0906] px-3 pb-16 pt-20 sm:rounded-b-[3.5rem] sm:px-4 sm:pt-24 md:rounded-b-[4.5rem] md:pt-28"
          style={{
            boxShadow:
              "0 14px 28px -6px rgba(0,0,0,0.4), 0 28px 56px -10px rgba(0,0,0,0.32)",
          }}
        >
          <div className="relative z-10 mx-auto w-full max-w-3xl space-y-4 animate-pulse">
            <div className="mx-auto h-12 w-3/4 rounded bg-white/10" />
            <div className="mx-auto h-4 w-2/3 rounded bg-white/10" />
            <div className="mx-auto mt-6 h-48 w-full max-w-xl rounded-2xl bg-white/10" />
          </div>
        </div>
      </div>
    );
  }

  if (data && !section) {
    return null;
  }

  const hero = resolveHero(section?.content as HeroContent | undefined);

  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.12, delayChildren: 0.05 },
    },
  };

  const textVariants: Variants = {
    hidden: { opacity: 0, y: reduceMotion ? 0 : 24 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: reduceMotion ? 0 : 0.45, ease: "easeOut" },
    },
  };

  const imageVariants: Variants = {
    hidden: { opacity: 1, scale: 0.97, y: reduceMotion ? 0 : 12 },
    visible: {
      opacity: 1,
      scale: 1,
      y: 0,
      transition: { duration: reduceMotion ? 0 : 0.4, ease: "easeOut" },
    },
  };

  const headlineLines = hero.headline.split(/\n/).filter(Boolean);

  return (
    <div className="relative bg-white pb-5 sm:pb-6 md:pb-8">
      {/* Soft contact shadow under the curved edge (3D lift) */}
      <div
        className="pointer-events-none absolute bottom-1 left-1/2 z-0 h-10 w-[92%] -translate-x-1/2 sm:bottom-2 sm:h-12 md:h-14"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.12) 45%, transparent 72%)",
          filter: "blur(10px)",
        }}
      />

      {/* Dark glitter shell — rounded bottom instead of a flat rectangle */}
      <div
        className="relative z-[1] overflow-hidden rounded-b-[2.75rem] sm:rounded-b-[3.5rem] md:rounded-b-[4.5rem] lg:rounded-b-[5.5rem]"
        style={{
          boxShadow: `
            0 4px 0 0 rgba(212, 175, 55, 0.18),
            0 14px 28px -6px rgba(0, 0, 0, 0.4),
            0 28px 56px -10px rgba(0, 0, 0, 0.32),
            0 40px 80px -16px rgba(10, 9, 6, 0.35)
          `,
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 z-0 bg-[#0a0906]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 z-0"
          aria-hidden
          style={{
            background: `
              radial-gradient(ellipse 90% 55% at 50% 0%, rgba(253, 199, 19, 0.2) 0%, transparent 55%),
              radial-gradient(ellipse 70% 50% at 20% 100%, rgba(212, 175, 55, 0.1) 0%, transparent 50%),
              radial-gradient(ellipse 70% 50% at 80% 100%, rgba(255, 225, 129, 0.08) 0%, transparent 50%)
            `,
          }}
        />

        <HeroGlitter reduced={Boolean(reduceMotion)} />

        <motion.div
          className="relative z-10 mx-auto w-full max-w-7xl px-3 pb-8 pt-20 sm:px-4 sm:pb-10 sm:pt-24 md:pb-12 md:pt-28"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <div className="relative flex flex-col items-center justify-center">
            <div className="relative z-30 mx-auto w-full max-w-3xl px-1 text-center">
              <div
                className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[140%] w-[115%] -translate-x-1/2 -translate-y-1/2"
                aria-hidden
                style={{
                  background:
                    "radial-gradient(ellipse at center, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.28) 42%, transparent 72%)",
                }}
              />
              <motion.h1
                className="mb-3 text-3xl font-bold leading-[1.05] text-white sm:mb-4 sm:text-4xl md:text-5xl xl:text-6xl"
                variants={textVariants}
                style={{
                  textShadow:
                    "0 2px 4px rgba(0,0,0,0.75), 0 0 28px rgba(0,0,0,0.45)",
                }}
              >
                {headlineLines.map((line, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <br />}
                    {line}
                  </React.Fragment>
                ))}
              </motion.h1>

              <motion.p
                className="mx-auto mb-6 max-w-2xl px-1 text-sm font-medium leading-relaxed tracking-wide whitespace-pre-line sm:mb-8 sm:text-base md:text-lg"
                variants={textVariants}
                style={{
                  color: "#FFF8E7",
                  textShadow:
                    "0 1px 2px rgba(0,0,0,0.85), 0 0 18px rgba(0,0,0,0.55), 0 0 2px rgba(0,0,0,0.9)",
                }}
              >
                {hero.subtitle}
              </motion.p>

              <motion.div
                className="mt-1 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4"
                variants={textVariants}
              >
                <HeroCtaButton
                  label={hero.ctaPrimary.label}
                  href={hero.ctaPrimary.href}
                  variant="dark"
                  className="w-full justify-center sm:w-auto"
                />
                <HeroCtaButton
                  label={hero.ctaSecondary.label}
                  href={hero.ctaSecondary.href}
                  variant="gold"
                  className="w-full justify-center sm:w-auto"
                />
              </motion.div>
            </div>

            <div
              className="pointer-events-none relative z-30 mx-auto mt-4 w-full max-w-[860px] isolate
                h-[220px] sm:mt-3 sm:h-[280px] sm:max-w-[920px]
                md:h-[340px] md:max-w-[960px]
                lg:mt-2 lg:h-[380px] lg:max-w-[1020px]
                xl:h-[400px]"
            >
              {hero.images.map((image, index) => {
                const frame = HERO_FRAME[index] ?? HERO_FRAME[0];
                return (
                  <motion.div
                    key={`${image.src}-${index}`}
                    className={`${frame.frameClass} opacity-100`}
                    variants={imageVariants}
                    style={{ opacity: 1 }}
                  >
                    <div
                      className={`h-full w-full overflow-hidden ring-1 ring-white/10 shadow-[0_18px_40px_rgba(0,0,0,0.45)] ${frame.radiusClass}`}
                    >
                      <OpeningImg
                        src={image.src}
                        alt={image.alt}
                        className="h-full w-full object-cover opacity-100"
                        frameClassName="relative h-full w-full"
                        overlayClassName={frame.radiusClass}
                        fetchPriority="high"
                        loading="eager"
                      />
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </motion.div>

        {/* Soft gold lip along the curved bottom edge */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[6] h-16 sm:h-20"
          aria-hidden
          style={{
            background:
              "linear-gradient(to top, rgba(253,199,19,0.14) 0%, transparent 70%)",
          }}
        />
      </div>
    </div>
  );
};

export default HeroSection;
