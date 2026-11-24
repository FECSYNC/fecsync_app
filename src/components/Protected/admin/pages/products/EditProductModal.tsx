'use client';

import { useEffect, useRef, useState } from 'react';
import { useToast } from '@/contexts/toast-context';
import { useUpdateProductMutation } from '@/hooks/useProducts';
import { useAdminCategoriesQuery } from '@/hooks/useCategories';
import { uploadCatalogImages, prefetchUploadSignatures } from '@/services/upload';
import { IMAGE_FILE_ACCEPT, isLikelyImageFile } from '@/utils/imageUpload';
import { ButtonSpinner } from '../../components/Spinner';
import ProductTaxFields, { taxFieldsToPayload } from './ProductTaxFields';
import ProductVenueField from './ProductVenueField';
import ProductAccountingFields from '../accounting/shared/ProductAccountingFields';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';
import { MAX_PRODUCT_IMAGES, padImageSlots } from '@/lib/productImages';
import { catalogRefId, isValidId } from '@/lib/ids';
import { toUserFacingMessage } from '@/lib/userFacingError';
import { useOverlayDismiss } from '@/hooks/useOverlayDismiss';
import { FOOD_VENDOR_COPY } from '@/lib/foodVendorCopy';
import { useAuthStore } from '@/store/authStore';

interface ProductFormState {
  id?: string;
  _id?: string;
  name: string;
  description?: string;
  price: string;
  quantity?: string;
  remainingInStock?: string;
  location?: string;
  venueLocationId?: string;
  images?: string[];
  sizes?: string[];
  gender: string;
  category: string | { _id: string; id: string; name: string; description: string; };
  taxRate?: string;
  taxExempt?: boolean;
}

/** Incoming product from API/table may have numeric taxRate. */
type EditableProduct = Omit<ProductFormState, 'taxRate' | 'category'> & {
  taxRate?: number | string | null;
  taxExempt?: boolean;
  venueLocationId?: string | null;
  category?:
    | string
    | { _id: string; id?: string; name?: string; description?: string };
};

interface EditProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: EditableProduct | null;
  onSuccess?: (updatedProduct?: any) => void;
}

