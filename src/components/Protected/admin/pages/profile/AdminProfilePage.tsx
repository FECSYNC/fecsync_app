'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Loader2 } from 'lucide-react';
import AvatarUpload from '@/components/common/avatar-upload';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import { useToast } from '@/contexts/toast-context';
import {
  useChangePasswordMutation,
  useProfileQuery,
  useUpdateProfileMutation,
  useUploadAvatarMutation,
} from '@/hooks/useProfile';
import { useAuthStore } from '@/store/authStore';
import { ApiError } from '@/utils/api';

type ProfileFormValues = {
  username: string;
  firstName: string;
  lastName: string;
  phone: string;
  bio: string;
};

type PasswordFormValues = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export default function AdminProfilePage() {
  const { addToast } = useToast();
  const authUser = useAuthStore((s) => s.user);
  const { data: profile, isLoading } = useProfileQuery();
  const updateProfileMutation = useUpdateProfileMutation();
  const uploadAvatarMutation = useUploadAvatarMutation();
  const changePasswordMutation = useChangePasswordMutation();

  const profileForm = useForm<ProfileFormValues>({
    defaultValues: {
      username: '',
      firstName: '',
      lastName: '',
      phone: '',
      bio: '',
    },
  });

  const passwordForm = useForm<PasswordFormValues>({
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    profileForm.reset({
      username: profile.user?.username || '',
      firstName: profile.firstName || '',
      lastName: profile.lastName || '',
      phone: profile.user?.phoneNumber || '',
      bio: profile.bio || '',
    });
  }, [profile, profileForm]);

  const roleLabel =
    authUser?.membershipRole?.replace(/_/g, ' ') ||
    authUser?.preset?.replace(/_/g, ' ') ||
    authUser?.role ||
    profile?.user?.role ||
    'Staff';

  const onSaveProfile = profileForm.handleSubmit(async (values) => {
    try {
      await updateProfileMutation.mutateAsync({
        username: values.username.trim(),
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        phone: values.phone.trim(),
        bio: values.bio.trim(),
      });
      addToast('Profile updated across the app', 'success');
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to update profile';
      addToast(message, 'error');
    }
  });

  const onChangePassword = passwordForm.handleSubmit(async (values) => {
    setPasswordMessage(null);
    if (values.newPassword !== values.confirmPassword) {
      passwordForm.setError('confirmPassword', {
        message: 'Passwords do not match',
      });
      return;
    }
    try {
      await changePasswordMutation.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      passwordForm.reset();
      setPasswordMessage('Password updated successfully');
      addToast('Password changed successfully', 'success');
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to change password';
      addToast(message, 'error');
    }
  });

  const handleAvatarUpload = async (file: File) => {
    try {
      await uploadAvatarMutation.mutateAsync(file);
      addToast('Profile picture updated', 'success');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to upload picture';
      addToast(message, 'error');
    }
  };

  if (isLoading && !profile) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-10 flex items-center justify-center gap-2 text-gray-600">
        <Loader2 className="animate-spin" size={18} />
        Loading profile…
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My profile</h1>
        <p className="text-sm text-gray-600 mt-1">
          Update your personal details. Email, role, and permissions can only be
          changed by a platform admin.
        </p>
      </div>

      <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        <div className="flex items-center gap-4">
          <AvatarUpload
            src={profile?.profilePicture || authUser?.avatar}
            size={80}
            onUpload={handleAvatarUpload}
          />
          <div className="min-w-0">
            <p className="text-lg font-semibold text-gray-900 truncate">
              {[profile?.firstName, profile?.lastName].filter(Boolean).join(' ') ||
                authUser?.fullName ||
                authUser?.name ||
                'Admin'}
            </p>
            <p className="text-sm text-gray-500 truncate">{profile?.user?.email}</p>
            <p className="text-xs text-gray-400 mt-1 capitalize">{roleLabel}</p>
          </div>
        </div>

        <form onSubmit={onSaveProfile} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Username
            </label>
            <input
              {...profileForm.register('username')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              value={profile?.user?.email || ''}
              disabled
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 cursor-not-allowed"
            />
            <p className="text-xs text-gray-500 mt-1">
              Email cannot be changed by you.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              First name
            </label>
            <input
              {...profileForm.register('firstName')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Last name
            </label>
            <input
              {...profileForm.register('lastName')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phone
            </label>
            <input
              {...profileForm.register('phone')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Role
            </label>
            <input
              value={roleLabel}
              disabled
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 capitalize cursor-not-allowed"
            />
            <p className="text-xs text-gray-500 mt-1">
              Only a platform admin can change roles and permissions.
            </p>
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bio
            </label>
            <textarea
              {...profileForm.register('bio')}
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
              placeholder="A short intro about you"
            />
          </div>

          {Array.isArray(authUser?.permissions) && authUser.permissions.length > 0 && (
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Permissions
              </label>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 max-h-40 overflow-y-auto">
                <p className="text-xs text-gray-500 mb-2">
                  Read-only. Ask a platform admin to update these in Team & users.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {authUser.permissions.map((permission) => (
                    <span
                      key={permission}
                      className="inline-flex rounded-full bg-white border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600"
                    >
                      {permission}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={updateProfileMutation.isPending || !profileForm.formState.isDirty}
              className="inline-flex items-center gap-2 rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-medium text-white hover:bg-[#B8941F] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {updateProfileMutation.isPending ? (
                <>
                  <ButtonSpinner className="text-white" />
                  Saving…
                </>
              ) : (
                'Save profile'
              )}
            </button>
          </div>
        </form>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Change password</h2>
          <p className="text-sm text-gray-600 mt-1">
            Enter your current password, then choose a new one (min. 8 characters).
          </p>
        </div>

        <form onSubmit={onChangePassword} className="grid grid-cols-1 gap-4 max-w-md">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Current password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              {...passwordForm.register('currentPassword', { required: true })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              New password
            </label>
            <input
              type="password"
              autoComplete="new-password"
              {...passwordForm.register('newPassword', {
                required: true,
                minLength: 8,
              })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirm new password
            </label>
            <input
              type="password"
              autoComplete="new-password"
              {...passwordForm.register('confirmPassword', { required: true })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
            />
            {passwordForm.formState.errors.confirmPassword && (
              <p className="text-xs text-red-600 mt-1">
                {passwordForm.formState.errors.confirmPassword.message}
              </p>
            )}
          </div>

          {passwordMessage && (
            <p className="text-sm text-emerald-700">{passwordMessage}</p>
          )}

          <div>
            <button
              type="submit"
              disabled={changePasswordMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {changePasswordMutation.isPending ? (
                <>
                  <ButtonSpinner className="text-gray-700" />
                  Updating…
                </>
              ) : (
                'Update password'
              )}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
