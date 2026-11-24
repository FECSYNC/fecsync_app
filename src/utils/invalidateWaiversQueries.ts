import type { QueryClient } from "@tanstack/react-query";

/**
 * Digital Waivers React Query roots (admin desk).
 * Used on logout, park-scope preference changes, and org SaaS session sync.
 */
export function invalidateWaiversQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ["admin", "waivers"] });
}

/** Hard-drop (logout / account switch) — same roots as invalidate. */
export function removeWaiversQueries(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: ["admin", "waivers"] });
}
