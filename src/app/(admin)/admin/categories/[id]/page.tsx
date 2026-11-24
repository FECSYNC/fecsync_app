import AdminCategoryDetailPage from './AdminCategoryDetailClient';

export default async function AdminCategoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AdminCategoryDetailPage id={id} />;
}
