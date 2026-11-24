'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { currentReturnTo, defaultPathForSession, signInHref } from '@/utils/authRedirect';
import PublicLayout from "@/components/Public_C/Layout/public-layout/publiclayout";

export default function UserPagesLayout({ children }: { children: React.ReactNode }) {
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const { user, hasHydratedAuth, isStaff } = useAuthStore();

  useEffect(() => {
    if (user) {
      if (isStaff()) {
        router.push(defaultPathForSession(user));
        return;
      }

      setIsCheckingAuth(false);
      return;
    }

    if (hasHydratedAuth && !user) {
      router.push(signInHref(currentReturnTo(pathname)));
      return;
    }
  }, [user, hasHydratedAuth, router, pathname, isStaff]);

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Minimal background to prevent flicker */}
      </div>
    );
  }

  // AuthBootstrap lives in root layout — do not remount here (duplicate timers).
  return <PublicLayout>{children}</PublicLayout>;
}
