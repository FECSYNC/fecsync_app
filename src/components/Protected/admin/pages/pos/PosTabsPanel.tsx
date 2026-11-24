"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  addPosTabLine,
  getPosCardSecrets,
  getPosSettings,
  listPosTabs,
  openPosTab,
  preauthPosTab,
  settlePosTab,
  splitPosTab,
  type PosSettingsDto,
} from "@/services/pos";
import PosPayPad, { type PayPadTender } from "./PosPayPad";
import PosPinModal from "./PosPinModal";
import PosCardConfirmModal, { type CardClientSecret } from "./PosCardConfirmModal";
import PosTabsGuideModal from "./PosTabsGuideModal";
import { collectAndConfirmOnTerminal } from "./posTerminalCollect";
import { emitPosEvent, onPosEvent } from "./posEvents";

type TabLine = { id?: string; name: string; qty: number; unitPrice: number };
type TabRow = {
  id: string;
  status: string;
  tableLabel: string | null;
  lines?: TabLine[];
};

type Props = {
  locationId: string;
  deviceId: string;
  /** When provided, skips a settings round-trip (faster modal open). */
  settings?: PosSettingsDto | null;
  tillOpen?: boolean;
  parkName?: string;
  /** Stripe Terminal reader id (`tmr_…`) on the selected device. */
  terminalReaderId?: string;
  /** Fired after settle / open so Sales & station stay aligned. */
  onChanged?: () => void;
};

const field =
  "w-full rounded-xl bg-stone-50 px-3.5 py-2.5 text-sm text-stone-900 ring-1 ring-stone-200/90 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/55";
const primaryBtn =
  "rounded-xl bg-[#D4AF37] px-4 py-2.5 text-sm font-semibold text-stone-900 shadow-sm shadow-[#D4AF37]/25 transition hover:brightness-105 disabled:opacity-45";
const softBtn =
  "rounded-xl bg-white px-3.5 py-2.5 text-sm font-medium text-stone-800 ring-1 ring-stone-200 transition hover:ring-[#D4AF37]/60 disabled:opacity-45";

function Section({
  title,
  children,
  delay = 0,
}: {
  title: string;
  children: ReactNode;
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm shadow-stone-900/5"
    >
      <div className="border-b border-stone-100 bg-gradient-to-r from-stone-50 to-white px-4 py-2.5">
        <h2 className="text-sm font-semibold tracking-wide text-stone-900">{title}</h2>
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </motion.section>
  );
}

function lineSum(lines: TabLine[]) {
  return lines.reduce((s, l) => s + Number(l.unitPrice) * Math.max(1, Number(l.qty) || 1), 0);
}

function normalizeLines(raw: unknown): TabLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id ? String(r.id) : undefined,
      name: String(r.name ?? "Item"),
      qty: Math.max(1, Number(r.qty ?? 1) || 1),
      unitPrice: Number(r.unitPrice ?? 0) || 0,
    };
  });
}

/**
 * Guest tabs workspace for the terminal modal (and standalone tabs page).
 * Does not fetch venue list — parent supplies park + device.
 */
