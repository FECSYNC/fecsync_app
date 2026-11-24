export type FormDataPayload = {
  name: string;
  description: string;
  price: string;
  quantity: string;
  remainingInStock: string;
  location: string;
  /** Park stamp FK — empty = company-shared for CWV. */
  venueLocationId: string;
  category: string;
  sizes: string[];
  gender: 'male' | 'female' | 'unisex';
  /** Cloudinary (or remote) URLs — uploaded as soon as the user picks files */
  images: string[];
  taxRate: string;
  taxExempt: boolean;
};

export type BackendProductPayload = {
  name: string;
  description: string;
  price: string;
  quantity: string;
  remainingInStock: string;
  location: string;
  venueLocationId?: string | null;
  images: string[];
  sizes: string[];
  gender: 'male' | 'female' | 'unisex';
  category: string;
  taxRate?: number | null;
  taxExempt?: boolean;
};

export interface StepProps {
  formData: FormDataPayload;
  onFormDataChange: (data: Partial<FormDataPayload>) => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onSubmit?: (data: FormDataPayload) => void;
  /** True while a Cloudinary upload is in flight (disables Save). */
  onImagesBusyChange?: (busy: boolean) => void;
}

export interface AddProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit?: (data: FormDataPayload) => void;
  onSuccess?: (product?: any) => void; // Accept the created product
}
