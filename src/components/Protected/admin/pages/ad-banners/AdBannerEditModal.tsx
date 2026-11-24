'use client';

import { useEffect, useState } from 'react';
import {
  useCreateAdBannerMutation,
  useUpdateAdBannerMutation,
} from '@/hooks/useAdBanners';
import { uploadCatalogImages, prefetchUploadSignatures } from '@/services/upload';
import { IMAGE_FILE_ACCEPT, isLikelyImageFile } from '@/utils/imageUpload';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';
import type { AdBannerDto } from '@/lib/adBanners.shared';

type Props = {
  banner: AdBannerDto | null;
  mode: 'create' | 'edit';
  nextOrder: number;
  onClose: () => void;
  onSaved: () => void;
};

export default function AdBannerEditModal({
  banner,
  mode,
  nextOrder,
  onClose,
  onSaved,
}: Props) {
  const createMutation = useCreateAdBannerMutation();
  const updateMutation = useUpdateAdBannerMutation();
  const { canUploadImages } = useCatalogActionPermissions();

  const [image, setImage] = useState('');
  const [heading, setHeading] = useState('');
  const [paragraph, setParagraph] = useState('');
  const [href, setHref] = useState('');
  const [order, setOrder] = useState(0);
  const [active, setActive] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode === 'edit' && banner) {
      setImage(banner.image);
      setHeading(banner.heading);
      setParagraph(banner.paragraph);
      setHref(banner.href ?? '');
      setOrder(banner.order);
      setActive(banner.active);
    } else {
      setImage('');
      setHeading('');
      setParagraph('');
      setHref('');
      setOrder(nextOrder);
      setActive(true);
    }
    setError(null);
  }, [banner, mode, nextOrder]);

  useEffect(() => {
    prefetchUploadSignatures('banners', 1);
  }, []);

  const saving = createMutation.isPending || updateMutation.isPending;

  const handleUpload = async (file: File | null | undefined) => {
    if (!file) return;
    if (!isLikelyImageFile(file)) {
      setError('Please choose an image file.');
      return;
    }
    if (!canUploadImages) {
      setError(
        'You need the Upload Images permission (uploads:write) to change banner images.'
      );
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const [url] = await uploadCatalogImages([file], 'banners');
      setImage(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setError(null);
    const payload = {
      image: image.trim(),
      heading: heading.trim(),
      paragraph: paragraph.trim(),
      // Always send href so clearing the field actually unsets it in Mongo
      href: href.trim(),
      order: Number.isFinite(order) ? Math.max(0, Math.floor(order)) : 0,
      active,
    };
    if (!payload.image || !payload.heading || !payload.paragraph) {
      setError('Image, heading, and paragraph are required.');
      return;
    }
    try {
      if (mode === 'edit' && banner) {
        await updateMutation.mutateAsync({ id: banner._id, payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save banner');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h3 className="text-lg font-semibold text-gray-900">
            {mode === 'edit' ? 'Edit ad banner' : 'Create ad banner'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
          >
            Close
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Image
            </label>
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image}
                alt="Banner preview"
                className="mb-2 h-40 w-full rounded-xl object-cover"
              />
            ) : (
              <div className="mb-2 flex h-40 items-center justify-center rounded-xl bg-gray-100 text-sm text-gray-400">
                No image yet
              </div>
            )}
            <input
              type="file"
              accept={IMAGE_FILE_ACCEPT}
              disabled={uploading || !canUploadImages}
              onChange={(e) => handleUpload(e.target.files?.[0])}
              className="block w-full text-sm text-gray-600"
            />
            {uploading && (
              <p className="mt-1 text-xs text-[#D4AF37]">Uploading…</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Heading
            </label>
            <input
              value={heading}
              onChange={(e) => setHeading(e.target.value)}
              maxLength={120}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#D4AF37]"
              placeholder="Summer fabric sale"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Paragraph
            </label>
            <textarea
              value={paragraph}
              onChange={(e) => setParagraph(e.target.value)}
              maxLength={400}
              rows={3}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#D4AF37]"
              placeholder="Discover premium prints with free styling tips."
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Link (optional)
            </label>
            <input
              value={href}
              onChange={(e) => setHref(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#D4AF37]"
              placeholder="/shop or https://…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Order
              </label>
              <input
                type="number"
                min={0}
                value={order}
                onChange={(e) => setOrder(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#D4AF37]"
              />
            </div>
            <div className="flex items-end pb-2">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-[#D4AF37]"
                />
                Active on store
              </label>
            </div>
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || uploading}
            className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:opacity-60"
          >
            {saving && <ButtonSpinner />}
            {mode === 'edit' ? 'Save changes' : 'Create banner'}
          </button>
        </div>
      </div>
    </div>
  );
}
