"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { listAdminVenueLocations } from "@/services/venueLocations";
import {
  HQ_LOCATION_CONTEXT_SYNC_KEY,
  parseHqLocationContextSync,
} from "@/utils/hqLocationContextSync";
import { parkContextKeys } from "@/services/parkContext";
import { hqKeys } from "@/services/hq";
import PosParkGate from "./PosParkGate";
import { emitPosEvent, onPosEvent } from "./posEvents";
import {
  addPosCartLine,
  checkoutPosCart,
  getPosAvailability,
  getPosCardSecrets,
  getPosCart,
  getPosCatalog,
  getPosSettings,
  listParkedPosCarts,
  listPosDevices,
  listPosTills,
  openPosCart,
  parkPosCart,
  previewPosDiscount,
  removePosCartLine,
  type PosCartDto,
  type PosProductDto,
  type PosSettingsDto,
  type PosTenderInput,
} from "@/services/pos";
import {
  getCachedPosVenues,
  getPosStation,
  getPosStationLocationId,
  setCachedPosVenues,
  setPosStation,
} from "./posStation";
import PosOfflineBanner from "./PosOfflineBanner";
import PosPayPad, { type PayPadTender } from "./PosPayPad";
import PosPinModal from "./PosPinModal";
import PosCardConfirmModal, { type CardClientSecret } from "./PosCardConfirmModal";
import PosCheckInPanel from "./PosCheckInPanel";
import PosCapacityPanel from "./PosCapacityPanel";
import PosTabsPanel from "./PosTabsPanel";
import PosGuestPanel from "./PosGuestPanel";
import PosTillsPanel from "./PosTillsPanel";
import PosSalesPanel from "./PosSalesPanel";
import PosAdminPage from "./PosAdminPage";
import PosSellGuideModal from "./PosSellGuideModal";
import AdminPendingLink from "@/components/Protected/admin/components/AdminPendingLink";
import { useAdminRouteTransition } from "@/lib/adminInstantNav";
import { enqueueOfflineSale, OFFLINE_ALLOWED_KINDS } from "./PosOfflineQueue";
import { settlePosCardFromStripeReturn } from "./posCardReturn";
import { collectAndConfirmOnTerminal } from "./posTerminalCollect";
import { useAuthStore } from "@/store/authStore";
import { useHqLocationFilter } from "@/hooks/useHqLocationFilter";
import { useQuery } from "@tanstack/react-query";
import { venueLocationKeys } from "@/services/venueLocations";
import {
  listParkMarketplaceAccounts,
  marketplaceKeys,
} from "@/services/marketplace";
import { isStorefrontOrgSession } from "@/services/auth";
import { P } from "@/lib/auth/permissions";

