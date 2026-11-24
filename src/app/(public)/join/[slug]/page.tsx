import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import JoinCampaignClient from '@/components/Public_C/campaigns/JoinCampaignClient';

type Props = {
  params: Promise<{ slug: string }>;
};

function JoinFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Loader2 className="animate-spin text-stone-400" />
    </div>
  );
}

export default async function JoinCampaignPage({ params }: Props) {
  const { slug } = await params;
  return (
    <Suspense fallback={<JoinFallback />}>
      <JoinCampaignClient slug={slug} />
    </Suspense>
  );
}
