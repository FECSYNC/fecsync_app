import PartyPackageEditorPage from '@/components/Protected/admin/pages/parties/PartyPackageEditorPage';

export default async function AdminPartyPackageEditRoute({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  return <PartyPackageEditorPage productId={productId} />;
}
