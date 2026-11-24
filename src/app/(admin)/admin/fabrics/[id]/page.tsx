import AdminFabricDetailPage from './AdminFabricDetailClient';

export default async function AdminFabricPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AdminFabricDetailPage id={id} />;
}
