'use client';

import Link from 'next/link';
import { bookBtn, formatMoney } from './bookingUi';

/** Ticket / party card shared by /book venue pages and company category pages. */
export default function BookProductCard({
  href,
  label,
  name,
  description,
  priceFrom,
  currency,
  soldOut,
  party,
  parkName,
}: {
  href: string;
  label: string;
  name: string;
  description: string | null;
  priceFrom: number | null;
  currency?: string | null;
  soldOut?: boolean;
  party?: boolean;
  parkName?: string | null;
}) {
  return (
    <Link
      href={href}
      className={
        party
          ? 'rounded-xl border-2 border-[#D4AF37]/40 bg-[#D4AF37]/5 p-5 hover:border-[#D4AF37]'
          : 'rounded-xl border border-stone-200 bg-white p-5 hover:border-[#D4AF37]/60'
      }
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className={
            party
              ? 'text-xs uppercase tracking-wide text-[#D4AF37]'
              : 'text-xs uppercase text-stone-500'
          }
        >
          {label}
        </p>
        {soldOut ? (
          <span className="rounded-full bg-stone-800 px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
            Sold out
          </span>
        ) : null}
      </div>
      <p className={`mt-1 ${party ? 'text-lg' : ''} font-semibold text-stone-900`}>
        {name}
      </p>
      {parkName ? (
        <p className="text-xs text-stone-500">{parkName}</p>
      ) : null}
      <p
        className={`text-sm text-stone-600 ${party ? '' : 'mt-1 line-clamp-2'}`}
      >
        {description}
      </p>
      <p className={`${party ? 'mt-2 font-medium' : 'mt-3 text-sm font-medium'}`}>
        {formatMoney(priceFrom ?? 0, currency ?? undefined)}
      </p>
      {!party ? (
        <span className={`${bookBtn} mt-3 w-full`}>
          {soldOut ? 'View' : 'Book'}
        </span>
      ) : null}
    </Link>
  );
}
