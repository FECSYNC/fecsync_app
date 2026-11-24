'use client';

import { useEffect, useState } from 'react';
import { useUpdateHomepageSectionMutation } from '@/hooks/useHomepageContent';
import { uploadCatalogImages, prefetchUploadSignatures } from '@/services/upload';
import { IMAGE_FILE_ACCEPT, isLikelyImageFile } from '@/utils/imageUpload';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';
import type {
  FashionJourneyContent,
  HeroContent,
  HomepageSectionDto,
  HomepageSectionKey,
  NewArrivalsContent,
  WhatWeOfferContent,
} from '@/lib/homepageContent.shared';

type Props = {
  section: HomepageSectionDto | null;
  onClose: () => void;
  onSaved: (key: HomepageSectionKey) => void;
};

export default function HomepageSectionEditModal({
  section,
  onClose,
  onSaved,
}: Props) {
  const updateMutation = useUpdateHomepageSectionMutation();
  const { canUploadImages } = useCatalogActionPermissions();
  const [published, setPublished] = useState(true);
  const [hero, setHero] = useState<HeroContent | null>(null);
  const [whatWeOffer, setWhatWeOffer] = useState<WhatWeOfferContent | null>(null);
  const [newArrivals, setNewArrivals] = useState<NewArrivalsContent | null>(null);
  const [fashionJourney, setFashionJourney] =
    useState<FashionJourneyContent | null>(null);
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!section) return;
    prefetchUploadSignatures('homepage', 1);
    setPublished(section.published);
    setError(null);
    if (section.key === 'hero') setHero(section.content as HeroContent);
    if (section.key === 'whatWeOffer') {
      setWhatWeOffer(section.content as WhatWeOfferContent);
    }
    if (section.key === 'newArrivals') {
      setNewArrivals(section.content as NewArrivalsContent);
    }
    if (section.key === 'fashionJourney') {
      setFashionJourney(section.content as FashionJourneyContent);
    }
  }, [section]);

  if (!section) return null;

  const uploadToSlot = async (
    file: File | null | undefined,
    slotId: string,
    onUrl: (url: string) => void
  ) => {
    if (!file) return;
    if (!isLikelyImageFile(file)) {
      setError('Please choose an image file.');
      return;
    }
    if (!canUploadImages) {
      setError(
        'You need the Upload Images permission (uploads:write) to change section images.'
      );
      return;
    }
    setUploadingSlot(slotId);
    setError(null);
    try {
      const [url] = await uploadCatalogImages([file], 'homepage');
      onUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed');
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let content: unknown;
    if (section.key === 'hero' && hero) content = hero;
    if (section.key === 'whatWeOffer' && whatWeOffer) content = whatWeOffer;
    if (section.key === 'newArrivals' && newArrivals) content = newArrivals;
    if (section.key === 'fashionJourney' && fashionJourney) {
      content = fashionJourney;
    }
    if (!content) {
      setError('Nothing to save');
      return;
    }

    try {
      await updateMutation.mutateAsync({
        key: section.key,
        payload: { published, content },
      });
      onSaved(section.key);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save section');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close"
        onClick={onClose}
      />
      <form
        onSubmit={handleSave}
        className="relative z-10 w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-100 bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Edit · {section.label}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Changes save to the database and update the store instantly.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          <label className="flex items-center justify-between gap-3 rounded-xl border border-[#D4AF37]/20 bg-[#D4AF37]/5 px-4 py-3">
            <span>
              <span className="block text-sm font-semibold text-gray-900">
                Published on store
              </span>
              <span className="block text-xs text-gray-600 mt-0.5">
                Turn off to hide this section from the homepage.
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={published}
              onClick={() => setPublished((v) => !v)}
              className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                published ? 'bg-[#D4AF37]' : 'bg-gray-200'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow transition ${
                  published ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </label>

          {section.key === 'hero' && hero && (
            <HeroFields
              value={hero}
              onChange={setHero}
              uploadingSlot={uploadingSlot}
              onUpload={uploadToSlot}
              canUpload={canUploadImages}
            />
          )}
          {section.key === 'whatWeOffer' && whatWeOffer && (
            <WhatWeOfferFields
              value={whatWeOffer}
              onChange={setWhatWeOffer}
              uploadingSlot={uploadingSlot}
              onUpload={uploadToSlot}
              canUpload={canUploadImages}
            />
          )}
          {section.key === 'newArrivals' && newArrivals && (
            <div className="space-y-4">
              <TextField
                label="Title"
                value={newArrivals.title}
                onChange={(title) => setNewArrivals({ ...newArrivals, title })}
              />
              <TextField
                label="Subtitle (optional)"
                value={newArrivals.subtitle}
                onChange={(subtitle) =>
                  setNewArrivals({ ...newArrivals, subtitle })
                }
              />
              <p className="text-xs text-gray-500">
                The product collage uses your newest catalog products
                automatically.
              </p>
            </div>
          )}
          {section.key === 'fashionJourney' && fashionJourney && (
            <FashionJourneyFields
              value={fashionJourney}
              onChange={setFashionJourney}
              uploadingSlot={uploadingSlot}
              onUpload={uploadToSlot}
              canUpload={canUploadImages}
            />
          )}

          {!canUploadImages && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              You can edit text and publish, but image uploads require the Upload
              Images permission.
            </p>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-3 border-t border-gray-100 bg-white px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={updateMutation.isPending || Boolean(uploadingSlot)}
            className="inline-flex items-center gap-2 rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-medium text-black hover:bg-[#c9a430] disabled:opacity-60"
          >
            {updateMutation.isPending && <ButtonSpinner />}
            {updateMutation.isPending
              ? 'Saving…'
              : published
                ? 'Save & publish'
                : 'Save as draft'}
          </button>
        </div>
      </form>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  multiline,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-600">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#D4AF37] focus:outline-none focus:ring-1 focus:ring-[#D4AF37]"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#D4AF37] focus:outline-none focus:ring-1 focus:ring-[#D4AF37]"
        />
      )}
    </label>
  );
}

function ImageSlot({
  label,
  src,
  slotId,
  uploadingSlot,
  onUpload,
  canUpload = true,
}: {
  label: string;
  src: string;
  slotId: string;
  uploadingSlot: string | null;
  onUpload: (file: File | null | undefined, slotId: string) => void;
  canUpload?: boolean;
}) {
  const busy = uploadingSlot === slotId;
  return (
    <div className="rounded-xl border border-gray-100 p-3">
      <p className="text-xs font-medium text-gray-600 mb-2">{label}</p>
      <div className="relative h-28 rounded-lg overflow-hidden bg-gray-50 border border-gray-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className="h-full w-full object-cover" />
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-xs font-medium text-gray-700">
            Uploading…
          </div>
        )}
      </div>
      <input
        type="file"
        accept={IMAGE_FILE_ACCEPT}
        className="mt-2 block w-full text-xs text-gray-600 disabled:opacity-50"
        disabled={!canUpload || Boolean(uploadingSlot)}
        onChange={(e) => onUpload(e.target.files?.[0], slotId)}
      />
    </div>
  );
}

