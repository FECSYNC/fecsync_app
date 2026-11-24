'use client';

import React from 'react';
import { Category } from './types';
import AdBannerSlider from './AdBannerSlider';

interface CategorySidebarProps {
  categories: Category[];
  activeCategory: string;
  onCategoryChange: (category: string) => void;
  isLoading?: boolean;
}

const CategorySidebar: React.FC<CategorySidebarProps> = ({
  categories,
  activeCategory,
  onCategoryChange,
  isLoading = false,
}) => {
  return (
    <div className="flex w-full flex-col gap-6 lg:w-1/3 lg:min-h-[520px] lg:self-stretch">
      <div>
        <h2 className="mb-2 text-3xl font-bold text-[#3D3D3D] md:text-4xl">
          Trending Fashion Styles
        </h2>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/stroke.png" alt="underline" className="h-3" />
      </div>

      <div className="overflow-x-auto lg:overflow-visible">
        {isLoading ? (
          <div className="flex gap-3 whitespace-nowrap lg:flex-col lg:items-start">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-8 w-32 animate-pulse rounded-full bg-gray-200"
              />
            ))}
          </div>
        ) : (
          <div className="flex gap-3 whitespace-nowrap lg:flex-col lg:items-start">
            {categories.map((category) => (
              <button
                key={category._id || category.id}
                onClick={() => onCategoryChange(category.name)}
                className={`cursor-pointer rounded-full px-4 py-2 text-sm font-medium transition-all duration-300
                  ${
                    activeCategory === category.name
                      ? 'bg-[#D4AF37]/10 text-[#D4AF37]'
                      : 'text-[#5D5D5D] hover:bg-[#D4AF37]/5 hover:text-[#D4AF37]'
                  }
                `}
              >
                {category.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <AdBannerSlider />
    </div>
  );
};

export default CategorySidebar;
