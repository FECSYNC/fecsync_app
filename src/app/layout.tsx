import type { Metadata, Viewport } from "next";
import { Geist_Mono, Mulish } from "next/font/google";
import "../app/globals.css";
import AuthBootstrap from "./auth-bootstrap";
import ClientSyncBootstrap from "@/components/common/ClientSyncBootstrap";
import DeferredCartHydration from "@/components/Public_C/cart/DeferredCartHydration";
import ToastContainer from '@/components/ui/toast-container';
import { ToastProvider } from '@/contexts/toast-context';
import { NavigationFeedbackProvider } from '@/contexts/navigation-feedback';
import { QueryProvider } from '@/providers/QueryProvider';
import MaintenanceWrapper from '@/components/common/MaintenanceWrapper';
import UserErrorBanner from '@/components/common/UserErrorBanner';
import SuspendedAccountGate from '@/components/common/SuspendedAccountGate';

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  fallback: ["ui-monospace", "monospace"],
});

const mulish = Mulish({
  variable: "--font-mulish",
  subsets: ["latin"],
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
  preload: true,
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "FECSYNC",
  description:
    "Everything your venue needs to move faster, simplify operations, and grow with confidence.",
  keywords: [
    "venue management",
    "ticketing",
    "attractions",
    "trampoline parks",
    "operations",
    "POS",
    "FECSYNC",
  ],
  authors: [{ name: "FECSYNC" }],
  creator: "FECSYNC",
  publisher: "FECSYNC",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_BASE_URL ||
      process.env.NEXT_PUBLIC_URL ||
      "https://fecsync.com"
  ),
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [{ url: "/brand/fecsync-mark.svg", type: "image/svg+xml" }],
    shortcut: ["/brand/fecsync-mark.svg"],
    apple: [{ url: "/apple-icon", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url:
      process.env.NEXT_PUBLIC_BASE_URL ||
      process.env.NEXT_PUBLIC_URL ||
      "https://fecsync.com",
    title: "FECSYNC",
    description:
      "Everything your venue needs to move faster, simplify operations, and grow with confidence.",
    siteName: "FECSYNC",
  },
  twitter: {
    card: "summary_large_image",
    title: "FECSYNC",
    description:
      "Everything your venue needs to move faster, simplify operations, and grow with confidence.",
    creator: "@fecsync",
    site: "@fecsync",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    google: "your-google-verification-code",
    yandex: "your-yandex-verification-code",
    yahoo: "your-yahoo-verification-code",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistMono.variable} ${mulish.variable}`}
      suppressHydrationWarning
    >
      <body
        data-gramm="false"
        className="antialiased font-sans "
        suppressHydrationWarning
      >
        <QueryProvider>
          <ToastProvider>
            <NavigationFeedbackProvider>
              <AuthBootstrap />
              <ClientSyncBootstrap />
              <DeferredCartHydration />
              <MaintenanceWrapper>
                {children}
              </MaintenanceWrapper>
              <UserErrorBanner />
              <SuspendedAccountGate />
              <ToastContainer />
            </NavigationFeedbackProvider>
          </ToastProvider>
        </QueryProvider>
      </body>
    </html>
  );
}