function HeroFields({
  value,
  onChange,
  uploadingSlot,
  onUpload,
  canUpload,
}: {
  value: HeroContent;
  onChange: (next: HeroContent) => void;
  uploadingSlot: string | null;
  onUpload: (
    file: File | null | undefined,
    slotId: string,
    onUrl: (url: string) => void
  ) => void;
  canUpload: boolean;
}) {
  return (
    <div className="space-y-4">
      <TextField
        label="Headline (use a new line to split onto two lines)"
        value={value.headline}
        onChange={(headline) => onChange({ ...value, headline })}
        multiline
        rows={2}
      />
      <TextField
        label="Subtitle"
        value={value.subtitle}
        onChange={(subtitle) => onChange({ ...value, subtitle })}
        multiline
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField
          label="Primary button label"
          value={value.ctaPrimary.label}
          onChange={(label) =>
            onChange({
              ...value,
              ctaPrimary: { ...value.ctaPrimary, label },
            })
          }
        />
        <TextField
          label="Primary button link"
          value={value.ctaPrimary.href}
          onChange={(href) =>
            onChange({
              ...value,
              ctaPrimary: { ...value.ctaPrimary, href },
            })
          }
        />
        <TextField
          label="Secondary button label"
          value={value.ctaSecondary.label}
          onChange={(label) =>
            onChange({
              ...value,
              ctaSecondary: { ...value.ctaSecondary, label },
            })
          }
        />
        <TextField
          label="Secondary button link"
          value={value.ctaSecondary.href}
          onChange={(href) =>
            onChange({
              ...value,
              ctaSecondary: { ...value.ctaSecondary, href },
            })
          }
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {value.images.map((img, index) => (
          <div key={index} className="space-y-2">
            <ImageSlot
              label={`Image ${index + 1}`}
              src={img.src}
              slotId={`hero-${index}`}
              uploadingSlot={uploadingSlot}
              canUpload={canUpload}
              onUpload={(file, slotId) =>
                onUpload(file, slotId, (src) => {
                  const images = value.images.map((row, i) =>
                    i === index ? { ...row, src } : row
                  );
                  onChange({ ...value, images });
                })
              }
            />
            <TextField
              label="Alt text"
              value={img.alt}
              onChange={(alt) => {
                const images = value.images.map((row, i) =>
                  i === index ? { ...row, alt } : row
                );
                onChange({ ...value, images });
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function WhatWeOfferFields({
  value,
  onChange,
  uploadingSlot,
  onUpload,
  canUpload,
}: {
  value: WhatWeOfferContent;
  onChange: (next: WhatWeOfferContent) => void;
  uploadingSlot: string | null;
  onUpload: (
    file: File | null | undefined,
    slotId: string,
    onUrl: (url: string) => void
  ) => void;
  canUpload: boolean;
}) {
  return (
    <div className="space-y-4">
      <TextField
        label="Section title"
        value={value.title}
        onChange={(title) => onChange({ ...value, title })}
      />
      <TextField
        label="Section subtitle"
        value={value.subtitle}
        onChange={(subtitle) => onChange({ ...value, subtitle })}
      />
      <div className="space-y-4">
        {value.cards.map((card, index) => (
          <div
            key={index}
            className="rounded-xl border border-gray-100 p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-900">
                Card {index + 1}
              </p>
              {value.cards.length > 1 && (
                <button
                  type="button"
                  className="text-xs text-red-600 hover:underline"
                  onClick={() =>
                    onChange({
                      ...value,
                      cards: value.cards.filter((_, i) => i !== index),
                    })
                  }
                >
                  Remove
                </button>
              )}
            </div>
            <TextField
              label="Title"
              value={card.title}
              onChange={(title) => {
                const cards = value.cards.map((row, i) =>
                  i === index ? { ...row, title } : row
                );
                onChange({ ...value, cards });
              }}
            />
            <TextField
              label="Description"
              value={card.description}
              onChange={(description) => {
                const cards = value.cards.map((row, i) =>
                  i === index ? { ...row, description } : row
                );
                onChange({ ...value, cards });
              }}
              multiline
            />
            <ImageSlot
              label="Card image"
              src={card.image}
              slotId={`offer-${index}`}
              uploadingSlot={uploadingSlot}
              canUpload={canUpload}
              onUpload={(file, slotId) =>
                onUpload(file, slotId, (image) => {
                  const cards = value.cards.map((row, i) =>
                    i === index ? { ...row, image } : row
                  );
                  onChange({ ...value, cards });
                })
              }
            />
          </div>
        ))}
      </div>
      {value.cards.length < 8 && (
        <button
          type="button"
          className="text-sm font-medium text-[#D4AF37] hover:underline"
          onClick={() =>
            onChange({
              ...value,
              cards: [
                ...value.cards,
                {
                  title: 'New offer',
                  description: 'Describe this offer…',
                  image: value.cards[0]?.image || '/fast/w1.webp',
                },
              ],
            })
          }
        >
          + Add card
        </button>
      )}
    </div>
  );
}

function FashionJourneyFields({
  value,
  onChange,
  uploadingSlot,
  onUpload,
  canUpload,
}: {
  value: FashionJourneyContent;
  onChange: (next: FashionJourneyContent) => void;
  uploadingSlot: string | null;
  onUpload: (
    file: File | null | undefined,
    slotId: string,
    onUrl: (url: string) => void
  ) => void;
  canUpload: boolean;
}) {
  return (
    <div className="space-y-4">
      <TextField
        label="Section title"
        value={value.title}
        onChange={(title) => onChange({ ...value, title })}
      />
      <TextField
        label="Section subtitle"
        value={value.subtitle}
        onChange={(subtitle) => onChange({ ...value, subtitle })}
      />
      <div className="space-y-4">
        {value.cards.map((card, index) => (
          <div
            key={index}
            className="rounded-xl border border-gray-100 p-4 space-y-3"
          >
            <p className="text-sm font-semibold text-gray-900">Card {index + 1}</p>
            <TextField
              label="Title"
              value={card.title}
              onChange={(title) => {
                const cards = value.cards.map((row, i) =>
                  i === index ? { ...row, title } : row
                );
                onChange({ ...value, cards });
              }}
            />
            <TextField
              label="Paragraph"
              value={card.paragraph}
              onChange={(paragraph) => {
                const cards = value.cards.map((row, i) =>
                  i === index ? { ...row, paragraph } : row
                );
                onChange({ ...value, cards });
              }}
              multiline
              rows={4}
            />
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Background color"
                value={card.bgColor}
                onChange={(bgColor) => {
                  const cards = value.cards.map((row, i) =>
                    i === index ? { ...row, bgColor } : row
                  );
                  onChange({ ...value, cards });
                }}
              />
              <TextField
                label="Text color"
                value={card.textColor}
                onChange={(textColor) => {
                  const cards = value.cards.map((row, i) =>
                    i === index ? { ...row, textColor } : row
                  );
                  onChange({ ...value, cards });
                }}
              />
            </div>
            <ImageSlot
              label="Icon image"
              src={card.icon}
              slotId={`journey-${index}`}
              uploadingSlot={uploadingSlot}
              canUpload={canUpload}
              onUpload={(file, slotId) =>
                onUpload(file, slotId, (icon) => {
                  const cards = value.cards.map((row, i) =>
                    i === index ? { ...row, icon } : row
                  );
                  onChange({ ...value, cards });
                })
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}