export default function PosTabsPanel({
  locationId,
  deviceId,
  settings: settingsProp,
  tillOpen = false,
  parkName,
  terminalReaderId = "",
  onChanged,
}: Props) {
  const [settings, setSettings] = useState<PosSettingsDto | null>(settingsProp ?? null);
  const [openTabs, setOpenTabs] = useState<TabRow[]>([]);
  const [tabId, setTabId] = useState("");
  const [tableLabel, setTableLabel] = useState("");
  const [lines, setLines] = useState<TabLine[]>([]);
  const [lineName, setLineName] = useState("");
  const [linePrice, setLinePrice] = useState("10");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [tip, setTip] = useState(0);
  const [busy, setBusy] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [payFn, setPayFn] = useState<(() => void) | null>(null);
  const [cardConfirm, setCardConfirm] = useState<{
    saleId: string;
    publicId: string;
    secrets: CardClientSecret[];
  } | null>(null);

  const stripeConfigured = useMemo(
    () => typeof process !== "undefined" && Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY),
    []
  );
  const terminalConfigured = Boolean(
    stripeConfigured && terminalReaderId.trim().startsWith("tmr_")
  );

  const tabTotal = useMemo(() => lineSum(lines), [lines]);

  const refreshTabs = useCallback(async () => {
    if (!locationId) return;
    try {
      const res = await listPosTabs(locationId);
      const rows = (res.tabs ?? []).map((t) => ({
        id: t.id,
        status: t.status,
        tableLabel: t.tableLabel,
        lines: normalizeLines(t.lines),
      }));
      setOpenTabs(rows);
      setTabId((current) => {
        if (!current) return current;
        const match = rows.find((r) => r.id === current);
        if (match) setLines(match.lines ?? []);
        return current;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load tabs");
    }
  }, [locationId]);

  useEffect(() => {
    if (settingsProp) {
      setSettings(settingsProp);
      return;
    }
    if (!locationId) return;
    getPosSettings(locationId)
      .then((r) => setSettings(r.settings))
      .catch((e: Error) => setError(e.message));
  }, [locationId, settingsProp]);

  useEffect(() => {
    void refreshTabs();
  }, [refreshTabs]);

  useEffect(() => {
    const onFocus = () => {
      void refreshTabs();
    };
    window.addEventListener("focus", onFocus);
    const unsub = onPosEvent(["pos:tab", "pos:sale", "pos:station"], (detail) => {
      if (detail.locationId && detail.locationId !== locationId) return;
      void refreshTabs();
    });
    return () => {
      window.removeEventListener("focus", onFocus);
      unsub();
    };
  }, [refreshTabs, locationId]);

  function selectTab(row: TabRow) {
    setTabId(row.id);
    setTableLabel(row.tableLabel ?? "");
    setLines(row.lines ?? []);
    setTip(0);
    setError("");
    setNote(`Resumed ${row.tableLabel || "tab"} · ${row.status}`);
  }

  function clearTabUi(message: string) {
    setLines([]);
    setTabId("");
    setLineName("");
    setLinePrice("10");
    setTip(0);
    setNote(message);
    void refreshTabs();
    emitPosEvent("pos:tab", { locationId, deviceId });
    emitPosEvent("pos:sale", { locationId, deviceId });
    onChanged?.();
  }

  async function openTab() {
    setError("");
    if (!locationId) {
      setError("Select a park on the terminal first.");
      return;
    }
    if (!deviceId) {
      setError("Select a POS device on the terminal first — or register one in Setup.");
      return;
    }
    setBusy(true);
    try {
      const { tab } = await openPosTab({
        locationId,
        deviceId,
        tableLabel: tableLabel.trim() || "Table",
      });
      setTabId(tab.id);
      setLines([]);
      setNote(`Opened ${tableLabel.trim() || "Table"}`);
      await refreshTabs();
      emitPosEvent("pos:tab", { locationId, deviceId });
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open tab");
    } finally {
      setBusy(false);
    }
  }

  async function addLine() {
    if (!tabId) return;
    setError("");
    const name = lineName.trim() || "Item";
    const unitPrice = parseFloat(linePrice) || 0;
    setBusy(true);
    try {
      const { line } = await addPosTabLine(tabId, {
        locationId,
        name,
        unitPrice,
        qty: 1,
      });
      const added = normalizeLines([line])[0] ?? { name, qty: 1, unitPrice };
      setLines((prev) => [...prev, added]);
      setLineName("");
      await refreshTabs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add line");
    } finally {
      setBusy(false);
    }
  }

  async function settle(tenders: PayPadTender[]) {
    setError("");
    setBusy(true);
    try {
      const result = await settlePosTab(tabId, {
        locationId,
        deviceId,
        tipAmount: tip,
        tenders: tenders.map((t) => ({
          tender: t.tender,
          amount: t.amount,
          code: t.giftCode || t.cashlessCode,
          guestProfileId: t.guestProfileId,
          simulate: t.simulate,
        })),
        idempotencyKey: `tab:${tabId}`,
      });
      if (!result.sale) return;
      const secrets = result.sale.cardClientSecrets ?? [];
      if (secrets.length) {
        const first = secrets[0]!;
        if (terminalConfigured && terminalReaderId.trim()) {
          const collected = await collectAndConfirmOnTerminal({
            saleId: result.sale.id,
            publicId: result.sale.publicId,
            clientSecret: first.clientSecret,
            paymentIntentId: first.paymentIntentId,
            readerId: terminalReaderId.trim(),
          });
          if (collected.ok) {
            clearTabUi(collected.message);
            return;
          }
          setNote(`${collected.reason} — opening in-browser card confirm.`);
        }
        let secretsForElements = secrets;
        try {
          const refreshed = await getPosCardSecrets(result.sale.id);
          if (refreshed.cardClientSecrets.length) {
            secretsForElements = refreshed.cardClientSecrets;
          }
        } catch {
          /* keep checkout secrets */
        }
        setCardConfirm({
          saleId: result.sale.id,
          publicId: result.sale.publicId,
          secrets: secretsForElements,
        });
        setNote(
          `Sale ${result.sale.publicId} awaiting card confirm — tab stays authorized until paid.`
        );
        await refreshTabs();
        onChanged?.();
        return;
      }
      clearTabUi(
        result.sale.status === "completed"
          ? `Settled ${result.sale.publicId}`
          : `Sale ${result.sale.publicId} recorded (${result.sale.status})`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Settle failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {parkName ? (
            <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-600 ring-1 ring-stone-200">
              {parkName}
            </span>
          ) : null}
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${
              tillOpen
                ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                : "bg-stone-100 text-stone-500 ring-stone-200"
            }`}
          >
            Till {tillOpen ? "open" : "closed"}
          </span>
          <span className="rounded-full bg-[#D4AF37]/15 px-2.5 py-1 text-[11px] font-medium tabular-nums text-[#6b5a12] ring-1 ring-[#D4AF37]/35">
            {openTabs.length} open
          </span>
        </div>
        <button
          type="button"
          onClick={() => setGuideOpen(true)}
          className="rounded-full bg-[#D4AF37] px-3.5 py-1.5 text-[11px] font-semibold text-stone-900 shadow-sm shadow-[#D4AF37]/25"
        >
          Guide
        </button>
      </div>

      <AnimatePresence mode="wait">
        {!stripeConfigured ? (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900"
          >
            Stripe is not configured — card preauth and card settle need keys.
          </motion.p>
        ) : null}
        {error ? (
          <motion.p
            key={error}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-red-800"
          >
            {error}
          </motion.p>
        ) : null}
        {note ? (
          <motion.p
            key={note}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900"
          >
            {note}
          </motion.p>
        ) : null}
      </AnimatePresence>

      {!deviceId ? (
        <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/80 px-4 py-6 text-center">
          <p className="font-serif text-lg text-stone-900">Device required</p>
          <p className="mt-1 text-xs text-stone-600">
            Register a POS device in Setup, then pick it in the terminal header.
          </p>
          <button
            type="button"
            className="mt-3 text-xs font-semibold text-[#8a7320] underline"
            onClick={() => setGuideOpen(true)}
          >
            Open guide
          </button>
        </div>
      ) : null}

      <Section title="Open a tab">
        <label className="block text-[11px] font-medium text-stone-500">
          Table label
          <input
            className={`${field} mt-1`}
            placeholder="Table 4"
            value={tableLabel}
            onChange={(e) => setTableLabel(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={busy || !deviceId}
          className={primaryBtn}
          onClick={() => openTab().catch(() => undefined)}
        >
          {busy ? "Working…" : "Open tab"}
        </button>
      </Section>

      <Section title="Open tabs" delay={0.04}>
        {openTabs.length ? (
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {openTabs.map((t, i) => {
              const active = t.id === tabId;
              const total = lineSum(t.lines ?? []);
              return (
                <motion.li
                  key={t.id}
                  initial={{ opacity: 0, x: 6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.2) }}
                >
                  <button
                    type="button"
                    onClick={() => selectTab(t)}
                    className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left transition ${
                      active
                        ? "bg-stone-900 text-white shadow-md"
                        : "bg-stone-50 text-stone-800 ring-1 ring-stone-200 hover:ring-[#D4AF37]/60"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        {t.tableLabel || "Untitled"}
                      </span>
                      <span
                        className={`text-[10px] uppercase tracking-wide ${
                          active ? "text-stone-300" : "text-stone-500"
                        }`}
                      >
                        {t.status} · {(t.lines ?? []).length} line
                        {(t.lines ?? []).length === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-medium tabular-nums">
                      ${total.toFixed(2)}
                    </span>
                  </button>
                </motion.li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-stone-300 bg-stone-50/50 px-3 py-6 text-center text-xs text-stone-500">
            No open tabs on this park yet.
          </p>
        )}
      </Section>

      <AnimatePresence>
        {tabId ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-3"
          >
            <Section title="Lines on this tab" delay={0.06}>
              <div className="grid gap-2 sm:grid-cols-[1fr_5.5rem_auto]">
                <input
                  className={field}
                  placeholder="Line name"
                  value={lineName}
                  onChange={(e) => setLineName(e.target.value)}
                />
                <input
                  className={field}
                  placeholder="Price"
                  inputMode="decimal"
                  value={linePrice}
                  onChange={(e) => setLinePrice(e.target.value)}
                />
                <button
                  type="button"
                  className={softBtn}
                  disabled={busy}
                  onClick={() => addLine().catch(() => undefined)}
                >
                  Add
                </button>
              </div>
              {lines.length ? (
                <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl ring-1 ring-stone-200/70">
                  {lines.map((l, i) => (
                    <li
                      key={l.id ?? `${l.name}-${i}`}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 truncate text-stone-800">
                        <span className="font-medium tabular-nums text-stone-500">{l.qty}×</span>{" "}
                        {l.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-stone-700">
                        ${(Number(l.unitPrice) * l.qty).toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-stone-400">Add at least one line before settle.</p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 pt-2">
                <p className="text-sm font-semibold text-stone-900">
                  Total{" "}
                  <span className="tabular-nums text-[#A6892A]">${tabTotal.toFixed(2)}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="text-xs font-medium text-stone-600 underline"
                    onClick={() =>
                      splitPosTab(tabId, { locationId })
                        .then((r) => {
                          const childId = (r.child as { id?: string } | null)?.id;
                          setNote(
                            `Split child created${childId ? ` · ${childId.slice(0, 10)}…` : ""}`
                          );
                          void refreshTabs();
                        })
                        .catch((e: Error) => setError(e.message))
                    }
                  >
                    Split (beta)
                  </button>
                  <button
                    type="button"
                    className="text-xs font-medium text-stone-600 underline"
                    onClick={() =>
                      preauthPosTab(tabId, {
                        locationId,
                        amount: Math.max(tabTotal, 1),
                      })
                        .then(() => {
                          setNote("Card preauth held — tip must be a separate tender at settle.");
                          void refreshTabs();
                        })
                        .catch((e: Error) => setError(e.message))
                    }
                  >
                    Card preauth (beta)
                  </button>
                </div>
              </div>
            </Section>

            <Section title="Settle" delay={0.08}>
              {tip > 0 ? (
                <p className="text-xs text-amber-800">
                  With preauth, tip must be cash / gift / wallet — not added to the captured card.
                </p>
              ) : null}
              <PosPayPad
                totalDue={tabTotal}
                tipAmount={tip}
                tipPercents={settings?.tipSuggestedPercents ?? [15, 18, 20]}
                tipEnabled={settings?.tipPromptEnabled ?? true}
                cashRequiresOpenTill={settings?.cashRequiresOpenTill ?? true}
                tillOpen={tillOpen}
                stripeConfigured={stripeConfigured}
                terminalConfigured={terminalConfigured}
                busy={busy || tabTotal <= 0}
                onTipChange={setTip}
                onPay={(tenders) => settle(tenders)}
                onRequestManagerPin={(then) => {
                  setPayFn(() => then);
                  setPinOpen(true);
                }}
              />
            </Section>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <PosPinModal
        open={pinOpen}
        locationId={locationId}
        onClose={() => setPinOpen(false)}
        onVerified={() => {
          payFn?.();
          setPayFn(null);
        }}
      />
      <PosCardConfirmModal
        open={Boolean(cardConfirm)}
        saleId={cardConfirm?.saleId ?? ""}
        publicId={cardConfirm?.publicId ?? ""}
        secrets={cardConfirm?.secrets ?? []}
        onClose={() => {
          setCardConfirm(null);
          setNote(
            "Card not confirmed — tab stays authorized. Resume from Sales → Confirm card."
          );
          void refreshTabs();
        }}
        onSettled={(message) => {
          setCardConfirm(null);
          clearTabUi(message);
        }}
      />
      <PosTabsGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
