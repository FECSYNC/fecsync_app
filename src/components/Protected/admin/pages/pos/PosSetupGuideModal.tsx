"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

export type PosSetupGuideTab = "station" | "catalog" | "menus" | "policies" | "tools";

type GuideStep = {
  id: string;
  title: string;
  plain: string;
  bullets?: string[];
  fields?: Array<{ name: string; how: string }>;
  elsewhere?: Array<{ label: string; href?: string; note: string }>;
  goTab?: PosSetupGuideTab;
  tip?: string;
};

const STEPS: GuideStep[] = [
  {
    id: "welcome",
    title: "Welcome — what this screen is for",
    plain:
      "POS setup is where you prepare the counter before cashiers sell. Think of it like stocking a till: first pick which park you are configuring, then register a device (the till), then add products guests can buy. When you are done, close this window and use the terminal Sell tab.",
    bullets: [
      "You do not need a separate browser page for everyday setup — use this modal from the terminal.",
      "Changes save as you go. The sell pad behind this window refreshes automatically.",
      "Work in order: Park → Device → Products → (optional) Menus → Policies → sell.",
    ],
    tip: "If anything is blank or greyed out, you usually skipped an earlier step — this guide will tell you which one.",
  },
  {
    id: "before",
    title: "Before you start — things that must already exist",
    plain:
      "Some pieces are created outside POS setup. If the Park dropdown is empty, or POS is locked, fix these first, then come back here.",
    elsewhere: [
      {
        label: "Company plan (Growth or higher)",
        href: "/admin/billing",
        note: "POS is a Growth+ module. Demo/Starter companies cannot run the live terminal until you upgrade. Open Billing to check or change your package.",
      },
      {
        label: "At least one park (venue)",
        href: "/admin/venues",
        note: "A park is the physical site (attraction, rink, campus). Go to Venues, create or open a park, save it, then return here — it will appear in the Park dropdown.",
      },
      {
        label: "Staff permission for POS setup",
        href: "/admin/users",
        note: "Your login needs POS admin rights. If Save buttons fail with a permission error, ask a company admin to grant POS setup on your membership.",
      },
    ],
    tip: "Create the park first. Without a park you cannot register a device or add products.",
  },
  {
    id: "park",
    title: "Step 1 — Choose the park",
    plain:
      "Everything on this screen belongs to one park. Select the site you are setting up now. Device counts and product counts on the right update for that park only.",
    fields: [
      {
        name: "Park",
        how: "Open the dropdown and pick the venue. If you only see “Select park”, go create a venue first (previous step), then reopen setup.",
      },
    ],
    goTab: "station",
    tip: "Multi-park companies: finish one park (device + a few products), then switch Park and repeat for the next site.",
  },
  {
    id: "device",
    title: "Step 2 — Register a device (till)",
    plain:
      "A device is one counter station — for example “Front desk” or “Gift shop”. Cashiers must pick this device on the terminal before they can sell. You need at least one active device per park.",
    fields: [
      {
        name: "Device display name",
        how: "Type a clear name staff will recognize (e.g. Front desk). Leave blank and we still save it as “Front desk”.",
      },
      {
        name: "Internal code",
        how: "Generated automatically from the name (e.g. front-till). You do not type this — it is used behind the scenes so each till is unique in your company.",
      },
      {
        name: "Save device",
        how: "Press this after choosing a park and entering a name. The new till appears in the list below. Then select that device on the terminal header.",
      },
    ],
    goTab: "station",
    elsewhere: [
      {
        label: "Open a till for cash",
        href: "/admin/pos",
        note: "After the device exists, open a cash drawer via the Tills tab on the terminal. Cash sales usually require an open till if that policy is on.",
      },
    ],
    tip: "Seeing “0 devices”? You have not saved a device yet for this park — complete this step before Catalog.",
  },
  {
    id: "catalog",
    title: "Step 3 — Add products (what you sell)",
    plain:
      "Products are the buttons cashiers tap on Sell. Add at least one product (snack, souvenir, day pass proxy, etc.). They show on the sell pad as soon as they are saved and not suspended.",
    fields: [
      {
        name: "Product name",
        how: "What appears on the sell tile (e.g. Soft drink). Keep it short and clear.",
      },
      {
        name: "Price",
        how: "Default sale price in your currency. You can change it later; open-price items need the “Allow open price” policy turned on.",
      },
      {
        name: "Add",
        how: "Saves the product to this park’s catalog. Watch the gold “products” badge go up.",
      },
      {
        name: "Suspend / Unsuspend",
        how: "Suspend hides the item from cashiers without deleting it. Use this for seasonal items.",
      },
    ],
    goTab: "catalog",
    tip: "Shop menu items under Admin → Products are a different catalog (online store). POS products live only here unless you later link special kinds (membership, admission).",
  },
  {
    id: "menus",
    title: "Step 4 (optional) — Menus, categories & modifiers",
    plain:
      "Menus are optional. You can sell from a flat product list. Use Menus when you want categories (Food, Retail) or modifiers (Size, Topping). Create products first — menus only attach existing products.",
    fields: [
      {
        name: "Menu name + Create menu",
        how: "Creates a menu shell for this park. Click a menu chip to select it before adding categories or items.",
      },
      {
        name: "Category name",
        how: "A section inside the selected menu (e.g. Drinks). Add category, then add products into the menu.",
      },
      {
        name: "Select product for menu item",
        how: "Pick from products you already created on Catalog. If the list is empty, go back to Catalog and add products first.",
      },
      {
        name: "Modifiers (group, option, price delta)",
        how: "Choose a product, name a group (Size), an option (Large), and an extra price. Save modifiers — cashiers will see choices when adding that item.",
      },
    ],
    goTab: "menus",
    tip: "Order of work: Catalog products → create menu → add category → add products to menu → add modifiers if needed.",
  },
  {
    id: "policies",
    title: "Step 5 — Policies (rules & PIN)",
    plain:
      "Policies control how strict the counter is. Each toggle saves immediately and syncs to the sell pad. Start with defaults if you are unsure; you can tighten rules later.",
    fields: [
      {
        name: "Guest / postcode toggles",
        how: "Require a guest or postcode on sale when you need guest data for marketing or compliance.",
      },
      {
        name: "Tip prompt & tip percents",
        how: "Shows tip chips on pay. Edit percents as comma numbers like 15,18,20 then leave the field (blur) to save.",
      },
      {
        name: "Manager PIN for discount / refund / void / wastage",
        how: "Forces a manager PIN for sensitive actions. Set the PIN in the box at the bottom of Policies before relying on these toggles.",
      },
      {
        name: "Cash requires open till",
        how: "When on, cashiers cannot take cash until a till is open for that device (see Tills).",
      },
      {
        name: "Offline enabled",
        how: "Allows limited offline queueing when the network drops. Only turn on if your team was trained for offline recovery.",
      },
    ],
    goTab: "policies",
    tip: "Set a manager override PIN early if you plan to require PINs for voids or discounts.",
  },
  {
    id: "tools",
    title: "Step 6 — Tools (discounts & wastage)",
    plain:
      "Discounts and wastage are day-to-day tools. Create a discount code here, then cashiers type that same code on the sell pad. Wastage records spoilage against a product you already created.",
    fields: [
      {
        name: "Discount CODE",
        how: "Type a short code (e.g. STAFF10). It cannot be empty. “Add 10% code” saves a 10% off code for this park.",
      },
      {
        name: "Wastage product / qty / reason",
        how: "Pick a catalog product, enter how many units were wasted, and why. If policy requires a manager PIN, you will be asked for it.",
      },
    ],
    goTab: "tools",
    tip: "Create the product on Catalog before recording wastage — the product list comes from this park’s POS catalog.",
  },
  {
    id: "sell",
    title: "Step 7 — Start selling on the terminal",
    plain:
      "When the badges show at least 1 device and 1 product, you are ready. Press Done to close setup. On the terminal: pick the same park and device in the header, tap a product, then take payment (Cash / Card).",
    bullets: [
      "Sell — catalog and checkout (main screen).",
      "Check in / Tabs / Capacity / Guest — open as quick tools from the top tabs (modals).",
      "Sales — look up past sales and resume unpaid card confirms.",
      "Tills — open/close cash drawers for the device.",
    ],
    elsewhere: [
      {
        label: "Terminal (Sell)",
        href: "/admin/pos",
        note: "Main cashier screen. Use the Setup tab anytime you need to add products or devices again.",
      },
      {
        label: "Tills",
        href: "/admin/pos",
        note: "Use the Tills tab on the terminal to open a till for the device before taking cash if your policy requires it.",
      },
      {
        label: "Sales history",
        href: "/admin/pos",
        note: "Use the Sales tab on the terminal for receipts, voids, and unpaid card sales that still need confirmation.",
      },
    ],
    tip: "Card payments need Stripe keys configured for the company. Cash and payment links can still work without a card reader.",
  },
  {
    id: "checklist",
    title: "Quick checklist",
    plain: "Use this list whenever a new park goes live or a new counter is added.",
    bullets: [
      "☐ Park exists under Venues and is selected here.",
      "☐ At least one device saved for that park.",
      "☐ At least one product on Catalog (not suspended).",
      "☐ (Optional) Menu + categories if you want grouped selling.",
      "☐ Policies reviewed; manager PIN set if required.",
      "☐ Till opened for cash, if cash-requires-till is on.",
      "☐ Terminal header shows the correct park + device; sell pad shows products.",
    ],
    tip: "Stuck? Re-open this guide from the Guide button anytime — nothing here changes your data; it only explains the path.",
  },
];

