"use client";

import { useEffect } from "react";
import VenueFlowPricingSection from "@/components/Public_C/venueflow/VenueFlowPricingSection";
import VenueFlowMarketingBand from "@/components/Public_C/venueflow/VenueFlowMarketingBand";

const LOGO_PILLS = [
  { name: "Altitude Co.", c: "#FF6B4A" },
  { name: "SkyBound Parks", c: "#4A90FF" },
  { name: "WaveHouse", c: "#1DB8A0" },
  { name: "Ninja Circuit", c: "#F4B942" },
  { name: "PlayOrbit", c: "#9B59B6" },
  { name: "FlipZone", c: "#E74C3C" },
  { name: "Urban Leap", c: "#2ECC71" },
  { name: "Echo Arcade", c: "#3498DB" },
];

export default function VenueFlowLandingBelow() {
  useEffect(() => {
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (prefersReduced || !("IntersectionObserver" in window)) return;

    const els = document.querySelectorAll(".vf-reveal");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );

    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <>      <section className="trusted" aria-label="Trusted venues">
        <p className="trusted-label">Trusted by over 3,000 venues worldwide</p>
        <div className="marquee" data-marquee>
          <div className="marquee-track">
            {[...LOGO_PILLS, ...LOGO_PILLS].map((logo, i) => (
              <div className="logo-pill" key={`${logo.name}-${i}`}>
                <span
                  className="logo-dot"
                  style={{ ["--c" as string]: logo.c }}
                />
                {logo.name}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="intents" id="intents">
        <div className="section-head">
          <h2>What brings you to FECSYNC today?</h2>
        </div>
        <div className="intent-grid">
          <a className="intent-card vf-reveal" href="#stories">
            <div className="intent-visual">
              <img
                src="/venueflow/img/intent-1.jpg" width={640} height={440} loading="lazy" decoding="async"
                alt="Happy group celebrating at a venue"
              />
            </div>
            <h3>See how venues like mine use FECSYNC</h3>
            <p>
              Streamline operations, save time, and deliver better guest
              experiences.
            </p>
            <span className="text-link">Learn more →</span>
          </a>
          <a className="intent-card vf-reveal" href="#features">
            <div className="intent-visual">
              <img
                src="/venueflow/img/intent-2.jpg" width={640} height={440} loading="lazy" decoding="async"
                alt="Point of sale terminal on a counter"
              />
            </div>
            <h3>Explore features built for attractions</h3>
            <p>
              Bookings and marketplace packages online today; guest Memberships
              sell, billing, redeem/verify, guest self-serve, and membership
              reports on Growth+; POS terminal live on Growth+ — one company
              workspace.
            </p>
            <span className="text-link">Learn more →</span>
          </a>
          <a className="intent-card vf-reveal" href="#pricing">
            <div className="intent-visual">
              <img
                src="/venueflow/img/intent-3.jpg" width={640} height={440} loading="lazy" decoding="async"
                alt="Notebook with charts and planning notes"
              />
            </div>
            <h3>Compare plans and pricing</h3>
            <p>Plans designed to deliver value at every stage of growth.</p>
            <span className="text-link">Learn more →</span>
          </a>
        </div>
      </section>

      <section className="launch" id="launch">
        <div className="launch-copy vf-reveal">
          <p className="eyebrow">Spring 2026 product launch</p>
          <h2>
            Intelligence built for attractions: grow faster and run smarter
          </h2>
          <p>
            Handle guest inquiries 24/7 with always-on AI chat support, grow
            online ticket sales with live booking tools, and turn insights into
            action — without adding to your team&apos;s workload.
          </p>
          <a className="btn btn-primary" href="/register-company">
            Register your company
          </a>
        </div>
        <div className="launch-visual">
          <img
            src="/venueflow/img/launch.jpg" width={900} height={600} loading="lazy" decoding="async"
            alt="Bright indoor adventure park with climbing walls"
          />
        </div>
      </section>

      <section className="feature-block vf-reveal" id="ticketing">
        <div className="feature-copy">
          <p className="eyebrow">Online ticket booking</p>
          <h2>Increase your online revenue</h2>
          <p>
            Entitled companies publish park pages and sell timed tickets, day
            passes, and parties online. Staff tools, payments, search/export,
            and HQ park scope are live — not every park is online by default;
            each venue must enable public booking. Guests book at{" "}
            <code>/book/&#123;venueSlug&#125;</code> when published.
          </p>
          <p id="marketplace">
            Marketplace booking packages are also live on Starter+: complete
            Connect payouts in company admin, publish a package, and guests pay
            at <code>/book/&#123;orgSlug&#125;/&#123;packageSlug&#125;</code>{" "}
            with funds settling to your connected account (FECSYNC application
            fee). Franchise parks under the same company can each complete park
            Connect so guest card money for that park settles to the park bank;
            software billing stays company-wide. POS terminal is live on Growth+.
            Digital Waivers (guest signing, desk verify, import/export, expiry
            reminders, and a booking confirmation link when a ticket requires
            one) are Growth+, not Starter.
          </p>
          <div className="stat-callout">
            <span className="stat-num">30%</span>
            <span className="stat-desc">
              increase in average online revenue with FECSYNC
            </span>
          </div>
          <blockquote>
            “We are making money while we sleep! Extra bookings come in overnight
            — and guests find it straightforward.”
            <cite>Alex Rivera · Owner, Dummy Playland</cite>
          </blockquote>
          <a className="text-link" href="/register-company?plan=starter">
            Start with Starter →
          </a>
        </div>
        <div className="feature-visual">
          <img
            src="/venueflow/img/feature-ticket.jpg" width={800} height={640} loading="lazy" decoding="async"
            alt="Smartphone showing a booking interface mock"
          />
        </div>
      </section>

      <section className="feature-block reverse vf-reveal" id="pos">
        <div className="feature-copy">
          <p className="eyebrow">Live on Growth+ · Ticketing POS</p>
          <h2>Sell faster &amp; keep lines flowing</h2>
          <p>
            Staff POS terminal is live on Growth+: sell pad (cash, in-browser
            card, or payment link), check-in, tills, tabs, and capacity under
            your company workspace with venue-scoped operations. The separate
            check-in scanner product and ticket-purchase kiosk remain later
            epics.
          </p>
          <blockquote>
            “Capacity stays shared with online bookings — one inventory story
            for the counter and the web.”
            <cite>Jordan Lee · Marketing Lead, Dummy Jump Co.</cite>
          </blockquote>
          <a className="text-link" href="#features">
            Explore point-of-sale →
          </a>
        </div>
        <div className="feature-visual">
          <img
            src="/venueflow/img/feature-pos.jpg" width={800} height={640} loading="lazy" decoding="async"
            alt="Staff member helping a guest at a counter"
          />
        </div>
      </section>

      <section className="feature-block vf-reveal" id="multi">
        <div className="feature-copy">
          <p className="eyebrow">Multi-venue management</p>
          <h2>Save time managing multiple venues</h2>
          <p>
            Register a company workspace, get FECSYNC approval, then subscribe in
            Billing to unlock creates. Add parks and sites under your plan
            (Starter 1 · Growth up to 5 · Enterprise unlimited by agreement).
            Entitled Enterprise unlocks the HQ multi-venue control plane —
            venue switcher and cross-park HQ dashboard (venues and park-stamped
            modules filtered; members roster stays company-wide). On Growth,
            company-wide seats get a park filter in admin chrome (no HQ rollup),
            and park assignments can lock seats to assigned venues without
            Enterprise. Ticketing staff catalog, public/admin booking wizards,
            HQ search, and bookings export are live on Starter+, along with
            marketplace booking packages (Connect payouts). POS terminal is live
            on Growth+. Digital Waivers on Growth+ include guest signing by link, QR,
            on-site, and kiosk, plus desk verify, import/export, expiry
            reminders, and a booking confirmation link when a ticket requires a
            waiver. Check-in blocking is a later phase.
          </p>
          <a className="text-link" href="/register-company">
            Register your company workspace →
          </a>
        </div>
        <div className="feature-visual">
          <img
            src="/venueflow/img/feature-multi.jpg" width={800} height={640} loading="lazy" decoding="async"
            alt="City skyline representing multi-location operations"
          />
        </div>
      </section>

      <section className="platform vf-reveal" id="features">
        <div className="platform-shell">
          <div className="platform-copy">
            <p className="eyebrow">Company workspace + modules</p>
            <h2>Run your business from one platform</h2>
            <p>
              Company admin and multi-park venues ship today. Modules unlock
              with your package — live tools for entitled companies, clear locks
              for Demo and Starter where they apply.
            </p>
            <ul className="feature-points">
              <li>Ticketing catalog + guest/staff booking wizards</li>
              <li>Marketplace packages with Connect payouts</li>
              <li>Digital Waivers &amp; POS terminal on Growth+</li>
              <li>Enterprise HQ for multi-venue control</li>
            </ul>
            <div className="hero-ctas">
              <a className="btn btn-primary" href="#pricing">
                See packages
              </a>
              <a className="btn btn-outline-dark" href="#waivers">
                Explore modules
              </a>
            </div>
          </div>
          <div className="platform-visual">
            <img
              src="/venueflow/img/platform.jpg"
              width={900}
              height={560}
              loading="lazy"
              decoding="async"
              alt="Laptop dashboard showing analytics charts"
            />
          </div>
        </div>
      </section>

      <section className="stats vf-reveal" id="about">
        <div className="section-head light">
          <h2>Supporting your business every step of the way</h2>
          <p>
            Whether you manage one venue or 100, FECSYNC is built to help you
            succeed.
          </p>
        </div>
        <div className="stats-grid">
          <div>
            <strong>280</strong>
            <span>team members</span>
          </div>
          <div>
            <strong>3,000+</strong>
            <span>customers</span>
          </div>
          <div>
            <strong>24/7</strong>
            <span>global support</span>
          </div>
          <div>
            <strong>8M</strong>
            <span>bookings / month</span>
          </div>
          <div>
            <strong>165M</strong>
            <span>guests served yearly</span>
          </div>
          <div>
            <strong>$5B</strong>
            <span>transactions processed</span>
          </div>
        </div>
      </section>

      <VenueFlowPricingSection />

      <VenueFlowMarketingBand />

      {/* Anchor stubs for mega-menu destinations without dedicated sections */}
      <div id="industries" className="sr-only" aria-hidden="true" />
      <div id="access" className="sr-only" aria-hidden="true" />
      <div id="surveys" className="sr-only" aria-hidden="true" />
      <div id="loyalty" className="sr-only" aria-hidden="true" />
      <div id="analytics" className="sr-only" aria-hidden="true" />
      <div id="grow" className="sr-only" aria-hidden="true" />

      <section className="feature-block vf-reveal" id="waivers">
        <div className="feature-copy">
          <p className="eyebrow">Digital Waivers · Growth+</p>
          <h2>Guests sign waivers before they arrive</h2>
          <p>
            Publish liability waivers and forms, then collect signatures by
            link, QR, on-site, or kiosk — before guests hit the gate.
          </p>
          <ul className="feature-points">
            <li>Templates, versions, and admission requirements</li>
            <li>Typed name, drawn signature, or both</li>
            <li>Desk search, verify, void, import &amp; export</li>
            <li>Booking confirmation link when a ticket needs one</li>
          </ul>
          <a className="text-link" href="/register-company?plan=growth">
            Choose Growth →
          </a>
        </div>
        <div className="feature-visual">
          <img
            src="/venueflow/img/sol-1.jpg"
            width={800}
            height={640}
            loading="lazy"
            decoding="async"
            alt="Guests completing a waiver on a tablet"
          />
        </div>
      </section>

      <section className="feature-block reverse vf-reveal" id="memberships">
        <div className="feature-copy">
          <p className="eyebrow">Guest park Memberships</p>
          <h2>Season and recurring memberships for Growth+</h2>
          <p>
            Sell and run park memberships from company admin — plans,
            eligibility, billing lifecycle, and guest self-serve in one place.
          </p>
          <ul className="feature-points">
            <li>Plans, CRM profiles &amp; multi-venue eligibility</li>
            <li>Sell, renew, pause, cancel &amp; recover payments</li>
            <li>Guest Profile → Memberships self-serve</li>
            <li>Redeem desk with CURRENT / VISITING / INELIGIBLE</li>
          </ul>
          <a className="text-link" href="/register-company?plan=growth">
            Unlock Memberships on Growth →
          </a>
        </div>
        <div className="feature-visual">
          <img
            src="/venueflow/img/sol-2.jpg"
            width={800}
            height={640}
            loading="lazy"
            decoding="async"
            alt="Members enjoying a park visit"
          />
        </div>
      </section>

      <section className="feature-block vf-reveal" id="enterprise">
        <div className="feature-copy">
          <p className="eyebrow">Enterprise</p>
          <h2>HQ multi-venue control plane</h2>
          <p>
            Switch parks, roll up health, and keep members company-wide —
            unlimited venues by agreement.
          </p>
          <ul className="feature-points">
            <li>Venue switcher + cross-park HQ dashboard</li>
            <li>Location scope on venues and park modules</li>
            <li>All Growth modules included</li>
            <li>Dedicated success contact</li>
          </ul>
          <a className="text-link" href="/register-company?plan=enterprise">
            Contact sales / register for Enterprise →
          </a>
        </div>
        <div className="feature-visual">
          <img
            src="/venueflow/img/feature-multi.jpg"
            width={800}
            height={640}
            loading="lazy"
            decoding="async"
            alt="Multi-location operations overview"
          />
        </div>
      </section>
      <div id="stories" className="sr-only" aria-hidden="true" />
      <div id="values" className="sr-only" aria-hidden="true" />
      <div id="blog" className="sr-only" aria-hidden="true" />
      <div id="academy" className="sr-only" aria-hidden="true" />
      <div id="demos" className="sr-only" aria-hidden="true" />
      <div id="help" className="sr-only" aria-hidden="true" />
      <div id="api" className="sr-only" aria-hidden="true" />
    </>
  );
}