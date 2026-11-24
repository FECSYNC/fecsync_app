import type { Metadata } from 'next';
import PartyInvitePage from '@/components/Public_C/booking/party/PartyInvitePage';

export const metadata: Metadata = {
  title: 'Party invitation',
  robots: { index: false, follow: false },
};

export default async function PartyInviteRoute({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PartyInvitePage token={token} />;
}
