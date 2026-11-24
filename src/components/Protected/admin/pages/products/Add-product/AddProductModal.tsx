'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/contexts/toast-context';
import { useCreateProductMutation } from '@/hooks/useProducts';
import type { AdminProductInput } from '@/services/products';
import ProductInformationStep from './ProductInformationStep';
import ImageUploadStep from './ImageUploadStep';
import { AddProductModalProps, FormDataPayload } from './types';
import { ButtonSpinner } from '../../../components/Spinner';
import { taxFieldsToPayload } from '../ProductTaxFields';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';
import { toUserFacingMessage } from '@/lib/userFacingError';
import { useOverlayDismiss } from '@/hooks/useOverlayDismiss';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { isStorefrontOrgSession } from '@/services/auth';
import { useBillingUsageQuery } from '@/hooks/useBilling';
import { usageMeterFor } from '@/services/billing';
import { softGateBlockedMessage } from '@/utils/planLimitSoftGate';
import { FOOD_VENDOR_COPY } from '@/lib/foodVendorCopy';

const emptyForm = (): FormDataPayload => ({
  name: '',
  description: '',
  price: '',
  quantity: '',
  remainingInStock: '',
  location: '',
  venueLocationId: '',
  category: '',
  sizes: [],
  gender: 'unisex',
  images: [],
  taxRate: '',
  taxExempt: false,
});


