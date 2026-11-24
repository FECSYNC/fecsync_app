"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAuthStore } from "@/store/authStore";
import { sessionIsStaff } from "@/lib/auth/session";
import { signInHref } from "@/utils/authRedirect";
import { useMarketingOverview } from "@/hooks/useMarketing";

const MARKETING_NEWSLETTER_PATH = "/admin/marketing?tab=newsletter";
const MARKETING_OVERVIEW_PATH = "/admin/marketing";

/**
 * Guest Marketing band — uses the same feature-block grid as Ticketing/POS
 * (styles from /venueflow/styles.css).
 */
export default function VenueFlowMarketingBand() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const staffSignedIn = Boolean(
    isAuthenticated && user && sessionIsStaff(user)
  );
  const orgSlug = user?.organizationSlug?.trim() || "";
  const publicNewsletterHref = orgSlug ? `/${orgSlug}/newsletter` : "";

  const signInToNewsletter = useMemo(
    () => signInHref(MARKETING_NEWSLETTER_PATH),
    []
  );

  const overview = useMarketingOverview(null, { enabled: staffSignedIn });
  const syncing = overview.isFetching && !overview.isLoading;
  const optedIn = overview.data?.optedInLeadCount ?? 0;

  return (
    <section className="feature-block reverse vf-reveal mkt-feature" id="get-started">
      <div className="feature-copy">
        <p className="eyebrow">Guest marketing · Growth+</p>
        <h2>Keep guests coming back with inbox-ready welcome moments</h2>
        <p>
          Capture email opt-ins without a waiver, send welcome and birthday
          notes, and invite post-visit feedback — from one company desk that
          stays in sync with your park operations.
        </p>
        <ul className="feature-points">
          <li>On-brand public signup for park guests</li>
          <li>Welcome, birthday, and re-engagement automations</li>
          <li>Post-visit surveys with live response counts</li>
        </ul>

        <div className="mkt-feature-ctas">
          {staffSignedIn ? (
            <>
              <Link href={MARKETING_NEWSLETTER_PATH} className="btn btn-primary">
                Open Marketing desk
              </Link>
              {publicNewsletterHref ? (
                <Link
                  href={publicNewsletterHref}
                  className="btn btn-outline-dark"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Preview guest signup
                </Link>
              ) : (
                <Link href={MARKETING_OVERVIEW_PATH} className="btn btn-outline-dark">
                  Marketing overview
                </Link>
              )}
            </>
          ) : (
            <>
              <Link
                href="/register-company?plan=growth"
                className="btn btn-primary"
              >
                Start with Growth
              </Link>
              <Link href={signInToNewsletter} className="btn btn-outline-dark">
                Staff sign in
              </Link>
            </>
          )}
        </div>

        {staffSignedIn ? (
          <p className="mkt-feature-live" role="status">
            <span
              className={`mkt-feature-live-dot${syncing ? " is-syncing" : ""}`}
              aria-hidden
            />
            {syncing ? "Syncing…" : "Live"}
            {!overview.isLoading
              ? ` · ${optedIn.toLocaleString()} opted-in lead${optedIn === 1 ? "" : "s"}`
              : null}
          </p>
        ) : (
          <p className="mkt-feature-note">
            Guests subscribe without an account. Staff sign in to share your
            park&apos;s signup page from the Marketing desk.
          </p>
        )}
      </div>

      <div className="feature-visual mkt-feature-visual">
        <img
          src="/venueflow/img/feature-ticket.jpg"
          width={800}
          height={640}
          loading="lazy"
          decoding="async"
          alt="Guest holding a phone with a digital ticket and park updates"
        />
        <div className="mkt-feature-badge" aria-hidden>
          <span className="mkt-feature-badge-dot" />
          Live guest KPIs
        </div>
        <div className="mkt-feature-chip" aria-hidden>
          <strong>Welcome</strong>
          <span>Automation ready</span>
        </div>
      </div>
    </section>
  );
}
