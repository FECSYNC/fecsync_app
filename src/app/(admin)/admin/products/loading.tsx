import AdminRouteLoading from '@/components/Protected/admin/components/AdminRouteLoading';
import { FOOD_VENDOR_COPY } from '@/lib/foodVendorCopy';

export default function Loading() {
  return <AdminRouteLoading label={FOOD_VENDOR_COPY.loading} />;
}