export default function AddProductModal({ isOpen, onClose, onSubmit, onSuccess }: AddProductModalProps) {
  const { addToast } = useToast();
  const createProductMutation = useCreateProductMutation();
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const canLoadUsage =
    !isStorefrontOrgSession(user) &&
    (can(P.ProductsWrite) || can(P.SettingsManage) || can(P.AnalyticsRead));
  const usageQuery = useBillingUsageQuery(isOpen && canLoadUsage);
  const productsMeter = usageMeterFor(usageQuery.data, 'products');
  const usageReady = !canLoadUsage || Boolean(usageQuery.data);
  const productsAtLimit =
    canLoadUsage &&
    (!usageReady ||
      !productsMeter ||
      (!productsMeter.unlimited && (productsMeter.remaining ?? 0) <= 0));
  const { canWriteProducts } = useCatalogActionPermissions();
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<FormDataPayload>(emptyForm);
  const [imagesBusy, setImagesBusy] = useState(false);

  const { overlayDismissProps } = useOverlayDismiss(onClose);

  // Close on ESC
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Reset step when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(1);
      setFormData(emptyForm());
      setImagesBusy(false);
    }
  }, [isOpen]);

  const handleFormDataChange = (data: Partial<FormDataPayload>) => {
    setFormData(prev => ({ ...prev, ...data }));
  };

  const handleNext = () => {
    setCurrentStep(2);
  };

  const handlePrevious = () => {
    setCurrentStep(1);
  };

  const hasAnyContent = () => {
    if (formData.name.trim()) return true;
    if (formData.description.trim()) return true;
    if (formData.price.trim()) return true;
    if (formData.quantity.trim()) return true;
    if (formData.remainingInStock.trim()) return true;
    if (formData.location.trim()) return true;
    if (formData.category.trim()) return true;
    if (formData.images.length > 0) return true;
    if (formData.taxRate.trim()) return true;
    if (formData.taxExempt) return true;
    return false;
  };

  const handleSubmit = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (isLoading || imagesBusy) return;
    if (!canWriteProducts) {
      addToast(FOOD_VENDOR_COPY.noPermissionAdd, 'error');
      return;
    }
    if (productsAtLimit) {
      addToast(
        softGateBlockedMessage(usageQuery.data, FOOD_VENDOR_COPY.meterLabel, {
          atLimit: true,
          usageReady: usageReady && Boolean(productsMeter),
        }) ?? 'Could not verify plan capacity',
        'error'
      );
      return;
    }

    if (!hasAnyContent()) {
      addToast('Fill in at least one field or add a photo to create the item.', 'error');
      return;
    }

    if (imagesBusy) {
      addToast('Please wait for image uploads to finish.', 'info');
      return;
    }

    try {
      const taxPayload = taxFieldsToPayload(formData.taxRate, formData.taxExempt);

      const backendPayload: AdminProductInput = {
        name: formData.name.trim() || 'Untitled item',
        description: formData.description.trim(),
        price: formData.price.trim() || '0',
        quantity: formData.quantity.trim() || '0',
        remainingInStock: formData.remainingInStock.trim() || '0',
        location: formData.location.trim(),
        venueLocationId: formData.venueLocationId.trim()
          ? formData.venueLocationId.trim()
          : null,
        images: formData.images,
        sizes: [],
        gender: 'unisex',
        ...(formData.category.trim()
          ? { category: formData.category.trim() }
          : {}),
        taxRate: taxPayload.taxRate,
        taxExempt: taxPayload.taxExempt,
      };

      // Use React Query mutation
      const result = await createProductMutation.mutateAsync(backendPayload);
      
      console.log('Product created successfully:', result);
      addToast(FOOD_VENDOR_COPY.successCreate, 'success');

      // Call the original onSubmit if provided (for backward compatibility)
      if (onSubmit) {
        onSubmit(formData);
      }

      // Call onSuccess callback (mutation handles cache update automatically)
      if (onSuccess) {
        onSuccess(result);
      }

      // Close modal
      onClose();
    } catch (error) {
      addToast(toUserFacingMessage(error), 'error');
    }
  };

  const isLoading = createProductMutation.isPending;

  if (!isOpen) return null;

  return (
    <div
      {...overlayDismissProps}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      aria-modal="true"
      role="dialog"
      aria-labelledby="product-modal-title"
    >
      <div className="w-full max-w-4xl rounded-xl bg-white shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 id="product-modal-title" className="text-xl font-semibold text-gray-900">
              {currentStep === 1
                ? FOOD_VENDOR_COPY.addModalTitle
                : FOOD_VENDOR_COPY.addPhotosTitle}
            </h2>
            <button
              onClick={onClose}
              disabled={isLoading}
              aria-label="Close"
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {productsMeter ? (
            <p className="mt-2 text-xs text-gray-500">
              {usageQuery.data?.billingEntitled === false
                ? softGateBlockedMessage(usageQuery.data, FOOD_VENDOR_COPY.meterLabel, {
                    atLimit: true,
                  })
                : productsMeter.unlimited
                  ? `${FOOD_VENDOR_COPY.meterPrefix}: ${productsMeter.used} items (unlimited)`
                  : `${FOOD_VENDOR_COPY.meterPrefix}: ${productsMeter.used}/${productsMeter.limit} items · ${productsMeter.remaining ?? 0} remaining`}
              {productsAtLimit && usageQuery.data?.billingEntitled !== false
                ? ' — Upgrade your plan in Billing to add more.'
                : null}
            </p>
          ) : null}
          
          {/* Step Indicator */}
          <div className="mt-4 flex items-center space-x-4">
            <div className="flex items-center">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                currentStep >= 1 ? 'bg-[#D4AF37] text-white' : 'bg-gray-200 text-gray-600'
              }`}>
                1
              </div>
              <span className={`ml-3 text-sm ${currentStep >= 1 ? 'text-gray-900' : 'text-gray-500'}`}>
                Item info
              </span>
            </div>
            <div className="h-0.5 w-8 bg-gray-200"></div>
            <div className="flex items-center">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                currentStep >= 2 ? 'bg-[#D4AF37] text-white' : 'bg-gray-200 text-gray-600'
              }`}>
                2
              </div>
              <span className={`ml-3 text-sm ${currentStep >= 2 ? 'text-gray-900' : 'text-gray-500'}`}>
                Photos
              </span>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-6">
          {currentStep === 1 ? (
            <ProductInformationStep
              formData={formData}
              onFormDataChange={handleFormDataChange}
              onNext={handleNext}
            />
          ) : (
            <ImageUploadStep
              formData={formData}
              onFormDataChange={handleFormDataChange}
              onImagesBusyChange={setImagesBusy}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t px-6 py-4">
          <div>
            {currentStep === 2 && (
              <button
                onClick={handlePrevious}
                disabled={isLoading}
                className="px-6 py-3 text-base font-medium text-gray-600 hover:text-gray-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ← Previous
              </button>
            )}
          </div>
          <div className="flex space-x-4">
            <button
              onClick={onClose}
              disabled={isLoading}
              className="px-6 py-3 text-base font-medium text-gray-600 hover:text-gray-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            {currentStep === 1 ? (
              <button
                onClick={handleNext}
                disabled={isLoading}
                className="rounded-lg bg-[#D4AF37] px-6 py-3 text-base font-medium text-white hover:bg-[#D4AF37]/90 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={
                  isLoading ||
                  imagesBusy ||
                  formData.images.length === 0 ||
                  productsAtLimit
                }
                className="rounded-lg bg-[#D4AF37] px-6 py-3 text-base font-medium text-white hover:bg-[#D4AF37]/90 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <span className="inline-flex items-center">
                    <ButtonSpinner className="text-white" />
                    Saving…
                  </span>
                ) : imagesBusy ? (
                  <span>Uploading photos…</span>
                ) : (
                  <span>{FOOD_VENDOR_COPY.saveButton}</span>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
