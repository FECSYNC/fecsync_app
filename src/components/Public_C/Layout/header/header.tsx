'use client';

import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Menu, X, ArrowUpRight, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// Phase two: re-enable promo announcement bar
// import AnnouncementBar from '../../Home/announcementBar';
import { useUIStore } from '@/store/uiStore';
import { useAuthStore } from '@/store/authStore';
import { useNavOpening } from '@/hooks/useNavOpening';
import CartButton from '../../cart/cart-button';
import UserMenu from '../../user-menu/user-menu';
import { FabricMenu } from '../../header_expandable_menu/fabric_menu';
import { AboutMenu } from '../../header_expandable_menu/about_menu';

const STOREFRONT_PREFETCH_ROUTES = [
  '/shop',
  '/tailors',
  '/customize',
  '/trending-fashion',
  '/fabrics',
  '/about',
  '/home',
] as const;

const navItems = [
  { label: 'Ready to Wear', href: '/shop', key: 'nav:shop' },
  { label: 'Find a Tailor', href: '/tailors', key: 'nav:tailors' },
  { label: 'Customization', href: '/customize', key: 'nav:customize' },
  { label: 'Trending Styles', href: '/trending-fashion', key: 'nav:trending' },
];

function NavOpeningLabel({
  label,
  busy,
  className = '',
}: {
  label: string;
  busy: boolean;
  className?: string;
}) {
  if (!busy) return <span className={className}>{label}</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <Loader2 size={14} className="animate-spin shrink-0" aria-hidden />
      <span>Opening…</span>
    </span>
  );
}

