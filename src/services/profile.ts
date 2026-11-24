import { api } from '@/utils/api';
import { compressImageFile } from '@/utils/imageUpload';
import { UPLOAD_REQUEST_TIMEOUT_MS } from '@/services/upload';

export type User = {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  gender?: 'male' | 'female' | 'other';
  dob?: string;        // ISO string
  avatarUrl?: string;
};

export type Profile = {
  _id: string;
  user: {
    email: string;
    username: string;
    isVerified: boolean;
    role: string;
    phoneNumber?: string;
  };
  firstName: string;
  lastName: string;
  addresses: Address[];
  bio: string;
  profilePicture?: string;
};

export type Address = {
  _id?: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  lga?: string;
  zip: string;
  country: string;
  phone?: string;
  contactName?: string;
  isDefault: boolean;
};

export type ProfileUpdatePayload = {
  username?: string;
  phone?: string;
  bio?: string;
  firstName?: string;
  lastName?: string;
  addresses?: Address[];
};

export function getMe() {
  return api<User>('/api/auth/me');
}

export function getProfile() {
  return api<Profile>('/api/auth/profile');
}

export function patchMe(payload: ProfileUpdatePayload) {
  return api<User>('/api/auth/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function changePassword(payload: {
  currentPassword: string;
  newPassword: string;
}) {
  return api<{ message?: string }>('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function uploadAvatar(file: File) {
  const prepared = await compressImageFile(file);
  const form = new FormData();
  form.append('file', prepared);
  return api<Profile>(
    '/api/auth/profile/picture',
    { method: 'POST', body: form },
    { timeout: UPLOAD_REQUEST_TIMEOUT_MS }
  );
}

// Addresses — server shape may differ; adapt paths if needed
export function getTwoAddresses() {
  // Expecting array [{kind:'billing',...},{kind:'shipping',...}]
  return api<Address[]>('/api/addresses?limit=2');
}

export function upsertAddress(addr: Address) {
  // if id exists -> PATCH, else POST (but still only billing/shipping)
  if (addr._id) {
    return api<Address>(`/api/addresses/${addr._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addr),
    });
  }
  return api<Address>('/api/addresses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(addr),
  });
}
