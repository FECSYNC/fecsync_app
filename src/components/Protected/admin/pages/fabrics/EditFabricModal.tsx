'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useToast } from '@/contexts/toast-context';
import { colorHexToName } from './utils';
import { type Fabric } from './FabricsTable';
import {
  useAdminFabricsQuery,
  useUpdateFabricMutation,
} from '@/hooks/useFabrics';
import { type UpdateFabricInput, type YardBundle } from '@/services/fabric';
import { uploadCatalogImages, prefetchUploadSignatures } from '@/services/upload';
import { IMAGE_FILE_ACCEPT, isLikelyImageFile } from '@/utils/imageUpload';
import { ButtonSpinner } from '../../components/Spinner';
import {
  defaultCommerceState,
  FabricBundlePricingFields,
  FabricCommerceReview,
  FabricStepIndicator,
  FabricStepPanel,
  fabricModalMotion,
  validateCommerceStep,
  type FabricCommerceFormState,
} from './FabricFormShared';
import { taxFieldsToPayload } from '../products/ProductTaxFields';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';
import { useOverlayDismiss } from '@/hooks/useOverlayDismiss';

interface EditFabricModalProps {
  isOpen: boolean;
  onClose: () => void;
  fabric: Fabric;
  onSuccess?: (updated: Fabric) => void;
}