export default function EditProductModal({
  isOpen,
  onClose,
  product,
  onSuccess
}: EditProductModalProps) {
  const { addToast } = useToast();
  const updateProductMutation = useUpdateProductMutation();
  const parkLocked = useAuthStore((s) => s.user?.parkLocked === true);
  const {
    canWriteProducts,
    canReadCategories,
  } = useCatalogActionPermissions();
  const [formData, setFormData] = useState<ProductFormState>({
    id: '',
    _id: '',
    name: '',
    description: '',
    price: '',
    quantity: '',
    remainingInStock: '',
    location: '',
    venueLocationId: '',
    images: [],
    sizes: [],
    gender: '',
    category: '',
    taxRate: '',
    taxExempt: false,
  });

  const errorBannerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const isLoading = updateProductMutation.isPending;
  const {
    data: categories = [],
    isLoading: isLoadingCategories,
    isError: categoriesFailed,
  } = useAdminCategoriesQuery(isOpen && canReadCategories);
  const categoriesError =
    !canReadCategories
      ? 'You need permission to read categories'
      : categoriesFailed
        ? 'Failed to load categories'
        : null;
  /** Which image slot is currently uploading to Cloudinary (null = idle) */
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  const { overlayDismissProps } = useOverlayDismiss(() => {
    if (isLoading || uploadingSlot !== null) return;
    onClose();
  });
  /** Local blob previews while a slot upload is in flight */
  const [slotPreviews, setSlotPreviews] = useState<Record<number, string>>({});
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>(
    Array.from({ length: MAX_PRODUCT_IMAGES }, () => null)
  );

  useEffect(() => {
    if (isOpen) {
      prefetchUploadSignatures('products', 1);
    }
  }, [isOpen]);

  // Initialize form data when product changes
  useEffect(() => {
    if (product) {
      const categoryId =
        typeof product.category === 'object' && product.category
          ? catalogRefId(product.category)
          : typeof product.category === 'string'
            ? product.category
            : '';

      // Ensure we always have up to MAX_PRODUCT_IMAGES slots for editing
      const images = product.images || [];
      const paddedImages = padImageSlots(images, MAX_PRODUCT_IMAGES);

      setFormData({
        id: product.id || product._id || '',
        _id: product._id || product.id || '',
        name: product.name || '',
        description: product.description || '',
        price: String(product.price || ''),
        quantity: String(product.quantity || ''),
        remainingInStock: String(product.remainingInStock || ''),
        location: product.location || '',
        venueLocationId: product.venueLocationId || '',
        images: paddedImages,
        sizes: product.sizes || [],
        gender: product.gender || '',
        category: categoryId,
        taxRate:
          product.taxRate === null || product.taxRate === undefined || product.taxRate === ''
            ? ''
            : String(product.taxRate),
        taxExempt: Boolean(product.taxExempt),
      });
    }
  }, [product]);

  // Close on ESC
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading && uploadingSlot === null) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, isLoading, uploadingSlot]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setFormData({
        id: '',
        _id: '',
        name: '',
        description: '',
        price: '',
        quantity: '',
        remainingInStock: '',
        location: '',
        venueLocationId: '',
        images: [],
        sizes: [],
        gender: '',
        category: '',
        taxRate: '',
        taxExempt: false,
      });
      setError(null);
    }
  }, [isOpen]);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleImageChange = (index: number, value: string) => {
    setFormData((prev) => {
      const next = padImageSlots(prev.images || [], MAX_PRODUCT_IMAGES);
      next[index] = value;
      return { ...prev, images: next };
    });
  };

  const handleSlotFileSelected = async (
    index: number,
    fileList: FileList | null
  ) => {
    const file = fileList?.[0];
    if (!file) return;

    if (!isLikelyImageFile(file)) {
      addToast('Please choose an image file (JPG, PNG, WebP, HEIC, and others).', 'error');
      return;
    }

    // Instant local preview so the slot never looks "stuck"
    const previewUrl = URL.createObjectURL(file);
    setSlotPreviews((prev) => {
      if (prev[index]) URL.revokeObjectURL(prev[index]);
      return { ...prev, [index]: previewUrl };
    });
    setUploadingSlot(index);

    try {
      const [url] = await uploadCatalogImages([file], 'products');
      handleImageChange(index, url);
      addToast(`Image ${index + 1} uploaded`, 'success');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to upload image',
        'error'
      );
    } finally {
      setUploadingSlot(null);
      setSlotPreviews((prev) => {
        const next = { ...prev };
        if (next[index]) {
          URL.revokeObjectURL(next[index]);
          delete next[index];
        }
        return next;
      });
      const input = fileInputRefs.current[index];
      if (input) input.value = '';
    }
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading || uploadingSlot !== null) return;
    if (!canWriteProducts) {
      addToast('You do not have permission to edit products', 'error');
      return;
    }

    const productId = product?.id || product?._id;
    if (!productId) {
      setError('Product ID not found');
      return;
    }

    // Loading state is handled by mutation.isPending

    setError(null);

    const fail = (message: string) => {
      setError(message);
      addToast(message, 'error');
      requestAnimationFrame(() => {
        errorBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    };

    try {
      // Prepare the update payload
      const taxPayload = taxFieldsToPayload(
        formData.taxRate || '',
        Boolean(formData.taxExempt)
      );
      const updatePayload: any = {
        name: formData.name?.trim() || 'Untitled item',
        description: formData.description || '',
        price: formData.price === '' || formData.price == null ? '0' : formData.price,
        quantity: formData.quantity || '0',
        remainingInStock: formData.remainingInStock || '0',
        location: formData.location || '',
        venueLocationId: formData.venueLocationId?.trim()
          ? formData.venueLocationId.trim()
          : null,
        images: (formData.images || []).filter(img => img.trim() !== ''),
        taxRate: taxPayload.taxRate,
        taxExempt: taxPayload.taxExempt,
      };

      const categoryValue =
        typeof formData.category === 'string' ? formData.category.trim() : '';
      if (categoryValue) {
        if (!isValidId(categoryValue)) {
          fail('Please select a valid category');
          return;
        }
        updatePayload.category = categoryValue;
      }

      const updatedProduct = await updateProductMutation.mutateAsync({
        id: productId,
        payload: updatePayload,
      });

      // Show success toast
      addToast(FOOD_VENDOR_COPY.successUpdate, 'success');

      // Call success callback (mutation handles cache update automatically)
      if (onSuccess) {
        onSuccess(updatedProduct);
      }

      // Close modal
      onClose();
    } catch (error) {
      const errorMessage = toUserFacingMessage(error);
      setError(errorMessage);
      addToast(errorMessage, 'error');
    }
  };

  if (!isOpen || !product) return null;

  return (
    <div
      {...overlayDismissProps}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      aria-modal="true"
      role="dialog"
      aria-labelledby="edit-modal-title"
    >
      <div className="w-full max-w-4xl rounded-xl bg-white shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="flex-shrink-0 w-10 h-10 bg-[#D4AF37]/20 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-[#D4AF37]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </div>
              <div>
                <h3 id="edit-modal-title" className="text-lg font-semibold text-gray-900">
                  {FOOD_VENDOR_COPY.editModalTitle}
                </h3>
                <p className="text-sm text-gray-500">Update product information</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading || uploadingSlot !== null}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-6">
          {error && (
            <div
              ref={errorBannerRef}
              className="sticky top-0 z-10 p-3 bg-red-50 border border-red-200 rounded-lg"
            >
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* API Error Messages */}
          {categoriesError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{categoriesError}</p>
            </div>
          )}

          {!isLoadingCategories && categories.length === 0 && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-sm text-yellow-800">
                No categories yet — you can still save without selecting one.
              </p>
            </div>
          )}
          {/* Basic Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {FOOD_VENDOR_COPY.itemName}
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent text-gray-900"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {FOOD_VENDOR_COPY.itemCategory}
              </label>
              <select
                name="category"
                value={typeof formData.category === 'string' ? formData.category : ''}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent text-gray-900"
                disabled={isLoadingCategories}
              >
                <option value="">
                  {isLoadingCategories ? "Loading..." : "Select menu category (optional)"}
                </option>
                {categories.map((category) => {
                  const value = catalogRefId(category);
                  return (
                    <option key={value} value={value}>
                      {category.name}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleInputChange}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent text-gray-900"
            />
          </div>

          {/* Pricing and Inventory */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Price ($)
              </label>
              <input
                type="number"
                name="price"
                value={formData.price}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent text-gray-900"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Quantity
              </label>
              <input
                type="number"
                name="quantity"
                value={formData.quantity}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent text-gray-900"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Remaining in Stock
              </label>
              <input
                type="number"
                name="remainingInStock"
                value={formData.remainingInStock}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent text-gray-900"
              />
            </div>
          </div>

          <ProductTaxFields
            taxRate={formData.taxRate || ''}
            taxExempt={Boolean(formData.taxExempt)}
            onChange={(patch) => setFormData((prev) => ({ ...prev, ...patch }))}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Location
            </label>
            <input
              type="text"
              name="location"
              value={formData.location}
              onChange={handleInputChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent text-gray-900"
            />
          </div>

          {product?._id ? (
            <ProductAccountingFields
              mode="shop"
              productId={product._id}
              avgCost={(product as { avgCost?: number | string }).avgCost}
              lastCost={(product as { lastCost?: number | string | null }).lastCost}
            />
          ) : null}

          <ProductVenueField
            value={formData.venueLocationId || ''}
            onChange={(venueLocationId) =>
              setFormData((prev) => ({ ...prev, venueLocationId }))
            }
            allowShared={!parkLocked}
            disabled={isLoading}
          />

          {/* Images */}
          <div>
            <div className="flex items-center justify-between mb-2 gap-2">
              <label className="block text-sm font-medium text-gray-700">
                Product Images
              </label>
              <span className="text-xs text-gray-500">
                {(formData.images || []).filter((u) => u.trim()).length}/
                {MAX_PRODUCT_IMAGES} used
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {Array.from({ length: MAX_PRODUCT_IMAGES }, (_, index) => {
                const remoteSrc = formData.images?.[index]?.trim() || '';
                const previewSrc = slotPreviews[index] || remoteSrc;
                const isUploading = uploadingSlot === index;
                const filledCount = (formData.images || []).filter((u) =>
                  u.trim()
                ).length;
                // Show filled slots + the next empty slot (progressive add), always at least 3
                const showSlot =
                  index < Math.max(3, Math.min(filledCount + 1, MAX_PRODUCT_IMAGES));
                if (!showSlot) return null;

                return (
                  <div key={index} className="relative group">
                    <div className="aspect-square bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 overflow-hidden relative">
                      {previewSrc ? (
                        <img
                          src={previewSrc}
                          alt={`Product image ${index + 1}`}
                          className={`w-full h-full object-cover transition-opacity ${
                            isUploading ? 'opacity-40' : 'opacity-100'
                          }`}
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

                      {isUploading && (
                        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-white/80">
                          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#D4AF37] border-t-transparent" />
                          <span className="text-sm font-medium text-gray-700">
                            Uploading…
                          </span>
                        </div>
                      )}

                      {!isUploading && (
                        <div className="absolute inset-0 z-10 bg-black/25 flex items-center justify-center rounded-lg">
                          <button
                            type="button"
                            disabled={uploadingSlot !== null}
                            onClick={() => fileInputRefs.current[index]?.click()}
                            className="bg-white/95 hover:bg-white text-gray-800 px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center space-x-2 cursor-pointer shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <svg
                              className="w-4 h-4"
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
                            <span>{previewSrc ? 'Update' : 'Upload'}</span>
                          </button>
                        </div>
                      )}

                      <input
                        ref={(el) => {
                          fileInputRefs.current[index] = el;
                        }}
                        type="file"
                        accept={IMAGE_FILE_ACCEPT}
                        className="hidden"
                        onChange={(e) =>
                          handleSlotFileSelected(index, e.target.files)
                        }
                      />
                    </div>

                    <div className="mt-2 text-center">
                      <span className="text-xs text-gray-500 font-medium">
                        Image {index + 1}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Image URL Input for Manual Entry */}
            <div className="mt-4">
              <details className="group">
                <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-800 transition-colors">
                  <span className="group-open:hidden">+ Add image URL manually</span>
                  <span className="hidden group-open:inline">- Hide manual URL input</span>
                </summary>
                <div className="mt-2 space-y-2">
                  {(formData.images || []).map((image, index) => (
                    <div key={index} className="flex items-center space-x-2">
                      <input
                        type="url"
                        value={image}
                        onChange={(e) => handleImageChange(index, e.target.value)}
                        placeholder="https://example.com/image.jpg"
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent text-gray-900 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => handleImageChange(index, '')}
                        className="px-2 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Clear image"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 rounded-b-xl -mx-6 -mb-4 mt-6 space-y-3">
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
          <div className="flex justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading || uploadingSlot !== null}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isLoading || uploadingSlot !== null}
            className="min-w-[160px] px-4 py-2 text-sm font-medium text-white bg-[#D4AF37] rounded-lg hover:bg-[#D4AF37]/90 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <ButtonSpinner className="text-white" />
                <span>Updating…</span>
              </>
            ) : uploadingSlot !== null ? (
              <span>Uploading image…</span>
            ) : (
              <span>{FOOD_VENDOR_COPY.updateButton}</span>
            )}
          </button>
          </div>
        </div>
        </form>
      </div>
    </div>
  );
}
