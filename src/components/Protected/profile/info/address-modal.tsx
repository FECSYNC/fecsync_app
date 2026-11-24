'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { X, Loader2 } from 'lucide-react';
import type { AddressValues } from './address-card';

export type { AddressValues };

const EMPTY_ADDRESS: AddressValues = {
  line1: '',
  line2: '',
  city: '',
  state: '',
  lga: '',
  zip: '',
  country: 'Nigeria',
  phone: '',
  contactName: '',
  isDefault: false,
};

export default function AddressModal({
  open,
  title,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  initial?: AddressValues;
  onClose: () => void;
  onSubmit: (data: AddressValues) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const { register, handleSubmit, reset, formState: { isDirty } } = useForm<AddressValues>();

  useEffect(() => {
    if (open && initial) {
      reset({
        ...EMPTY_ADDRESS,
        ...initial,
        line2: initial.line2 ?? '',
        lga: initial.lga ?? '',
        phone: initial.phone ?? '',
        contactName: initial.contactName ?? '',
      });
    } else if (open) {
      reset({ ...EMPTY_ADDRESS });
    }
  }, [open, initial, reset]);

  const handleFormSubmit = async (data: AddressValues) => {
    setSaving(true);
    try {
      await onSubmit({
        ...data,
        line1: data.line1.trim(),
        line2: data.line2?.trim() || undefined,
        city: data.city.trim(),
        state: data.state.trim(),
        lga: data.lga?.trim() || undefined,
        zip: data.zip.trim(),
        country: data.country.trim() || 'Nigeria',
        phone: data.phone?.trim() || undefined,
        contactName: data.contactName?.trim() || undefined,
        _id: initial?._id,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-lg p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-black">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Contact name</label>
            <input
              {...register('contactName')}
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fdc713] focus:border-transparent text-black"
              placeholder="Recipient name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
            <input
              {...register('phone')}
              type="tel"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fdc713] focus:border-transparent text-black"
              placeholder="08012345678"
            />
            <p className="mt-1 text-xs text-gray-500">Recommended for courier delivery</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Street Address *</label>
            <input
              {...register('line1', { required: true })}
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fdc713] focus:border-transparent text-black"
              placeholder="123 Main Street"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Address line 2</label>
            <input
              {...register('line2')}
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fdc713] focus:border-transparent text-black"
              placeholder="Apartment, suite, landmark"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">City *</label>
            <input
              {...register('city', { required: true })}
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fdc713] focus:border-transparent text-black"
              placeholder="Lagos"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">LGA</label>
            <input
              {...register('lga')}
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fdc713] focus:border-transparent text-black"
              placeholder="Ikeja"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">State *</label>
            <input
              {...register('state', { required: true })}
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fdc713] focus:border-transparent text-black"
              placeholder="Lagos"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">ZIP Code</label>
            <input
              {...register('zip')}
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fdc713] focus:border-transparent text-black"
              placeholder="100001"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Country *</label>
            <input
              {...register('country', { required: true })}
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fdc713] focus:border-transparent text-black"
              placeholder="Nigeria"
            />
          </div>

          <div className="flex items-center">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                {...register('isDefault')}
                className="w-4 h-4 text-[#fdc713] border-gray-300 rounded focus:ring-[#fdc713]"
              />
              <span className="text-sm text-gray-700">Set as default address</span>
            </label>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={saving || !isDirty}
              className="flex-1 px-4 py-2 bg-[#fdc713] text-black rounded-lg hover:bg-[#f0c000] transition-colors disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="animate-spin mr-2 inline" size={16} />
                  Saving...
                </>
              ) : (
                'Save Address'
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
