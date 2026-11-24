import AdminRouteLoading from '@/components/Protected/admin/components/AdminRouteLoading';

/** First-compile only — soft-nav reuses the admin shell and skips this. */
export default function Loading() {
  return <AdminRouteLoading label="Opening membership categories…" />;
}
