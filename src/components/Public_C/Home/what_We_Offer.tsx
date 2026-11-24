"use client"
import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { OpeningImg } from '@/components/common/OpeningImage';
import { usePublicHomepageContentQuery } from '@/hooks/useHomepageContent';
import {
  DEFAULT_HOMEPAGE_CONTENT,
  type WhatWeOfferContent,
} from '@/lib/homepageContent.shared';

const What_we_Offer = () => {
  const [isPaused, setIsPaused] = useState(false);
  const { data, isPending, isError } = usePublicHomepageContentQuery();
  const section = data?.byKey?.whatWeOffer;

  const content =
    (section?.content as WhatWeOfferContent | undefined) ??
    DEFAULT_HOMEPAGE_CONTENT.whatWeOffer;

  const cards = useMemo(
    () =>
      content.cards.map((card, index) => ({
        id: index + 1,
        title: card.title,
        description: card.description,
        mainImage: card.image,
      })),
    [content.cards]
  );

  const loopDistance = useMemo(() => {
    const cardWidth = 384;
    const gap = 24;
    return Math.max(1, cards.length) * (cardWidth + gap);
  }, [cards.length]);

  const duration = Math.max(20, cards.length * 8);
  const infiniteCards = useMemo(
    () => [...cards, ...cards, ...cards],
    [cards]
  );

  if (isPending && !data) {
    return (
      <section className="w-full bg-white py-16">
        <div className="mx-auto h-10 w-64 animate-pulse rounded bg-gray-100" />
        <div className="mt-12 flex gap-6 overflow-hidden px-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-80 w-80 shrink-0 animate-pulse rounded-2xl bg-gray-100 md:w-96"
            />
          ))}
        </div>
      </section>
    );
  }

  if ((data && !section) || (isError && !section)) {
    return null;
  }

  return (
    <section className="w-full bg-white pb-16 pt-8 overflow-hidden sm:pt-10">
      <div className="text-center mb-12 px-4">
        <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
          {content.title}
        </h2>
        <p className="text-lg text-gray-600">{content.subtitle}</p>
      </div>

      <div className="relative w-full">
        <motion.div
          className="flex gap-6 w-fit"
          animate={isPaused ? {} : { x: [0, -loopDistance] }}
          transition={
            isPaused
              ? undefined
              : {
                  x: {
                    repeat: Infinity,
                    repeatType: 'loop',
                    duration,
                    ease: 'linear',
                  },
                }
          }
          style={{ width: 'fit-content' }}
        >
          {infiniteCards.map((card, index) => {
            const eager = index < Math.min(4, cards.length);
            return (
              <motion.div
                key={`${card.id}-${index}`}
                className="flex-shrink-0 w-80 md:w-96 bg-white rounded-2xl shadow-lg overflow-hidden"
                whileHover={{ y: -8, scale: 1.02 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                onMouseEnter={() => setIsPaused(true)}
                onMouseLeave={() => setIsPaused(false)}
              >
                <div className="h-64 md:h-80 overflow-hidden">
                  <OpeningImg
                    src={card.mainImage}
                    alt={card.title}
                    className="w-full h-full object-cover transition-transform duration-500 hover:scale-110"
                    frameClassName="relative w-full h-full"
                    loading={eager ? 'eager' : 'lazy'}
                    fetchPriority={eager ? 'high' : 'auto'}
                  />
                </div>
                <div className="p-6">
                  <h3 className="text-xl font-bold text-gray-900 mb-3">
                    {card.title}
                  </h3>
                  <p className="text-gray-600 text-sm leading-relaxed">
                    {card.description}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
};

export default What_we_Offer;
