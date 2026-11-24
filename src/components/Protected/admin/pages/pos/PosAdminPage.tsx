"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  listAdminVenueLocations,
  venueLocationKeys,
} from "@/services/venueLocations";
import { useHqLocationFilter } from "@/hooks/useHqLocationFilter";
import {
  getPosStationLocationId,
  setPosStation,
} from "./posStation";
import { emitPosEvent } from "./posEvents";
import {
  addPosMenuCategory,
  addPosMenuItem,
  createPosDevice,
  createPosDiscountCode,
  createPosMenu,
  createPosProduct,
  getPosSettings,
  listPosDevices,
  listPosDiscountCodes,
  listPosMenus,
  listPosProducts,
  recordPosWastage,
  savePosSettings,
  setPosManagerPin,
  suspendPosProduct,
  updatePosProduct,
  type PosDeviceDto,
  type PosProductDto,
  type PosSettingsDto,
} from "@/services/pos";
import PosPinModal from "./PosPinModal";
import PosSetupGuideModal from "./PosSetupGuideModal";
import ProductAccountingFields from "../accounting/shared/ProductAccountingFields";

type SetupTab = "station" | "catalog" | "menus" | "policies" | "tools";

const SETUP_TABS: Array<{ id: SetupTab; label: string; hint: string }> = [
  { id: "station", label: "Station", hint: "Park & devices" },
  { id: "catalog", label: "Catalog", hint: "What you sell" },
  { id: "menus", label: "Menus", hint: "Categories & layout" },
  { id: "policies", label: "Policies", hint: "Rules & PINs" },
  { id: "tools", label: "Tools", hint: "Discounts & wastage" },
];

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-2 py-2.5 transition hover:bg-stone-50">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-stone-800">{label}</span>
        {hint ? <span className="mt-0.5 block text-[11px] text-stone-500">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
          checked ? "bg-[#D4AF37]" : "bg-stone-300"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </label>
  );
}

function SectionCard({
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
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm shadow-stone-900/5"
    >
      <div className="border-b border-stone-100 bg-gradient-to-r from-stone-50 to-white px-4 py-3">
        <h2 className="text-sm font-semibold tracking-wide text-stone-900">{title}</h2>
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </motion.section>
  );
}

const field =
  "w-full rounded-xl bg-stone-50 px-3.5 py-2.5 text-sm text-stone-900 ring-1 ring-stone-200/90 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/55";
const primaryBtn =
  "rounded-xl bg-[#D4AF37] px-4 py-2.5 text-sm font-semibold text-stone-900 shadow-sm shadow-[#D4AF37]/25 transition hover:brightness-105 disabled:opacity-45";
const darkBtn =
  "rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:opacity-45";
const softBtn =
  "rounded-xl bg-white px-3 py-2 text-sm font-medium text-stone-800 ring-1 ring-stone-200 transition hover:ring-[#D4AF37]/60";

type Props = {
  /** When true, omit page chrome — used inside the terminal setup modal. */
  embedded?: boolean;
  /** Prefer the terminal’s active park when embedded. */
  initialLocationId?: string;
  /** Fired after settings/products/devices/menus change so the sell pad can refresh. */
  onDataChange?: () => void;
  /** Keep the terminal park in sync when Setup switches parks. */
  onLocationChange?: (locationId: string) => void;
};

