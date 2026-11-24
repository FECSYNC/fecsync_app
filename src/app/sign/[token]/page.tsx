import SignWaiverForm from "@/components/waivers/SignWaiverForm";

export const dynamic = "force-dynamic";

export default async function SignWaiverPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ orgSlug?: string; venueSlug?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  return (
    <SignWaiverForm
      token={token}
      orgSlug={query.orgSlug}
      venueSlug={query.venueSlug}
    />
  );
}