export default function EditFabricModal({ isOpen, onClose, fabric, onSuccess }: EditFabricModalProps) {
  const { addToast } = useToast();
  const [colorHex, setColorHex] = useState('#000080');
  const { canWriteFabrics, canReadProducts } = useCatalogActionPermissions();
  
  // Use React Query mutation
  const updateMutation = useUpdateFabricMutation();
  const { data: fabrics = [] } = useAdminFabricsQuery(isOpen);
  const liveCount = Number(
    (fabrics.find((f) => f._id === fabric?._id)?.productCount ??
      fabric?.productCount ??
      0)
  );
  const [isUploading, setIsUploading] = useState(false);
  const isLoading = isUploading || updateMutation.isPending;
  const [formData, setFormData] = useState({
    name: '',
    image: '',
    type: '',
    color: '',
    pattern: '',
    weight: '',
    width: '',
    composition: '',
    supplier: '',
    widthUnit: 'cm',
  });
  const [commerce, setCommerce] = useState<FabricCommerceFormState>(defaultCommerceState);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [step, setStep] = useState(1);

  const { overlayRef, overlayDismissProps } = useOverlayDismiss(onClose);

  useEffect(() => {
    if (!isOpen) return;
    prefetchUploadSignatures('fabrics', 1);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen && fabric) {
      setFormData({
        name: fabric.name || '',
        image: fabric.image || '',
        type: fabric.type || '',
        color: fabric.color || '',
        pattern: fabric.pattern || '',
        weight: fabric.weight?.toString() || '',
        width: fabric.width?.toString() || '',
        composition: fabric.composition || '',
        widthUnit: 'cm',
      });
      setCommerce({
        isSellable: Boolean(fabric.isSellable),
        yardBundle: fabric.yardBundle === 4 || fabric.yardBundle === 6 ? fabric.yardBundle : '',
        bundlePrice: fabric.bundlePrice?.toString() || '',
        stockBundles: fabric.stockBundles?.toString() ?? '0',
        supplier: fabric.supplier || '',
        inStock: fabric.inStock !== false,
        taxRate:
          fabric.taxRate === null || fabric.taxRate === undefined
            ? ''
            : String(fabric.taxRate),
        taxExempt: Boolean(fabric.taxExempt),
      });
      setSelectedFile(null);
      setImagePreview(null);
      setColorHex('#000080');
      setStep(1);
    }
  }, [isOpen, fabric]);

  useEffect(() => {
    setFormData(prev => ({ ...prev, color: colorHexToName(colorHex) }));
  }, [colorHex]);

  const handleCommerceChange = (
    name: keyof FabricCommerceFormState,
    value: string | boolean | YardBundle
  ) => {
    setCommerce((prev) => ({ ...prev, [name]: value }));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type, checked } = e.target as any;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));

    // Clear file selection when URL is entered
    if (name === 'image' && value) {
      setSelectedFile(null);
      setImagePreview(null);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!isLikelyImageFile(file)) {
      addToast('Please select a valid image file.', 'error');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 10 * 1024 * 1024) {
      addToast('Image size should be less than 10MB.', 'error');
      return;
    }

    setSelectedFile(file);

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Clear URL input when file is selected
    setFormData(prev => ({ ...prev, image: '' }));
  };

  const removeFile = () => {
    setSelectedFile(null);
    setImagePreview(null);
  };

  const canProceedFromStep = (s: number) => {
    if (s === 1) {
      return formData.name.trim().length > 0 && formData.type.trim().length > 0;
    }
    if (s === 2) return true;
    if (s === 3) {
      return validateCommerceStep(commerce) === null;
    }
    return true;
  };

  const nextStep = () => {
    if (!canProceedFromStep(step)) {
      const commerceErr = step === 3 ? validateCommerceStep(commerce) : null;
      addToast(commerceErr || 'Please complete required fields on this step.', 'error');
      return;
    }
    setStep((s) => Math.min(4, s + 1));
  };

  const prevStep = () => setStep((s) => Math.max(1, s - 1));

  const handleSubmit = async () => {
    if (!canWriteFabrics) {
      addToast('You do not have permission to edit fabrics', 'error');
      return;
    }
    if (isLoading) return;
    const name = formData.name.trim();
    const type = formData.type.trim();
    if (!name || !type) {
      addToast('Please fill required fields: name and type.', 'error');
      setStep(1);
      return;
    }
    
    try {
      let imageUrl = formData.image;

      if (selectedFile) {
        setIsUploading(true);
        try {
          const [uploaded] = await uploadCatalogImages([selectedFile], 'fabrics');
          imageUrl = uploaded;
        } catch (error: any) {
          addToast(`Failed to upload image: ${error.message}`, 'error');
          return;
        } finally {
          setIsUploading(false);
        }
      }

      const widthNum = formData.width ? Number(formData.width) : undefined;
      const widthCm =
        widthNum != null && !Number.isNaN(widthNum)
          ? formData.widthUnit === 'in'
            ? Math.round(widthNum * 2.54 * 100) / 100
            : widthNum
          : undefined;

      const taxPayload = taxFieldsToPayload(commerce.taxRate, commerce.taxExempt);
      const payload: UpdateFabricInput = {
        name,
        image: imageUrl || undefined,
        type,
        color: formData.color,
        pattern: formData.pattern || undefined,
        weight: formData.weight ? Number(formData.weight) : undefined,
        width: widthCm,
        composition: formData.composition || undefined,
        supplier: commerce.supplier || undefined,
        inStock: commerce.inStock,
        isSellable: commerce.isSellable,
        yardBundle: commerce.isSellable ? (commerce.yardBundle as YardBundle) : undefined,
        bundlePrice:
          commerce.isSellable && commerce.bundlePrice
            ? Number(commerce.bundlePrice)
            : undefined,
        stockBundles:
          commerce.isSellable && commerce.stockBundles !== ''
            ? Number(commerce.stockBundles)
            : undefined,
        taxRate: commerce.isSellable ? taxPayload.taxRate : null,
        taxExempt: commerce.isSellable ? taxPayload.taxExempt : false,
      };

      // Use React Query mutation
      const result = await updateMutation.mutateAsync({ _id: fabric._id, payload });
      addToast('Fabric updated successfully!', 'success');

      const updatedFabric: Fabric = {
        ...fabric,
        ...result,
        _id: fabric._id,
        productCount:
          typeof result.productCount === 'number'
            ? result.productCount
            : Number(fabric.productCount ?? liveCount),
        updatedAt: result.updatedAt || new Date().toISOString(),
      };
      onSuccess?.(updatedFabric);
      onClose();
    } catch (error: any) {
      let errorMessage = 'Failed to update fabric. Please try again.';
      if (error?.name === 'AbortError' || error?.message?.includes('aborted')) {
        errorMessage = 'Request failed. Please check your network connection and try again.';
      } else if (error?.error?.includes('E11000') || error?.message?.includes('duplicate')) {
        errorMessage = 'A fabric with this name already exists. Please choose a different name.';
      } else if (error?.error) {
        errorMessage = error.error;
      } else if (error?.message && !error.message.includes('aborted')) {
        errorMessage = error.message;
      }
      addToast(errorMessage, 'error');
    }
  };

  if (!isOpen) return null;

  return (
    <motion.div
      ref={overlayRef}
      onPointerDown={overlayDismissProps.onPointerDown}
      onClick={overlayDismissProps.onClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      aria-modal="true"
      role="dialog"
      aria-labelledby="edit-fabric-modal-title"
      initial={fabricModalMotion.overlay.initial}
      animate={fabricModalMotion.overlay.animate}
    >
      <motion.div
        className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl shadow-[#D4AF37]/10 overflow-hidden border border-[#D4AF37]/10"
        initial={fabricModalMotion.panel.initial}
        animate={fabricModalMotion.panel.animate}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-shrink-0 border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 id="edit-fabric-modal-title" className="text-xl font-semibold text-gray-900">Edit Fabric</h2>
            <button onClick={onClose} disabled={isLoading} aria-label="Close" className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] disabled:opacity-50 disabled:cursor-not-allowed">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <FabricStepIndicator step={step} />

          {step === 1 && (
            <FabricStepPanel stepKey={1}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input id="name" name="name" type="text" value={formData.name} onChange={handleInputChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-[#D4AF37] disabled:bg-gray-50 disabled:cursor-not-allowed" required />
              </div>
              <div>
                <label htmlFor="type" className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
                <input id="type" name="type" type="text" value={formData.type} onChange={handleInputChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-[#D4AF37] disabled:bg-gray-50 disabled:cursor-not-allowed" required />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Linked products
                </label>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <span className="text-sm text-gray-700">
                    {liveCount} {liveCount === 1 ? 'product' : 'products'}
                  </span>
                  {fabric?._id && canReadProducts && (
                    <Link
                      href={`/admin/products?fabric=${encodeURIComponent(fabric._id)}`}
                      className="text-sm font-medium text-[#D4AF37] hover:text-[#B8941F] hover:underline"
                      onClick={onClose}
                    >
                      View products
                    </Link>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Count updates automatically as products use this fabric
                </p>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Fabric Image</label>
                <div className="space-y-3">
                  {/* File Upload Option */}
                  <div>
                    <label htmlFor="file-upload" className="block text-xs font-medium text-gray-600 mb-1">Upload from Computer</label>
                    <div className="flex items-center space-x-3">
                      <input
                        id="file-upload"
                        type="file"
                        accept={IMAGE_FILE_ACCEPT}
                        onChange={handleFileChange}
                        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#D4AF37] file:text-white hover:file:bg-[#D4AF37]/90 file:cursor-pointer cursor-pointer"
                      />
                      {selectedFile && (
                        <button
                          type="button"
                          onClick={removeFile}
                          className="px-3 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>

                  {/* URL Input Option */}
                  <div>
                    <label htmlFor="image-url" className="block text-xs font-medium text-gray-600 mb-1">Or enter Image URL</label>
                    <input
                      id="image-url"
                      name="image"
                      type="url"
                      value={formData.image}
                      onChange={handleInputChange}
                      placeholder="https://placehold.co/600x400"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-[#D4AF37] disabled:bg-gray-50 disabled:cursor-not-allowed"
                    />
                  </div>

                  {/* Image Preview */}
                  {(imagePreview || formData.image) && (
                    <div className="mt-3">
                      <p className="text-sm text-gray-600 mb-2">Preview:</p>
                      <img
                        src={imagePreview || formData.image}
                        alt="Fabric preview"
                        className="w-32 h-32 object-cover rounded-lg border border-gray-300"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    </div>
                  )}

                  <p className="text-xs text-gray-500">
                    Upload an image file (JPG, PNG, GIF) or enter an image URL. Max file size: 5MB
                  </p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
                <div className="flex items-center space-x-3">
                  <input type="color" value={colorHex} onChange={(e) => setColorHex(e.target.value)} className="h-10 w-12 p-1 border border-gray-300 rounded" />
                  <input type="text" name="color" value={formData.color} onChange={handleInputChange} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-[#D4AF37]" required />
                </div>
                <p className="text-xs text-gray-500 mt-1">Picker updates to nearest color name; submitted as text.</p>
              </div>
              <div>
                <label htmlFor="pattern" className="block text-sm font-medium text-gray-700 mb-1">Pattern</label>
                <input id="pattern" name="pattern" type="text" value={formData.pattern} onChange={handleInputChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-[#D4AF37]" required />
              </div>
            </div>
            </FabricStepPanel>
          )}

          {step === 2 && (
            <FabricStepPanel stepKey={2}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="weight" className="block text-sm font-medium text-gray-700 mb-1">Weight (g/m²)</label>
                <input id="weight" name="weight" type="number" step="1" min="1" value={formData.weight} onChange={handleInputChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-[#D4AF37]" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Width</label>
                <div className="flex space-x-2">
                  <input id="width" name="width" type="number" step="0.01" min="0.01" value={formData.width} onChange={handleInputChange} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-[#D4AF37]" required />
                  <select name="widthUnit" value={formData.widthUnit} onChange={handleInputChange} className="px-3 py-2 border border-gray-300 rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-[#D4AF37]">
                    <option value="cm">cm</option>
                    <option value="in">in</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="composition" className="block text-sm font-medium text-gray-700 mb-1">Composition</label>
                <input id="composition" name="composition" type="text" value={formData.composition} onChange={handleInputChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-[#D4AF37]" required />
              </div>
            </div>
            </FabricStepPanel>
          )}

          {step === 3 && (
            <FabricStepPanel stepKey={3}>
              <FabricBundlePricingFields values={commerce} onFieldChange={handleCommerceChange} />
            </FabricStepPanel>
          )}

          {step === 4 && (
            <FabricStepPanel stepKey={4}>
            <div className="space-y-3 text-sm text-gray-800">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                <div><span className="text-gray-500">Name:</span> {formData.name || '-'}</div>
                <div><span className="text-gray-500">Type:</span> {formData.type || '-'}</div>
                <div className="md:col-span-2">
                  <span className="text-gray-500">Image:</span> {
                    selectedFile ? `File: ${selectedFile.name}` :
                    formData.image ? 'URL provided' :
                    'No image provided'
                  }
                  {(imagePreview || formData.image) && (
                    <div className="mt-2">
                      <img
                        src={imagePreview || formData.image}
                        alt="Fabric preview"
                        className="w-24 h-24 object-cover rounded border border-gray-300"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    </div>
                  )}
                </div>
                <div><span className="text-gray-500">Color:</span> {formData.color || '-'}</div>
                <div><span className="text-gray-500">Pattern:</span> {formData.pattern || '-'}</div>
                <div><span className="text-gray-500">Weight:</span> {formData.weight || '-'} {formData.weight ? 'g/m²' : ''}</div>
                <div><span className="text-gray-500">Width:</span> {formData.width || '-'} {formData.width ? formData.widthUnit : ''}</div>
                <div className="md:col-span-2"><span className="text-gray-500">Composition:</span> {formData.composition || '-'}</div>
                <div className="md:col-span-2">
                  <FabricCommerceReview commerce={commerce} />
                </div>
              </div>
            </div>
            </FabricStepPanel>
          )}

          <div className="flex-shrink-0 flex items-center justify-between mt-6 pt-4 border-t">
            <div>
              {step > 1 && (
                <button type="button" onClick={prevStep} disabled={isLoading} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Back</button>
              )}
            </div>
            <div className="flex items-center space-x-3">
              <button type="button" onClick={onClose} disabled={isLoading} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Cancel</button>
              {step < 4 ? (
                <button type="button" onClick={nextStep} disabled={isLoading} className="px-6 py-2 bg-[#D4AF37] text-white text-sm font-medium rounded-lg hover:bg-[#D4AF37]/90 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Next</button>
              ) : (
                <button type="button" onClick={handleSubmit} disabled={isLoading} className="px-6 py-2 bg-[#D4AF37] text-white text-sm font-medium rounded-lg hover:bg-[#D4AF37]/90 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2">
                  {isLoading ? (
                    <>
                      <ButtonSpinner />
                      <span>{isUploading ? 'Uploading image…' : 'Updating…'}</span>
                    </>
                  ) : (
                    <span>Update Fabric</span>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}


