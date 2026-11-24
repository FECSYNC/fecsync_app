import React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

interface CustomizeHeaderSectionProps {
  category: string;
}

const CustomizeHeaderSection: React.FC<CustomizeHeaderSectionProps> = ({
  category,
}) => {
  void category;
  return (
    <div className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center py-8">
          <h1 className="text-4xl md:text-5xl font-bold text-black mb-2">
            Customize Your Look
          </h1>
          <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">
            Select a Style to Personalize
          </h2>
          <p className="text-[#5D5D5D] md:text-base max-w-2xl mx-auto">
            Discover vibrant clothes from skilled craftsmen to suit every of your
            event.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/tailors"
              className="inline-flex items-center gap-2 rounded-xl border border-[#D4AF37]/40 bg-[#FFF8E7] px-4 py-2.5 text-sm font-semibold text-[#8A6D00] hover:bg-[#FFF0CC] transition"
            >
              Find a tailor instead
              <ArrowRight size={16} aria-hidden />
            </Link>
            <span className="text-xs text-gray-500">
              Prefer bespoke work with a local tailor?
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CustomizeHeaderSection;
