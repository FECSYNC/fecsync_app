'use client';

import { ReactNode, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import Header from '../header/header';
import Footer from '../footer/footer';
import ChatBot from '@/components/Public_C/chatbot/ChatBot';
import VenueFlowHeader from '@/components/Public_C/venueflow/VenueFlowHeader';
import VenueFlowFooter from '@/components/Public_C/venueflow/VenueFlowFooter';
import '@/components/Public_C/venueflow/logo-lock.css';

/**
 * Inherited fashion-shop routes keep the old shop chrome (cart / Ready to Wear).
 * Everything else on the public surface uses FECSYNC VenueFlow nav + footer.
 */
const SHOP_CHROME_PREFIXES = [
  '/shop',
  '/cart',
  '/checkout',
  '/fabrics',
  '/trending-fashion',
  '/customize',
  '/tailors',
] as const;

function usesShopChrome(pathname: string | null): boolean {
  if (!pathname) return false;
  return SHOP_CHROME_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/**
 * Public chrome:
 * - /home uses its own VenueFlow landing shell (header/footer inside the page)
 * - FECSYNC product pages (/book, /booking, terms, …) → VenueFlowHeader
 * - Inherited shop routes → legacy shop Header (cart nav)
 * - /book/* must stay reachable for staff “Open booking”
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuthStore();
  const isLanding = pathname === '/home' || pathname === '/';
  const isPublicBooking = pathname === '/book' || pathname.startsWith('/book/');
  const shopChrome = usesShopChrome(pathname);
  const fecsyncChrome = !isLanding && !shopChrome;

  useEffect(() => {
    if (user?.role === 'admin' && !isLanding && !isPublicBooking) {
      router.push('/admin');
    }
  }, [user, router, isLanding, isPublicBooking]);

  useEffect(() => {
    if (!fecsyncChrome) return;
    document.documentElement.classList.add('vf-landing-page');
    document.body.classList.add('vf-landing-page');
    return () => {
      document.documentElement.classList.remove('vf-landing-page');
      document.body.classList.remove(
        'vf-landing-page',
        'announce-hidden',
        'drawer-open'
      );
    };
  }, [fecsyncChrome]);

  if (isLanding) {
    return <>{children}</>;
  }

  if (fecsyncChrome) {
    return (
      <>
        <VenueFlowHeader />
        <main className="min-h-screen min-w-0 overflow-x-hidden">{children}</main>
        <VenueFlowFooter />
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="min-h-screen min-w-0 overflow-x-hidden">{children}</main>
      <Footer />
      <ChatBot />
    </>
  );
}