export default function PosAdminPage({
  embedded = false,
  initialLocationId,
  onDataChange,
  onLocationChange,
}: Props) {
  const { scopedLocationId, parkLocked } = useHqLocationFilter();
  const [tab, setTab] = useState<SetupTab>("station");
  const [locationId, setLocationId] = useState(
    () => initialLocationId || getPosStationLocationId() || ""
  );
  const venuesQuery = useQuery({
    queryKey: venueLocationKeys.list("all"),
    queryFn: () => listAdminVenueLocations({ scope: "all" }),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const venues = (venuesQuery.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
  }));
  const venuesLoading = venuesQuery.isPending || venuesQuery.isLoading;
  const [settings, setSettings] = useState<PosSettingsDto | null>(null);
  const [devices, setDevices] = useState<PosDeviceDto[]>([]);
  const [products, setProducts] = useState<PosProductDto[]>([]);
  const [costProductId, setCostProductId] = useState<string | null>(null);
  const [codes, setCodes] = useState<unknown[]>([]);
  const [deviceName, setDeviceName] = useState("");
  const [productName, setProductName] = useState("");
  const [productPrice, setProductPrice] = useState("5");
  const [discountCode, setDiscountCode] = useState("");
  const [wastageProductId, setWastageProductId] = useState("");
  const [wastageQty, setWastageQty] = useState("1");
  const [wastageReason, setWastageReason] = useState("");
  const [tipPercents, setTipPercents] = useState("15,18,20");
  const [lateGrace, setLateGrace] = useState("0");
  const [menuName, setMenuName] = useState("");
  const [menus, setMenus] = useState<unknown[]>([]);
  const [menuId, setMenuId] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [menuItemProductId, setMenuItemProductId] = useState("");
  const [modifierProductId, setModifierProductId] = useState("");
  const [modifierGroupName, setModifierGroupName] = useState("");
  const [modifierOptionName, setModifierOptionName] = useState("");
  const [modifierDelta, setModifierDelta] = useState("0");
  const [newManagerPin, setNewManagerPin] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const deviceCodePreview = useMemo(() => {
    const slug = deviceName.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 24);
    return slug || "front-till";
  }, [deviceName]);

  function notifyChange() {
    emitPosEvent("pos:catalog", { locationId: locationId || null });
    onDataChange?.();
  }

  useEffect(() => {
    if (initialLocationId) setLocationId(initialLocationId);
  }, [initialLocationId]);

  useEffect(() => {
    if (scopedLocationId) setLocationId(scopedLocationId);
  }, [scopedLocationId]);

  useEffect(() => {
    if (venuesQuery.isError) {
      const err = venuesQuery.error;
      setError(err instanceof Error ? err.message : "Could not load parks");
      return;
    }
    if (!venues.length) return;
    setLocationId((prev) => {
      if (scopedLocationId && venues.some((v) => v.id === scopedLocationId)) {
        return scopedLocationId;
      }
      if (prev && venues.some((v) => v.id === prev)) return prev;
      const saved = getPosStationLocationId();
      if (saved && venues.some((v) => v.id === saved)) return saved;
      return initialLocationId || venues[0]?.id || "";
    });
  }, [
    venues,
    venuesQuery.isError,
    venuesQuery.error,
    scopedLocationId,
    initialLocationId,
  ]);

  const onLocationChangeRef = useRef(onLocationChange);
  onLocationChangeRef.current = onLocationChange;
  // Keep terminal park + station memory aligned when Setup resolves/switches park.
  useEffect(() => {
    if (!locationId) return;
    setPosStation({ locationId });
    onLocationChangeRef.current?.(locationId);
  }, [locationId]);

  function loadAll(loc: string) {
    Promise.all([
      getPosSettings(loc),
      listPosDevices(loc),
      listPosProducts(loc),
      listPosDiscountCodes(loc),
      listPosMenus(loc),
    ])
      .then(([s, d, p, c, m]) => {
        setSettings(s.settings);
        setTipPercents((s.settings.tipSuggestedPercents ?? [15, 18, 20]).join(","));
        setLateGrace(String(s.settings.lateRedemptionGraceMinutes ?? 0));
        setDevices(d.devices ?? []);
        setProducts(p.products ?? []);
        setCodes(c.codes ?? []);
        setMenus(m.menus ?? []);
      })
      .catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    if (locationId) loadAll(locationId);
  }, [locationId]);

  async function patchSettings(patch: Partial<PosSettingsDto>) {
    setError("");
    try {
      const saved = await savePosSettings(locationId, patch);
      setSettings(saved.settings);
      setMessage("Policy saved — sell pad will refresh.");
      notifyChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings");
    }
  }

  async function onCreateDevice() {
    if (!locationId) {
      setError("Select a park before registering a device.");
      return;
    }
    setError("");
    setBusy(true);
    const name = deviceName.trim() || "Front desk";
    const code =
      name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 24) ||
      `till-${Date.now().toString(36)}`;
    try {
      const created = await createPosDevice({ locationId, name, code });
      setDevices((rows) => [created.device, ...rows]);
      setDeviceName("");
      setMessage(`Device “${created.device.name}” is ready on this park.`);
      notifyChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Device create failed");
    } finally {
      setBusy(false);
    }
  }

  const activeDevices = devices.filter((d) => !d.archivedAt);
  const sellableProducts = products;

  return (
    <div
      className={
        embedded
          ? "mx-auto max-w-3xl space-y-4 px-0.5 py-0.5"
          : "relative mx-auto max-w-3xl space-y-5 overflow-hidden rounded-2xl border border-stone-200/90 bg-gradient-to-br from-stone-100 via-[#faf8f4] to-[#D4AF37]/12 px-4 py-8 shadow-[0_20px_50px_-28px_rgba(28,25,23,0.35)] sm:px-6"
      }
    >
      {!embedded ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="flex flex-wrap items-end justify-between gap-3"
        >
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#A6892A]">
              Sell
            </p>
            <h1 className="mt-1 font-serif text-3xl tracking-tight text-stone-900">
              POS <span className="text-[#A6892A]">setup</span>
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              className="rounded-full bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-stone-900 shadow-sm shadow-[#D4AF37]/25"
            >
              Guide
            </button>
            <Link
              href="/admin/pos"
              className="inline-flex rounded-full bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-800"
            >
              Open terminal
            </Link>
          </div>
        </motion.div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[12rem] flex-1 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
          Park
          <select
            className={`${field} mt-1.5`}
            value={locationId}
            disabled={parkLocked && venues.length <= 1}
            onChange={(event) => {
              const next = event.target.value;
              if (!next) return;
              if (parkLocked && scopedLocationId && next !== scopedLocationId) {
                return;
              }
              setError("");
              setMessage("");
              setLocationId(next);
              setPosStation({ locationId: next });
              onLocationChange?.(next);
            }}
          >
            {venuesLoading && !venues.length ? (
              <option value="">Loading parks…</option>
            ) : null}
            {!locationId && !venuesLoading ? (
              <option value="">Select park</option>
            ) : null}
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
          {embedded ? (
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              className="rounded-full bg-[#D4AF37] px-3.5 py-1.5 text-[11px] font-semibold text-stone-900 shadow-sm shadow-[#D4AF37]/25 transition hover:brightness-105"
            >
              Guide
            </button>
          ) : null}
          <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium tabular-nums text-stone-600 ring-1 ring-stone-200">
            {activeDevices.length} device{activeDevices.length === 1 ? "" : "s"}
          </span>
          <span className="rounded-full bg-[#D4AF37]/15 px-2.5 py-1 text-[11px] font-medium tabular-nums text-[#6b5a12] ring-1 ring-[#D4AF37]/35">
            {sellableProducts.length} product{sellableProducts.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {message ? (
          <motion.p
            key={`ok-${message}`}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
          >
            {message}
          </motion.p>
        ) : null}
        {error ? (
          <motion.p
            key={`err-${error}`}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <nav className="flex gap-1.5 overflow-x-auto pb-0.5">
        {SETUP_TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`group relative shrink-0 overflow-hidden rounded-2xl px-3.5 py-2 text-left transition ${
                active
                  ? "bg-stone-900 text-white shadow-md shadow-stone-900/20"
                  : "bg-white/90 text-stone-700 ring-1 ring-stone-200/90 hover:bg-white hover:ring-[#D4AF37]/50"
              }`}
            >
              {active ? (
                <motion.span
                  layoutId="pos-setup-nav-glow"
                  className="pointer-events-none absolute inset-x-2 top-0 h-px bg-gradient-to-r from-transparent via-[#D4AF37] to-transparent"
                />
              ) : null}
              <span className="block text-xs font-semibold tracking-wide">{t.label}</span>
              <span className={`mt-0.5 block text-[10px] ${active ? "text-stone-300" : "text-stone-400"}`}>
                {t.hint}
              </span>
            </button>
          );
        })}
      </nav>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22 }}
          className="space-y-4"
        >
          {tab === "station" ? (
            <>
              <SectionCard title="Devices">
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    onCreateDevice().catch(() => undefined);
                  }}
                >
                  <label className="block text-[11px] font-medium text-stone-500">
                    Device display name
                    <input
                      className={`${field} mt-1`}
                      placeholder="Front desk"
                      value={deviceName}
                      onChange={(e) => setDeviceName(e.target.value)}
                    />
                  </label>
                  <p className="text-[11px] text-stone-500">
                    Internal code:{" "}
                    <span className="font-mono font-medium text-stone-700">{deviceCodePreview}</span>
                  </p>
                  <button type="submit" disabled={busy || !locationId} className={primaryBtn}>
                    {busy ? "Saving…" : "Save device"}
                  </button>
                </form>
                {activeDevices.length ? (
                  <ul className="divide-y divide-stone-100 rounded-xl bg-stone-50/80 ring-1 ring-stone-200/70">
                    {activeDevices.map((device, i) => (
                      <motion.li
                        key={device.id}
                        initial={{ opacity: 0, x: 6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: Math.min(i * 0.04, 0.2) }}
                        className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm"
                      >
                        <span className="font-medium text-stone-800">{device.name}</span>
                        <span className="font-mono text-[11px] text-stone-500">{device.code}</span>
                      </motion.li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-xl border border-dashed border-stone-300 bg-stone-50/50 px-3 py-6 text-center text-xs text-stone-500">
                    No devices yet.{" "}
                    <button
                      type="button"
                      className="font-semibold text-[#8a7320] underline"
                      onClick={() => setGuideOpen(true)}
                    >
                      Open guide
                    </button>
                  </p>
                )}
              </SectionCard>
            </>
          ) : null}

          {tab === "catalog" ? (
            <SectionCard title="Products">
              <form
                className="grid gap-2 sm:grid-cols-[1fr_6.5rem_auto]"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!locationId) {
                    setError("Select a park first.");
                    return;
                  }
                  setError("");
                  const price = Math.max(0, parseFloat(productPrice) || 0);
                  createPosProduct({
                    locationId,
                    name: productName.trim() || "Item",
                    kind: "merchandise",
                    price,
                  })
                    .then((r) => {
                      setProducts((rows) => [r.product, ...rows]);
                      setProductName("");
                      setMessage(`“${r.product.name}” is on the catalog.`);
                      notifyChange();
                    })
                    .catch((err: Error) => setError(err.message));
                }}
              >
                <input
                  className={field}
                  placeholder="Product name"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                />
                <input
                  className={field}
                  placeholder="Price"
                  inputMode="decimal"
                  value={productPrice}
                  onChange={(e) => setProductPrice(e.target.value)}
                />
                <button type="submit" className={darkBtn}>
                  Add
                </button>
              </form>
              {sellableProducts.length ? (
                <ul className="max-h-72 space-y-0 overflow-y-auto divide-y divide-stone-100 rounded-xl ring-1 ring-stone-200/70">
                  {sellableProducts.map((p, i) => (
                    <motion.li
                      key={p.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.03, 0.24) }}
                      className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-stone-800">
                          {p.name}
                          {p.suspendSales ? (
                            <span className="ml-1.5 text-[10px] font-semibold uppercase text-amber-700">
                              suspended
                            </span>
                          ) : null}
                        </span>
                        <span className="text-[11px] tabular-nums text-stone-500">
                          ${Number(p.price).toFixed(2)} · {p.kind.replace(/_/g, " ")}
                        </span>
                      </span>
                      {costProductId === p.id ? (
                        <div className="w-full basis-full">
                          <ProductAccountingFields
                            mode="pos"
                            productId={p.id}
                            locationId={locationId}
                            avgCost={p.avgCost}
                            lastCost={p.lastCost}
                            inventoryAccountId={p.inventoryAccountId}
                            cogsAccountId={p.cogsAccountId}
                            revenueAccountId={p.revenueAccountId}
                            onSaved={() => {
                              void listPosProducts(loc).then((r) => setProducts(r.products));
                            }}
                          />
                        </div>
                      ) : null}
                      <button
                        type="button"
                        className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50"
                        onClick={() =>
                          setCostProductId((cur) => (cur === p.id ? null : p.id))
                        }
                      >
                        Costs
                      </button>
                      <button
                        type="button"
                        className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50"
                        onClick={() =>
                          suspendPosProduct(p.id, !p.suspendSales)
                            .then((r) => {
                              setProducts((rows) =>
                                rows.map((x) => (x.id === p.id ? r.product : x))
                              );
                              notifyChange();
                            })
                            .catch((err: Error) => setError(err.message))
                        }
                      >
                        {p.suspendSales ? "Unsuspend" : "Suspend"}
                      </button>
                    </motion.li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl border border-dashed border-stone-300 bg-stone-50/50 px-3 py-8 text-center text-xs text-stone-500">
                  No products yet.{" "}
                  <button
                    type="button"
                    className="font-semibold text-[#8a7320] underline"
                    onClick={() => setGuideOpen(true)}
                  >
                    Open guide
                  </button>
                </p>
              )}
            </SectionCard>
          ) : null}

          {tab === "menus" ? (
            <>
              <SectionCard title="Menus">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    className={`${field} flex-1`}
                    placeholder="Menu name"
                    value={menuName}
                    onChange={(e) => setMenuName(e.target.value)}
                  />
                  <button
                    type="button"
                    className={primaryBtn}
                    onClick={() => {
                      if (!locationId) {
                        setError("Select a park first.");
                        return;
                      }
                      createPosMenu({ locationId, name: menuName.trim() || "Main menu" })
                        .then(() => {
                          setMenuName("");
                          loadAll(locationId);
                          setMessage("Menu created.");
                          notifyChange();
                        })
                        .catch((err: Error) => setError(err.message));
                    }}
                  >
                    Create menu
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {menus.map((m, i) => {
                    const row = m as { id?: string; name?: string };
                    const selected = menuId === row.id;
                    return (
                      <button
                        key={row.id ?? i}
                        type="button"
                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                          selected
                            ? "bg-stone-900 text-white"
                            : "bg-stone-50 text-stone-700 ring-1 ring-stone-200 hover:ring-[#D4AF37]/60"
                        }`}
                        onClick={() => setMenuId(row.id ?? "")}
                      >
                        {row.name ?? row.id}
                      </button>
                    );
                  })}
                  {!menus.length ? (
                    <p className="text-xs text-stone-500">No menus yet.</p>
                  ) : null}
                </div>
                {menuId ? (
                  <div className="space-y-2 rounded-xl bg-stone-50/80 p-3 ring-1 ring-stone-200/70">
                    <p className="text-[11px] text-stone-500">
                      Editing menu <span className="font-mono text-stone-700">{menuId.slice(0, 10)}…</span>
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        className={`${field} flex-1`}
                        placeholder="Category name"
                        value={categoryName}
                        onChange={(e) => setCategoryName(e.target.value)}
                      />
                      <button
                        type="button"
                        className={softBtn}
                        onClick={() =>
                          addPosMenuCategory(menuId, { name: categoryName.trim() || "Category" })
                            .then(() => {
                              setCategoryName("");
                              setMessage("Category added.");
                              notifyChange();
                            })
                            .catch((err: Error) => setError(err.message))
                        }
                      >
                        Add category
                      </button>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <select
                        className={`${field} flex-1`}
                        value={menuItemProductId}
                        onChange={(e) => setMenuItemProductId(e.target.value)}
                      >
                        <option value="">Select product for menu item</option>
                        {sellableProducts.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className={softBtn}
                        disabled={!menuItemProductId}
                        onClick={() => {
                          if (!menuItemProductId) {
                            setError("Choose a product to add to the menu.");
                            return;
                          }
                          addPosMenuItem(menuId, { productId: menuItemProductId })
                            .then(() => {
                              setMessage("Menu item added.");
                              notifyChange();
                            })
                            .catch((err: Error) => setError(err.message));
                        }}
                      >
                        Add to menu
                      </button>
                    </div>
                  </div>
                ) : null}
              </SectionCard>

              <SectionCard title="Modifiers" delay={0.05}>
                <select
                  className={field}
                  value={modifierProductId}
                  onChange={(e) => setModifierProductId(e.target.value)}
                >
                  <option value="">Select product</option>
                  {sellableProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <div className="grid gap-2 sm:grid-cols-3">
                  <input
                    className={field}
                    placeholder="Group (e.g. Size)"
                    value={modifierGroupName}
                    onChange={(e) => setModifierGroupName(e.target.value)}
                  />
                  <input
                    className={field}
                    placeholder="Option"
                    value={modifierOptionName}
                    onChange={(e) => setModifierOptionName(e.target.value)}
                  />
                  <input
                    className={field}
                    placeholder="Price delta"
                    value={modifierDelta}
                    onChange={(e) => setModifierDelta(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className={darkBtn}
                  disabled={!modifierProductId}
                  onClick={() => {
                    if (!modifierProductId) {
                      setError("Select a product for modifiers.");
                      return;
                    }
                    updatePosProduct(modifierProductId, {
                      modifiers: [
                        {
                          name: modifierGroupName.trim() || "Options",
                          minSelect: 0,
                          maxSelect: 1,
                          required: false,
                          modifiers: [
                            {
                              name: modifierOptionName.trim() || "Option",
                              priceDelta: parseFloat(modifierDelta) || 0,
                            },
                          ],
                        },
                      ],
                    })
                      .then(() => {
                        setMessage("Modifiers saved.");
                        loadAll(locationId);
                        notifyChange();
                      })
                      .catch((err: Error) => setError(err.message));
                  }}
                >
                  Save modifiers
                </button>
              </SectionCard>
            </>
          ) : null}

          {tab === "policies" ? (
            settings ? (
              <SectionCard title="Counter policies">
                <div className="divide-y divide-stone-100">
                  <Toggle label="Capture guest postcode" checked={settings.captureGuestPostcode} onChange={(v) => patchSettings({ captureGuestPostcode: v })} />
                  <Toggle label="Postcode required" checked={settings.postcodeRequired} onChange={(v) => patchSettings({ postcodeRequired: v })} />
                  <Toggle label="Require guest on sale" checked={settings.requireGuestOnSale} onChange={(v) => patchSettings({ requireGuestOnSale: v })} />
                  <Toggle label="Allow open price" checked={settings.allowOpenPrice} onChange={(v) => patchSettings({ allowOpenPrice: v })} />
                  <Toggle label="Allow parked carts" checked={settings.allowParkedCarts} onChange={(v) => patchSettings({ allowParkedCarts: v })} />
                  <Toggle label="Allow unpaid bookings" checked={settings.allowUnpaidBookings} onChange={(v) => patchSettings({ allowUnpaidBookings: v })} />
                  <Toggle label="Paid required for redeem" checked={settings.paidRequiredForRedeem} onChange={(v) => patchSettings({ paidRequiredForRedeem: v })} />
                  <Toggle label="Default receipt email" checked={settings.defaultReceiptEmail} onChange={(v) => patchSettings({ defaultReceiptEmail: v })} />
                  <Toggle label="Print tickets on sale" checked={settings.printTicketsOnSale} onChange={(v) => patchSettings({ printTicketsOnSale: v })} />
                  <Toggle label="Show expected till totals" checked={settings.showExpectedTillTotals} onChange={(v) => patchSettings({ showExpectedTillTotals: v })} />
                  <Toggle label="Tip prompt" checked={settings.tipPromptEnabled} onChange={(v) => patchSettings({ tipPromptEnabled: v })} />
                  <Toggle label="Manager PIN for discount" checked={settings.managerPinRequiredForDiscount} onChange={(v) => patchSettings({ managerPinRequiredForDiscount: v })} />
                  <Toggle label="Manager PIN for refund" checked={settings.managerPinRequiredForRefund} onChange={(v) => patchSettings({ managerPinRequiredForRefund: v })} />
                  <Toggle label="Manager PIN for void" checked={settings.managerPinRequiredForVoid} onChange={(v) => patchSettings({ managerPinRequiredForVoid: v })} />
                  <Toggle label="Manager PIN for wastage" checked={settings.managerPinRequiredForWastage} onChange={(v) => patchSettings({ managerPinRequiredForWastage: v })} />
                  <Toggle label="Offline enabled" checked={settings.offlineEnabled} onChange={(v) => patchSettings({ offlineEnabled: v })} />
                  <Toggle label="Cash requires open till" checked={settings.cashRequiresOpenTill} onChange={(v) => patchSettings({ cashRequiresOpenTill: v })} />
                  <Toggle label="Banned guest prompt" checked={settings.bannedGuestPrompt ?? true} onChange={(v) => patchSettings({ bannedGuestPrompt: v })} />
                  <Toggle label="Allow past-date redemption" checked={settings.allowPastDateRedemption ?? false} onChange={(v) => patchSettings({ allowPastDateRedemption: v })} />
                </div>
                <div className="grid gap-3 border-t border-stone-100 pt-3 sm:grid-cols-2">
                  <label className="block text-[11px] font-medium text-stone-500">
                    Tip percents
                    <input
                      className={`${field} mt-1`}
                      value={tipPercents}
                      onChange={(e) => setTipPercents(e.target.value)}
                      onBlur={() =>
                        patchSettings({
                          tipSuggestedPercents: tipPercents
                            .split(",")
                            .map((n) => parseInt(n.trim(), 10))
                            .filter((n) => !Number.isNaN(n)),
                        })
                      }
                    />
                  </label>
                  <label className="block text-[11px] font-medium text-stone-500">
                    Late redemption grace (minutes)
                    <input
                      className={`${field} mt-1`}
                      value={lateGrace}
                      onChange={(e) => setLateGrace(e.target.value)}
                      onBlur={() =>
                        patchSettings({
                          lateRedemptionGraceMinutes: Math.max(0, parseInt(lateGrace, 10) || 0),
                        })
                      }
                    />
                  </label>
                </div>
                <div className="space-y-2 rounded-xl bg-stone-50 p-3 ring-1 ring-stone-200/70">
                  <p className="text-sm font-medium text-stone-900">
                    Manager override PIN{" "}
                    <span className="text-xs font-normal text-stone-500">
                      {settings.hasManagerOverridePin ? "· set" : "· not set"}
                    </span>
                  </p>
                  <input
                    type="password"
                    inputMode="numeric"
                    className={field}
                    placeholder="New PIN (4+ digits)"
                    value={newManagerPin}
                    onChange={(e) => setNewManagerPin(e.target.value.replace(/\D/g, ""))}
                  />
                  <button
                    type="button"
                    className={darkBtn}
                    onClick={() =>
                      setPosManagerPin(newManagerPin, locationId)
                        .then(() => {
                          setNewManagerPin("");
                          setMessage("Venue override PIN saved.");
                          loadAll(locationId);
                          notifyChange();
                        })
                        .catch((err: Error) => setError(err.message))
                    }
                  >
                    Save venue override PIN
                  </button>
                </div>
              </SectionCard>
            ) : (
              <p className="rounded-2xl border border-dashed border-stone-300 px-4 py-10 text-center text-sm text-stone-500">
                Select a park to load policies.
              </p>
            )
          ) : null}

          {tab === "tools" ? (
            <>
              <SectionCard title="Discount codes">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    className={`${field} flex-1`}
                    placeholder="CODE"
                    value={discountCode}
                    onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
                  />
                  <button
                    type="button"
                    className={primaryBtn}
                    onClick={() => {
                      const code = discountCode.trim();
                      if (!code) {
                        setError("Enter a discount code before saving.");
                        return;
                      }
                      if (!locationId) {
                        setError("Select a park first.");
                        return;
                      }
                      setError("");
                      createPosDiscountCode({ locationId, code, percentOff: 10 })
                        .then(() => {
                          setDiscountCode("");
                          loadAll(locationId);
                          setMessage(`Discount “${code}” saved (10% off).`);
                          notifyChange();
                        })
                        .catch((err: Error) => setError(err.message));
                    }}
                  >
                    Add 10% code
                  </button>
                </div>
                <ul className="space-y-1 text-xs text-stone-600">
                  {codes.map((c, i) => {
                    const row = c as { code?: string; percentOff?: number | null };
                    return (
                      <li
                        key={i}
                        className="rounded-lg bg-stone-50 px-3 py-2 font-medium ring-1 ring-stone-200/70"
                      >
                        {row.code ?? JSON.stringify(c)}
                        {row.percentOff != null ? ` · ${row.percentOff}%` : ""}
                      </li>
                    );
                  })}
                  {!codes.length ? (
                    <li className="text-stone-400">No discount codes yet.</li>
                  ) : null}
                </ul>
              </SectionCard>

              <SectionCard title="Wastage" delay={0.05}>
                <select
                  className={field}
                  value={wastageProductId}
                  onChange={(e) => setWastageProductId(e.target.value)}
                >
                  <option value="">Select product</option>
                  {sellableProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    className={field}
                    placeholder="Qty"
                    value={wastageQty}
                    onChange={(e) => setWastageQty(e.target.value)}
                  />
                  <input
                    className={field}
                    placeholder="Reason"
                    value={wastageReason}
                    onChange={(e) => setWastageReason(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className={softBtn}
                  onClick={() => {
                    if (!wastageProductId) {
                      setError("Select a product for wastage.");
                      return;
                    }
                    if (settings?.managerPinRequiredForWastage) setPinOpen(true);
                    else
                      recordPosWastage({
                        locationId,
                        productId: wastageProductId,
                        qty: parseInt(wastageQty, 10) || 1,
                        reason: wastageReason.trim() || "Spoilage",
                      })
                        .then(() => {
                          setMessage("Wastage recorded.");
                          notifyChange();
                        })
                        .catch((err: Error) => setError(err.message));
                  }}
                >
                  Record wastage
                </button>
              </SectionCard>
            </>
          ) : null}
        </motion.div>
      </AnimatePresence>

      <PosPinModal
        open={pinOpen}
        locationId={locationId}
        onClose={() => setPinOpen(false)}
        onVerified={(pin) =>
          recordPosWastage({
            locationId,
            productId: wastageProductId,
            qty: parseInt(wastageQty, 10) || 1,
            reason: wastageReason.trim() || "Spoilage",
            managerPin: pin,
          })
            .then(() => {
              setMessage("Wastage recorded.");
              notifyChange();
            })
            .catch((err: Error) => setError(err.message))
        }
      />

      <PosSetupGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        onGoToTab={(next) => setTab(next)}
      />
    </div>
  );
}
