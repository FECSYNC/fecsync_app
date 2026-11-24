/**
 * Stripe Terminal reader collect for POS card tenders.
 * Loads Terminal JS from Stripe's CDN (no extra npm dep). Falls back to
 * in-browser Elements when the reader is offline or unavailable.
 */
import { confirmPosCardPayment, getPosTerminalConnectionToken } from "@/services/pos";

export type TerminalCollectResult =
  | { ok: true; message: string }
  | { ok: false; reason: string; fallbackToElements: true };

type TerminalReader = { id: string; label?: string; status?: string };
type TerminalSdk = {
  discoverReaders: (opts: {
    simulated?: boolean;
  }) => Promise<{
    error?: { message?: string };
    discoveredReaders?: TerminalReader[];
  }>;
  connectReader: (
    reader: TerminalReader
  ) => Promise<{ error?: { message?: string }; reader?: TerminalReader }>;
  collectPaymentMethod: (clientSecret: string) => Promise<{
    error?: { message?: string };
    paymentIntent?: unknown;
  }>;
  processPayment: (paymentIntent: unknown) => Promise<{
    error?: { message?: string };
    paymentIntent?: { id?: string; status?: string };
  }>;
};

type StripeTerminalFactory = {
  create: (opts: {
    onFetchConnectionToken: () => Promise<string>;
    onUnexpectedReaderDisconnect?: () => void;
  }) => TerminalSdk;
};

declare global {
  interface Window {
    StripeTerminal?: StripeTerminalFactory;
  }
}

let terminalSingleton: TerminalSdk | null = null;
let scriptPromise: Promise<StripeTerminalFactory> | null = null;

function loadStripeTerminalFactory(): Promise<StripeTerminalFactory> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Terminal requires a browser"));
  }
  if (window.StripeTerminal) return Promise.resolve(window.StripeTerminal);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const finish = () => {
      if (window.StripeTerminal) resolve(window.StripeTerminal);
      else reject(new Error("Stripe Terminal SDK missing after load"));
    };
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-pos-stripe-terminal="1"]'
    );
    if (existing) {
      // Script may already be loaded (load event already fired).
      if (window.StripeTerminal) {
        finish();
        return;
      }
      existing.addEventListener("load", finish);
      existing.addEventListener("error", () =>
        reject(new Error("Failed to load Stripe Terminal script"))
      );
      return;
    }
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/terminal/v1/";
    script.async = true;
    script.dataset.posStripeTerminal = "1";
    script.onload = finish;
    script.onerror = () => reject(new Error("Failed to load Stripe Terminal script"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

async function getTerminal(): Promise<TerminalSdk> {
  if (terminalSingleton) return terminalSingleton;
  const factory = await loadStripeTerminalFactory();
  terminalSingleton = factory.create({
    onFetchConnectionToken: async () => {
      const { secret } = await getPosTerminalConnectionToken();
      return secret;
    },
    onUnexpectedReaderDisconnect: () => {
      terminalSingleton = null;
    },
  });
  return terminalSingleton;
}

/**
 * Connect to the device's registered reader (`tmr_…`) and collect + process
 * the PaymentIntent, then settle the POS sale via confirm-card.
 */
export async function collectAndConfirmOnTerminal(opts: {
  saleId: string;
  publicId: string;
  clientSecret: string;
  paymentIntentId: string;
  readerId: string;
}): Promise<TerminalCollectResult> {
  const readerId = opts.readerId.trim();
  if (!readerId.startsWith("tmr_")) {
    return {
      ok: false,
      reason: "Device stripeTerminalId must be a Stripe reader id (tmr_…).",
      fallbackToElements: true,
    };
  }

  try {
    const terminal = await getTerminal();
    const discover = await terminal.discoverReaders({ simulated: false });
    if (discover.error) {
      return {
        ok: false,
        reason: discover.error.message || "Could not discover Terminal readers",
        fallbackToElements: true,
      };
    }
    const readers = discover.discoveredReaders ?? [];
    const match =
      readers.find((r) => r.id === readerId) ??
      (readers.length === 1 ? readers[0]! : null);
    if (!match) {
      return {
        ok: false,
        reason: `Reader ${readerId} not found nearby — use in-browser card confirm.`,
        fallbackToElements: true,
      };
    }

    const connected = await terminal.connectReader(match);
    if (connected.error) {
      return {
        ok: false,
        reason: connected.error.message || "Could not connect to Terminal reader",
        fallbackToElements: true,
      };
    }

    const collected = await terminal.collectPaymentMethod(opts.clientSecret);
    if (collected.error) {
      return {
        ok: false,
        reason: collected.error.message || "Card not presented on reader",
        fallbackToElements: true,
      };
    }

    const processed = await terminal.processPayment(collected.paymentIntent);
    if (processed.error) {
      return {
        ok: false,
        reason: processed.error.message || "Terminal could not process the card",
        fallbackToElements: true,
      };
    }

    const settled = await confirmPosCardPayment(opts.saleId, {
      paymentIntentId: opts.paymentIntentId,
    });
    return {
      ok: true,
      message:
        settled.sale.status === "completed"
          ? `Sale complete on Terminal: ${settled.sale.publicId}`
          : `Card captured on Terminal (${settled.sale.status}): ${settled.sale.publicId}`,
    };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Terminal collect failed",
      fallbackToElements: true,
    };
  }
}
