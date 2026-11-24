import VenueFlowPublicStyles from "@/components/Public_C/venueflow/VenueFlowPublicStyles";
import UserPagesLayout from "./UserPagesLayout";

export default function UserRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <VenueFlowPublicStyles />
      <UserPagesLayout>{children}</UserPagesLayout>
    </>
  );
}
