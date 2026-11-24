import VenueFlowHeader from "@/components/Public_C/venueflow/VenueFlowHeader";
import VenueFlowLanding from "@/components/Public_C/venueflow/VenueFlowLanding";
import VenueFlowFooter from "@/components/Public_C/venueflow/VenueFlowFooter";
import HomeLandingEffects from "@/components/Public_C/venueflow/HomeLandingEffects";

/**
 * Landing route — server shell streams header/landing/footer.
 * Interactive auth menu + slider hydrate on the client.
 */
export default function HomePage() {
  return (
    <>
      <HomeLandingEffects />
      <VenueFlowHeader />
      <VenueFlowLanding />
      <VenueFlowFooter />
    </>
  );
}
