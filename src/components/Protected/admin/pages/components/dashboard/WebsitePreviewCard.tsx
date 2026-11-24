'use client';

/** Quick jumps into the FECSYNC public landing (matches /home sections). */
const websitePreviewItems = [
  { name: 'Home', href: '/home' },
  { name: 'Features', href: '/home#features' },
  { name: 'Ticketing', href: '/home#ticketing' },
  { name: 'Point of Sale', href: '/home#pos' },
  { name: 'Multi-site', href: '/home#multi' },
  { name: 'Pricing', href: '/home#pricing' },
  { name: 'Get started', href: '/home#get-started' },
];

export default function WebsitePreviewCard({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-white p-6 rounded-lg border border-gray-200 ${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 bg-[#1DB8A0]/15 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg
              className="w-6 h-6 text-[#1DB8A0]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.8}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Preview website</h3>
            <p className="text-sm text-gray-600 mt-0.5">
              Open the live FECSYNC landing in a new tab to confirm your updates.
            </p>
          </div>
        </div>
        <a
          href="/home"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-1.5 text-sm bg-[#1DB8A0] text-white px-3 py-1.5 rounded-md hover:bg-[#1DB8A0]/90 transition-colors font-medium whitespace-nowrap self-start"
        >
          View website
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </a>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {websitePreviewItems.map((item) => (
          <a
            key={item.name}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-[#1DB8A0]/40 hover:bg-[#1DB8A0]/10 hover:text-gray-900 transition-colors"
          >
            {item.name}
            <svg
              className="w-3 h-3 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
        ))}
      </div>
    </div>
  );
}
