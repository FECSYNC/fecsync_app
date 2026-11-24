"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PARK_SLIDES, type ParkSlide } from "./parkSlides";

export type { ParkSlide };
export { PARK_SLIDES };

type Dir = "next" | "prev";

type HeroParkSliderProps = {
  slides?: ParkSlide[];
  autoMs?: number;
};

function SlideFace({
  slide,
  animKey,
}: {
  slide: ParkSlide;
  animKey: number;
}) {
  return (
    <>
      <div className="hero-slide-media">
        <img
          src={slide.image}
          alt=""
          width={900}
          height={640}
          decoding="async"
          loading={animKey === 0 ? "eager" : "lazy"}
          fetchPriority={animKey === 0 ? "high" : "low"}
          style={
            slide.position ? { objectPosition: slide.position } : undefined
          }
        />
        <div className="hero-slide-shade" aria-hidden="true" />
      </div>
      <div className="hero-slide-copy" key={animKey}>
        <p className="hero-slide-eyebrow">{slide.eyebrow}</p>
        <h3 className="hero-slide-title">{slide.title}</h3>
        <p className="hero-slide-text">{slide.description}</p>
      </div>
    </>
  );
}

export default function HeroParkSlider({
  slides = PARK_SLIDES,
  autoMs = 5600,
}: HeroParkSliderProps) {
  const [index, setIndex] = useState(0);
  const [animKey, setAnimKey] = useState(0);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flipClass, setFlipClass] = useState("");
  const [outgoing, setOutgoing] = useState<ParkSlide | null>(null);
  const lockRef = useRef(false);
  const total = slides.length;
  const slide = slides[index];

  const turn = useCallback(
    (dir: Dir) => {
      if (lockRef.current || total < 2) return;
      lockRef.current = true;
      setBusy(true);

      const from = slides[index];
      const nextIndex =
        dir === "next"
          ? (index + 1) % total
          : (index - 1 + total) % total;

      setOutgoing(from);
      setFlipClass(dir === "next" ? "is-flip-next" : "is-flip-prev");
      setIndex(nextIndex);
      setAnimKey((k) => k + 1);

      window.setTimeout(() => {
        setFlipClass("");
        setOutgoing(null);
        setBusy(false);
        lockRef.current = false;
      }, 900);
    },
    [index, slides, total]
  );

  const prev = useCallback(() => turn("prev"), [turn]);
  const next = useCallback(() => turn("next"), [turn]);

  useEffect(() => {
    if (paused || busy || total < 2) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const id = window.setInterval(() => turn("next"), autoMs);
    return () => window.clearInterval(id);
  }, [autoMs, busy, paused, total, turn]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  return (
    <div
      className="hero-slider"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setPaused(false);
        }
      }}
    >
      <div
        className={`hero-slider-stage${flipClass ? ` ${flipClass}` : ""}`}
        aria-roledescription="carousel"
        aria-label="Venue park highlights"
      >
        <div className="hero-book" aria-live="polite">
          {outgoing ? (
            <article className="hero-page hero-page-out" aria-hidden="true">
              <SlideFace slide={outgoing} animKey={animKey - 1} />
            </article>
          ) : null}

          <article className="hero-page hero-page-in">
            <SlideFace slide={slide} animKey={animKey} />
          </article>
        </div>

        <div className="hero-slider-bar" aria-label="Slider controls">
          <button
            type="button"
            className="hero-slider-btn"
            onClick={prev}
            disabled={busy}
            aria-label="Previous venue slide"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M15 6L9 12l6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <p className="hero-slider-index" aria-hidden="true">
            <span>{String(index + 1).padStart(2, "0")}</span>
            <span className="hero-slider-index-sep">/</span>
            <span>{String(total).padStart(2, "0")}</span>
          </p>

          <button
            type="button"
            className="hero-slider-btn"
            onClick={next}
            disabled={busy}
            aria-label="Next venue slide"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M9 6l6 6-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
