'use client';

import React, { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { currentReturnTo, signInHref } from '@/utils/authRedirect';
import ProfileInvoiceDetail from '@/components/Protected/profile/billing/ProfileInvoiceDetail';

function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  return (
    <Suspense fallback={<p className="px-6 py-10 text-sm text-stone-500">Loading…</p>}>
      <ProfileInvoiceDetail invoiceId={invoiceId} />
    </Suspense>
  );
}

export default function ProfileInvoicePage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = React.use(params);
  const { isAuthenticated, hasHydratedAuth, user } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (user && isAuthenticated) return;
    if (hasHydratedAuth && !isAuthenticated) {
      router.push(signInHref(currentReturnTo(`/profile/invoices/${invoiceId}`)));
    }
  }, [isAuthenticated, hasHydratedAuth, user, router, invoiceId]);

  if (!user && !hasHydratedAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-[#D4AF37]" />
      </div>
    );
  }
  if (!isAuthenticated) return <div className="min-h-screen bg-white" />;
  return <InvoiceDetail invoiceId={invoiceId} />;
}
