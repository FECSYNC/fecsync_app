'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { currentReturnTo, signInHref } from '@/utils/authRedirect';
import ProfileTailoringJobLayout from '@/components/Protected/profile/tailoring-jobs/ProfileTailoringJobLayout';

export default function ProfileTailoringJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = React.use(params);
  const { isAuthenticated, hasHydratedAuth, user } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (user && isAuthenticated) return;
    if (hasHydratedAuth && !isAuthenticated) {
      router.push(signInHref(currentReturnTo(`/profile/tailoring-jobs/${id}`)));
    }
  }, [isAuthenticated, hasHydratedAuth, user, router, id]);

  if (!user && !hasHydratedAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-[#fdc713] rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <div className="min-h-screen bg-white" />;
  }

  return <ProfileTailoringJobLayout jobId={id} />;
}
