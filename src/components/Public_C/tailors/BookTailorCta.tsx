'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

type BookTailorCtaProps = {
  slug: string;
  className?: string;
  children?: React.ReactNode;
};

/**
 * Always links to the book route. Auth is handled on the book page so the
 * Link href stays stable (flipping to /signin mid-session cancelled nav
 * feedback and felt like a double-load).
 */
export default function BookTailorCta({
  slug,
  className,
  children,
}: BookTailorCtaProps) {
  const bookPath = `/tailors/${encodeURIComponent(slug)}/book`;

  return (
    <Link
      href={bookPath}
      prefetch
      className={
        className ??
        'inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-5 py-3 text-sm font-semibold text-white hover:bg-[#c4a030] transition'
      }
    >
      {children ?? (
        <>
          Book this tailor
          <ArrowRight size={16} aria-hidden />
        </>
      )}
    </Link>
  );
}
