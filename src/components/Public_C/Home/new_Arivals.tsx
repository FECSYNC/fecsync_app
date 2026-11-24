"use client"
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ShoppingCart, Loader2 } from 'lucide-react';
import { type Product } from '@/services/products';
import { useAuthAwareCartActions } from '@/hooks/use-cart';
import { useToast } from '@/contexts/toast-context';
import { formatPrice } from '@/utils/currency';
import { NewArrivalsSkeleton } from '@/components/common/skeletons';
import { getSizeInitial } from '@/store/cartStore';
import CatalogImage from '@/components/common/CatalogImage';
import { usePublicHomepageContentQuery } from '@/hooks/useHomepageContent';
import {
  DEFAULT_HOMEPAGE_CONTENT,
  type NewArrivalsContent,
} from '@/lib/homepageContent.shared';

interface ProductCardProps {
  product: Product;
  className?: string;
  imagePosition?: 'top' | 'center';
  /** Above-the-fold cards should load eagerly */
  priority?: boolean;
}

const ProductCard: React.FC<ProductCardProps> = ({
  product,
  className = "",
  imagePosition = 'top',
  priority = false,
}) => {
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [selectedSize, setSelectedSize] = useState<string>('');
  const { addToCart: addToCartAction } = useAuthAwareCartActions();
  const { addToast } = useToast();

  const imageUrl = product.images?.[0]?.trim() || '/placeholder.png';
  const displayName = product.name;
  const displayPrice = typeof product.price === 'string' ? parseFloat(product.price) : product.price;
  const productId = String(product._id || product.id || '').trim();
  const sizes = product.sizes || [];

  // Auto-select first size if available and none selected
  useEffect(() => {
    if (!selectedSize && sizes.length > 0) {
      setSelectedSize(sizes[0]);
    }
  }, [sizes, selectedSize]);

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isAddingToCart || !productId) return;

    if (!selectedSize && sizes.length > 0) {
      addToast('Please select a size', 'error');
      return;
    }

    setIsAddingToCart(true);
    try {
      await addToCartAction({
        id: productId,
        quantity: 1,
        price: displayPrice,
        name: displayName,
        image: imageUrl,
        size: selectedSize,
        availableSizes: sizes,
        remainingInStock:
          typeof (product as { remainingInStock?: number }).remainingInStock ===
          'number'
            ? (product as { remainingInStock: number }).remainingInStock
            : typeof (product as { quantity?: number }).quantity === 'number'
              ? (product as { quantity: number }).quantity
              : undefined,
        taxRate: (product as { taxRate?: number | null }).taxRate ?? null,
        taxExempt: Boolean((product as { taxExempt?: boolean }).taxExempt),
      });
      addToast('Item added to cart successfully', 'success');
    } catch (error) {
      const msg =
        error instanceof Error && error.message
          ? error.message
          : 'Failed to add item to cart';
      addToast(msg, 'error');
      console.error('Failed to add item to cart:', error);
    } finally {
      setIsAddingToCart(false);
    }
  };

  if (!productId) {
    return (
      <div
        className={`relative overflow-hidden rounded-2xl border border-black/5 shadow-xl bg-gray-100 ${className}`}
      >
        <div className="absolute inset-0">
          <CatalogImage
            src={imageUrl}
            alt={displayName}
            fill
            priority={priority}
            optimizeWidth={640}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className={
              imagePosition === 'center'
                ? 'object-cover object-[center_25%]'
                : 'object-cover object-top'
            }
          />
        </div>
      </div>
    );
  }

  return (
    <Link
      href={`/shop/${productId}`}
      className={`block relative overflow-hidden rounded-2xl border border-black/5 shadow-xl bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] focus-visible:ring-offset-2 ${className}`}
      aria-label={`View ${displayName}`}
    >
      <motion.div
        className="absolute inset-0"
        whileHover={{ scale: 1.02 }}
        transition={{ duration: 0.3 }}
      >
        <CatalogImage
          src={imageUrl}
          alt={displayName}
          fill
          priority={priority}
          optimizeWidth={640}
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className={
            imagePosition === 'center'
              ? 'object-cover object-[center_25%]'
              : 'object-cover object-top'
          }
        />

        {/* Glassmorphic overlay for bottom content */}
        <div className="absolute bottom-0 left-0 right-0 z-10 backdrop-blur-lg bg-black/35 border-t border-white/20 p-2.5 sm:p-2">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <h3 className="text-white font-semibold text-sm line-clamp-1 flex-1 min-w-0">
              {displayName}
            </h3>
            <span className="text-white font-bold text-sm whitespace-nowrap">
              {formatPrice(displayPrice)}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2">
            {sizes.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {sizes.map((size) => {
                  const isSelected = selectedSize === size;
                  return (
                    <button
                      key={size}
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSelectedSize(size);
                      }}
                      className={`w-6 h-6 rounded border-2 flex items-center justify-center text-xs font-semibold transition-all duration-200 backdrop-blur-sm ${
                        isSelected
                          ? 'bg-[#D4AF37] border-[#D4AF37] text-white'
                          : 'bg-white/20 border-white/30 text-white/90 hover:bg-white/30'
                      }`}
                      aria-label={`Select size ${size}`}
                    >
                      {getSizeInitial(size)}
                    </button>
                  );
                })}
              </div>
            )}

            <motion.button
              type="button"
              onClick={handleAddToCart}
              disabled={isAddingToCart}
              className={`${
                !isAddingToCart ? 'group hover:bg-white/20 cursor-pointer' : 'pointer-events-none opacity-60'
              } flex items-center gap-1 rounded-full px-2.5 py-1 backdrop-blur-sm border border-white/30 text-xs font-medium transition-all duration-300 shrink-0`}
              style={{ color: '#FFFFFFB2' }}
              whileHover={!isAddingToCart ? { scale: 1.05 } : {}}
              whileTap={!isAddingToCart ? { scale: 0.95 } : {}}
              aria-busy={isAddingToCart}
              aria-label={isAddingToCart ? 'Adding to cart' : 'Add to cart'}
            >
              <div
                className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center
                           transition-all duration-300 group-hover:bg-black group-hover:translate-x-6"
              >
                {isAddingToCart ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <ShoppingCart
                    size={12}
                    className="transition-all duration-700 group-hover:text-[#FDC713]"
                  />
                )}
              </div>
              <span className="transition-opacity duration-300 group-hover:opacity-0">
                {isAddingToCart ? 'Adding...' : 'Add'}
              </span>
            </motion.button>
          </div>
        </div>
      </motion.div>
    </Link>
  );
};

