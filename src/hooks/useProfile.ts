// src/hooks/useProfile.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  patchMe, 
  uploadAvatar,
  changePassword,
  type Profile,
  type ProfileUpdatePayload 
} from '@/services/profile';
import { api, unwrap } from '@/utils/api';
import { useAuthStore } from '@/store/authStore';
import { toFrontendRole } from '@/services/auth';

/** Query Keys */
export const profileKeys = {
  all: ['profile'] as const,
  mine: () => [...profileKeys.all, 'mine'] as const,
  addresses: () => [...profileKeys.all, 'addresses'] as const,
};

function toProfileShape(raw: any): Profile {
  const profile = raw?.profile ?? raw;
  const userNode = profile?.user ?? {};
  return {
    _id: profile?._id || 'pending-profile',
    user: {
      email: userNode?.email || '',
      username: userNode?.username || '',
      isVerified: Boolean(userNode?.isVerified),
      role: toFrontendRole(userNode?.role),
      phoneNumber: userNode?.phoneNumber || '',
    },
    firstName: profile?.firstName || userNode?.firstName || '',
    lastName: profile?.lastName || userNode?.lastName || '',
    bio: profile?.bio || '',
    profilePicture: profile?.profilePicture || '',
    addresses: Array.isArray(profile?.addresses) ? profile.addresses : [],
  };
}

function syncAuthFromProfile(profile: Profile) {
  const { updateUser } = useAuthStore.getState();
  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
  updateUser({
    fullName: fullName || profile.user.username || undefined,
    name: fullName || profile.user.username || undefined,
    avatar: profile.profilePicture || undefined,
  });
}

/**
 * Hook to fetch user profile
 * Cached for 5 minutes (profile data doesn't change often)
 * Uses /api/auth/me endpoint (which returns profile nested in response)
 */
export function useProfileQuery(enabled: boolean = true) {
  const { isAuthenticated } = useAuthStore();
  
  return useQuery<Profile, Error>({
    queryKey: profileKeys.mine(),
    queryFn: async () => {
      const response = await api<any>('/api/auth/me');
      return toProfileShape(response);
    },
    enabled: enabled && isAuthenticated,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/**
 * Hook to get user addresses (derived from profile)
 */
export function useAddressesQuery(enabled: boolean = true) {
  const { data: profile, isLoading, error } = useProfileQuery(enabled);
  
  return {
    data: profile?.addresses ?? [],
    isLoading,
    error,
  };
}

/**
 * Hook to update user profile
 * Includes optimistic updates for instant UI feedback
 * Syncs important changes with authStore for navbar consistency
 */
export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation<Profile, Error, ProfileUpdatePayload>({
    mutationFn: async (payload: ProfileUpdatePayload) => {
      await patchMe(payload);
      const response = await api<any>('/api/auth/me');
      return toProfileShape(response);
    },
    onMutate: async (newProfile) => {
      await queryClient.cancelQueries({ queryKey: profileKeys.mine() });
      const previousProfile = queryClient.getQueryData<Profile>(profileKeys.mine());

      if (previousProfile) {
        queryClient.setQueryData<Profile>(profileKeys.mine(), {
          ...previousProfile,
          ...newProfile,
          user: {
            ...previousProfile.user,
            username: newProfile.username ?? previousProfile.user.username,
            phoneNumber: newProfile.phone ?? previousProfile.user.phoneNumber,
          },
          firstName: newProfile.firstName ?? previousProfile.firstName,
          lastName: newProfile.lastName ?? previousProfile.lastName,
          bio: newProfile.bio ?? previousProfile.bio,
          addresses: newProfile.addresses ?? previousProfile.addresses,
        });
      }

      return { previousProfile };
    },
    onError: (_error, _newProfile, context) => {
      if (context?.previousProfile) {
        queryClient.setQueryData(profileKeys.mine(), context.previousProfile);
      }
    },
    onSuccess: (updatedProfile) => {
      queryClient.setQueryData(profileKeys.mine(), updatedProfile);
      syncAuthFromProfile(updatedProfile);
      // Team & users list reads User.firstName/lastName — refresh after self-edit.
      void queryClient.invalidateQueries({ queryKey: ['admin-members'] });
      void queryClient.invalidateQueries({ queryKey: profileKeys.mine() });
    },
  });
}

/**
 * Hook to upload avatar/profile picture
 * Includes optimistic updates and syncs with authStore
 */
export function useUploadAvatarMutation() {
  const queryClient = useQueryClient();

  return useMutation<Profile, Error, File>({
    mutationFn: async (file: File) => {
      const response = await uploadAvatar(file);
      const unwrapped = unwrap(response);
      // Prefer fresh /me so nested user fields stay consistent with list APIs.
      try {
        const me = await api<any>('/api/auth/me');
        const shaped = toProfileShape(me);
        if (!shaped.profilePicture) {
          const fromUpload = (unwrapped as any)?.profilePicture;
          if (typeof fromUpload === 'string' && fromUpload) {
            shaped.profilePicture = fromUpload;
          }
        }
        return shaped;
      } catch {
        return toProfileShape({ profile: unwrapped, user: (unwrapped as any)?.user });
      }
    },
    onMutate: async (file) => {
      await queryClient.cancelQueries({ queryKey: profileKeys.mine() });
      const previousProfile = queryClient.getQueryData<Profile>(profileKeys.mine());

      if (previousProfile) {
        const previewUrl = URL.createObjectURL(file);
        queryClient.setQueryData<Profile>(profileKeys.mine(), {
          ...previousProfile,
          profilePicture: previewUrl,
        });
        useAuthStore.getState().updateUser({ avatar: previewUrl });
      }

      return { previousProfile };
    },
    onError: (_error, _file, context) => {
      if (context?.previousProfile) {
        queryClient.setQueryData(profileKeys.mine(), context.previousProfile);
        useAuthStore.getState().updateUser({
          avatar: context.previousProfile.profilePicture,
        });
      }
    },
    onSuccess: (updatedProfile) => {
      queryClient.setQueryData(profileKeys.mine(), updatedProfile);
      syncAuthFromProfile(updatedProfile);
      void queryClient.invalidateQueries({ queryKey: profileKeys.mine() });
    },
  });
}

/**
 * Authenticated password change (current + new). Does not touch role/email.
 */
export function useChangePasswordMutation() {
  return useMutation<void, Error, { currentPassword: string; newPassword: string }>({
    mutationFn: async (payload) => {
      await changePassword(payload);
    },
  });
}
