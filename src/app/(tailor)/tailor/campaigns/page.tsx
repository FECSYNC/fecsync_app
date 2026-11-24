import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import CampaignsPage from '@/components/Protected/tailor/CampaignsPage';

function CampaignsFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Loader2 className="animate-spin text-stone-400" />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<CampaignsFallback />}>
      <CampaignsPage />
    </Suspense>
  );
}
