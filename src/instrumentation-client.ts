/**
 * Runs before React hydrates. Next.js 16 turns console.error into a red
 * “1 Issue” overlay with stack traces — owners and admins should never see that.
 * Expected API/network noise is logged as warnings instead.
 */

function textFromArg(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name} ${value.message}`;
  if (value && typeof value === "object" && "message" in value) {
    return String((value as { message?: unknown }).message ?? "");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isExpectedClientNoise(args: unknown[]): boolean {
  const blob = args.map(textFromArg).join(" ").toLowerCase();
  return (
    blob.includes("apierror") ||
    blob.includes("failed to fetch") ||
    blob.includes("database temporarily") ||
    blob.includes("network error") ||
    blob.includes("network blip") ||
    blob.includes("request timed out") ||
    blob.includes("load failed") ||
    blob.includes("aborted") ||
    blob.includes("econnreset") ||
    blob.includes("can't reach database") ||
    blob.includes("[api]")
  );
}

const originalError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  if (isExpectedClientNoise(args)) {
    const friendly = args.map((arg) =>
      arg instanceof Error ? arg.message : arg
    );
    console.warn("[FECSYNC]", ...friendly);
    return;
  }
  originalError(...args);
};
