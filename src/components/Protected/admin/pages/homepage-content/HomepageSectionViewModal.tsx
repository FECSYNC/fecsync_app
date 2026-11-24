'use client';

import type { HomepageSectionDto } from '@/lib/homepageContent.shared';

type Props = {
  section: HomepageSectionDto | null;
  onClose: () => void;
};

export default function HomepageSectionViewModal({ section, onClose }: Props) {
  if (!section) return null;

  const content = section.content as Record<string, unknown>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-gray-100 bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              View · {section.label}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {section.published ? 'Published' : 'Draft'} · {section.key}
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
        <div className="px-5 py-4 space-y-4 text-sm">
          {section.key === 'hero' && (
            <>
              <Field label="Headline" value={String(content.headline ?? '')} />
              <Field label="Subtitle" value={String(content.subtitle ?? '')} />
              <Field
                label="Primary CTA"
                value={`${(content.ctaPrimary as { label?: string })?.label ?? ''} → ${(content.ctaPrimary as { href?: string })?.href ?? ''}`}
              />
              <Field
                label="Secondary CTA"
                value={`${(content.ctaSecondary as { label?: string })?.label ?? ''} → ${(content.ctaSecondary as { href?: string })?.href ?? ''}`}
              />
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Images</p>
                <div className="grid grid-cols-3 gap-2">
                  {((content.images as { src: string; alt: string }[]) ?? []).map(
                    (img, i) => (
                      <div key={i} className="rounded-lg overflow-hidden border border-gray-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img.src} alt={img.alt} className="h-28 w-full object-cover" />
                      </div>
                    )
                  )}
                </div>
              </div>
            </>
          )}

          {section.key === 'whatWeOffer' && (
            <>
              <Field label="Title" value={String(content.title ?? '')} />
              <Field label="Subtitle" value={String(content.subtitle ?? '')} />
              <div className="space-y-3">
                {((content.cards as { title: string; description: string; image: string }[]) ?? []).map(
                  (card, i) => (
                    <div key={i} className="flex gap-3 rounded-xl border border-gray-100 p-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={card.image}
                        alt={card.title}
                        className="h-20 w-16 rounded-lg object-cover shrink-0"
                      />
                      <div>
                        <p className="font-medium text-gray-900">{card.title}</p>
                        <p className="text-gray-600 text-xs mt-1 line-clamp-3">
                          {card.description}
                        </p>
                      </div>
                    </div>
                  )
                )}
              </div>
            </>
          )}

          {section.key === 'newArrivals' && (
            <>
              <Field label="Title" value={String(content.title ?? '')} />
              <Field
                label="Subtitle"
                value={String(content.subtitle || '—')}
              />
              <p className="text-xs text-gray-500">
                Product images in this section come from your newest catalog
                products.
              </p>
            </>
          )}

          {section.key === 'fashionJourney' && (
            <>
              <Field label="Title" value={String(content.title ?? '')} />
              <Field label="Subtitle" value={String(content.subtitle ?? '')} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {((content.cards as {
                  title: string;
                  paragraph: string;
                  icon: string;
                  bgColor: string;
                  textColor: string;
                }[]) ?? []).map((card, i) => (
                  <div
                    key={i}
                    className="rounded-xl p-4 border border-gray-100"
                    style={{ backgroundColor: card.bgColor, color: card.textColor }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={card.icon} alt="" className="h-10 w-10 object-contain mb-2" />
                    <p className="font-semibold text-sm">{card.title}</p>
                    <p className="text-xs mt-1 opacity-90 line-clamp-4">{card.paragraph}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="border-t border-gray-100 pt-4 grid grid-cols-2 gap-3">
            <Field
              label="Created by"
              value={section.createdByName?.trim() || '—'}
            />
            <Field
              label="Updated by"
              value={section.updatedByName?.trim() || '—'}
            />
            <Field
              label="Created"
              value={
                section.createdAt
                  ? new Date(section.createdAt).toLocaleString()
                  : '—'
              }
            />
            <Field
              label="Updated"
              value={
                section.updatedAt
                  ? new Date(section.updatedAt).toLocaleString()
                  : '—'
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
      <p className="text-gray-900 whitespace-pre-line">{value}</p>
    </div>
  );
}
