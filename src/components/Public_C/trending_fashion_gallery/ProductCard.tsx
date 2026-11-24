'use client';

import React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Product } from './types';
import CatalogImage from '@/components/common/CatalogImage';

interface ProductCardProps {
  product: Product;
  variants?: any;
  /** First row cards should use priority for LCP */
  priority?: boolean;
}

const ProductCard: React.FC<ProductCardProps> = ({
  product,
  variants,
  priority = false,
}) => {
  const productId = String(product._id || product.id || '').trim();
  const imageUrl = product.images?.[0]?.trim() || '/placeholder.png';

  if (!productId) {
    return (
      <motion.div
        variants={variants}
        className="bg-white rounded-2xl shadow-lg overflow-hidden"
      >
        <div className="relative h-64 overflow-hidden bg-gray-100">
          <CatalogImage
            src={imageUrl}
            alt={product.name || 'Product'}
            fill
            priority={priority}
            optimizeWidth={480}
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-cover"
          />
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      variants={variants}
      className="bg-white rounded-2xl shadow-lg overflow-hidden hover:shadow-xl transition-all duration-300 group"
    >
      <Link
        href={`/shop/${productId}`}
        className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] focus-visible:ring-offset-2"
        aria-label={`View ${product.name || 'product'}`}
      >
        <div className="relative h-64 overflow-hidden bg-gray-100">
          <CatalogImage
            src={imageUrl}
            alt={product.name}
            fill
            priority={priority}
            optimizeWidth={480}
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-cover transition-transform duration-500 group-hover:scale-110"
          />
        </div>
      </Link>
    </motion.div>
  );
};

export default ProductCard;
