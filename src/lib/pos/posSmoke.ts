/**
 * Simulated card tenders (POS_SMOKE=1) are for local/CI smokes only.
 * Never honor in production even if the env var is accidentally set.
 */
export function posSmokeAllowed(): boolean {
  return (
    process.env.POS_SMOKE === "1" && process.env.NODE_ENV !== "production"
  );
}
