import AdminProductDetailPage from './AdminProductDetailClient';

export default async function AdminProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AdminProductDetailPage id={id} />;
}
