import Link from "next/link";
import { BrandMark } from "./BrandMark";

export default function VenueFlowFooter() {
  return (
    <footer className="site-footer" id="contact">
      <div className="footer-grid">
        <div className="footer-brand">
          <Link className="brand" href="/home">
            <BrandMark variant="footer" />
            <span className="brand-name">FECSYNC</span>
          </Link>
          <p>
            Company SaaS for multi-park operators — venues, team, billing,
            Enterprise HQ, online ticketing (catalog, guest/staff wizards, HQ
            search &amp; bookings export), guest Memberships sell, lifecycle
            billing &amp; redeem/verify, guest self-serve &amp; reports on Growth+, and marketplace booking
            packages with Connect payouts today; POS terminal live on Growth+;
            loyalty and other guest modules still shipping.
          </p>
        </div>
        <div>
          <h4>Features</h4>
          <a href="/home#multi">Multi-venue &amp; park admins</a>
          <a href="/home#enterprise">Enterprise HQ (shipped)</a>
          <a href="/home#ticketing">Online Ticketing</a>
          <a href="/home#memberships">Memberships (Growth+ sell, self-serve &amp; reports)</a>
          <a href="/home#marketplace">Marketplace packages (shipped)</a>
          <a href="/home#pos">Point of Sale (Growth+)</a>
          <a href="/home#pricing">Plans &amp; pricing</a>
        </div>
        <div>
          <h4>Industries</h4>
          <a href="/home#industries">Trampoline Parks</a>
          <a href="/home#industries">Playcenters</a>
          <a href="/home#industries">Museums</a>
          <a href="/home#industries">Climbing</a>
        </div>
        <div>
          <h4>Company</h4>
          <a href="/home#about">About</a>
          <a href="/home#stories">Stories</a>
          <a href="/home#help">Help</a>
          <a href="/signin">Sign in</a>
        </div>
      </div>
      <div className="footer-bottom">
        <p>© {new Date().getFullYear()} FECSYNC</p>
        <div className="footer-links">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
        </div>
      </div>
    </footer>
  );
}