function StationSetupNavLink({
  href,
  idleLabel,
  onNavigate,
  onOpenSetupModal,
}: {
  href: string;
  idleLabel: string;
  onNavigate?: () => void;
  /** When set for Setup, open the terminal setup modal instead of hard-navigating. */
  onOpenSetupModal?: () => void;
}) {
  const transition = useAdminRouteTransition();
  const [localOpening, setLocalOpening] = useState(false);
  const pendingNav =
    Boolean(transition.href) &&
    (transition.href === href || Boolean(transition.href?.startsWith(`${href}?`)));
  const pending = localOpening || pendingNav;

  if (onOpenSetupModal) {
    return (
      <button
        type="button"
        disabled={pending}
        className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-[#8a7320] underline disabled:opacity-70"
        onClick={() => {
          setLocalOpening(true);
          onNavigate?.();
          // Brief loader so the click feels acknowledged before the modal paints.
          window.setTimeout(() => {
            onOpenSetupModal();
            setLocalOpening(false);
          }, 180);
        }}
      >
        {pending ? (
          <>
            <span
              className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-stone-300 border-t-[#D4AF37]"
              aria-hidden
            />
            Opening…
          </>
        ) : (
          `${idleLabel} →`
        )}
      </button>
    );
  }

  return (
    <AdminPendingLink
      href={href}
      onNavigate={onNavigate}
      className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-[#8a7320] underline"
      pendingLabel="Opening…"
    >
      {pending ? "Opening…" : `${idleLabel} →`}
    </AdminPendingLink>
  );
}

/** Matches admin sidebar POS leaves — each opens a modal except Terminal (Sell). */
type NavTab =
  | "SELL"
  | "CHECK_IN"
  | "CAPACITY"
  | "TABS"
  | "TILLS"
  | "SALES"
  | "SETUP"
  | "GUEST";
/** Setup uses `setupOpen`, not modalSection. */
type ModalSection = Exclude<NavTab, "SELL" | "SETUP">;

const NAV_META: Record<NavTab, { label: string; hint: string }> = {
  SELL: { label: "Terminal", hint: "Catalog & checkout" },
  CHECK_IN: { label: "Check-in", hint: "Tickets & memberships" },
  CAPACITY: { label: "Capacity", hint: "Sessions & seats" },
  TABS: { label: "Tabs", hint: "Open guest tabs" },
  TILLS: { label: "Tills", hint: "Cash drawer" },
  SALES: { label: "Sales", hint: "Sale history" },
  SETUP: { label: "Setup", hint: "Devices & catalog" },
  GUEST: { label: "Guest", hint: "Attach a guest" },
};

function lineTotal(cart: PosCartDto | null) {
  if (!cart?.lines?.length) return 0;
  return cart.lines.reduce((s, l) => s + Number(l.unitPrice) * l.qty, 0);
}

function kindLabel(kind: string) {
  return kind.replace(/_/g, " ");
}

function kindTone(kind: string) {
  switch (kind) {
    case "food":
    case "beverage":
      return "bg-amber-50 text-amber-900 ring-amber-200/80";
    case "admission":
    case "session":
      return "bg-sky-50 text-sky-900 ring-sky-200/80";
    case "gift_card":
    case "membership":
      return "bg-[#D4AF37]/15 text-[#6b5a12] ring-[#D4AF37]/35";
    default:
      return "bg-stone-100 text-stone-700 ring-stone-200";
  }
}

export default function PosHomePage() {
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const orgId = useAuthStore((s) => s.user?.orgId ?? null);
  const queryClient = useQueryClient();
  const { scopedLocationId, parkLocked } = useHqLocationFilter();
  const [modalSection, setModalSection] = useState<ModalSection | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  /** Sticky nav highlight — closing a tool modal must not bounce to Terminal. */
  const [activeNav, setActiveNav] = useState<NavTab>("SELL");
  const [sellGuideOpen, setSellGuideOpen] = useState(false);
  const [venues, setVenues] = useState<Array<{ id: string; name: string }>>([]);
  const [devices, setDevices] = useState<
    Array<{ id: string; name: string; stripeTerminalId?: string | null }>
  >([]);
  const [locationId, setLocationId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const scopedVenuesQuery = useQuery({
    queryKey: venueLocationKeys.list("all"),
    queryFn: () => listAdminVenueLocations({ scope: "all" }),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const venuesLoading =
    scopedVenuesQuery.isPending || scopedVenuesQuery.isLoading;
  const canSeeParkPayoutBanner =
    can(P.PayoutsManage) ||
    (user?.parkLocked === true && user?.franchiseParkManager === true);
  const parkAccountsQuery = useQuery({
    queryKey: marketplaceKeys.parkAccounts(),
    queryFn: listParkMarketplaceAccounts,
    enabled: canSeeParkPayoutBanner && !isStorefrontOrgSession(user),
    staleTime: 60_000,
  });
  const [settings, setSettings] = useState<PosSettingsDto | null>(null);
  const [products, setProducts] = useState<PosProductDto[]>([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<PosCartDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState("");
  const [error, setError] = useState("");
  const [tip, setTip] = useState(0);
  const [discountCode, setDiscountCode] = useState("");
  const [guestId, setGuestId] = useState<string | null>(null);
  const [guestBanned, setGuestBanned] = useState(false);
  const [postal, setPostal] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [sessions, setSessions] = useState<
    Array<{ id: string; label: string | null; remaining: number; closed?: boolean; productId: string }>
  >([]);
  const [parkedId, setParkedId] = useState("");
  const [parkedCarts, setParkedCarts] = useState<Array<{ id: string; updatedAt?: string }>>([]);
  const [openPrice, setOpenPrice] = useState<{ product: PosProductDto; amount: string } | null>(null);
  const [modifierPick, setModifierPick] = useState<{ product: PosProductDto; selected: string[] } | null>(null);
  const [addonSuggestions, setAddonSuggestions] = useState<PosProductDto[]>([]);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinAction, setPinAction] = useState<((pin: string) => void) | null>(null);
  const [tillOpen, setTillOpen] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [cardConfirm, setCardConfirm] = useState<{
    saleId: string;
    publicId: string;
    secrets: CardClientSecret[];
  } | null>(null);

  const stripeConfigured = Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim());
  const selectedDevice = devices.find((d) => d.id === deviceId);
  const terminalReaderId = selectedDevice?.stripeTerminalId?.trim() || "";
  /** True when Stripe is configured and this device has a registered Terminal reader id. */
  const terminalConfigured = Boolean(stripeConfigured && terminalReaderId.startsWith("tmr_"));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q)
    );
  }, [products, search]);

  const subtotal = lineTotal(cart);
  const checkoutBlocked =
    (settings?.requireGuestOnSale && !guestId) ||
    (settings?.postcodeRequired && !postal.trim());

  const loadStation = useCallback(async (loc: string, dev: string, openNewCart = true, guestProfileId?: string | null) => {
    setError("");
    setLoading(true);
    try {
      // Critical path only — show sell pad as soon as settings + catalog + cart are ready.
      // Availability / parked / tills fill in afterward (they were blocking for many seconds).
      const [settingsRes, catalog, cartRes] = await Promise.all([
        getPosSettings(loc),
        dev ? getPosCatalog(loc, dev) : Promise.resolve(null),
        openNewCart && dev
          ? openPosCart({
              locationId: loc,
              deviceId: dev,
              guestProfileId: guestProfileId ?? undefined,
            })
          : Promise.resolve(null),
      ]);
      setSettings(settingsRes.settings);
      if (catalog) setProducts(catalog.products ?? []);
      if (cartRes) setCart(cartRes.cart);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load POS";
      if (/403|not enabled|demo|starter/i.test(msg)) setLocked(msg);
      else setError(msg);
    } finally {
      setLoading(false);
    }

    void getPosAvailability(loc)
      .then((availability) => {
        setSessions(
          (availability.sessions ?? []).map((s) => ({
            ...s,
            closed: Boolean(s.closed ?? s.isClosed),
          }))
        );
      })
      .catch(() => setSessions([]));
    void listParkedPosCarts(loc)
      .then((parked) => setParkedCarts((parked.carts ?? []).map((c) => ({ id: c.id }))))
      .catch(() => setParkedCarts([]));
    if (dev) {
      void listPosTills()
        .then((tills) =>
          setTillOpen((tills.tills ?? []).some((t) => t.deviceId === dev && t.status === "open"))
        )
        .catch(() => setTillOpen(false));
    }
  }, []);

  const applyParkSelection = useCallback(
    (loc: string) => {
      if (!loc) return;
      if (parkLocked && scopedLocationId && loc !== scopedLocationId) return;
      setError("");
      setLocationId(loc);
      setPosStation({ locationId: loc });
      emitPosEvent("pos:station", { locationId: loc });
      setLoading(true);
      listPosDevices(loc)
        .then((d) => {
          const active = d.devices.filter((x) => !x.archivedAt);
          setDevices(
            active.map((x) => ({
              id: x.id,
              name: x.name,
              stripeTerminalId: x.stripeTerminalId,
            }))
          );
          const dev = active[0]?.id ?? "";
          setDeviceId(dev);
          setPosStation({ deviceId: dev });
          if (dev) return loadStation(loc, dev);
          setCart(null);
          setError("");
          setLoading(false);
        })
        .catch((err: Error) => {
          setError(err.message);
          setLoading(false);
        });
    },
    [parkLocked, scopedLocationId, loadStation]
  );

  /** Keep session seats in sync after check-in / capacity actions. */
  const refreshAvailability = useCallback(async (loc?: string) => {
    const park = loc || locationId;
    if (!park) return;
    try {
      const availability = await getPosAvailability(park);
      setSessions(
        (availability.sessions ?? []).map((s) => ({
          ...s,
          closed: Boolean(s.closed ?? s.isClosed),
        }))
      );
    } catch {
      /* keep last known sessions */
    }
  }, [locationId]);

  /** Stable till badge sync — used by Tills/Tabs modals without re-fetch loops. */
  const syncTillOpen = useCallback((dev?: string) => {
    const device = dev || deviceId;
    if (!device) {
      setTillOpen(false);
      return;
    }
    listPosTills()
      .then((tills) =>
        setTillOpen(
          (tills.tills ?? []).some((t) => t.deviceId === device && t.status === "open")
        )
      )
      .catch(() => setTillOpen(false));
  }, [deviceId]);

  /** Soft refresh after setup mutations — no loading skeleton flash. */
  const refreshSellSurface = useCallback(async () => {
    const loc = locationId;
    if (!loc) return;
    try {
      const [settingsRes, devicesRes] = await Promise.all([
        getPosSettings(loc),
        listPosDevices(loc),
      ]);
      setSettings(settingsRes.settings);
      const active = (devicesRes.devices ?? []).filter((x) => !x.archivedAt);
      setDevices(
        active.map((x) => ({
          id: x.id,
          name: x.name,
          stripeTerminalId: x.stripeTerminalId,
        }))
      );

      const nextDev = deviceId || active[0]?.id || "";
      const newlyAssigned = Boolean(nextDev && !deviceId);
      if (newlyAssigned) {
        setDeviceId(nextDev);
        setPosStation({ deviceId: nextDev });
      }

      if (nextDev) {
        const catalog = await getPosCatalog(loc, nextDev);
        setProducts(catalog.products ?? []);
        if (newlyAssigned) {
          const cartRes = await openPosCart({ locationId: loc, deviceId: nextDev });
          setCart(cartRes.cart);
        }
      }
    } catch {
      /* keep existing sell pad state on soft-refresh failure */
    }
  }, [locationId, deviceId]);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSellRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshSellSurface();
    }, 280);
  }, [refreshSellSurface]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const closeSetupModal = useCallback(() => {
    setSetupOpen(false);
    // Keep Setup highlighted until the cashier picks Terminal (or another tool).
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    void refreshSellSurface();
  }, [refreshSellSurface]);

  const closeToolModal = useCallback(() => {
    const leaving = modalSection;
    setModalSection(null);
    // Do not reset activeNav — highlight stays on the tool that was open.
    if (leaving === "CHECK_IN" || leaving === "CAPACITY") {
      void refreshAvailability();
    }
    if (leaving === "TILLS" || leaving === "TABS") {
      syncTillOpen();
    }
  }, [modalSection, refreshAvailability, syncTillOpen]);

  const openStationTool = useCallback((tab: NavTab) => {
    if (tab === "SELL") {
      setActiveNav("SELL");
      setModalSection(null);
      setSetupOpen(false);
      return;
    }
    if (tab === "SETUP") {
      setActiveNav("SETUP");
      setModalSection(null);
      setSetupOpen(true);
      return;
    }
    setActiveNav(tab);
    setSetupOpen(false);
    setModalSection(tab);
  }, []);

  useEffect(() => {
    void settlePosCardFromStripeReturn().then((message) => {
      if (message) window.alert(message);
    });
  }, []);

  useEffect(() => {
    if (!modalSection && !setupOpen && !sellGuideOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (sellGuideOpen) {
        setSellGuideOpen(false);
        return;
      }
      if (setupOpen) closeSetupModal();
      else closeToolModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalSection, setupOpen, sellGuideOpen, closeSetupModal, closeToolModal]);

  useEffect(() => {
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    const onFocus = () => {
      // Avoid stomping Setup edits mid-form; other station modals refresh themselves.
      if (setupOpen) return;
      void refreshSellSurface();
      syncTillOpen();
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("focus", onFocus);
    };
  }, [setupOpen, refreshSellSurface, syncTillOpen]);

  useEffect(() => {
    const saved = getPosStation();
    const savedLocationId = getPosStationLocationId();
    const cachedVenues = getCachedPosVenues();
    if (cachedVenues.length) setVenues(cachedVenues);

    // Park alone unlocks Check-in / Capacity / Tabs — do not wait for a device.
    if (savedLocationId) setLocationId(savedLocationId);

    // Resume full sell station only when both park + device are remembered.
    if (saved?.locationId && saved?.deviceId) {
      setDeviceId(saved.deviceId);
      void loadStation(saved.locationId, saved.deviceId, true);
    } else if (!savedLocationId) {
      /* venues effect will pick list[0] once the query lands */
    } else {
      setLoading(false);
    }
    // Bootstrap once on mount — guest attach must not re-run station load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep venue dropdown + station aligned with park-scoped list + header preference.
  useEffect(() => {
    const rows = scopedVenuesQuery.data;
    if (!rows) return;
    const list = Array.isArray(rows) ? rows : [];
    const mapped = list.map((v) => ({ id: v.id, name: v.name }));
    setVenues(mapped);
    setCachedPosVenues(mapped);
    const saved = getPosStation();
    const savedLocationId = getPosStationLocationId();
    const loc =
      (scopedLocationId && list.some((v) => v.id === scopedLocationId)
        ? scopedLocationId
        : null) ||
      (locationId && list.some((v) => v.id === locationId) ? locationId : null) ||
      (savedLocationId && list.some((v) => v.id === savedLocationId)
        ? savedLocationId
        : null) ||
      list[0]?.id ||
      "";
    if (!loc) {
      if (!saved?.deviceId) setLoading(false);
      return;
    }
    const locationChanged = loc !== locationId;
    if (locationChanged) setLocationId(loc);
    void (async () => {
      try {
        const d = await listPosDevices(loc);
        const active = d.devices.filter((x) => !x.archivedAt);
        setDevices(
          active.map((x) => ({
            id: x.id,
            name: x.name,
            stripeTerminalId: x.stripeTerminalId,
          }))
        );
        const preferred =
          !locationChanged &&
          saved?.deviceId &&
          active.some((x) => x.id === saved.deviceId)
            ? saved.deviceId
            : active[0]?.id ?? "";
        setDeviceId(preferred);
        // Always stamp park; clear stale device when this park has none.
        setPosStation({ locationId: loc, deviceId: preferred || "" });
        if (locationChanged || !deviceId) {
          if (preferred) void loadStation(loc, preferred, true);
          else {
            // Park is valid; missing device is the yellow banner path — clear stale
            // errors from a prior failed station resume (e.g. empty locationId).
            setError("");
            setCart(null);
            setLoading(false);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load devices");
        if (!saved?.deviceId) setLoading(false);
      }
    })();
    // scopedLocationId / venue list drive park switches; avoid re-running on every device flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedVenuesQuery.data, scopedLocationId]);

  // Real-time park list + HQ / park-context preference — same tab and sister tabs.
  useEffect(() => {
    const bumpParkQueries = () => {
      void queryClient.invalidateQueries({ queryKey: venueLocationKeys.all });
      void queryClient.invalidateQueries({ queryKey: hqKeys.all });
      void queryClient.invalidateQueries({ queryKey: parkContextKeys.all });
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== HQ_LOCATION_CONTEXT_SYNC_KEY || !event.newValue) return;
      const payload = parseHqLocationContextSync(event.newValue);
      if (!payload || (orgId && payload.orgId !== orgId)) return;
      bumpParkQueries();
    };
    const onFocus = () => {
      if (modalSection || setupOpen) bumpParkQueries();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [queryClient, orgId, modalSection, setupOpen]);

  // Targeted sync — do not soft-refresh the whole catalog on every till/sale tick.
  useEffect(() => {
    const samePark = (detail: { locationId?: string | null }) =>
      !(detail.locationId && locationId && detail.locationId !== locationId);

    const unsubs = [
      onPosEvent(["pos:checkin", "pos:capacity", "pos:sale", "pos:tab"], (detail) => {
        if (!samePark(detail)) return;
        void refreshAvailability(locationId || detail.locationId || undefined);
      }),
      onPosEvent("pos:till", (detail) => {
        if (!samePark(detail)) return;
        syncTillOpen(detail.deviceId || deviceId || undefined);
      }),
      onPosEvent(["pos:catalog", "pos:station"], (detail) => {
        if (!samePark(detail)) return;
        scheduleSellRefresh();
        syncTillOpen(detail.deviceId || deviceId || undefined);
      }),
    ];
    return () => {
      for (const u of unsubs) u();
    };
  }, [
    locationId,
    deviceId,
    refreshAvailability,
    syncTillOpen,
    scheduleSellRefresh,
  ]);

  async function refreshCart(id: string) {
    const { cart: next } = await getPosCart(id);
    setCart(next);
  }

  async function addProduct(product: PosProductDto) {
    if (!cart || !online && !OFFLINE_ALLOWED_KINDS.has(product.kind)) {
      setError("Admissions and live catalog items need a connection.");
      return;
    }
    if (product.openPrice || product.kind === "open_price") {
      setOpenPrice({ product, amount: String(product.price || "") });
      return;
    }
    if (product.modifierGroups?.length) {
      setModifierPick({ product, selected: [] });
      return;
    }
    if (
      (product.kind === "booking" || product.admissionProductId) &&
      (!sessionId ||
        !sessions.some(
          (s) => s.id === sessionId && s.remaining > 0 && !(s.closed ?? false)
        ))
    ) {
      setError("Pick a session with remaining seats before adding an admission.");
      return;
    }
    await addPosCartLine(cart.id, {
      productId: product.id,
      qty: 1,
      sessionId: sessionId || undefined,
      admissionProductId: product.admissionProductId ?? undefined,
    });
    await refreshCart(cart.id);
    if (product.kind === "booking" || product.admissionProductId) {
      const links = products.filter(
        (p) =>
          p.id !== product.id &&
          (p.kind === "food" || p.kind === "merchandise" || p.kind === "beverage") &&
          !p.suspendSales
      );
      setAddonSuggestions(links.slice(0, 6));
    }
  }

  async function confirmOpenPrice() {
    if (!cart || !openPrice) return;
    await addPosCartLine(cart.id, {
      productId: openPrice.product.id,
      unitPrice: parseFloat(openPrice.amount) || 0,
      qty: 1,
    });
    setOpenPrice(null);
    await refreshCart(cart.id);
  }

  async function confirmModifiers() {
    if (!cart || !modifierPick) return;
    const product = modifierPick.product;
    if (
      (product.kind === "booking" || product.admissionProductId) &&
      (!sessionId ||
        !sessions.some(
          (s) => s.id === sessionId && s.remaining > 0 && !(s.closed ?? false)
        ))
    ) {
      setError("Pick a session with remaining seats before adding an admission.");
      return;
    }
    const group = product.modifierGroups ?? [];
    for (const g of group) {
      const hits = g.modifiers.filter((m) => modifierPick.selected.includes(m.id));
      if (hits.length < g.minSelect || (g.required && hits.length < 1)) {
        setError(`Choose options for ${g.name}`);
        return;
      }
      if (hits.length > g.maxSelect) {
        setError(`Too many options for ${g.name}`);
        return;
      }
    }
    await addPosCartLine(cart.id, {
      productId: product.id,
      qty: 1,
      modifiers: modifierPick.selected.map((id) => ({ modifierId: id })),
      sessionId: sessionId || undefined,
      admissionProductId: product.admissionProductId ?? undefined,
    });
    setModifierPick(null);
    await refreshCart(cart.id);
  }

  async function runCheckout(tenders: PayPadTender[], managerPin?: string) {
    if (!cart || !settings) return;
    setCheckoutBusy(true);
    setError("");
    try {
      if (discountCode) {
        await previewPosDiscount({
          locationId,
          cartId: cart.id,
          code: discountCode,
          managerPin,
        });
      }
      const apiTenders: PosTenderInput[] = tenders.map((t) => ({
        tender: t.tender,
        amount: t.amount,
        code: t.giftCode || t.cashlessCode,
        guestProfileId: t.guestProfileId,
        simulate: t.simulate,
      }));
      const wantsPaymentLink = tenders.some((t) => t.tender === "payment_link");
      const body = {
        tenders: apiTenders,
        tipAmount: tip,
        tipAllocations: tip > 0 ? [{ amount: tip }] : undefined,
        discountCode: discountCode || undefined,
        managerPin,
        postalCode: postal || undefined,
        guestProfileId: guestId ?? undefined,
        allowBannedGuest: guestBanned ? true : undefined,
        // Unpaid only when cashier chose payment_link (or explicit unpaid path).
        allowUnpaid: wantsPaymentLink ? true : false,
        idempotencyKey: `checkout:${cart.id}`,
      };
      if (!online && settings.offlineEnabled) {
        const nonCash = tenders.some((t) => t.tender !== "cash");
        if (nonCash) {
          setError("Offline sales only support cash. Reconnect for card, gift, wallet, or link.");
          return;
        }
        const offlineOk = (cart.lines ?? []).every((l) =>
          OFFLINE_ALLOWED_KINDS.has(String(l.kind))
        );
        if (!offlineOk) {
          setError("Admissions, memberships, and gift issue need a connection.");
          return;
        }
        const lines = (cart.lines ?? []).map((l) => ({
          productId: l.productId ?? undefined,
          kind: l.kind,
          name: l.name,
          qty: l.qty,
          unitPrice: Number(l.unitPrice),
        }));
        enqueueOfflineSale({
          clientMutationId: crypto.randomUUID(),
          locationId,
          deviceId,
          lines,
          total: subtotal + tip,
        });
        setError("Sale queued offline — sync when online.");
        return;
      }
      const result = await checkoutPosCart(cart.id, body);
      const sale = result.sale;
      const linkUrl = sale.paymentLinkUrl;
      const cardSecrets = sale.cardClientSecrets ?? [];
      emitPosEvent("pos:sale", { locationId, deviceId });
      emitPosEvent("pos:capacity", { locationId });
      setCart(null);
      const opened = await openPosCart({
        locationId,
        deviceId,
        guestProfileId: guestId ?? undefined,
      });
      setCart(opened.cart);
      setTip(0);
      if (cardSecrets.length) {
        const first = cardSecrets[0]!;
        if (terminalConfigured && terminalReaderId) {
          const collected = await collectAndConfirmOnTerminal({
            saleId: sale.id,
            publicId: sale.publicId,
            clientSecret: first.clientSecret,
            paymentIntentId: first.paymentIntentId,
            readerId: terminalReaderId,
          });
          if (collected.ok) {
            window.alert(collected.message);
            if (cardSecrets.length > 1) {
              // Remaining card tenders: convert Terminal PIs for Elements if needed.
              try {
                const secrets = await getPosCardSecrets(sale.id);
                if (secrets.cardClientSecrets.length) {
                  setCardConfirm({
                    saleId: secrets.saleId,
                    publicId: secrets.publicId,
                    secrets: secrets.cardClientSecrets,
                  });
                }
              } catch {
                /* first card settled; remaining can resume from Sales */
              }
            }
          } else {
            window.alert(`${collected.reason}\nOpening in-browser card confirm.`);
            try {
              const secrets = await getPosCardSecrets(sale.id);
              setCardConfirm({
                saleId: secrets.saleId,
                publicId: secrets.publicId,
                secrets: secrets.cardClientSecrets.length
                  ? secrets.cardClientSecrets
                  : cardSecrets,
              });
            } catch {
              setCardConfirm({
                saleId: sale.id,
                publicId: sale.publicId,
                secrets: cardSecrets,
              });
            }
          }
        } else {
          setCardConfirm({
            saleId: sale.id,
            publicId: sale.publicId,
            secrets: cardSecrets,
          });
        }
      } else if (linkUrl) {
        window.alert(`Payment link for ${sale.publicId}:\n${linkUrl}`);
        window.open(linkUrl, "_blank", "noopener,noreferrer");
      } else {
        window.alert(
          sale.status === "completed"
            ? `Sale complete: ${sale.publicId}`
            : `Sale ${sale.publicId} recorded (${sale.status}). Card/link tenders settle when paid.`
        );
      }
      // Cash tenders update expected till totals — keep header badge truthful.
      syncTillOpen();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed");
    } finally {
      setCheckoutBusy(false);
    }
  }

  function requestPin(then: (pin: string) => void) {
    setPinAction(() => then);
    setPinOpen(true);
  }

  const sections = useMemo(() => {
    const all: NavTab[] = [
      "SELL",
      "CHECK_IN",
      "CAPACITY",
      "TABS",
      "TILLS",
      "SALES",
      "SETUP",
      "GUEST",
    ];
    return all.filter((s) => {
      switch (s) {
        case "SELL":
          return can(P.PosSell);
        case "CHECK_IN":
          return can(P.PosCheckin);
        case "CAPACITY":
          return can(P.PosSell);
        case "TABS":
          return can(P.PosTabs);
        case "TILLS":
          return (
            can(P.PosRead) ||
            can(P.PosTillOpen) ||
            can(P.PosTillClose) ||
            can(P.PosTillEdit)
          );
        case "SALES":
          return can(P.PosRead);
        case "SETUP":
          return can(P.PosAdmin);
        case "GUEST":
          return can(P.PosSell) || can(P.PosGuestsWrite) || can(P.PosRead);
        default:
          return false;
      }
    });
  }, [can]);

  useEffect(() => {
    if (modalSection && !sections.includes(modalSection)) {
      setModalSection(null);
      if (activeNav === modalSection) setActiveNav("SELL");
    }
    if (setupOpen && !can(P.PosAdmin)) {
      setSetupOpen(false);
      if (activeNav === "SETUP") setActiveNav("SELL");
    }
    if (activeNav !== "SELL" && activeNav !== "SETUP" && !sections.includes(activeNav)) {
      setActiveNav("SELL");
    }
  }, [sections, modalSection, setupOpen, can, activeNav]);

  const parkName = venues.find((v) => v.id === locationId)?.name;
  const deviceName = devices.find((d) => d.id === deviceId)?.name;
  const lineCount = cart?.lines?.length ?? 0;
  const stationParkNotReady = useMemo(() => {
    if (!locationId || !canSeeParkPayoutBanner) return null;
    const park = (parkAccountsQuery.data ?? []).find(
      (p) => p.locationId === locationId
    );
    if (park?.isFranchise && !park.chargeReady) {
      return {
        locationId: park.locationId,
        locationName: park.locationName || parkName || "This park",
      };
    }
    return null;
  }, [
    locationId,
    canSeeParkPayoutBanner,
    parkAccountsQuery.data,
    parkName,
  ]);

  if (locked) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-stone-200 bg-gradient-to-br from-stone-100 via-white to-[#D4AF37]/10 p-10 shadow-sm">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[#D4AF37]/20 blur-3xl" />
        <div className="relative mx-auto max-w-md text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#D4AF37]">POS</p>
          <h1 className="mt-2 font-serif text-3xl text-stone-900">Terminal locked</h1>
          <p className="mt-3 text-sm leading-relaxed text-stone-600">{locked}</p>
          <Link
            href="/admin"
            className="mt-6 inline-flex rounded-full bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-800"
          >
            Back to admin
          </Link>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="relative flex min-h-[34rem] flex-col overflow-hidden rounded-2xl border border-stone-200/90 bg-gradient-to-br from-stone-100 via-[#faf8f4] to-[#D4AF37]/15 shadow-[0_20px_50px_-28px_rgba(28,25,23,0.35)]"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(212,175,55,0.18),_transparent_55%)]" />
      <div className="pointer-events-none absolute -left-20 bottom-0 h-56 w-56 rounded-full bg-stone-300/30 blur-3xl" />

      <header className="relative z-10 border-b border-stone-200/80 bg-white/75 px-4 py-3 backdrop-blur-md">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="mt-1 font-serif text-2xl tracking-tight text-stone-900 sm:text-3xl">
              Point of <span className="text-[#A6892A]">Sale</span>
            </h1>
            <p className="mt-0.5 text-xs text-stone-500">
              Use the tabs below — each tool opens here without leaving the terminal.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${
                tillOpen
                  ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                  : "bg-stone-100 text-stone-600 ring-stone-200"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${tillOpen ? "bg-emerald-500" : "bg-stone-400"}`}
              />
              Till {tillOpen ? "open" : "closed"}
            </span>
            {!online ? (
              <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200">
                Offline
              </span>
            ) : null}
            <label className="sr-only" htmlFor="pos-park">
              Park
            </label>
            <select
              id="pos-park"
              className="max-w-[11rem] rounded-full border-0 bg-white/90 py-1.5 pl-3 pr-8 text-xs font-medium text-stone-800 shadow-sm ring-1 ring-stone-200 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/60"
              value={locationId}
              disabled={parkLocked && venues.length <= 1}
              onChange={(e) => applyParkSelection(e.target.value)}
            >
              {venuesLoading && venues.length === 0 ? (
                <option value="">Loading parks…</option>
              ) : null}
              {venues.length === 0 && locationId && !venuesLoading ? (
                <option value={locationId}>Loading parks…</option>
              ) : null}
              {!locationId && !venuesLoading ? (
                <option value="">Select park</option>
              ) : null}
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="pos-device">
              Device
            </label>
            <select
              id="pos-device"
              className="max-w-[9rem] rounded-full border-0 bg-white/90 py-1.5 pl-3 pr-8 text-xs font-medium text-stone-800 shadow-sm ring-1 ring-stone-200 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/60"
              value={deviceId}
              onChange={(e) => {
                setDeviceId(e.target.value);
                setPosStation({ deviceId: e.target.value });
                loadStation(locationId, e.target.value, true);
              }}
            >
              {devices.length === 0 && deviceId ? (
                <option value={deviceId}>Loading devices…</option>
              ) : null}
              {!deviceId ? <option value="">Device</option> : null}
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <nav className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5" aria-label="POS station tools">
          {sections.map((s) => {
            const active = activeNav === s;
            const meta = NAV_META[s];
            return (
              <button
                key={s}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => openStationTool(s)}
                className={`group relative shrink-0 overflow-hidden rounded-2xl px-3.5 py-2 text-left transition ${
                  active
                    ? "bg-stone-900 text-white shadow-md shadow-stone-900/20"
                    : "bg-white/80 text-stone-700 ring-1 ring-stone-200/90 hover:bg-white hover:ring-[#D4AF37]/50"
                }`}
              >
                {active ? (
                  <motion.span
                    layoutId="pos-nav-glow"
                    className="pointer-events-none absolute inset-x-2 top-0 h-px bg-gradient-to-r from-transparent via-[#D4AF37] to-transparent"
                  />
                ) : null}
                <span className="block text-xs font-semibold tracking-wide">{meta.label}</span>
                <span
                  className={`mt-0.5 block text-[10px] ${active ? "text-stone-300" : "text-stone-400"}`}
                >
                  {meta.hint}
                </span>
              </button>
            );
          })}
          {can(P.PartiesRead) ? (
            <Link
              href={`/admin/parties?date=today${locationId ? `&locationId=${encodeURIComponent(locationId)}` : ""}`}
              className="group relative shrink-0 overflow-hidden rounded-2xl bg-white/80 px-3.5 py-2 text-left text-stone-700 ring-1 ring-stone-200/90 transition hover:bg-white hover:ring-[#D4AF37]/50"
            >
              <span className="block text-xs font-semibold tracking-wide">PARTY</span>
              <span className="mt-0.5 block text-[10px] text-stone-400">Today&apos;s parties</span>
            </Link>
          ) : null}
        </nav>
        {(parkName || deviceName) && (
          <p className="mt-2 text-[11px] text-stone-500">
            {parkName ?? "Park"}
            {deviceName ? ` · ${deviceName}` : ""}
            {guestId ? " · Guest attached" : ""}
          </p>
        )}
      </header>

      <main className="relative z-10 flex-1 overflow-auto p-3 sm:p-4">
        {settings?.offlineEnabled ? (
          <PosOfflineBanner offlineEnabled locationId={locationId} deviceId={deviceId} />
        ) : null}
        {stationParkNotReady ? (
          <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-2.5 text-sm text-amber-950">
            {stationParkNotReady.locationName} park payouts are not charge-ready
            — card-present settlement for this franchise park stays blocked until
            Connect completes on{" "}
            <Link
              href={`/admin/payouts?locationId=${encodeURIComponent(stationParkNotReady.locationId)}`}
              className="font-semibold text-[#8a7320] underline"
            >
              Park payouts
            </Link>
            .
          </p>
        ) : null}
        {error ? (
          <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        {!loading && locationId && !deviceId ? (
          <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-2.5 text-sm text-amber-950">
            No POS device on this park.{" "}
            <button
              type="button"
              className="font-semibold text-[#8a7320] underline"
              onClick={() => openStationTool("SETUP")}
            >
              Register a device in Setup
            </button>
            .
          </p>
        ) : null}

        {loading ? (
          <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
            <div className="space-y-3">
              <div className="h-11 animate-pulse rounded-2xl bg-white/70" />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/70" />
                ))}
              </div>
            </div>
            <div className="h-72 animate-pulse rounded-2xl bg-white/70" />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <section className="space-y-3">
              <div className="rounded-2xl border border-white/80 bg-white/80 p-3 shadow-sm backdrop-blur-sm ring-1 ring-stone-200/60">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    className="min-w-0 flex-1 rounded-xl border-0 bg-stone-50 px-3.5 py-2.5 text-sm text-stone-900 shadow-inner ring-1 ring-stone-200/80 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/55"
                    placeholder="Search catalog by name or SKU"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <label className="block shrink-0 text-[11px] font-medium text-stone-500 sm:w-52">
                    Session seats
                    <select
                      className="mt-1 w-full rounded-xl border-0 bg-stone-50 px-3 py-2 text-sm text-stone-800 ring-1 ring-stone-200/80 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/55"
                      value={sessionId}
                      onChange={(e) => setSessionId(e.target.value)}
                    >
                      <option value="">Optional session</option>
                      {sessions
                        .filter((s) => !s.closed && s.remaining > 0)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {(s.label ?? s.id.slice(0, 8)) + ` · ${s.remaining} left`}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-stone-300 bg-white/50 px-6 py-14 text-center">
                  <p className="font-serif text-xl text-stone-800">Catalog is empty</p>
                  <p className="mx-auto mt-2 max-w-sm text-sm text-stone-500">
                    Add products and a menu in Setup — changes appear here right away.
                  </p>
                  <button
                    type="button"
                    onClick={() => openStationTool("SETUP")}
                    className="mt-5 inline-flex rounded-full bg-[#D4AF37] px-5 py-2 text-sm font-semibold text-stone-900 shadow-sm shadow-[#D4AF37]/25 transition hover:brightness-105"
                  >
                    Open setup
                  </button>
                </div>
              ) : (
                <motion.div
                  layout
                  className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4"
                >
                  {filtered.map((p, i) => (
                    <motion.button
                      key={p.id}
                      type="button"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.02, 0.24), duration: 0.28 }}
                      whileHover={{ y: -2, scale: 1.01 }}
                      whileTap={{ scale: 0.98 }}
                      className="group flex flex-col rounded-2xl border border-stone-200/80 bg-white p-3 text-left shadow-sm transition hover:border-[#D4AF37]/70 hover:shadow-md hover:shadow-[#D4AF37]/10"
                      onClick={() => addProduct(p).catch((e: Error) => setError(e.message))}
                    >
                      <span
                        className={`w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${kindTone(p.kind)}`}
                      >
                        {kindLabel(p.kind)}
                      </span>
                      <span className="mt-2 line-clamp-2 text-sm font-semibold leading-snug text-stone-900 group-hover:text-[#6b5a12]">
                        {p.name}
                      </span>
                      <span className="mt-auto pt-3 text-sm font-medium tabular-nums text-stone-700">
                        ${Number(p.price).toFixed(2)}
                      </span>
                    </motion.button>
                  ))}
                </motion.div>
              )}

              {addonSuggestions.length ? (
                <div className="rounded-2xl border border-dashed border-[#D4AF37]/40 bg-[#D4AF37]/5 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#8a7320]">
                    Suggested add-ons
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {addonSuggestions.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="rounded-full bg-white px-3 py-1 text-xs font-medium text-stone-800 ring-1 ring-stone-200 transition hover:ring-[#D4AF37]"
                        onClick={() => addProduct(p).catch((e: Error) => setError(e.message))}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {settings?.allowParkedCarts ? (
                <div className="rounded-2xl bg-white/70 p-3 text-xs ring-1 ring-stone-200/70">
                  <p className="font-semibold text-stone-800">Parked carts</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-full bg-stone-900 px-3 py-1.5 font-medium text-white disabled:opacity-40"
                      disabled={!cart}
                      onClick={() =>
                        cart &&
                        parkPosCart(cart.id)
                          .then(async () => {
                            setError("Cart parked.");
                            const [parked, opened] = await Promise.all([
                              listParkedPosCarts(locationId),
                              openPosCart({
                                locationId,
                                deviceId,
                                guestProfileId: guestId ?? undefined,
                              }),
                            ]);
                            setParkedCarts((parked.carts ?? []).map((c) => ({ id: c.id })));
                            setCart(opened.cart);
                          })
                          .catch((e: Error) => setError(e.message))
                      }
                    >
                      Park current
                    </button>
                    <input
                      className="min-w-[8rem] flex-1 rounded-full bg-stone-50 px-3 py-1.5 ring-1 ring-stone-200"
                      placeholder="Paste parked cart id"
                      value={parkedId}
                      onChange={(e) => setParkedId(e.target.value)}
                    />
                    <button
                      type="button"
                      className="rounded-full bg-white px-3 py-1.5 font-medium ring-1 ring-stone-200"
                      onClick={() =>
                        getPosCart(parkedId)
                          .then((r) => setCart(r.cart))
                          .catch((e: Error) => setError(e.message))
                      }
                    >
                      Resume
                    </button>
                  </div>
                  {parkedCarts.length ? (
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {parkedCarts.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            className="text-[#8a7320] underline"
                            onClick={() =>
                              getPosCart(p.id)
                                .then((r) => setCart(r.cart))
                                .catch((e: Error) => setError(e.message))
                            }
                          >
                            {p.id.slice(0, 10)}…
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </section>

            <aside className="space-y-3 lg:sticky lg:top-2 lg:self-start">
              <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-md shadow-stone-900/5">
                <div className="border-b border-stone-100 bg-gradient-to-r from-stone-900 to-stone-800 px-4 py-3 text-white">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold tracking-wide">Cart</h2>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSellGuideOpen(true)}
                        className="rounded-full bg-[#D4AF37] px-2.5 py-0.5 text-[11px] font-semibold text-stone-900 shadow-sm shadow-[#D4AF37]/30 transition hover:brightness-105"
                      >
                        Guide
                      </button>
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] tabular-nums">
                        {lineCount} item{lineCount === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-[#D4AF37]">
                    ${subtotal.toFixed(2)}
                  </p>
                </div>
                <ul className="max-h-48 space-y-0 overflow-y-auto px-2 py-1 text-sm">
                  <AnimatePresence initial={false}>
                    {(cart?.lines ?? []).map((l) => (
                      <motion.li
                        key={l.id}
                        initial={{ opacity: 0, x: 8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex items-center justify-between gap-2 border-b border-stone-50 px-2 py-2 last:border-0"
                      >
                        <span className="min-w-0 truncate text-stone-800">
                          <span className="font-medium tabular-nums text-stone-500">{l.qty}×</span>{" "}
                          {l.name}
                        </span>
                        <button
                          type="button"
                          className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-50"
                          onClick={() =>
                            cart &&
                            removePosCartLine(cart.id, l.id)
                              .then((r) => setCart(r.cart))
                              .catch((e: Error) => setError(e.message))
                          }
                        >
                          Remove
                        </button>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                  {!lineCount ? (
                    <li className="px-3 py-6 text-center">
                      <p className="text-xs text-stone-400">Tap a product to start the sale</p>
                      <button
                        type="button"
                        onClick={() => setSellGuideOpen(true)}
                        className="mt-2 text-[11px] font-semibold text-[#8a7320] underline"
                      >
                        How do I use this checkout?
                      </button>
                    </li>
                  ) : null}
                </ul>
              </div>

              <div className="space-y-2 rounded-2xl bg-white/90 p-3 ring-1 ring-stone-200/80">
                <input
                  className="w-full rounded-xl bg-stone-50 px-3 py-2 text-sm ring-1 ring-stone-200 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/55"
                  placeholder="Discount code"
                  value={discountCode}
                  onChange={(e) => setDiscountCode(e.target.value)}
                />
                {settings?.captureGuestPostcode || settings?.postcodeRequired ? (
                  <input
                    className="w-full rounded-xl bg-stone-50 px-3 py-2 text-sm ring-1 ring-stone-200 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/55"
                    placeholder={settings.postcodeRequired ? "Postcode (required)" : "Postcode"}
                    value={postal}
                    onChange={(e) => setPostal(e.target.value)}
                  />
                ) : null}
                {guestBanned ? (
                  <p className="text-xs text-amber-800">
                    Guest is banned — manager override required at checkout.
                  </p>
                ) : null}
                {guestId ? (
                  <p className="text-[11px] text-stone-500">Guest {guestId.slice(0, 12)}…</p>
                ) : null}
              </div>

              <PosPayPad
                totalDue={subtotal}
                tipAmount={tip}
                tipPercents={settings?.tipSuggestedPercents ?? [15, 18, 20]}
                tipEnabled={settings?.tipPromptEnabled ?? true}
                cashRequiresOpenTill={settings?.cashRequiresOpenTill ?? true}
                tillOpen={tillOpen}
                stripeConfigured={stripeConfigured}
                terminalConfigured={terminalConfigured}
                onTipChange={setTip}
                busy={checkoutBusy || checkoutBlocked}
                onPay={(tenders) => {
                  const needsPin =
                    Boolean(discountCode && settings?.managerPinRequiredForDiscount) || guestBanned;
                  if (needsPin) requestPin((pin) => runCheckout(tenders, pin));
                  else runCheckout(tenders);
                }}
                onRequestManagerPin={(then) => requestPin(() => then())}
              />
              {checkoutBlocked ? (
                <p className="text-xs text-red-700">
                  Complete guest/postcode requirements before checkout.
                </p>
              ) : null}
            </aside>
          </div>
        )}
      </main>

      <AnimatePresence>
        {setupOpen ? (
          <motion.div
            key="pos-setup"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-40 flex items-stretch justify-center bg-stone-900/50 p-2 backdrop-blur-[2px] sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label="POS setup"
            onClick={closeSetupModal}
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 380, damping: 28 }}
              className="flex max-h-[min(94vh,920px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl shadow-stone-900/25"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="flex shrink-0 items-center justify-between gap-2 border-b border-stone-100 bg-gradient-to-r from-stone-50 to-white px-4 py-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#A6892A]">
                    Terminal
                  </p>
                  <h2 className="font-serif text-xl text-stone-900">POS setup</h2>
                </div>
                <button
                  type="button"
                  className="rounded-full bg-stone-900 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-stone-800"
                  onClick={closeSetupModal}
                >
                  Done
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <PosAdminPage
                  embedded
                  initialLocationId={locationId || undefined}
                  onDataChange={scheduleSellRefresh}
                  onLocationChange={(loc) => {
                    if (!loc || loc === locationId) return;
                    applyParkSelection(loc);
                  }}
                />
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {modalSection ? (
          <motion.div
            key={modalSection}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-40 flex items-stretch justify-center bg-stone-900/50 p-2 backdrop-blur-[2px] sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label={NAV_META[modalSection].label}
            onClick={closeToolModal}
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 380, damping: 28 }}
              className={`flex max-h-[min(92vh,900px)] w-full flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl shadow-stone-900/25 ${
                modalSection === "CHECK_IN" ||
                modalSection === "TABS" ||
                modalSection === "CAPACITY" ||
                modalSection === "GUEST" ||
                modalSection === "TILLS" ||
                modalSection === "SALES"
                  ? "max-w-xl"
                  : "max-w-lg"
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-100 bg-gradient-to-r from-[#faf8f4] via-white to-[#D4AF37]/10 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#A6892A]">
                      Station tool
                    </p>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      </span>
                      Live
                    </span>
                    {parkName ? (
                      <span className="truncate rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium text-stone-600 ring-1 ring-stone-200">
                        {parkName}
                      </span>
                    ) : null}
                  </div>
                  <h2 className="font-serif text-xl text-stone-900">
                    {NAV_META[modalSection].label}
                  </h2>
                  <p className="text-[11px] text-stone-500">{NAV_META[modalSection].hint}</p>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-full bg-stone-900 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-stone-800"
                  onClick={closeToolModal}
                >
                  Close
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {!locationId && modalSection !== "SALES" ? (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <PosParkGate
                      toolLabel={NAV_META[modalSection].label}
                      venues={venues}
                      venuesLoading={venuesLoading}
                      parkLocked={parkLocked}
                      onSelectPark={applyParkSelection}
                      heroGlyph={
                        modalSection === "CAPACITY"
                          ? "C"
                          : modalSection === "TABS"
                            ? "T"
                            : modalSection === "TILLS"
                              ? "$"
                              : modalSection === "CHECK_IN"
                                ? "✓"
                                : modalSection === "GUEST"
                                  ? "G"
                                  : "P"
                      }
                      createParkCta={
                        <StationSetupNavLink
                          href="/admin/venues"
                          idleLabel="Open Venues"
                          onNavigate={() => closeToolModal()}
                        />
                      }
                    />
                  </motion.div>
                ) : null}
                {modalSection === "CHECK_IN" && locationId ? (
                  <PosCheckInPanel
                    key={`checkin-${locationId}`}
                    locationId={locationId}
                    compact
                    parkName={venues.find((v) => v.id === locationId)?.name}
                    onRedeemed={() => {
                      void refreshAvailability(locationId);
                    }}
                  />
                ) : null}
                {modalSection === "CAPACITY" && locationId ? (
                  <PosCapacityPanel
                    key={`cap-${locationId}-${modalSection}`}
                    locationId={locationId}
                    compact
                    parkName={venues.find((v) => v.id === locationId)?.name}
                    onChanged={() => {
                      void refreshAvailability(locationId);
                    }}
                  />
                ) : null}
                {modalSection === "TABS" && locationId ? (
                  <PosTabsPanel
                    key={`tabs-${locationId}-${deviceId}`}
                    locationId={locationId}
                    deviceId={deviceId}
                    settings={settings}
                    tillOpen={tillOpen}
                    parkName={venues.find((v) => v.id === locationId)?.name}
                    terminalReaderId={terminalReaderId}
                    onChanged={() => syncTillOpen()}
                  />
                ) : null}
                {modalSection === "TILLS" && locationId ? (
                  <PosTillsPanel
                    key={`tills-${locationId}-${deviceId}`}
                    locationId={locationId}
                    deviceId={deviceId}
                    parkName={venues.find((v) => v.id === locationId)?.name}
                    onTillOpenChange={setTillOpen}
                  />
                ) : null}
                {modalSection === "SALES" ? (
                  <PosSalesPanel
                    key={`sales-${locationId || "all"}`}
                    parkName={venues.find((v) => v.id === locationId)?.name}
                  />
                ) : null}
                {modalSection === "GUEST" && locationId ? (
                  <PosGuestPanel
                    key={`guest-${locationId}`}
                    locationId={locationId}
                    attachedGuestId={guestId}
                    parkName={venues.find((v) => v.id === locationId)?.name}
                    requireGuest={Boolean(settings?.requireGuestOnSale)}
                    onAttached={(g) => {
                      setGuestId(g.id);
                      setGuestBanned(g.banned);
                      setPostal(g.postalCode);
                      setError("");
                      // Guest is stamped at checkout from this state — do not reopen cart
                      // (that would wipe lines already on the sale).
                    }}
                    onCleared={() => {
                      setGuestId(null);
                      setGuestBanned(false);
                    }}
                    onDone={() => closeToolModal()}
                  />
                ) : null}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {openPrice ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-stone-900/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-4">
            <h3 className="font-semibold">{openPrice.product.name}</h3>
            <input
              className="mt-2 w-full rounded border px-2 py-1"
              value={openPrice.amount}
              onChange={(e) => setOpenPrice({ ...openPrice, amount: e.target.value })}
            />
            <div className="mt-3 flex gap-2">
              <button type="button" className="flex-1 rounded border py-2" onClick={() => setOpenPrice(null)}>
                Cancel
              </button>
              <button type="button" className="flex-1 rounded bg-[#D4AF37] py-2 font-semibold" onClick={() => confirmOpenPrice().catch((e: Error) => setError(e.message))}>
                Add
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {modifierPick ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-stone-900/40 p-4">
          <div className="max-h-[80vh] w-full max-w-md overflow-auto rounded-xl bg-white p-4">
            <h3 className="font-semibold">{modifierPick.product.name}</h3>
            {(modifierPick.product.modifierGroups ?? []).map((g) => (
              <div key={g.id} className="mt-3">
                <p className="text-sm font-medium">
                  {g.name} ({g.minSelect}-{g.maxSelect})
                </p>
                {g.modifiers.map((m) => (
                  <label key={m.id} className="mt-1 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={modifierPick.selected.includes(m.id)}
                      onChange={(e) => {
                        setModifierPick((prev) => {
                          if (!prev) return prev;
                          const sel = e.target.checked
                            ? [...prev.selected, m.id]
                            : prev.selected.filter((x) => x !== m.id);
                          return { ...prev, selected: sel };
                        });
                      }}
                    />
                    {m.name} (+${m.priceDelta.toFixed(2)})
                  </label>
                ))}
              </div>
            ))}
            <button type="button" className="mt-4 w-full rounded bg-[#D4AF37] py-2 font-semibold" onClick={() => confirmModifiers().catch((e: Error) => setError(e.message))}>
              Add to cart
            </button>
          </div>
        </div>
      ) : null}

      <PosPinModal
        open={pinOpen}
        locationId={locationId}
        onClose={() => setPinOpen(false)}
        onVerified={(pin) => {
          pinAction?.(pin);
          setPinAction(null);
        }}
      />

      <PosCardConfirmModal
        open={Boolean(cardConfirm)}
        saleId={cardConfirm?.saleId ?? ""}
        publicId={cardConfirm?.publicId ?? ""}
        secrets={cardConfirm?.secrets ?? []}
        onClose={() => {
          setCardConfirm(null);
          window.alert(
            "Card not confirmed — sale stays unpaid. Resume from Sales → Confirm card, or use cash / payment link."
          );
        }}
        onSettled={(message) => {
          setCardConfirm(null);
          window.alert(message);
        }}
      />

      <PosSellGuideModal
        open={sellGuideOpen}
        onClose={() => setSellGuideOpen(false)}
        onOpenSetup={() => openStationTool("SETUP")}
        onOpenTills={() => openStationTool("TILLS")}
        onOpenSales={() => openStationTool("SALES")}
        onOpenGuest={() => openStationTool("GUEST")}
      />
    </motion.div>
  );
}
