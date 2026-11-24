import PublicLayout from "@/components/Public_C/Layout/public-layout/publiclayout";
import VenueFlowPublicStyles from "@/components/Public_C/venueflow/VenueFlowPublicStyles";

export default function PublicPagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <VenueFlowPublicStyles />
      <PublicLayout>{children}</PublicLayout>
    </>
  );
}
