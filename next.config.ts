import type { NextConfig } from "next";
import { RESERVED_FIRST_SEGMENTS } from "./src/lib/publicCategory/slug";

const nextConfig: NextConfig = {
  /* config options here */
  // Allow LAN IP access in dev (Next.js 16 blocks cross-origin dev assets by default).
  allowedDevOrigins: process.env.DEV_ALLOWED_ORIGINS
    ? process.env.DEV_ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
    : ["172.20.240.1"],
  // Hide the floating Next.js "N" badge in local development
  devIndicators: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        port: "",
        pathname: "/**",
      },
    ],
  },
  logging: {
    fetches: {
      fullUrl: true,
      hmrRefreshes: true,
    },
  },
  typescript: {
    // Ignore TypeScript errors during build
    ignoreBuildErrors: true,
  },
  async redirects() {
    return [
      {
        source: "/login",
        destination: "/signin",
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/sign/:orgSlug/:venueSlug/:token",
        destination: "/sign/:token?orgSlug=:orgSlug&venueSlug=:venueSlug",
      },
    ];
  },
  async headers() {
    const frameHeaders = [{ key: "X-Frame-Options", value: "SAMEORIGIN" }];
    // Company category pages (/{orgSlug}/{categorySlug}/…) are the only paths
    // without SAMEORIGIN; src/proxy.ts sends their CSP frame-ancestors instead.
    const appFirstSegments = RESERVED_FIRST_SEGMENTS.join("|");
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
    ];
    if (process.env.NODE_ENV === "development") {
      securityHeaders.push({
        key: "Cache-Control",
        value: "no-store, no-cache, must-revalidate",
      });
    }
    if (process.env.NODE_ENV === "production") {
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      });
    }
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      { source: "/", headers: frameHeaders },
      { source: "/:first", headers: frameHeaders },
      { source: `/:first(${appFirstSegments})/:rest*`, headers: frameHeaders },
    ];
  },
};

export default nextConfig;
