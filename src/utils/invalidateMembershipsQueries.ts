import type { QueryClient } from "@tanstack/react-query";

/**
 * Guest park Memberships React Query roots (admin + profile self-serve).
 * Used on logout, plan entitle/demote flips, and org SaaS session sync.
 */
export function invalidateMembershipsQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ["admin", "memberships"] });
  void queryClient.invalidateQueries({ queryKey: ["me", "memberships"] });
}

/** Hard-drop (logout / account switch) — same roots as invalidate. */
export function removeMembershipsQueries(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: ["admin", "memberships"] });
  queryClient.removeQueries({ queryKey: ["me", "memberships"] });
}
