import TailorJobDetailClient from '@/components/Protected/tailor/TailorJobDetailClient';

export default async function TailorJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TailorJobDetailClient id={id} />;
}
