'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { currentReturnTo, signInHref } from '@/utils/authRedirect';
import ProfileBookingDetail from '@/components/Protected/profile/bookings/ProfileBookingDetail';

export default function ProfileBookingDetailPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = React.use(params);
  const { isAuthenticated, hasHydratedAuth, user } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (user && isAuthenticated) return;
    if (hasHydratedAuth && !isAuthenticated) {
      router.push(signInHref(currentReturnTo(`/profile/bookings/${bookingId}`)));
    }
  }, [isAuthenticated, hasHydratedAuth, user, router, bookingId]);

  if (!user && !hasHydratedAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-[#fdc713]" />
      </div>
    );
  }
  if (!isAuthenticated) return <div className="min-h-screen bg-white" />;
  return <ProfileBookingDetail bookingId={bookingId} />;
}
