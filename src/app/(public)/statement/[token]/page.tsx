import PublicStatementPage from '@/components/Public_C/accounting/PublicStatementPage';

export default async function PublicStatementRoute({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PublicStatementPage token={token} />;
}
