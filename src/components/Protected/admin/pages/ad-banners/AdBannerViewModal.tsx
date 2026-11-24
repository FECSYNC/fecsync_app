'use client';

import type { AdBannerDto } from '@/lib/adBanners.shared';

type Props = {
  banner: AdBannerDto | null;
  onClose: () => void;
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-gray-500">{label}</p>
      <p className="whitespace-pre-wrap text-sm text-gray-900">{value || '—'}</p>
    </div>
  );
}

export default function AdBannerViewModal({ banner, onClose }: Props) {
  if (!banner) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative z-10 max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-gray-100 bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              View · {banner.heading}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {banner.active ? 'Active on store' : 'Hidden'} · Order {banner.order}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            Close
          </button>
        </div>

        <div className="space-y-4 px-5 py-4 text-sm">
          <div>
            <p className="mb-2 text-xs font-medium text-gray-500">Image</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={banner.image}
              alt={banner.heading}
              className="h-48 w-full rounded-xl object-cover"
            />
          </div>
          <Field label="Heading" value={banner.heading} />
          <Field label="Paragraph" value={banner.paragraph} />
          <Field label="Link" value={banner.href?.trim() || '—'} />
          <Field label="Order" value={String(banner.order)} />
          <Field
            label="Status"
            value={banner.active ? 'Active on store' : 'Hidden'}
          />
          <Field
            label="Created by"
            value={banner.createdByName?.trim() || '—'}
          />
          <Field
            label="Updated by"
            value={banner.updatedByName?.trim() || '—'}
          />
          <Field
            label="Created"
            value={
              banner.createdAt
                ? new Date(banner.createdAt).toLocaleString()
                : '—'
            }
          />
          <Field
            label="Updated"
            value={
              banner.updatedAt
                ? new Date(banner.updatedAt).toLocaleString()
                : '—'
            }
          />
        </div>
      </div>
    </div>
  );
}
