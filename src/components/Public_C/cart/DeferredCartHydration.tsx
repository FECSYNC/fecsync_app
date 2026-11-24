'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { isCompanySitePath } from '@/lib/publicCategory/sitePaths';

const CartHydrationWithErrorBoundary = dynamic(
  () =>
    import('@/components/Public_C/cart/cart-hydration').then(
      (m) => m.CartHydrationWithErrorBoundary
    ),
  { ssr: false }
);

/** Defers cart sync JS so auth/marketing pages paint first. Company category sites never load the shop cart. */
export default function DeferredCartHydration() {
  const pathname = usePathname();
  if (isCompanySitePath(pathname)) return null;
  return <CartHydrationWithErrorBoundary />;
}
