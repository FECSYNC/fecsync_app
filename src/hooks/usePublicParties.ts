"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPublicPartyHold,
  getPublicPartyAvailability,
  getPublicPartyConfirmation,
  getPublicPartyInvitation,
  getPublicPartyPackages,
  publicPartyCheckout,
  publicPartyKeys,
  rsvpPublicPartyInvitation,
} from "@/services/publicParties";

export function usePublicPartyPackagesQuery(orgSlug: string, venueSlug: string) {
  return useQuery({
    queryKey: publicPartyKeys.packages(orgSlug, venueSlug),
    queryFn: () => getPublicPartyPackages(orgSlug, venueSlug),
    enabled: Boolean(orgSlug && venueSlug),
  });
}

export function usePublicPartyAvailabilityQuery(q: {
  orgSlug: string;
  venueSlug: string;
  productId: string;
  date?: string;
  kids?: number;
  adults?: number;
}) {
  return useQuery({
    queryKey: publicPartyKeys.availability(q),
    queryFn: () => getPublicPartyAvailability(q),
    enabled: Boolean(q.orgSlug && q.venueSlug && q.productId && q.date),
  });
}

export function useCreatePublicPartyHoldMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPublicPartyHold,
    onSuccess: () => void qc.invalidateQueries({ queryKey: [...publicPartyKeys.all, "availability"] }),
  });
}

export function usePublicPartyCheckoutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: publicPartyCheckout,
    onSuccess: () => void qc.invalidateQueries({ queryKey: [...publicPartyKeys.all, "availability"] }),
  });
}

export function usePublicPartyConfirmationQuery(publicId: string, viewToken: string) {
  return useQuery({
    queryKey: publicPartyKeys.confirmation(publicId),
    queryFn: () => getPublicPartyConfirmation(publicId, viewToken),
    enabled: Boolean(publicId && viewToken),
    // Non-party bookings answer 404 here; the generic confirmation still renders.
    retry: false,
  });
}

export function usePublicPartyInvitationQuery(token: string) {
  return useQuery({
    queryKey: publicPartyKeys.invite(token),
    queryFn: () => getPublicPartyInvitation(token),
    enabled: Boolean(token),
    retry: false,
  });
}

export function usePublicPartyRsvpMutation(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { accept: boolean; name?: string; age?: number | null }) =>
      rsvpPublicPartyInvitation(token, payload),
    onSuccess: () => void qc.invalidateQueries({ queryKey: publicPartyKeys.invite(token) }),
  });
}
