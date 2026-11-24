import { Suspense } from 'react';
import BillingPage from '@/components/Protected/admin/pages/billing/BillingPage';

export default function AdminBillingRoute() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[40vh]">
          <div className="w-10 h-10 border-4 border-[#D4AF37] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <BillingPage />
    </Suspense>
  );
}
