'use client';

import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import MobileNavigation from '../mobile-navigation';
import DesktopSidebar from '../desktop-sidebar';
import CustomerTailoringJobDetail from './CustomerTailoringJobDetail';
import UserTailoringAlerts from '@/components/common/UserTailoringAlerts';
import { useRouter } from 'next/navigation';

export default function ProfileTailoringJobLayout({ jobId }: { jobId: string }) {
  const { user } = useAuthStore();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('tailoring-jobs');

  void user;

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    if (tabId === 'logout') return;
    if (tabId === 'tailoring-jobs') {
      router.push('/profile?tab=tailoring-jobs');
      return;
    }
    router.push(`/profile?tab=${encodeURIComponent(tabId)}`);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <MobileNavigation activeTab={activeTab} onTabChange={handleTabChange} />
      <div className="flex">
        <DesktopSidebar activeTab={activeTab} onTabChange={handleTabChange} />
        <div className="flex-1 md:ml-64 pt-32 md:pt-16">
          <div className="flex justify-end px-4 md:px-6 pt-4 md:pt-2">
            <UserTailoringAlerts jobBasePath="/profile/tailoring-jobs" />
          </div>
          <CustomerTailoringJobDetail id={jobId} />
        </div>
      </div>
    </div>
  );
}
