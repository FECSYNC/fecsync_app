'use client';

import { StepProps } from './types';
import { useAdminCategoriesQuery } from '@/hooks/useCategories';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';
import ProductTaxFields from '../ProductTaxFields';
import ProductVenueField from '../ProductVenueField';
import { catalogRefId } from '@/lib/ids';
import { FOOD_VENDOR_COPY } from '@/lib/foodVendorCopy';
import { useAuthStore } from '@/store/authStore';

export default function ProductInformationStep({ formData, onFormDataChange, onNext }: StepProps) {
  const { canReadCategories } = useCatalogActionPermissions();
  const parkLocked = useAuthStore((s) => s.user?.parkLocked === true);
  const {
    data: categories = [],
    isLoading: isLoadingCategories,
    isError: categoriesFailed,
  } = useAdminCategoriesQuery(canReadCategories);

  const categoriesError =
    !canReadCategories
      ? 'You need permission to read categories'
      : categoriesFailed
        ? 'Failed to load categories'
        : null;

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    onFormDataChange({ [name]: value });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onNext) onNext();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {categoriesError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-600 text-sm">{categoriesError}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        <div>
          <label className="mb-3 block text-base font-medium text-gray-700">
            {FOOD_VENDOR_COPY.itemName}
          </label>
          <input
            type="text"
            name="name"
            value={formData.name}
            onChange={handleInputChange}
            placeholder="e.g. Park burger, lemonade, kids meal"
            className="w-full rounded-lg border border-gray-300 px-4 py-4 text-base text-black focus:border-transparent focus:ring-2 focus:ring-[#D4AF37]"
          />
        </div>

        <div>
          <label className="mb-3 block text-base font-medium text-gray-700">
            {FOOD_VENDOR_COPY.itemDescription}
          </label>
          <textarea
            name="description"
            value={formData.description}
            onChange={handleInputChange}
            rows={4}
            className="w-full rounded-lg border border-gray-300 px-4 py-4 text-base text-black focus:border-transparent focus:ring-2 focus:ring-[#D4AF37]"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div>
          <label className="mb-3 block text-base font-medium text-gray-700">
            Price ($)
          </label>
          <input
            type="number"
            name="price"
            value={formData.price}
            onChange={handleInputChange}
            min="0"
            step="0.01"
            className="w-full rounded-lg border border-gray-300 px-4 py-4 text-base text-black focus:border-transparent focus:ring-2 focus:ring-[#D4AF37]"
          />
        </div>

        <div>
          <label className="mb-3 block text-base font-medium text-gray-700">
            Quantity
          </label>
          <input
            type="number"
            name="quantity"
            value={formData.quantity}
            onChange={handleInputChange}
            min="0"
            className="w-full rounded-lg border border-gray-300 px-4 py-4 text-base text-black focus:border-transparent focus:ring-2 focus:ring-[#D4AF37]"
          />
        </div>

        <div>
          <label className="mb-3 block text-base font-medium text-gray-700">
            Remaining in Stock
          </label>
          <input
            type="number"
            name="remainingInStock"
            value={formData.remainingInStock}
            onChange={handleInputChange}
            min="0"
            className="w-full rounded-lg border border-gray-300 px-4 py-4 text-base text-black focus:border-transparent focus:ring-2 focus:ring-[#D4AF37]"
          />
        </div>

        <div>
          <label className="mb-3 block text-base font-medium text-gray-700">
            Location
          </label>
          <input
            type="text"
            name="location"
            value={formData.location}
            onChange={handleInputChange}
            className="w-full rounded-lg border border-gray-300 px-4 py-4 text-base text-black focus:border-transparent focus:ring-2 focus:ring-[#D4AF37]"
          />
        </div>
      </div>

      <ProductVenueField
        value={formData.venueLocationId}
        onChange={(venueLocationId) => onFormDataChange({ venueLocationId })}
        allowShared={!parkLocked}
      />

      <div>
        <label className="mb-3 block text-base font-medium text-gray-700">
          {FOOD_VENDOR_COPY.itemCategory}
        </label>
        <select
          name="category"
          value={formData.category}
          onChange={handleInputChange}
          className="w-full rounded-lg border border-gray-300 px-4 py-4 text-base text-black focus:border-transparent focus:ring-2 focus:ring-[#D4AF37]"
          disabled={isLoadingCategories}
        >
          <option value="">
            {isLoadingCategories
              ? 'Loading...'
              : 'Select menu category (optional)'}
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

      <ProductTaxFields
        taxRate={formData.taxRate}
        taxExempt={formData.taxExempt}
        disabled={false}
        onChange={(patch) => onFormDataChange(patch)}
      />
    </form>
  );
}
