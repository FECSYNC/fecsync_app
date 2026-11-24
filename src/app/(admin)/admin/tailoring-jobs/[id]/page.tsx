import AdminTailoringJobDetailPage from '@/components/Protected/admin/pages/tailoring-jobs/AdminTailoringJobDetailPage';

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AdminTailoringJobDetailPage id={id} />;
}
