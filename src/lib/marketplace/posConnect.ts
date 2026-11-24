/**
 * Shared Connect destination fields for POS live Stripe charges (Step 3).
 * Franchise parks fail closed; non-franchise uses org Connect or platform.
 */

import { ForbiddenError } from "@/lib/auth/http-error";
import { resolveVenueBookingCheckoutDestination } from "@/lib/marketplace/guestPayoutDestination";

export async function resolvePosConnectChargeFields(input: {
  orgId: string;
  locationId: string;
  amountMinor: number;
}): Promise<{
  connectedAccountId: string | null;
  applicationFeeMinor: number | null;
  paymentIntentExtras: {
    application_fee_amount?: number;
    transfer_data?: { destination: string };
  };
  metadataExtras: Record<string, string>;
}> {
  try {
    const dest = await resolveVenueBookingCheckoutDestination(input);
    if (dest.connectedAccountId && dest.applicationFeeMinor != null) {
      return {
        connectedAccountId: dest.connectedAccountId,
        applicationFeeMinor: dest.applicationFeeMinor,
        paymentIntentExtras: {
          application_fee_amount: dest.applicationFeeMinor,
          transfer_data: { destination: dest.connectedAccountId },
        },
        metadataExtras: {
          orgId: input.orgId,
          locationId: input.locationId,
          connectedAccountId: dest.connectedAccountId,
        },
      };
    }
  } catch (err) {
    if (err instanceof ForbiddenError) throw err;
  }
  return {
    connectedAccountId: null,
    applicationFeeMinor: null,
    paymentIntentExtras: {},
    metadataExtras: {
      orgId: input.orgId,
      locationId: input.locationId,
    },
  };
}
