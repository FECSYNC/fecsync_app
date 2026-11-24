"use client";

import dynamic from "next/dynamic";
import { PARK_SLIDES } from "./parkSlides";

const HeroParkSlider = dynamic(() => import("./HeroParkSlider"), {
  ssr: true,
  loading: () => (
    <div className="hero-slider" aria-hidden="true">
      <div className="hero-slider-stage">
        <div className="hero-book">
          <article className="hero-page hero-page-in">
            <div className="hero-slide-media">
              <img
                src={PARK_SLIDES[0]?.image ?? "/venueflow/img/mega-spotlight.jpg"}
                alt=""
                width={900}
                height={640}
                decoding="async"
              />
              <div className="hero-slide-shade" />
            </div>
          </article>
        </div>
      </div>
    </div>
  ),
});

const VenueFlowLandingBelow = dynamic(() => import("./VenueFlowLandingBelow"), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden="true"
      style={{ minHeight: "40vh", background: "#f6f4ef" }}
    />
  ),
});

export default function VenueFlowLanding() {
  return (
    <div id="top">
      <section className="hero">
        <div className="hero-media" aria-hidden="true">
          <img
            src="/venueflow/img/hero.jpg"
            width={1280}
            height={720}
            fetchPriority="high"
            decoding="async"
            alt=""
          />
          <div className="hero-veil" />
        </div>
        <div className="hero-shell">
          <div className="hero-content">
            <p className="brand-signal">
              <span className="brand-signal-main">FECSYNC</span>
              <span className="brand-signal-sub">
                Family Entertainment Center Synchronization
              </span>
            </p>
            <h1>The platform powering 3,000+ thriving attractions</h1>
            <p className="hero-lede">
              Everything your venue needs to move faster, simplify operations,
              and grow with confidence.
            </p>
            <div className="hero-ctas">
              {/* Plain <a>: soft Link nav to auth layouts often stalls in dev. */}
              <a className="btn btn-primary btn-lg" href="/register-company">
                Register your company
              </a>
              <a className="btn btn-outline btn-lg" href="/signin">
                Sign in
              </a>
            </div>
          </div>
          <div className="hero-slider-col" aria-label="Venue highlights">
            <HeroParkSlider />
          </div>
        </div>
      </section>

      <VenueFlowLandingBelow />
    </div>
  );
}