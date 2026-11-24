'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { OpeningImageOverlay, useOpeningImage } from '@/components/common/OpeningImage';
import { optimizeCatalogImageUrl } from '@/lib/catalogImages';
import { MAX_PRODUCT_IMAGES } from '@/lib/productImages';

interface ProductImageGalleryProps {
  images: string[];
  selectedImageIndex: number;
  onImageSelect: (index: number) => void;
  productName: string;
}

const GalleryThumb: React.FC<{
  src: string;
  alt: string;
  className?: string;
  sizes?: string;
}> = ({ src, alt, className, sizes = '96px' }) => {
  const { ready, showLoader, onLoad, onError } = useOpeningImage(src);

  return (
    <div className="relative w-full h-full">
      <Image
        src={src}
        alt={alt}
        fill
        className={`${className ?? 'object-cover'} ${
          ready ? 'opacity-100' : 'opacity-0'
        } transition-opacity duration-150`}
        sizes={sizes}
        loading="lazy"
        onLoad={onLoad}
        onError={onError}
      />
      <OpeningImageOverlay ready={ready} show={showLoader} compact />
    </div>
  );
};

const MainGalleryImage: React.FC<{
  src: string;
  alt: string;
  priority?: boolean;
  sizes: string;
}> = ({ src, alt, priority, sizes }) => {
  const { ready, showLoader, onLoad, onError } = useOpeningImage(src);

  return (
    <>
      <Image
        src={src}
        alt={alt}
        fill
        className={`object-cover rounded-lg ${
          ready ? 'opacity-100' : 'opacity-0'
        } transition-opacity duration-150`}
        sizes={sizes}
        priority={priority}
        onLoad={onLoad}
        onError={(e) => {
          (e.target as HTMLImageElement).src = '/placeholder.png';
          onError();
        }}
      />
      <OpeningImageOverlay ready={ready} show={showLoader} className="rounded-lg" />
    </>
  );
};

function ThumbButton({
  image,
  index,
  selected,
  pulsing,
  productName,
  onClick,
  className = '',
}: {
  image: string;
  index: number;
  selected: boolean;
  pulsing: boolean;
  productName: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative aspect-square border-2 rounded-lg overflow-hidden transition-all duration-200 hover:scale-[1.02] cursor-pointer shrink-0 ${
        selected
          ? 'border-[#D4AF37] shadow-md ring-2 ring-[#D4AF37]/25'
          : 'border-gray-200 hover:border-[#D4AF37]/50'
      } ${pulsing ? 'animate-pulse' : ''} ${className}`}
    >
      <GalleryThumb
        src={image}
        alt={`${productName} ${index + 1}`}
        sizes="(max-width: 1024px) 20vw, 96px"
        className="object-cover"
      />
    </button>
  );
}

const ProductImageGallery: React.FC<ProductImageGalleryProps> = ({
  images,
  selectedImageIndex,
  onImageSelect,
  productName,
}) => {
  const [pulsingIndex, setPulsingIndex] = useState<number | null>(null);

  const gallery = useMemo(() => {
    const list = (images || [])
      .map((u) => (typeof u === 'string' ? u.trim() : ''))
      .filter(Boolean)
      .slice(0, MAX_PRODUCT_IMAGES);
    // Fast Cloudinary thumbs for the strip; main uses larger derivative
    return list.map((src) => ({
      full: optimizeCatalogImageUrl(src, 960),
      thumb: optimizeCatalogImageUrl(src, 240),
    }));
  }, [images]);

  // Preload gallery images for near-instant switching
  useEffect(() => {
    gallery.forEach(({ full, thumb }) => {
      const a = new window.Image();
      a.src = thumb;
      const b = new window.Image();
      b.src = full;
    });
  }, [gallery]);

  const handleImageClick = (index: number) => {
    setPulsingIndex(index);
    onImageSelect(index);
    setTimeout(() => setPulsingIndex(null), 280);
  };

  const safeIndex =
    gallery.length === 0
      ? 0
      : Math.min(Math.max(selectedImageIndex, 0), gallery.length - 1);
  const mainSrc = gallery[safeIndex]?.full || '/placeholder.png';

  if (gallery.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="relative w-full max-w-lg h-[320px] lg:h-[400px] bg-gray-100 rounded-lg overflow-hidden">
          <MainGalleryImage
            src="/placeholder.png"
            alt={productName}
            sizes="(max-width: 1024px) 100vw, 50vw"
            priority
          />
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Desktop */}
      <div className="hidden lg:flex flex-1 gap-6 min-w-0">
        <div className="w-28 xl:w-32 flex-shrink-0 max-h-[420px] overflow-y-auto pr-1 custom-scrollbar">
          <div className="flex flex-col gap-2.5">
            {gallery.map((img, index) => (
              <ThumbButton
                key={`${img.thumb}-${index}`}
                image={img.thumb}
                index={index}
                selected={safeIndex === index}
                pulsing={pulsingIndex === index}
                productName={productName}
                onClick={() => handleImageClick(index)}
                className="w-full"
              />
            ))}
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center min-w-0">
          <div className="relative overflow-hidden rounded-lg w-full max-w-lg h-[400px] bg-gray-100">
            <AnimatePresence initial={false}>
              <motion.div
                key={safeIndex}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12, ease: 'easeOut' }}
                className="absolute inset-0"
              >
                <MainGalleryImage
                  src={mainSrc}
                  alt={productName}
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  priority={safeIndex === 0}
                />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Mobile / tablet */}
      <div className="lg:hidden pt-20 sm:pt-24">
        <div className="mb-4 relative w-full h-[300px] sm:h-[360px]">
          <div className="relative w-full h-full overflow-hidden rounded-lg bg-gray-100">
            <AnimatePresence initial={false}>
              <motion.div
                key={safeIndex}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12, ease: 'easeOut' }}
                className="absolute inset-0"
              >
                <MainGalleryImage
                  src={mainSrc}
                  alt={productName}
                  sizes="100vw"
                  priority={safeIndex === 0}
                />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory">
          {gallery.map((img, index) => (
            <ThumbButton
              key={`m-${img.thumb}-${index}`}
              image={img.thumb}
              index={index}
              selected={safeIndex === index}
              pulsing={pulsingIndex === index}
              productName={productName}
              onClick={() => handleImageClick(index)}
              className="w-20 sm:w-24 snap-start"
            />
          ))}
        </div>
      </div>
    </>
  );
};

export default ProductImageGallery;
