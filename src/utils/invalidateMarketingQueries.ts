import type { QueryClient } from "@tanstack/react-query";
import { marketingKeys } from "@/services/marketing";

/**
 * Guest Marketing Automation React Query roots (admin desk).
 * Used on logout, park-scope preference changes, mutations, and org SaaS session sync.
 */
export function invalidateMarketingQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: marketingKeys.all });
}

/** Hard-drop (logout / account switch) — same roots as invalidate. */
export function removeMarketingQueries(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: marketingKeys.all });
}
