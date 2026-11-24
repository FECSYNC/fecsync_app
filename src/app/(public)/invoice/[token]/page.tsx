import { Suspense } from 'react';
import PublicInvoicePage from '@/components/Public_C/accounting/PublicInvoicePage';

export default async function PublicInvoiceRoute({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <Suspense fallback={<p className="p-8 text-sm text-stone-500">Loading…</p>}>
      <PublicInvoicePage token={token} />
    </Suspense>
  );
}
