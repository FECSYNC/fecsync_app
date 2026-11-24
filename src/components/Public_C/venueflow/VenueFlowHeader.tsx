"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/store/authStore";
import { isTailorProviderPreset } from "@/lib/auth/permissions";
import UserMenu from "@/components/Public_C/user-menu/user-menu";
import { BrandMark } from "./BrandMark";

type MegaId = "features" | "industries" | "solutions" | "why";

const MOBILE_NAV_MAX = 1099;

function Chev() {
  return (
    <svg className="chev" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M2.5 4.5L6 8l3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function VenueFlowHeader() {
  const headerRef = useRef<HTMLElement | null>(null);
  const drawerPanelRef = useRef<HTMLDivElement | null>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [announceHidden, setAnnounceHidden] = useState(false);
  const [openMega, setOpenMega] = useState<MegaId | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [compactHeaderActions, setCompactHeaderActions] = useState(false);
  const { user, isAuthenticated, isStaff, hasHydratedAuth } = useAuthStore();
  const isLoggedIn = Boolean(hasHydratedAuth && user && isAuthenticated);
  const isTailor =
    isLoggedIn &&
    !isStaff() &&
    isTailorProviderPreset(user?.preset, user?.membershipRole);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_NAV_MAX}px)`);
    const sync = () => setCompactHeaderActions(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem("vf-announce-hidden") === "1") {
        setAnnounceHidden(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("drawer-open", drawerOpen);
    return () => document.body.classList.remove("drawer-open");
  }, [drawerOpen]);

  const isMobileNav = useCallback(
    () => window.matchMedia(`(max-width: ${MOBILE_NAV_MAX}px)`).matches,
    []
  );

  const canHover = useCallback(
    () => window.matchMedia("(hover: hover) and (pointer: fine)").matches,
    []
  );

  const closeMegas = useCallback(() => setOpenMega(null), []);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearMegaCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleCloseMegas = useCallback(() => {
    clearMegaCloseTimer();
    // Let the pointer cross the gap between the trigger and the panel.
    closeTimerRef.current = setTimeout(() => {
      setOpenMega(null);
      closeTimerRef.current = null;
    }, 220);
  }, [clearMegaCloseTimer]);

  const openMegaPanel = useCallback(
    (id: MegaId) => {
      if (isMobileNav()) return;
      clearMegaCloseTimer();
      setOpenMega(id);
    },
    [clearMegaCloseTimer, isMobileNav]
  );

  useEffect(() => () => clearMegaCloseTimer(), [clearMegaCloseTimer]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      // Keep open while interacting with the header (triggers + mega panel).
      if (!headerRef.current?.contains(t)) {
        clearMegaCloseTimer();
        closeMegas();
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [clearMegaCloseTimer, closeMegas]);

  useEffect(() => {
    let wasMobile = isMobileNav();
    const onResize = () => {
      const now = isMobileNav();
      if (now !== wasMobile) {
        closeMegas();
        if (!now) setDrawerOpen(false);
        wasMobile = now;
      }
    };
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, [closeMegas, isMobileNav]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeMegas();
        setDrawerOpen(false);
        return;
      }
      if (e.key !== "Tab" || !drawerOpen || !drawerPanelRef.current) return;
      const focusable = [
        ...drawerPanelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), summary, input, [tabindex]:not([tabindex="-1"])'
        ),
      ].filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeMegas, drawerOpen]);

  const dismissAnnounce = () => {
    setAnnounceHidden(true);
    try {
      sessionStorage.setItem("vf-announce-hidden", "1");
    } catch {
      /* ignore */
    }
  };

  const openDrawer = () => {
    lastFocused.current = document.activeElement as HTMLElement | null;
    setDrawerOpen(true);
    closeMegas();
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    lastFocused.current?.focus?.();
  };

  const megaProps = (id: MegaId) => ({
    onMouseEnter: () => {
      if (canHover() && !isMobileNav()) openMegaPanel(id);
    },
    className: `nav-item has-mega${openMega === id ? " is-open" : ""}`,
  });

  return (
    <>
      {!announceHidden && (
        <div className="announce" id="announce">
          <p>
            <span className="announce-copy-full">
              Meet Flow Agent — your always-on AI teammate. Plus more in our
              Spring 2026 Launch.
            </span>
            <span className="announce-copy-short">
              Meet Flow Agent — Spring 2026 Launch.
            </span>{" "}
            <a href="/home#launch">Explore the launch</a>
          </p>
          <button
            className="announce-close"
            type="button"
            aria-label="Dismiss announcement"
            onClick={dismissAnnounce}
          >
            &times;
          </button>
        </div>
      )}

      <header
        ref={headerRef}
        className={`site-header${scrolled ? " is-scrolled" : ""}`}
        id="siteHeader"
        onMouseEnter={() => {
          if (canHover() && !isMobileNav()) clearMegaCloseTimer();
        }}
        onMouseLeave={() => {
          if (canHover() && !isMobileNav()) scheduleCloseMegas();
        }}
      >
        <div className="nav-shell">
          <Link className="brand" href="/home" aria-label="FECSYNC home">
            <BrandMark />
            <span className="brand-name">FECSYNC</span>
          </Link>

          <nav
            className="primary-nav"
            id="primaryNav"
            aria-label="Main"
          >
            <ul className="nav-list">
              <li {...megaProps("features")}>
                <button
                  className="nav-trigger"
                  type="button"
                  aria-expanded={openMega === "features"}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isMobileNav()) return;
                    setOpenMega((cur) =>
                      cur === "features" ? null : "features"
                    );
                  }}
                >
                  Features
                  <Chev />
                </button>
                <div className="mega" id="mega-features">
                  <div className="mega-inner">
                    <div className="mega-intro">
                      <p className="mega-kicker">Company SaaS control plane + modules</p>
                      <h3>Shipped venues, HQ, ticketing &amp; marketplace payouts</h3>
                      <a className="mega-link-cta" href="/home#enterprise">
                        Enterprise HQ (shipped) →
                      </a>
                    </div>
                    <div className="mega-cols">
                      <div className="mega-col">
                        <h4>Sell online &amp; in-venue</h4>
                        <a href="/home#ticketing">Online Ticketing</a>
                        <a href="/home#marketplace">Marketplace packages (shipped)</a>
                        <a href="/home#pos">Point of Sale (Growth+)</a>
                        <a href="/home#memberships">
                          Memberships (Growth+ sell, self-serve &amp; reports)
                        </a>
                      </div>
                      <div className="mega-col">
                        <h4>Serve your guests</h4>
                        <a href="/home#waivers">
                          Digital Waivers (Growth+ signing and desk)
                        </a>
                        <a href="/home#access">Access Control (roadmap)</a>
                        <a href="/admin/marketing/surveys">Guest surveys (Growth+)</a>
                      </div>
                      <div className="mega-col">
                        <h4>Grow the business</h4>
                        <a href="/home#loyalty">Loyalty (roadmap)</a>
                        <a href="/home#pricing">Plans &amp; pricing (live)</a>
                        <a href="/home#analytics">Reporting (roadmap)</a>
                      </div>
                    </div>
                    <aside className="mega-spotlight">
                      <img
                        src="https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=640&q=80"
                        alt="Indoor trampoline park with colorful lighting"
                      />
                      <div>
                        <p className="mega-kicker">Product spotlight</p>
                        <strong>Intelligence in action</strong>
                        <p>
                          AI and automation are now built into every
                          FECSYNC workflow.
                        </p>
                        <a href="/home#launch">Explore the launch →</a>
                      </div>
                    </aside>
                  </div>
                </div>
              </li>

              <li {...megaProps("industries")}>
                <button
                  className="nav-trigger"
                  type="button"
                  aria-expanded={openMega === "industries"}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isMobileNav()) return;
                    setOpenMega((cur) =>
                      cur === "industries" ? null : "industries"
                    );
                  }}
                >
                  Industries
                  <Chev />
                </button>
                <div className="mega" id="mega-industries">
                  <div className="mega-inner mega-industries">
                    <div className="mega-intro">
                      <p className="mega-kicker">Built for operators like you</p>
                      <h3>
                        See how venues in your category use FECSYNC
                      </h3>
                    </div>
                    <div className="industry-grid">
                      <a href="/home#industries">
                        <span className="ind-icon" data-i="tp" />
                        Trampoline Parks
                      </a>
                      <a href="/home#industries">
                        <span className="ind-icon" data-i="pc" />
                        Playcenters
                      </a>
                      <a href="/home#industries">
                        <span className="ind-icon" data-i="wp" />
                        Wake Parks
                      </a>
                      <a href="/home#industries">
                        <span className="ind-icon" data-i="rs" />
                        Roller Skating
                      </a>
                      <a href="/home#industries">
                        <span className="ind-icon" data-i="ec" />
                        Entertainment Centers
                      </a>
                      <a href="/home#industries">
                        <span className="ind-icon" data-i="mu" />
                        Museums
                      </a>
                      <a href="/home#industries">
                        <span className="ind-icon" data-i="za" />
                        Zoos &amp; Aquariums
                      </a>
                      <a href="/home#industries">
                        <span className="ind-icon" data-i="rc" />
                        Rock Climbing
                      </a>
                    </div>
                  </div>
                </div>
              </li>

              <li {...megaProps("solutions")}>
                <button
                  className="nav-trigger"
                  type="button"
                  aria-expanded={openMega === "solutions"}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isMobileNav()) return;
                    setOpenMega((cur) =>
                      cur === "solutions" ? null : "solutions"
                    );
                  }}
                >
                  Solutions
                  <Chev />
                </button>
                <div className="mega" id="mega-solutions">
                  <div className="mega-inner mega-solutions">
                    <a className="solution-card" href="/home#grow">
                      <img
                        src="https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=480&q=80"
                        alt="Guests enjoying an entertainment venue"
                      />
                      <div>
                        <h4>Growing your business</h4>
                        <p>
                          Save time, empower decisions, and increase revenue from
                          day one.
                        </p>
                      </div>
                    </a>
                    <a className="solution-card" href="/home#multi">
                      <img
                        src="https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=480&q=80"
                        alt="Team collaborating in a modern office"
                      />
                      <div>
                        <h4>Scaling multi-venues</h4>
                        <p>
                          One company workspace for many parks — Growth adds a
                          park filter and park-lock seats; entitled Enterprise
                          unlocks the HQ multi-venue control plane (venue
                          switcher + cross-park dashboard). Fashion catalog stays
                          company-wide; ticketing staff catalog is park-scoped
                          when a park is selected.
                        </p>
                      </div>
                    </a>
                    <a className="solution-card" href="/home#enterprise">
                      <img
                        src="https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=480&q=80"
                        alt="Large event crowd with stage lights"
                      />
                      <div>
                        <h4>Enterprise HQ</h4>
                        <p>
                          Venue switcher, cross-park HQ dashboard, and unlimited
                          venues by agreement — company admin only when
                          entitled. Ticketing and marketplace booking packages
                          (Connect payouts) are live on Starter+. Staff Digital
                          Waivers are Growth+. Guests can sign from a link or kiosk. POS terminal is live on Growth+.
                        </p>
                      </div>
                    </a>
                  </div>
                </div>
              </li>

              <li {...megaProps("why")}>
                <button
                  className="nav-trigger"
                  type="button"
                  aria-expanded={openMega === "why"}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isMobileNav()) return;
                    setOpenMega((cur) => (cur === "why" ? null : "why"));
                  }}
                >
                  Why FECSYNC?
                  <Chev />
                </button>
                <div className="mega" id="mega-why">
                  <div className="mega-inner mega-why">
                    <div className="mega-cols">
                      <div className="mega-col">
                        <h4>Company</h4>
                        <a href="/home#about">About us</a>
                        <a href="/home#stories">Customer stories</a>
                        <a href="/home#values">Our values</a>
                      </div>
                      <div className="mega-col">
                        <h4>Learn</h4>
                        <a href="/home#blog">Blog</a>
                        <a href="/home#academy">Academy</a>
                        <a href="/home#demos">Demo videos</a>
                      </div>
                      <div className="mega-col">
                        <h4>Support</h4>
                        <a href="/home#help">Help center</a>
                        <a href="/home#api">API docs</a>
                        <a href="/home#contact">Contact support</a>
                      </div>
                    </div>
                    <aside className="mega-spotlight compact">
                      <div>
                        <p className="mega-kicker">What&apos;s new</p>
                        <strong>2026 Benchmark Report</strong>
                        <p>
                          Get ahead with insights from 2,800+ attraction
                          operators.
                        </p>
                        <a href="/home#blog">Unlock insights →</a>
                      </div>
                    </aside>
                  </div>
                </div>
              </li>

              <li className="nav-item">
                <a className="nav-link" href="/home#pricing">
                  Pricing
                </a>
              </li>
            </ul>
          </nav>

          <div className="nav-actions">
            {!hasHydratedAuth ? (
              <span className="nav-auth-slot" aria-hidden="true" />
            ) : isLoggedIn ? (
              <>
                {isStaff() && (
                  <Link className="btn btn-ghost" href="/admin">
                    Dashboard
                  </Link>
                )}
                {isTailor && (
                  <Link className="btn btn-ghost" href="/tailor/home">
                    Studio
                  </Link>
                )}
                <UserMenu
                  desktop={!compactHeaderActions}
                  className="vf-user-menu"
                />
              </>
            ) : (
              <>
                {/* Plain <a>: soft Link nav to auth layouts often stalls in dev. */}
                <a className="btn btn-gold" href="/signin">
                  Sign in
                </a>
                <a className="btn btn-primary" href="/register-company">
                  Sign up
                </a>
              </>
            )}
            <button
              className={`menu-toggle${drawerOpen ? " is-open" : ""}`}
              id="menuToggle"
              type="button"
              aria-label={drawerOpen ? "Close menu" : "Open menu"}
              aria-expanded={drawerOpen}
              onClick={() => (drawerOpen ? closeDrawer() : openDrawer())}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>
      </header>

      <div
        className="mobile-drawer"
        id="mobileDrawer"
        hidden={!drawerOpen}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeDrawer();
        }}
      >
        <div
          className="drawer-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          ref={drawerPanelRef}
        >
          <div className="drawer-head">
            <a className="drawer-brand" href="/home" onClick={closeDrawer}>
              <BrandMark />
              <span className="drawer-brand-text">
                <span className="drawer-brand-name">FECSYNC</span>
                <span className="drawer-brand-tag">Venue platform</span>
              </span>
            </a>
            <button
              type="button"
              className="drawer-close"
              aria-label="Close menu"
              onClick={closeDrawer}
            >
              &times;
            </button>
          </div>
          <p className="drawer-kicker">Explore</p>
          <nav className="drawer-nav" aria-label="Mobile">
            <details>
              <summary>Features</summary>
              <a href="/home#ticketing" onClick={closeDrawer}>
                Online Ticketing
              </a>
              <a href="/home#marketplace" onClick={closeDrawer}>
                Marketplace packages (shipped)
              </a>
              <a href="/home#pos" onClick={closeDrawer}>
                Point of Sale (Growth+)
              </a>
              <a href="/home#memberships" onClick={closeDrawer}>
                Memberships (Growth+ sell, self-serve &amp; reports)
              </a>
              <a href="/home#waivers" onClick={closeDrawer}>
                Digital Waivers (Growth+ signing and desk)
              </a>
              <a href="/home#enterprise" onClick={closeDrawer}>
                Enterprise HQ (shipped)
              </a>
              <a href="/home#analytics" onClick={closeDrawer}>
                Reporting (roadmap)
              </a>
              <a href="/home#features" onClick={closeDrawer}>
                See all features
              </a>
            </details>
            <details>
              <summary>Industries</summary>
              <a href="/home#industries" onClick={closeDrawer}>
                Trampoline Parks
              </a>
              <a href="/home#industries" onClick={closeDrawer}>
                Playcenters
              </a>
              <a href="/home#industries" onClick={closeDrawer}>
                Wake Parks
              </a>
              <a href="/home#industries" onClick={closeDrawer}>
                Entertainment Centers
              </a>
              <a href="/home#industries" onClick={closeDrawer}>
                Museums
              </a>
              <a href="/home#industries" onClick={closeDrawer}>
                Climbing
              </a>
            </details>
            <details>
              <summary>Solutions</summary>
              <a href="/home#grow" onClick={closeDrawer}>
                Growing your business
              </a>
              <a href="/home#multi" onClick={closeDrawer}>
                Scaling multi-venues
              </a>
              <a href="/home#enterprise" onClick={closeDrawer}>
                Enterprise HQ
              </a>
            </details>
            <details>
              <summary>Why us?</summary>
              <a href="/home#about" onClick={closeDrawer}>
                About us
              </a>
              <a href="/home#stories" onClick={closeDrawer}>
                Customer stories
              </a>
              <a href="/home#blog" onClick={closeDrawer}>
                Blog
              </a>
              <a href="/home#academy" onClick={closeDrawer}>
                Academy
              </a>
              <a href="/home#help" onClick={closeDrawer}>
                Help center
              </a>
              <a href="/home#api" onClick={closeDrawer}>
                API docs
              </a>
            </details>
            <a className="drawer-link" href="/home#pricing" onClick={closeDrawer}>
              Pricing
            </a>
            <a className="drawer-link" href="/home#launch" onClick={closeDrawer}>
              Product launch
            </a>
          </nav>
          <div className="drawer-actions">
            {!hasHydratedAuth ? null : isLoggedIn ? (
              <>
                <div className="drawer-user-row">
                  <UserMenu desktop={false} className="vf-user-menu" />
                  <span className="drawer-user-label">Your account</span>
                </div>
                {isStaff() && (
                  <Link
                    className="btn btn-ghost"
                    href="/admin"
                    onClick={closeDrawer}
                  >
                    Dashboard
                  </Link>
                )}
                {isTailor && (
                  <Link
                    className="btn btn-ghost"
                    href="/tailor/home"
                    onClick={closeDrawer}
                  >
                    Studio
                  </Link>
                )}
                <Link
                  className="btn btn-primary"
                  href="/profile"
                  onClick={closeDrawer}
                >
                  Open profile
                </Link>
              </>
            ) : (
              <>
                <a
                  className="btn btn-gold"
                  href="/signin"
                  onClick={closeDrawer}
                >
                  Sign in
                </a>
                <a
                  className="btn btn-primary"
                  href="/register-company"
                  onClick={closeDrawer}
                >
                  Sign up
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
