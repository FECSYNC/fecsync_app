'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight } from 'lucide-react';
import Image from 'next/image';
import { OpeningImageOverlay, useOpeningImage } from '@/components/common/OpeningImage';

interface AboutMenuProps {
  isMobile?: boolean;
}

const ABOUT_SRC = '/about_img.png';

const AboutMenu: React.FC<AboutMenuProps> = ({ isMobile = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Keep the same src always — switching to null on close remounted the loader on re-open/hover flicker.
  const { ready: imageReady, showLoader, onLoad: onImageLoad, setReady: setImageReady } =
    useOpeningImage(ABOUT_SRC);

  // Cached images often skip onLoad; mark ready when already decoded.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) {
      setImageReady(true);
    }
  }, [isOpen, setImageReady]);

  // Close menu when clicking outside (mobile + desktop)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  if (isMobile) {
    return (
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 text-white hover:text-[#FFE181] transition-colors cursor-pointer"
        >
          About
          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <div className="pt-4">
                <div className="bg-white rounded-lg p-4 text-gray-800 max-h-[45svh] overflow-y-auto">
                  <h3 className="text-lg font-semibold mb-2">About FECSYNC</h3>
                  <div className="h-px bg-gray-200/80 mb-4" />

                  <div className="space-y-4">
                    <div className="w-full">
                      <div className="relative w-full h-40 sm:h-48 rounded-lg overflow-hidden">
                        <OpeningImageOverlay
                          ready={imageReady}
                          show={showLoader}
                          className="rounded-lg bg-gray-100"
                        />
                        <Image
                          ref={imgRef}
                          src={ABOUT_SRC}
                          alt="FECSYNC About"
                          fill
                          className={`object-cover transition-opacity duration-300 ${
                            imageReady ? 'opacity-100' : 'opacity-0'
                          }`}
                          priority
                          onLoad={onImageLoad}
                        />
                      </div>
                    </div>

                    <div className="space-y-3 text-base sm:text-sm">
                      <p>
                        FECSYNC helps venue and attraction operators run bookings,
                        ticketing, marketplace packages with Connect payouts, and
                        multi-park operations from one workspace.
                      </p>
                      <p>
                        Register a company, get approved, subscribe to a plan, and manage
                        venues, staff, and guest-facing booking without stitching together
                        separate tools.
                      </p>
                      <p>
                        <span className="font-semibold text-[#D4AF37]">Our mission</span> is to
                        make venue operations simpler, faster, and ready to scale — from one
                        park to many.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Desktop: one hover zone for trigger + panel so moving onto the image
  // never closes/reopens the menu (that was remounting the picture + Opening…).
  return (
    <div
      className="relative"
      ref={menuRef}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <button
        type="button"
        className="flex items-center gap-2 text-white hover:text-[#FFE181] transition-colors cursor-pointer"
        aria-expanded={isOpen}
      >
        About
        <ChevronDown size={16} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            // Invisible bridge closes the gap under the trigger so the pointer
            // never "leaves" the hover zone on the way to the panel.
            className="absolute top-full -left-50 pt-2 w-[960px] max-w-[95vw] z-50"
          >
            <div className="bg-white rounded-lg shadow-xl border border-gray-200">
              <div className="p-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-2">
                  FECSYNC — venue operations, simplified
                </h3>
                <div className="h-px bg-gray-200/80 mb-6" />

                <div className="flex flex-col lg:flex-row gap-6">
                  <div className="w-full lg:w-2/5">
                    <div className="relative w-full h-48 lg:h-64 rounded-lg overflow-hidden">
                      <OpeningImageOverlay
                        ready={imageReady}
                        show={showLoader}
                        className="rounded-lg bg-gray-50"
                      />
                      <Image
                        ref={imgRef}
                        src={ABOUT_SRC}
                        alt="FECSYNC About"
                        fill
                        className={`object-cover transition-opacity duration-300 ${
                          imageReady ? 'opacity-100' : 'opacity-0'
                        }`}
                        priority
                        onLoad={onImageLoad}
                      />
                    </div>
                  </div>

                  <div className="hidden lg:block w-px bg-gray-200/80 mx-2" />

                  <div className="w-full lg:w-3/5 space-y-4 text-sm text-gray-700 leading-relaxed max-h-[400px] overflow-y-auto pr-2">
                    <p>
                      FECSYNC is built for parks, attractions, and multi-venue operators who
                      need online booking, ticketing, marketplace packages with Connect
                      payouts, and company admin in one place.
                    </p>
                    <p>
                      Company workspaces stay isolated. Guests book your published venues;
                      your team runs ops under your own brand — not a previous client&apos;s
                      storefront name.
                    </p>
                    <p>
                      <span className="font-semibold text-[#D4AF37]">Our mission</span> Make
                      venue operations simpler, faster, and ready to scale — from one site to
                      many.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AboutMenu;