interface ProductCardsGridProps {
  products?: Product[];
  isLoading?: boolean;
}

const ProductCardsGrid: React.FC<ProductCardsGridProps> = ({
  products: propProducts = [],
  isLoading = false,
}) => {
  const error = null;
  const { data: homepageData, isPending: homepagePending } =
    usePublicHomepageContentQuery();
  const section = homepageData?.byKey?.newArrivals;

  const sectionCopy =
    (section?.content as NewArrivalsContent | undefined) ??
    DEFAULT_HOMEPAGE_CONTENT.newArrivals;
  const title = sectionCopy.title || 'New Arrivals';
  const subtitle = sectionCopy.subtitle?.trim() || '';

  // Get the 5 newest products (already sorted by createdAt desc from API)
  const products = React.useMemo(() => {
    if (!propProducts || propProducts.length === 0) return [];

    const sorted = [...propProducts].sort((a, b) => {
      const dateA = new Date(a.createdAt || 0).getTime();
      const dateB = new Date(b.createdAt || 0).getTime();
      return dateB - dateA;
    });

    return sorted.slice(0, 5);
  }, [propProducts]);

  if (homepagePending && !homepageData) {
    return <NewArrivalsSkeleton />;
  }

  if (homepageData && !section) {
    return null;
  }

  if (isLoading && products.length === 0) {
    return <NewArrivalsSkeleton />;
  }

  if (error) {
    return (
      <div className="bg-white px-4 py-10 md:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-10 md:mb-12">
            <h2 className="text-3xl sm:text-4xl md:text-6xl font-bold text-gray-900 mb-4">
              {title}
            </h2>
            {subtitle ? (
              <p className="text-lg text-gray-600">{subtitle}</p>
            ) : null}
          </div>
          <div className="flex justify-center items-center h-48">
            <p className="text-gray-500 text-lg">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="bg-white px-4 py-10 md:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-10 md:mb-12">
            <h2 className="text-3xl sm:text-4xl md:text-6xl font-bold text-gray-900 mb-4">
              {title}
            </h2>
            {subtitle ? (
              <p className="text-lg text-gray-600">{subtitle}</p>
            ) : null}
          </div>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mx-auto mb-6 flex h-32 w-32 items-center justify-center">
              <img
                src="/unauthorized.png"
                alt="No Products"
                width={128}
                height={128}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>

            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No new arrivals available
            </h3>
            <p className="text-gray-500 mb-6 max-w-md">
              We couldn&apos;t find any new arrivals at the moment. Please check back later.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white px-4 py-10 sm:py-12 md:p-8">
      <div className="max-w-7xl mx-auto">
        <motion.div
          className="text-center mb-8 sm:mb-10 md:mb-12"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl sm:text-4xl md:text-6xl font-bold text-gray-900 mb-4">
            {title}
          </h2>
          {subtitle ? (
            <p className="text-lg text-gray-600">{subtitle}</p>
          ) : null}
        </motion.div>

        {/*
          Phone / tablet: real card heights via aspect-ratio (fill images need a sized box).
          Previously mobile cards used h-full with no parent height → 0px tall → blank section.
        */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:hidden">
          {products.map((product, index) => (
            <motion.div
              key={product._id || product.id || index}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: index * 0.06 }}
              className="w-full"
            >
              <ProductCard
                product={product}
                className="w-full aspect-[4/5] min-h-[280px]"
                priority={index < 2}
              />
            </motion.div>
          ))}
        </div>

        {/* Desktop / large tablet — masonry collage */}
        <div
          className="
            hidden md:grid grid-cols-3 gap-3
            h-[480px] lg:h-[560px] xl:h-[600px]
          "
          style={{
            gridTemplateRows: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.4fr)',
          }}
        >
          {products[0] && (
            <motion.div
              className="row-span-3 col-span-1 min-h-0"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.05 }}
            >
              <ProductCard product={products[0]} className="h-full w-full" priority />
            </motion.div>
          )}

          {products[1] && (
            <motion.div
              className="row-span-2 col-span-1 min-h-0"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              <ProductCard
                product={products[1]}
                className="h-full w-full"
                imagePosition="center"
                priority
              />
            </motion.div>
          )}

          {products[2] && (
            <motion.div
              className="row-span-2 col-span-1 min-h-0"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.15 }}
            >
              <ProductCard
                product={products[2]}
                className="h-full w-full"
                imagePosition="center"
                priority
              />
            </motion.div>
          )}

          {products[3] && (
            <motion.div
              className="row-span-1 col-span-1 min-h-0"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <ProductCard
                product={products[3]}
                className="h-full w-full"
                imagePosition="center"
              />
            </motion.div>
          )}

          {products[4] && (
            <motion.div
              className="row-span-1 col-span-1 min-h-0"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.25 }}
            >
              <ProductCard
                product={products[4]}
                className="h-full w-full"
                imagePosition="center"
              />
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProductCardsGrid;