type Props = {
  open: boolean;
  onClose: () => void;
  /** Jump the setup UI to the matching tab when the user taps “Show me”. */
  onGoToTab?: (tab: PosSetupGuideTab) => void;
};

export default function PosSetupGuideModal({ open, onClose, onGoToTab }: Props) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setStep((s) => Math.min(s + 1, STEPS.length - 1));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const current = STEPS[step]!;
  const progress = ((step + 1) / STEPS.length) * 100;
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-stretch justify-center bg-stone-900/55 p-2 backdrop-blur-[2px] sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="POS setup guide"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12 }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
        className="flex max-h-[min(92vh,880px)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl shadow-stone-900/30"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 border-b border-stone-100 bg-gradient-to-r from-stone-900 to-stone-800 px-4 py-3 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#D4AF37]">
                Walkthrough
              </p>
              <h2 className="font-serif text-xl tracking-tight">POS setup guide</h2>
              <p className="mt-1 text-[11px] text-stone-300">
                Step {step + 1} of {STEPS.length} · written for first-time admins
              </p>
            </div>
            <button
              type="button"
              className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-white/20"
              onClick={onClose}
            >
              Close
            </button>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15">
            <motion.div
              className="h-full rounded-full bg-[#D4AF37]"
              animate={{ width: `${progress}%` }}
              transition={{ type: "spring", stiffness: 200, damping: 24 }}
            />
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={current.id}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <h3 className="font-serif text-2xl leading-snug text-stone-900">{current.title}</h3>
              <p className="text-sm leading-relaxed text-stone-600">{current.plain}</p>

              {current.bullets?.length ? (
                <ul className="space-y-2">
                  {current.bullets.map((b) => (
                    <li
                      key={b}
                      className="rounded-xl bg-stone-50 px-3 py-2.5 text-sm leading-relaxed text-stone-700 ring-1 ring-stone-200/80"
                    >
                      {b}
                    </li>
                  ))}
                </ul>
              ) : null}

              {current.fields?.length ? (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#A6892A]">
                    Fields on this step
                  </p>
                  {current.fields.map((f) => (
                    <div
                      key={f.name}
                      className="rounded-xl border border-stone-200/90 bg-white px-3 py-2.5"
                    >
                      <p className="text-sm font-semibold text-stone-900">{f.name}</p>
                      <p className="mt-1 text-sm leading-relaxed text-stone-600">{f.how}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              {current.elsewhere?.length ? (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#A6892A]">
                    Create or check elsewhere first
                  </p>
                  {current.elsewhere.map((e) => (
                    <div
                      key={e.label}
                      className="rounded-xl border border-dashed border-[#D4AF37]/50 bg-[#D4AF37]/10 px-3 py-2.5"
                    >
                      <p className="text-sm font-semibold text-stone-900">{e.label}</p>
                      <p className="mt-1 text-sm leading-relaxed text-stone-700">{e.note}</p>
                      {e.href ? (
                        <Link
                          href={e.href}
                          className="mt-2 inline-flex text-sm font-semibold text-[#6b5a12] underline"
                          onClick={onClose}
                        >
                          Open {e.label.split("(")[0]?.trim()} →
                        </Link>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {current.tip ? (
                <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm leading-relaxed text-sky-950">
                  <span className="font-semibold">Tip: </span>
                  {current.tip}
                </p>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-stone-100 bg-stone-50/90 px-4 py-3">
          <button
            type="button"
            disabled={isFirst}
            className="rounded-xl px-3 py-2 text-sm font-medium text-stone-700 ring-1 ring-stone-200 disabled:opacity-35"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            Back
          </button>
          <div className="flex flex-wrap gap-2">
            {current.goTab && onGoToTab ? (
              <button
                type="button"
                className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-stone-800 ring-1 ring-stone-200"
                onClick={() => {
                  onGoToTab(current.goTab!);
                  onClose();
                }}
              >
                Show me this tab
              </button>
            ) : null}
            {isLast ? (
              <button
                type="button"
                className="rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-stone-900"
                onClick={onClose}
              >
                Got it — start setup
              </button>
            ) : (
              <button
                type="button"
                className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white"
                onClick={() => setStep((s) => Math.min(s + 1, STEPS.length - 1))}
              >
                Next
              </button>
            )}
          </div>
        </footer>
      </motion.div>
    </div>
  );
}
