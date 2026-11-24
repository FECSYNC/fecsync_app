import { toUserFacingMessage } from "@/lib/userFacingError";

const EVENT = "harewa:user-error";

let lastMessage = "";
let lastAt = 0;

/** Show one plain-language notice at the top of the screen (deduped). */
export function reportUserError(error: unknown): void {
  if (typeof window === "undefined") return;
  const message = toUserFacingMessage(error);
  const now = Date.now();
  if (message === lastMessage && now - lastAt < 8000) return;
  lastMessage = message;
  lastAt = now;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { message } }));
}

export function subscribeUserErrors(
  listener: (message: string) => void
): () => void {
  const handler = (event: Event) => {
    const message = (event as CustomEvent<{ message?: string }>).detail?.message;
    if (message) listener(message);
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
