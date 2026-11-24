import KioskWaiverScreen from "@/components/waivers/KioskWaiverScreen";

export const dynamic = "force-dynamic";

export default async function KioskWaiverPage({
  params,
}: {
  params: Promise<{ deviceToken: string }>;
}) {
  const { deviceToken } = await params;
  return <KioskWaiverScreen deviceToken={deviceToken} />;
}
