'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useFabricsQuery } from '@/hooks/useFabrics';
import { useNavOpening } from '@/hooks/useNavOpening';
import { useUIStore } from '@/store/uiStore';
import { type Fabric } from '@/services/fabric';
import { OpeningImageLoader } from '@/components/common/OpeningImage';

interface FabricMenuProps {
  isMobile?: boolean;
}

const FabricMenu: React.FC<FabricMenuProps> = ({ isMobile = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedFabric, setSelectedFabric] = useState<Fabric | null>(null);
  const [imagesReady, setImagesReady] = useState(false);
  const settledImagesRef = useRef<Set<number>>(new Set());
  const menuRef = useRef<HTMLDivElement>(null);
  const imagesContainerRef = useRef<HTMLDivElement>(null);
  const { closeMobileNav } = useUIStore();
  const { isBusy, navigate, prefetch } = useNavOpening();
  const fabricsBusy = isBusy('nav:fabrics');

  const openFabricsGallery = () => {
    setIsOpen(false);
    if (isMobile) closeMobileNav();
    prefetch('/fabrics');
    navigate('nav:fabrics', '/fabrics');
  };

  // React Query: fetch fabrics only when the menu is open (shared cache)
  const { data: fabrics = [], isLoading } = useFabricsQuery(isOpen);

  // Limit fabrics for display: 3 for mobile, 5 for desktop
  const displayLimit = isMobile ? 3 : 5;
  const displayedFabrics = fabrics.slice(0, displayLimit);
  // Show "View More" if there are fabrics (even if exactly at limit, to navigate to full page)
  const showViewMore = fabrics.length > 0 && !isLoading;
  const imageCount = isMobile ? 2 : 4;

  // Auto-select first fabric when data loads
  useEffect(() => {
    if (fabrics.length > 0 && !selectedFabric) {
      setSelectedFabric(fabrics[0]);
    }
  }, [fabrics, selectedFabric]);

  // Reset image-ready state whenever the selected fabric changes
  useEffect(() => {
    settledImagesRef.current = new Set();
    setImagesReady(false);
  }, [selectedFabric?._id]);

  const markImageSettled = useCallback(
    (index: number) => {
      if (settledImagesRef.current.has(index)) return;
      settledImagesRef.current.add(index);
      if (settledImagesRef.current.size >= imageCount) {
        setImagesReady(true);
      }
    },
    [imageCount]
  );

  // Handle cached images that may already be complete before onLoad fires
  useEffect(() => {
    if (!selectedFabric || imagesReady) return;

    const container = imagesContainerRef.current;
    if (!container) return;

    const imgs = container.querySelectorAll('img');
    imgs.forEach((img, index) => {
      if (img.complete) {
        markImageSettled(index);
      }
    });
  }, [selectedFabric?._id, imagesReady, markImageSettled]);

  // Close menu when clicking outside
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

  const handleFabricClick = (fabric: Fabric) => {
    setSelectedFabric(fabric);
  };

  // Create display slots from the fabric image.
  // Do NOT append ?variant= — that cache-busts and forces duplicate downloads
  // (and can retrigger Opening… when the grid remounts).
  const getFabricImages = (fabric: Fabric) => {
    const baseImage = fabric.image || '/placeholder.png';
    return Array.from({ length: imageCount }, () => baseImage);
  };

  const renderPrintsGrid = (fabric: Fabric) => {
    const images = getFabricImages(fabric);
    // Slight crop offsets so identical URLs still feel like a small print set
    const objectPositions = [
      'object-center',
      'object-left',
      'object-right',
      'object-top',
    ];

    return (
      <div className="relative min-h-[7.5rem]">
        {/* Keep images mounted (and sized) so they can load behind the loader */}
        <div
          ref={imagesContainerRef}
          className={`${
            isMobile ? 'grid grid-cols-2 gap-3' : 'grid grid-cols-4 gap-6 h-30'
          } transition-opacity duration-300 ${imagesReady ? 'opacity-100' : 'opacity-0'}`}
          aria-hidden={!imagesReady}
        >
          {images.map((image, index) => (
            <div
              key={`${fabric._id}-${index}`}
              className={`rounded-lg overflow-hidden ${isMobile ? 'aspect-square' : ''}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image}
                alt={`${fabric.name} print ${index + 1}`}
                className={`w-full h-full object-cover ${objectPositions[index % objectPositions.length]} ${
                  isMobile ? '' : 'hover:scale-105 transition-all duration-200'
                }`}
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  if (!target.src.includes('placeholder.png')) {
                    target.src = '/placeholder.png';
                  } else {
                    markImageSettled(index);
                  }
                }}
                onLoad={() => markImageSettled(index)}
              />
            </div>
          ))}
        </div>

        {!imagesReady && (
          <div
            className={`absolute inset-0 z-10 flex items-center justify-center rounded-lg ${
              isMobile ? 'bg-black/40' : 'bg-white/90'
            }`}
          >
            <OpeningImageLoader variant={isMobile ? 'dark' : 'light'} />
          </div>
        )}
      </div>
    );
  };

  if (isMobile) {
    return (
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 text-white hover:text-[#FFE181] transition-colors cursor-pointer"
        >
          Fabrics Gallery
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
              <div className="pt-4 space-y-4">
                {/* Fabric List - Limited Items */}
                <div className="space-y-2">
                  {isLoading ? (
                    Array.from({ length: displayLimit }).map((_, index) => (
                      <div key={index} className="h-8 bg-gray-700 rounded animate-pulse" />
                    ))
                  ) : displayedFabrics.length === 0 ? (
                    <p className="text-sm text-gray-400 px-3 py-2">
                      No fabrics yet. Add some in Admin → Fabrics.
                    </p>
                  ) : (
                    <>
                      {displayedFabrics.map((fabric) => (
                        <button
                          key={fabric._id}
                          onClick={() => handleFabricClick(fabric)}
                          className={`w-full text-left px-3 py-2 rounded transition-colors cursor-pointer ${
                            selectedFabric?._id === fabric._id
                              ? 'bg-[#D4AF37] text-black'
                              : 'text-white hover:bg-gray-700'
                          }`}
                        >
                          {fabric.name}
                        </button>
                      ))}
                      {/* View More Button - Distinct styling from fabric items */}
                      {showViewMore && (
                        <button
                          onClick={openFabricsGallery}
                          className="w-full px-4 py-3 rounded-lg border-2 border-[#D4AF37] bg-transparent text-[#D4AF37] font-bold hover:bg-[#D4AF37] hover:text-black transition-all duration-200 cursor-pointer mt-3 text-center flex items-center justify-center gap-2 shadow-lg"
                        >
                          {fabricsBusy ? (
                            <>
                              <Loader2 size={18} className="animate-spin" />
                              <span>Opening…</span>
                            </>
                          ) : (
                            <>
                              <span>View More Fabrics</span>
                              <ChevronRight size={18} className="mt-0.5" />
                            </>
                          )}
                        </button>
                      )}
                    </>
                  )}
                </div>

                {/* Selected Fabric Images - 2 images in 1 row */}
                <div className="pt-4">
                  <h3 className="text-white font-medium mb-3">
                    {selectedFabric && imagesReady
                      ? `${selectedFabric.name} Prints`
                      : 'Prints'}
                  </h3>
                  {selectedFabric ? (
                    renderPrintsGrid(selectedFabric)
                  ) : (
                    <div className="py-8 text-center text-sm text-gray-400">
                      {isLoading ? (
                        <OpeningImageLoader variant="dark" />
                      ) : (
                        'No fabric selected'
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Desktop: one hover zone so moving onto images doesn't close/reopen the panel.
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
        Fabrics Gallery
        <ChevronDown size={16} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="absolute top-full left-0 pt-2 w-[800px] z-50"
          >
            <div className="bg-white rounded-lg shadow-xl border border-gray-200">
            <div className="p-6">
              <div className="flex gap-8">
                {/* Left: Fabric List - Limited Items */}
                <div className="w-2/5">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">Fabric</h3>
                  <div className="space-y-2">
                    {isLoading ? (
                      Array.from({ length: displayLimit }).map((_, index) => (
                        <div key={index} className="h-8 bg-gray-200 rounded animate-pulse" />
                      ))
                    ) : displayedFabrics.length === 0 ? (
                      <p className="text-sm text-gray-500 py-2">
                        No fabrics yet. Add some in Admin → Fabrics.
                      </p>
                    ) : (
                      <>
                        {displayedFabrics.map((fabric) => (
                          <button
                            key={fabric._id}
                            onClick={() => handleFabricClick(fabric)}
                            className={`w-full text-left px-3 py-2 rounded-lg transition-all duration-200 flex items-center justify-between border cursor-pointer ${
                              selectedFabric?._id === fabric._id
                                ? 'bg-[#D4AF37BD]/35 text-[#D4AF37] border-[#D4AF37]'
                                : 'text-gray-700 hover:bg-gray-100 border-transparent'
                            }`}
                          >
                            <span className="text-sm font-medium">{fabric.name}</span>
                            <ChevronRight
                              size={14}
                              className={
                                selectedFabric?._id === fabric._id ? 'text-[#D4AF37]' : 'text-gray-500'
                              }
                            />
                          </button>
                        ))}
                        {/* View More Button - Distinct styling from fabric items */}
                        {showViewMore && (
                          <button
                            onClick={openFabricsGallery}
                            className="w-full px-4 py-2.5 rounded-lg bg-[#D4AF37] text-black font-semibold hover:bg-[#B8941F] transition-colors cursor-pointer mt-3 text-center flex items-center justify-center gap-2"
                          >
                            {fabricsBusy ? (
                              <>
                                <Loader2 size={16} className="animate-spin" />
                                <span>Opening…</span>
                              </>
                            ) : (
                              <>
                                <span>View More</span>
                                <ChevronRight size={16} className="text-black" />
                              </>
                            )}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Right: Fabric Images */}
                <div className="w-3/5">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">
                    {selectedFabric ? `${selectedFabric.name} Prints` : 'Prints'}
                  </h3>
                  {selectedFabric ? (
                    renderPrintsGrid(selectedFabric)
                  ) : (
                    <div className="flex items-center justify-center h-36 text-sm text-gray-500">
                      {isLoading ? <OpeningImageLoader /> : 'No fabric selected'}
                    </div>
                  )}
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

export default FabricMenu;
