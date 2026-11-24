import FabricDetail from '@/components/Public_C/fabrics_gallery/FabricDetail';

export default async function FabricDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="min-h-screen bg-gray-50 pt-24">
      <FabricDetail fabricId={id} />
    </div>
  );
}
