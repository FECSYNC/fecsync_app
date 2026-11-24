'use client';

import { useState, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import {
  useProfileQuery,
  useUpdateProfileMutation,
  useUploadAvatarMutation,
  useChangePasswordMutation,
} from '@/hooks/useProfile';
import { useToast } from '@/contexts/toast-context';
import AvatarUpload from '@/components/common/avatar-upload';
import ContactInfoCard from './contact-info-card';
import AddressCard, { AddressValues } from './address-card';
import AddressModal from './address-modal';
import { ApiError } from '@/utils/api';

export default function MyInfoSection() {
  // React Query hooks for profile data
  const { data: profileData, isLoading: loadingUser } = useProfileQuery();
  const updateProfileMutation = useUpdateProfileMutation();
  const uploadAvatarMutation = useUploadAvatarMutation();
  const changePasswordMutation = useChangePasswordMutation();
  const { addToast } = useToast();

  const [openKind, setOpenKind] = useState<null | 'home' | 'office'>(null);
  const passwordForm = useForm<{
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  }>({
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  // Derive addresses from profile (home = index 0, office = index 1)
  const addresses = useMemo(() => {
    const home = profileData?.addresses?.[0] || undefined;
    const office = profileData?.addresses?.[1] || undefined;
    return { home, office };
  }, [profileData?.addresses]);

  // Handle avatar upload
  const handleAvatarUpload = async (file: File) => {
    try {
      await uploadAvatarMutation.mutateAsync(file);
      addToast('Profile picture updated successfully', 'success');
    } catch (error) {
      console.error('Failed to upload avatar:', error);
      addToast('Failed to upload profile picture', 'error');
    }
  };

  if (loadingUser && !profileData) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-lg border p-8 flex items-center justify-center">
          <Loader2 className="animate-spin mr-2" size={18} />
          <span className="text-gray-600">Loading profile…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header: avatar + greeting */}
      <div className="bg-white border rounded-lg p-6 flex items-center gap-4">
        <AvatarUpload
          src={profileData?.profilePicture}
          size={72}
          onUpload={handleAvatarUpload}
        />
        <div>
          <h2 className="text-lg font-semibold text-black">Hello {profileData?.firstName || profileData?.user?.username?.split(' ')[0] || 'User'}</h2>
          <p className="text-sm text-gray-500">Welcome to your account</p>
        </div>
      </div>

      {/* Contact info card with Edit toggle */}
      <ContactInfoCard
        profileData={profileData}
        saving={updateProfileMutation.isPending}
        onSave={async (v) => {
          try {
            await updateProfileMutation.mutateAsync({
              username: v.username,
              firstName: v.firstName,
              lastName: v.lastName,
              phone: v.phone,
              bio: v.bio,
            });
            addToast('Profile updated successfully', 'success');
          } catch (error) {
            console.error('Failed to update profile:', error);
            addToast('Failed to update profile', 'error');
          }
        }}
      />

      {/* Address grid (exactly two cards) */}
      <div className="bg-white border rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-black">Address</h3>
            <p className="text-sm text-gray-500">Details</p>
          </div>
          {/* no add button by design */}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <AddressCard
            title="Home address"
            address={addresses.home}
            onEdit={() => setOpenKind('home')}
          />
          <AddressCard
            title="Office address"
            address={addresses.office}
            onEdit={() => setOpenKind('office')}
          />
        </div>
      </div>

      <div className="bg-white border rounded-lg p-6 max-w-lg">
        <h3 className="font-semibold text-black mb-1">Change password</h3>
        <p className="text-sm text-gray-500 mb-4">
          Use your current password, then choose a new one (min. 8 characters).
        </p>
        <form
          className="space-y-3"
          onSubmit={passwordForm.handleSubmit(async (vals) => {
            if (vals.newPassword !== vals.confirmPassword) {
              passwordForm.setError('confirmPassword', {
                message: 'Passwords do not match',
              });
              return;
            }
            try {
              await changePasswordMutation.mutateAsync({
                currentPassword: vals.currentPassword,
                newPassword: vals.newPassword,
              });
              passwordForm.reset();
              addToast('Password changed successfully', 'success');
            } catch (error) {
              const message =
                error instanceof ApiError
                  ? error.message
                  : 'Failed to change password';
              addToast(message, 'error');
            }
          })}
        >
          <input
            type="password"
            placeholder="Current password"
            autoComplete="current-password"
            {...passwordForm.register('currentPassword', { required: true })}
            className="w-full border rounded-lg px-3 py-2 text-black"
          />
          <input
            type="password"
            placeholder="New password"
            autoComplete="new-password"
            {...passwordForm.register('newPassword', { required: true, minLength: 8 })}
            className="w-full border rounded-lg px-3 py-2 text-black"
          />
          <input
            type="password"
            placeholder="Confirm new password"
            autoComplete="new-password"
            {...passwordForm.register('confirmPassword', { required: true })}
            className="w-full border rounded-lg px-3 py-2 text-black"
          />
          {passwordForm.formState.errors.confirmPassword && (
            <p className="text-xs text-red-600">
              {passwordForm.formState.errors.confirmPassword.message}
            </p>
          )}
          <button
            type="submit"
            disabled={changePasswordMutation.isPending}
            className="px-4 py-2 bg-[#fdc713] text-black rounded-lg hover:bg-[#f0c000] disabled:opacity-50 inline-flex items-center gap-2"
          >
            {changePasswordMutation.isPending ? (
              <>
                <Loader2 className="animate-spin" size={16} />
                Updating…
              </>
            ) : (
              'Update password'
            )}
          </button>
        </form>
      </div>

      {/* Modal for editing one slot */}
      <AddressModal
        open={!!openKind}
        title={openKind === 'home' ? 'Edit home address' : 'Edit office address'}
        initial={(openKind ? addresses[openKind] : undefined) as AddressValues}
        onClose={() => setOpenKind(null)}
        onSubmit={async (vals) => {
          if (!openKind || !profileData) return;
          
          try {
            const currentAddresses = [...(profileData.addresses || [])];
            const existing =
              openKind === 'home' ? currentAddresses[0] : currentAddresses[1];
            const nextAddress = {
              ...existing,
              ...vals,
              _id: vals._id || existing?._id,
            };
            
            if (openKind === 'home') {
              if (currentAddresses.length > 0) {
                currentAddresses[0] = nextAddress;
              } else {
                currentAddresses.push(nextAddress);
              }
            } else if (openKind === 'office') {
              if (currentAddresses.length > 1) {
                currentAddresses[1] = nextAddress;
              } else if (currentAddresses.length === 1) {
                currentAddresses.push(nextAddress);
              } else {
                currentAddresses.push(
                  {
                    line1: '',
                    city: '',
                    state: '',
                    zip: '',
                    country: 'Nigeria',
                    isDefault: true,
                  },
                  nextAddress
                );
              }
            }
            
            await updateProfileMutation.mutateAsync({ addresses: currentAddresses });
            addToast('Address updated successfully', 'success');
            setOpenKind(null);
          } catch (error) {
            console.error('Failed to update address:', error);
            addToast('Failed to update address', 'error');
          }
        }}
      />
    </div>
  );
}
