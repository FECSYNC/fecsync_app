'use client';

import { useEffect, useRef, useState } from 'react';
import { useToast } from '@/contexts/toast-context';
import { uploadCatalogImages, prefetchUploadSignatures } from '@/services/upload';
import { MAX_PRODUCT_IMAGES } from '@/lib/productImages';
import { IMAGE_FILE_ACCEPT, isLikelyImageFile } from '@/utils/imageUpload';
import { StepProps } from './types';

/**
 * Uploads each image to Cloudinary as soon as it is selected.
 * Save Product only persists URL strings — no batch upload on submit.
 */
export default function ImageUploadStep({
  formData,
  onFormDataChange,
  onImagesBusyChange,
}: StepProps) {
  const { addToast } = useToast();
  const [isDragging, setIsDragging] = useState(false);
  const [busySlot, setBusySlot] = useState<number | null>(null);
  const [isBatchBusy, setIsBatchBusy] = useState(false);
  /** Local blob previews while Cloudinary upload runs */
  const [slotPreviews, setSlotPreviews] = useState<Record<number, string>>({});
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const batchInputRef = useRef<HTMLInputElement | null>(null);

  const isBusy = busySlot !== null || isBatchBusy;
  const slotCount = Math.max(formData.images.length + 1, 3);
  const visibleSlots = Math.min(slotCount, MAX_PRODUCT_IMAGES);

  useEffect(() => {
    prefetchUploadSignatures('products', 1);
  }, []);

  useEffect(() => {
    onImagesBusyChange?.(isBusy);
  }, [isBusy, onImagesBusyChange]);

  useEffect(() => {
    return () => {
      Object.values(slotPreviews).forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revoke on unmount only
  }, []);

  const setPreview = (index: number, file: File) => {
    const url = URL.createObjectURL(file);
    setSlotPreviews((prev) => {
      if (prev[index]) URL.revokeObjectURL(prev[index]);
      return { ...prev, [index]: url };
    });
  };

  const clearPreview = (index: number) => {
    setSlotPreviews((prev) => {
      if (!prev[index]) return prev;
      URL.revokeObjectURL(prev[index]);
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const replaceSlot = async (index: number, file: File | undefined) => {
    if (!file) return;
    if (!isLikelyImageFile(file)) {
      addToast(`File "${file.name}" is not a valid image format.`, 'error');
      return;
    }

    if (index > formData.images.length) {
      // Only allow append at the next empty slot
      if (index !== formData.images.length || formData.images.length >= MAX_PRODUCT_IMAGES) {
        addToast('Fill earlier image slots first, or replace an existing one.', 'error');
        return;
      }
    }

    setPreview(index, file);
    setBusySlot(index);

    try {
      const [url] = await uploadCatalogImages([file], 'products');
      const next = [...formData.images];
      if (index < next.length) {
        next[index] = url;
      } else {
        next.push(url);
      }
      onFormDataChange({ images: next.slice(0, MAX_PRODUCT_IMAGES) });
      addToast(`Image ${index + 1} uploaded`, 'success');
    } catch (error) {
      console.warn('[ImageUpload] Upload error:', error);
      addToast(
        error instanceof Error ? error.message : 'Could not upload that image. Please try again.',
        'error'
      );
    } finally {
      clearPreview(index);
      setBusySlot(null);
      const input = fileInputRefs.current[index];
      if (input) input.value = '';
    }
  };

  const addFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;

    const validFiles = Array.from(files).filter((file) => {
      if (!isLikelyImageFile(file)) {
        addToast(`File "${file.name}" is not a valid image format.`, 'error');
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) return;

    const remaining = MAX_PRODUCT_IMAGES - formData.images.length;
    const filesToProcess = validFiles.slice(0, Math.max(0, remaining));

    if (filesToProcess.length === 0) {
      addToast(
        `You already have ${MAX_PRODUCT_IMAGES} images. Use Update on a slot to replace one.`,
        'error'
      );
      return;
    }

    // Instant local previews for every file being uploaded
    const startIndex = formData.images.length;
    filesToProcess.forEach((file, i) => setPreview(startIndex + i, file));

    setIsBatchBusy(true);
    try {
      // Parallel upload (bulk when >1) — done before Save, so Save is URL-only
      const urls = await uploadCatalogImages(filesToProcess, 'products');
      onFormDataChange({
        images: [...formData.images, ...urls].slice(0, MAX_PRODUCT_IMAGES),
      });
      addToast(
        `${urls.length} image${urls.length === 1 ? '' : 's'} uploaded`,
        'success'
      );
    } catch (error) {
      console.warn('[ImageUpload] Upload error:', error);
      addToast(
        error instanceof Error ? error.message : 'Could not upload those images. Please try again.',
        'error'
      );
    } finally {
      filesToProcess.forEach((_, i) => clearPreview(startIndex + i));
      setIsBatchBusy(false);
      if (batchInputRef.current) batchInputRef.current.value = '';
    }
  };

  const deleteImage = (index: number) => {
    onFormDataChange({
      images: formData.images.filter((_, i) => i !== index),
    });
    clearPreview(index);
    addToast('Image removed', 'success');
  };

  return (
    <div className="space-y-6">
      {isBusy && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center space-x-3">
          <svg
            className="animate-spin h-5 w-5 text-blue-600"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="text-sm font-medium text-blue-800">
            {busySlot !== null
              ? `Uploading image ${busySlot + 1} to cloud…`
              : 'Uploading images to cloud…'}
          </span>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3 gap-3">
          <label className="block text-base font-medium text-gray-700">
            Product Images
          </label>
          <span className="text-sm text-gray-500">
            {formData.images.length}/{MAX_PRODUCT_IMAGES} uploaded
          </span>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Images go to the cloud as soon as you pick them (JPG, PNG, WebP, HEIC, and other image formats). Save Product stays fast.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: visibleSlots }, (_, index) => {
            const remoteSrc = formData.images[index] || '';
            const previewSrc = slotPreviews[index] || remoteSrc;
            const slotBusy = busySlot === index || (isBatchBusy && !!slotPreviews[index]);

            return (
              <div key={index} className="relative group">
                <div className="aspect-square bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 overflow-hidden relative">
                  {previewSrc ? (
                    <img
                      src={previewSrc}
                      alt={`Product image ${index + 1}`}
                      className={`w-full h-full object-cover ${slotBusy ? 'opacity-40' : ''}`}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = '/placeholder.png';
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg
                        className="w-12 h-12 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                    </div>
                  )}

                  {slotBusy ? (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-white/80">
                      <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#D4AF37] border-t-transparent" />
                      <span className="text-xs font-medium text-gray-700">Uploading…</span>
                    </div>
                  ) : (
                    <div className="absolute inset-0 z-10 bg-black/40 flex flex-col items-center justify-center gap-2 rounded-lg opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => fileInputRefs.current[index]?.click()}
                        disabled={isBusy}
                        className="bg-white/95 hover:bg-white text-gray-800 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <span>{remoteSrc ? 'Update' : 'Upload'}</span>
                      </button>
                      {remoteSrc && (
                        <button
                          type="button"
                          onClick={() => deleteImage(index)}
                          disabled={isBusy}
                          className="text-xs text-white/90 underline hover:text-white disabled:opacity-50"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  )}

                  <input
                    ref={(el) => {
                      fileInputRefs.current[index] = el;
                    }}
                    type="file"
                    accept={IMAGE_FILE_ACCEPT}
                    className="hidden"
                    disabled={isBusy}
                    onChange={(e) => replaceSlot(index, e.target.files?.[0])}
                  />
                </div>

                <div className="mt-2 text-center">
                  <span className="text-xs text-gray-500 font-medium">Image {index + 1}</span>
                </div>
              </div>
            );
          })}
        </div>

        {formData.images.length < MAX_PRODUCT_IMAGES && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setIsDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (!isBusy) addFiles(e.dataTransfer.files);
            }}
            className={`flex cursor-pointer items-center justify-center rounded-lg border border-dashed px-8 py-10 text-center mt-6 ${
              isDragging ? 'border-[#D4AF37] bg-[#D4AF37]/10' : 'border-gray-300 bg-white'
            } ${isBusy ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={() => !isBusy && batchInputRef.current?.click()}
          >
            <div>
              <p className="text-base text-gray-700">Add more product images</p>
              <p className="text-sm text-gray-400 mt-1">Click or drag and drop — uploads start immediately</p>
              <p className="mt-2 text-sm text-gray-500">
                {MAX_PRODUCT_IMAGES - formData.images.length} slot
                {MAX_PRODUCT_IMAGES - formData.images.length === 1 ? '' : 's'} remaining
                (max {MAX_PRODUCT_IMAGES})
              </p>
            </div>
          </div>
        )}

        <input
          ref={batchInputRef}
          type="file"
          multiple
          accept={IMAGE_FILE_ACCEPT}
          onChange={(e) => addFiles(e.target.files)}
          disabled={isBusy}
          className="hidden"
        />
      </div>
    </div>
  );
}
