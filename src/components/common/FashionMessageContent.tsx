'use client';

import React from 'react';
import Link from 'next/link';
import {
  sanitizeFashionChatImageSrc,
  sanitizeFashionChatUrl,
} from '@/lib/fashionChatSecurity';

type FashionMessageContentProps = {
  content: string;
  /** Slightly denser cards for admin inbox */
  compact?: boolean;
};

/**
 * Renders StyleForge markdown: **bold**, images, product cards, and links.
 * Shared by storefront chat and admin inbox so staff see the same outfit cards.
 */
export default function FashionMessageContent({
  content,
  compact = false,
}: FashionMessageContentProps) {
  if (!content) return null;

  const cardMax = compact ? 'max-w-[160px]' : 'max-w-[180px]';
  const imgMax = compact ? '120px' : '140px';

  return (
    <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
      {content.split('\n').map((line, i) => (
        <div key={i}>
          {line
            .split(
              /(\*\*.*?\*\*|\[!\[.*?\]\(.*?\)\]\(.*?\)|!\[.*?\]\(.*?\)|\[.*?\]\(.*?\))/g
            )
            .map((part, j) => {
              if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={j}>{part.slice(2, -2)}</strong>;
              }

              const linkedImgMatch = part.match(
                /^\[!\[(.*?)\]\((.*?)\)\]\((.*?)\)$/
              );
              if (linkedImgMatch) {
                const [, alt, rawImgSrc, rawHref] = linkedImgMatch;
                const imgSrc = sanitizeFashionChatImageSrc(rawImgSrc || '');
                const href = sanitizeFashionChatUrl(rawHref || '');
                if (!href || !imgSrc) {
                  return <React.Fragment key={j}>{part}</React.Fragment>;
                }
                const isInternal = href.startsWith('/');
                return (
                  <div
                    key={j}
                    className={`my-3 flex flex-col gap-2 bg-white rounded-xl p-2 border border-black/5 w-full ${cardMax}`}
                  >
                    {isInternal ? (
                      <Link
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block hover:opacity-90 transition-opacity"
                      >
                        <img
                          src={imgSrc}
                          alt={alt}
                          className="w-full h-auto rounded-lg shadow-sm"
                          style={{ maxHeight: imgMax, objectFit: 'cover' }}
                        />
                      </Link>
                    ) : (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block hover:opacity-90 transition-opacity"
                      >
                        <img
                          src={imgSrc}
                          alt={alt}
                          className="w-full h-auto rounded-lg shadow-sm"
                          style={{ maxHeight: imgMax, objectFit: 'cover' }}
                        />
                      </a>
                    )}
                    {isInternal ? (
                      <Link
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full text-center py-2 px-3 bg-[#D4AF37] hover:bg-[#B8941F] text-white text-xs font-medium rounded-lg transition-colors shadow-sm"
                      >
                        View product
                      </Link>
                    ) : (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full text-center py-2 px-3 bg-[#D4AF37] hover:bg-[#B8941F] text-white text-xs font-medium rounded-lg transition-colors shadow-sm"
                      >
                        View product
                      </a>
                    )}
                  </div>
                );
              }

              const imgMatch = part.match(/^!\[(.*?)\]\((.*?)\)$/);
              if (imgMatch) {
                const safeSrc = sanitizeFashionChatImageSrc(imgMatch[2] || '');
                if (!safeSrc) {
                  return <React.Fragment key={j}>{part}</React.Fragment>;
                }
                return (
                  <div key={j} className="my-2">
                    <img
                      src={safeSrc}
                      alt={imgMatch[1]}
                      className="max-w-full h-auto rounded-lg shadow-sm border border-black/5"
                      style={{ maxHeight: imgMax, objectFit: 'cover' }}
                    />
                  </div>
                );
              }

              const linkMatch = part.match(/^\[(.*?)\]\((.*?)\)$/);
              if (linkMatch) {
                const href = sanitizeFashionChatUrl(linkMatch[2]);
                if (!href) {
                  return <React.Fragment key={j}>{linkMatch[1]}</React.Fragment>;
                }
                const isInternal = href.startsWith('/');
                if (isInternal) {
                  return (
                    <Link
                      key={j}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline underline-offset-2 break-all"
                    >
                      {linkMatch[1]}
                    </Link>
                  );
                }
                return (
                  <a
                    key={j}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:underline underline-offset-2 break-all"
                  >
                    {linkMatch[1]}
                  </a>
                );
              }

              return <React.Fragment key={j}>{part}</React.Fragment>;
            })}
        </div>
      ))}
    </div>
  );
}
