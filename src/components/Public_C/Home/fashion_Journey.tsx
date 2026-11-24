"use client"
import React from 'react';
import { motion, Variants, Easing } from 'framer-motion';
import { usePublicHomepageContentQuery } from '@/hooks/useHomepageContent';
import {
  DEFAULT_HOMEPAGE_CONTENT,
  type FashionJourneyContent,
} from '@/lib/homepageContent.shared';

const FashionCardsComponent: React.FC = () => {
  const { data, isPending } = usePublicHomepageContentQuery();
  const section = data?.byKey?.fashionJourney;

  if (isPending && !data) {
    return (
      <div className="w-full bg-white py-16 p-4 md:p-8">
        <div className="mx-auto mb-10 h-10 w-72 animate-pulse rounded bg-gray-100" />
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-2xl bg-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  if (data && !section) {
    return null;
  }

  const content =
    (section?.content as FashionJourneyContent | undefined) ??
    DEFAULT_HOMEPAGE_CONTENT.fashionJourney;

  const containerVariants = {
    initial: { opacity: 0 },
    animate: {
      opacity: 1,
      transition: {
        staggerChildren: 0.2,
        duration: 0.6,
      },
    },
  };

  const cardVariants: Variants = {
    initial: {
      opacity: 0,
      y: 30,
      scale: 0.95,
    },
    animate: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        duration: 0.6,
        ease: 'easeOut' as Easing,
      },
    },
  };

  return (
    <div className="w-full bg-white py-16 p-4 md:p-8 md:pb-24">
      <div className="py-12 flex flex-col items-center justify-center">
        <h2 className="text-3xl md:w-[35%] md:text-4xl text-[#000000] text-center font-bold mb-2">
          {content.title}
        </h2>
        <p className="text-center text-[#5D5D5D]">{content.subtitle}</p>
      </div>
      <motion.div
        className="max-w-7xl mx-auto"
        variants={containerVariants}
        initial="initial"
        animate="animate"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {content.cards.map((card, index) => (
            <motion.div
              key={`${card.title}-${index}`}
              variants={cardVariants}
              className="rounded-2xl p-8 shadow-sm border border-gray-100"
              style={{
                backgroundColor: card.bgColor,
                color: card.textColor,
              }}
            >
              <div className="flex flex-col items-start space-y-4">
                <div className="w-16 h-16 flex items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={card.icon}
                    alt={card.title}
                    className="w-full h-full object-contain"
                  />
                </div>
                <h3 className="text-xl font-black leading-tight">{card.title}</h3>
                <p className="text-sm leading-relaxed opacity-90">
                  {card.paragraph}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
};

export default FashionCardsComponent;