export default function Header() {
  const { isMobileNavOpen, toggleMobileNav, closeMobileNav } = useUIStore();
  const { user, isAuthenticated, isStaff } = useAuthStore();
  const [hideAnnouncement, setHideAnnouncement] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const pathname = usePathname();
  const headerRef = useRef<HTMLDivElement | null>(null);
  const { isBusy, navigate, prefetch } = useNavOpening();

  useEffect(() => {
    for (const href of STOREFRONT_PREFETCH_ROUTES) {
      prefetch(href);
    }
  }, [prefetch]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    setHideAnnouncement(isMobileNavOpen);
  }, [isMobileNavOpen]);

  // Lock page scroll while mobile nav is open
  useEffect(() => {
    if (!isMobileNavOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobileNavOpen]);

  // Measure and set header height as CSS variable
  useLayoutEffect(() => {
    const updateHeaderHeight = () => {
      if (headerRef.current) {
        const height = headerRef.current.offsetHeight;
        document.documentElement.style.setProperty('--header-height', `${height}px`);

        // Calculate total offset (announcement + header)
        const announcementHeight = parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--announcement-height') || '0'
        );
        document.documentElement.style.setProperty(
          '--total-header-offset',
          `${announcementHeight + height}px`
        );
      }
    };

    updateHeaderHeight();

    const ro = new ResizeObserver(updateHeaderHeight);
    if (headerRef.current) {
      ro.observe(headerRef.current);
    }

    window.addEventListener('resize', updateHeaderHeight);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateHeaderHeight);
    };
  }, []);

  const getCartUrl = () => '/cartt.png';

  // Show account UI as soon as we have a session user — do not wait for
  // background cookie refresh (that lag made the storefront look logged-out).
  const isLoggedIn = Boolean(user && isAuthenticated);

  const go = (key: string, href: string, closeMobile = false) => {
    if (closeMobile) closeMobileNav();
    navigate(key, href);
  };

  return (
    <>
      {/* Phase two: promo announcement bar */}
      {/* {!hideAnnouncement && <AnnouncementBar />} */}

      <header
        ref={headerRef}
        className="w-full bg-black border-b border-gray-700 sticky z-40"
        style={{
          top: 'var(--announcement-height, 0px)',
          transition: 'top 250ms ease',
        }}
      >
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => go('nav:home', '/home')}
            className="relative"
            aria-label="FECSYNC home"
          >
            <Image
              src="/logo.webp"
              alt="FECSYNC Logo"
              width={120}
              height={40}
              priority
              style={{ width: "auto", height: "auto" }}
            />
            {isBusy('nav:home') && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/50 rounded">
                <Loader2 size={18} className="animate-spin text-[#FFE181]" />
              </span>
            )}
          </button>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex gap-6 items-center text-sm text-white font-medium flex-1 justify-center">
            <FabricMenu />
            <AboutMenu />
            {navItems.map(({ label, href, key }) => {
              const isActive = pathname === href;
              const busy = isBusy(key);
              return (
                <motion.div key={key} whileHover={{ scale: 1.05 }}>
                  <button
                    type="button"
                    onClick={() => go(key, href)}
                    onMouseEnter={() => prefetch(href)}
                    aria-busy={busy}
                    className={`transition-colors ${
                      busy || isActive
                        ? 'text-[#FFE181]'
                        : 'hover:text-[#FFE181]'
                    }`}
                  >
                    <NavOpeningLabel label={label} busy={busy} />
                  </button>
                </motion.div>
              );
            })}
          </nav>

          {/* Desktop Right (Avatar/Name first, then Cart) */}
          <div className="hidden md:flex items-center gap-4 ml-8">
            {isLoggedIn ? (
              <>
                {isStaff() && (
                  <button
                    type="button"
                    onClick={() => go('nav:admin', '/admin')}
                    className="text-[#FFE181] text-sm font-medium hover:text-white transition-colors whitespace-nowrap"
                  >
                    <NavOpeningLabel label="Dashboard" busy={isBusy('nav:admin')} />
                  </button>
                )}
                <UserMenu desktop className="ml-2" />
              </>
            ) : (
              <>
                <motion.div whileHover={{ scale: 1.05 }}>
                  <button
                    type="button"
                    onClick={() => go('nav:signup', '/register-company')}
                    className="border border-white text-[#D4AF37] px-4 py-1 rounded-full font-semibold hover:bg-white hover:text-black transition-colors"
                  >
                    <NavOpeningLabel label="Sign Up" busy={isBusy('nav:signup')} />
                  </button>
                </motion.div>
                <motion.div whileHover={{ scale: 1.05 }}>
                  <button
                    type="button"
                    onClick={() => go('nav:signin', '/signin')}
                    className="bg-[#FFE181] text-black flex items-center gap-1 px-3 py-1 rounded-full font-semibold hover:bg-yellow-200 transition-colors"
                  >
                    {isBusy('nav:signin') ? (
                      <NavOpeningLabel label="Login" busy />
                    ) : (
                      <>
                        Login <ArrowUpRight size={16} />
                      </>
                    )}
                  </button>
                </motion.div>
              </>
            )}

            {/* Cart after avatar/name — with extra space */}
            <CartButton size={32} getCartIconUrl={getCartUrl} className="ml-8" />
          </div>

          {/* Mobile Right (Avatar circle first, then Cart) */}
          <div className="md:hidden flex items-center gap-6">
            {isLoggedIn && <UserMenu desktop={false} />}
            <CartButton size={24} getCartIconUrl={getCartUrl} preflight={false} />
            <button
              onClick={toggleMobileNav}
              className="md:hidden text-white"
              aria-label="Toggle navigation"
            >
              {isMobileNavOpen ? <X size={30} /> : <Menu size={30} />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile nav rendered on document.body so it isn't clipped by sticky header */}
      {isMounted &&
        createPortal(
          <AnimatePresence>
            {isMobileNavOpen && (
              <>
                <motion.div
                  className="md:hidden fixed inset-0 bg-black/60 z-[200]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  onClick={closeMobileNav}
                />

                <motion.div
                  className="md:hidden fixed inset-x-0 top-0 w-full bg-black px-5 text-white text-base font-medium flex flex-col z-[201] overflow-hidden h-svh max-h-svh supports-[height:100dvh]:h-dvh supports-[height:100dvh]:max-h-dvh pt-[env(safe-area-inset-top,0px)]"
                  style={{ height: '100dvh', maxHeight: '100dvh' }}
                  initial={{ x: '-100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '-100%' }}
                  transition={{ duration: 0.3, ease: 'easeInOut' }}
                >
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.1 }}
                    className="flex items-center justify-between py-3 border-b border-gray-700 mb-2 flex-shrink-0"
                  >
                    <button
                      type="button"
                      onClick={() => go('nav:home', '/home', true)}
                      className="relative"
                      aria-label="FECSYNC home"
                    >
                      <Image
                        src="/logo.webp"
                        alt="FECSYNC Logo"
                        width={120}
                        height={40}
                        priority
                        style={{ width: "auto", height: "auto" }}
                      />
                      {isBusy('nav:home') && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/50 rounded">
                          <Loader2 size={18} className="animate-spin text-[#FFE181]" />
                        </span>
                      )}
                    </button>
                    <button
                      onClick={closeMobileNav}
                      className="text-white p-1"
                      aria-label="Close navigation"
                    >
                      <X size={30} />
                    </button>
                  </motion.div>

                  <div className="flex-1 overflow-y-auto min-h-0 overscroll-y-contain [-webkit-overflow-scrolling:touch]">
                    <div className="flex flex-col space-y-3 pt-2 pb-2">
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: 0.15 }}
                      >
                        <FabricMenu isMobile={true} />
                      </motion.div>
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: 0.2 }}
                      >
                        <AboutMenu isMobile={true} />
                      </motion.div>
                      {navItems.map(({ label, href, key }, index) => {
                        const busy = isBusy(key);
                        return (
                          <motion.div
                            key={key}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.3, delay: 0.25 + index * 0.05 }}
                          >
                            <button
                              type="button"
                              onClick={() => go(key, href, true)}
                              aria-busy={busy}
                              className={`block w-full text-left py-2.5 px-2 text-base transition-colors ${
                                busy ? 'text-[#FFE181]' : 'hover:text-[#FFE181]'
                              }`}
                            >
                              <NavOpeningLabel label={label} busy={busy} />
                            </button>
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.4 }}
                    className="flex flex-col space-y-3 pt-4 flex-shrink-0 border-t border-gray-700 mt-auto pb-[max(1rem,env(safe-area-inset-bottom,0px))]"
                  >
                    {!isLoggedIn && (
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => go('nav:signup', '/register-company', true)}
                          className="flex-1 border border-white text-[#D4AF37] text-center px-4 py-3 rounded-full hover:bg-white hover:text-black transition-colors text-sm font-medium"
                        >
                          <NavOpeningLabel label="Sign Up" busy={isBusy('nav:signup')} />
                        </button>
                        <button
                          type="button"
                          onClick={() => go('nav:signin', '/signin', true)}
                          className="flex-1 bg-[#FFE181] text-black text-center px-4 py-3 rounded-full hover:bg-yellow-200 transition-colors text-sm font-medium"
                        >
                          <NavOpeningLabel label="Login" busy={isBusy('nav:signin')} />
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => go('nav:customize-cta', '/customize', true)}
                      className="bg-[#F4D35E] text-black text-center text-sm py-3 rounded-full hover:bg-[#F4D35E]/90 transition-colors font-medium"
                    >
                      <NavOpeningLabel
                        label="Customise Your Fabric"
                        busy={isBusy('nav:customize-cta')}
                      />
                    </button>
                  </motion.div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}
