'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { permissionForProfileTab } from '@/lib/auth/permissions';
import MobileNavigation from './mobile-navigation';
import DesktopSidebar from './desktop-sidebar';
import OrdersSection from './orders/order-section';
import WishlistSection from './wishlist/wishlist-section';
import MyInfoSection from './info/my-info-section';
import DeleteAccountSection from './delete-account-section';
import CustomizationsSection from './customizations/CustomizationsSection';
import MeasurementsSection from './measurements/MeasurementsSection';
import CustomerTailoringJobsList from './tailoring-jobs/CustomerTailoringJobsList';
import CustomerCampaignsSection from './campaigns/CustomerCampaignsSection';
import ProfileBookingsSection from './bookings/ProfileBookingsSection';
import ProfilePartiesSection from './parties/ProfilePartiesSection';
import ProfileMembershipsSection from './memberships/ProfileMembershipsSection';
import BillingTab from './billing/BillingTab';
import UserTailoringAlerts from '@/components/common/UserTailoringAlerts';

export default function ProfileLayout() {
  const { can } = useAuthStore();
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabFromUrl = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(tabFromUrl || 'info');

  useEffect(() => {
    const tab = tabFromUrl || 'info';
    const perm = permissionForProfileTab(tab);
    if (perm && !can(perm)) {
      router.replace('/profile?tab=info');
      setActiveTab('info');
      return;
    }
    setActiveTab(tab);
  }, [tabFromUrl, can, router]);

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    if (tabId !== 'logout') {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', tabId);
      if (tabId !== 'measurements') {
        params.delete('profile');
        params.delete('category');
      }
      router.replace(`/profile?${params.toString()}`);
    }
  };

  void can;

  const renderContent = () => {
    switch (activeTab) {
      case 'orders': 
      return <OrdersSection />;
      case 'bookings':
        return <ProfileBookingsSection />;
      case 'parties':
        return <ProfilePartiesSection />;
      case 'memberships':
        return <ProfileMembershipsSection />;
      case 'billing':
        return <BillingTab />;
      case 'customizations':
        return <CustomizationsSection />;
      case 'measurements':
        return <MeasurementsSection />;
      case 'campaigns':
        return <CustomerCampaignsSection />;
      case 'tailoring-jobs':
        return <CustomerTailoringJobsList />;
      case 'wishlist':
        return <WishlistSection />;
      case 'info':
        return <MyInfoSection />;
      case 'delete-account':
        return <DeleteAccountSection />;
      default:
        return <MyInfoSection />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Custom CSS for hiding scrollbar */}
      <style jsx>{`
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
      `}</style>
      
      {/* Mobile Navigation */}
      <MobileNavigation
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />

      <div className="flex">
        {/* Desktop Sidebar */}
        <DesktopSidebar
          activeTab={activeTab}
          onTabChange={handleTabChange}
        />

        {/* Page Content */}
        <div className="flex-1 min-w-0 md:ml-64 pt-28 sm:pt-32 md:pt-16">
          <div className="flex justify-end px-3 sm:px-4 md:px-6 pt-4 md:pt-2">
            <UserTailoringAlerts jobBasePath="/profile/tailoring-jobs" />
          </div>
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
