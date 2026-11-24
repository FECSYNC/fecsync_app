/**
 * Admin sidebar navigation SSOT (Step 6.3 / 7.3).
 * Hrefs must exist in ADMIN_ROUTE_PERMISSIONS (permissions.ts).
 */
export type AdminNavIconKey =
  | "dashboard"
  | "catalog"
  | "operations"
  | "bookings"
  | "parties"
  | "pos"
  | "accounting"
  | "memberships"
  | "waivers"
  | "marketing"
  | "venues"
  | "tailors"
  | "ai"
  | "users"
  | "workspaces"
  | "settings";

export type AdminNavChild = {
  name: string;
  href: string;
  /** Optional subsection label above this item (first child of a section). */
  section?: string;
};

/** One sidebar subsection (e.g. Ticketing) after grouping consecutive children. */
export type AdminNavSectionBucket<T extends AdminNavChild = AdminNavChild> = {
  /** Null = unlabelled leading items (no section dropdown). */
  section: string | null;
  items: T[];
};

/**
 * Groups flat nav children by `section` markers into accordion buckets.
 * Items after a section marker belong to that section until the next marker.
 */
export function groupAdminNavChildrenBySection<T extends AdminNavChild>(
  children: T[]
): AdminNavSectionBucket<T>[] {
  const buckets: AdminNavSectionBucket<T>[] = [];
  for (const child of children) {
    if (child.section || buckets.length === 0) {
      buckets.push({
        section: child.section ?? null,
        items: [child],
      });
    } else {
      buckets[buckets.length - 1]!.items.push(child);
    }
  }
  return buckets;
}

export type AdminNavLink = {
  type: "link";
  name: string;
  href: string;
  icon: AdminNavIconKey;
};

export type AdminNavGroup = {
  type: "group";
  name: string;
  icon: AdminNavIconKey;
  children: AdminNavChild[];
};

export type AdminNavEntry = AdminNavLink | AdminNavGroup;

/** Top-level Online Booking group — registered-company venue ops. */
export const ONLINE_BOOKING_NAV_NAME = "Online Booking";

/** Party Management group (rides the ticketing module entitlement). */
export const PARTIES_NAV_NAME = "Parties";

export function isPartiesNavHref(href: string): boolean {
  const path = (href.split("?")[0] ?? href).split("#")[0] ?? href;
  return path === "/admin/parties" || path.startsWith("/admin/parties/");
}

export function isAccountingNavHref(href: string): boolean {
  const path = (href.split("?")[0] ?? href).split("#")[0] ?? href;
  return path === "/admin/accounting" || path.startsWith("/admin/accounting/");
}

/**
 * In-app Accounting tabs (sidebar is a single “Accounting” link).
 * `section` groups the horizontal tab strip.
 */
export const ACCOUNTING_APP_TABS: AdminNavChild[] = [
  { section: "Overview", name: "Dashboard", href: "/admin/accounting" },
  { name: "Approvals", href: "/admin/accounting/approvals" },
  { section: "Ledger", name: "Journals", href: "/admin/accounting/journals" },
  { name: "General ledger", href: "/admin/accounting/ledger" },
  { name: "Chart of accounts", href: "/admin/accounting/chart-of-accounts" },
  { section: "Receivables", name: "Customers", href: "/admin/accounting/customers" },
  { name: "Invoices", href: "/admin/accounting/invoices" },
  { name: "Receipts", href: "/admin/accounting/receipts" },
  { section: "Payables", name: "Suppliers", href: "/admin/accounting/suppliers" },
  { name: "Purchase orders", href: "/admin/accounting/purchase-orders" },
  { name: "Bills", href: "/admin/accounting/bills" },
  { name: "Supplier payments", href: "/admin/accounting/supplier-payments" },
  { section: "Expenses", name: "Expenses", href: "/admin/accounting/expenses" },
  { name: "Expense categories", href: "/admin/accounting/expense-categories" },
  { section: "Banking", name: "Banking", href: "/admin/accounting/banking" },
  { name: "Bank accounts", href: "/admin/accounting/bank-accounts" },
  { name: "Transfers", href: "/admin/accounting/transfers" },
  { name: "Reconciliations", href: "/admin/accounting/reconciliations" },
  { section: "Inventory", name: "Inventory", href: "/admin/accounting/inventory" },
  { name: "Inventory movements", href: "/admin/accounting/inventory/movements" },
  { section: "Reports", name: "Reports", href: "/admin/accounting/reports" },
  { name: "Tax", href: "/admin/accounting/tax" },
  { section: "Control", name: "Periods", href: "/admin/accounting/periods" },
  { name: "Posting exceptions", href: "/admin/accounting/posting-queue" },
  { name: "Audit trail", href: "/admin/accounting/audit" },
  { section: "Configuration", name: "Setup", href: "/admin/accounting/setup" },
  { name: "Mappings", href: "/admin/accounting/mappings" },
  { name: "Tax codes", href: "/admin/accounting/tax-codes" },
  { name: "Opening balances", href: "/admin/accounting/opening-balances" },
  { name: "Settings", href: "/admin/accounting/settings" },
];

/** Active Accounting tab for a pathname (longest prefix wins; dashboard is exact). */
export function matchAccountingAppTab(pathname: string): string | null {
  const path = (pathname.split("?")[0] ?? pathname).split("#")[0] ?? pathname;
  const normalized = path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
  if (normalized === "/admin/accounting") return "/admin/accounting";
  const matches = ACCOUNTING_APP_TABS.filter(
    (t) =>
      t.href !== "/admin/accounting" &&
      (normalized === t.href || normalized.startsWith(`${t.href}/`))
  ).sort((a, b) => b.href.length - a.href.length);
  return matches[0]?.href ?? null;
}

/** Sidebar order — permission filtering happens in AdminSidebar via can(). */
export const ADMIN_NAV_ITEMS: AdminNavEntry[] = [
  {
    type: "link",
    name: "Dashboard",
    href: "/admin",
    icon: "dashboard",
  },
  {
    type: "link",
    name: "Venues",
    href: "/admin/venues",
    icon: "venues",
  },
  {
    type: "group",
    name: "Food sales",
    icon: "catalog",
    children: [
      { name: "Menu items", href: "/admin/products" },
      { name: "Categories", href: "/admin/categories" },
      // UI-hidden via adminUiHidden (route kept)
      { name: "Fabrics", href: "/admin/fabrics" },
    ],
  },
  {
    type: "group",
    name: "Operations",
    icon: "operations",
    children: [
      { name: "Orders", href: "/admin/orders" },
      // UI-hidden via adminUiHidden (route kept)
      { name: "Customizations", href: "/admin/customizations" },
      { name: "Deliveries", href: "/admin/deliveries" },
      { name: "Reviews", href: "/admin/reviews" },
    ],
  },
  {
    type: "group",
    name: ONLINE_BOOKING_NAV_NAME,
    icon: "bookings",
    children: [
      { section: "Bookings", name: "All bookings", href: "/admin/bookings" },
      {
        section: "Ticketing",
        name: "Ticket products",
        href: "/admin/ticketing",
      },
      { name: "Booking category", href: "/admin/ticketing/categories" },
      { name: "Sessions", href: "/admin/ticketing/sessions" },
      { name: "Add-ons", href: "/admin/ticketing/add-ons" },
      { name: "Passes", href: "/admin/ticketing/passes" },
      { name: "Resources", href: "/admin/ticketing/resources" },
      { name: "Booking packages", href: "/admin/booking-packages" },
      {
        section: "Sales",
        name: "Companies",
        href: "/admin/booking-accounts",
      },
      { name: "Invoices", href: "/admin/booking-invoices" },
      { name: "Payments", href: "/admin/booking-payments" },
      {
        section: "Settings",
        name: "Ticketing settings",
        href: "/admin/ticketing/settings",
      },
    ],
  },
  // Flat link: Packages / Rooms / Menu / Balances / Run sheets / Settings open as tabs on the page.
  {
    type: "link",
    name: PARTIES_NAV_NAME,
    href: "/admin/parties",
    icon: "parties",
  },
  {
    type: "link",
    name: "POS",
    href: "/admin/pos",
    icon: "pos",
  },
  {
    type: "link",
    name: "Accounting",
    href: "/admin/accounting",
    icon: "accounting",
  },
  {
    type: "group",
    name: "Memberships",
    icon: "memberships",
    children: [
      { name: "Create plan", href: "/admin/memberships/plans" },
      { name: "Membership categories", href: "/admin/memberships/categories" },
      { name: "Members", href: "/admin/memberships/members" },
      { name: "Redeem desk", href: "/admin/memberships/redeem" },
      { name: "Eligibility", href: "/admin/memberships/eligibility" },
      { name: "Settings", href: "/admin/memberships/settings" },
      { name: "Reports", href: "/admin/memberships/reports" },
    ],
  },
  {
    type: "group",
    name: "Waivers",
    icon: "waivers",
    children: [
      { name: "Waivers", href: "/admin/waivers" },
      { name: "Template", href: "/admin/waivers/templates" },
      { name: "Forms", href: "/admin/waivers/forms" },
      { name: "Signage", href: "/admin/waivers/signage" },
      { name: "Kiosk", href: "/admin/waivers/kiosk" },
      { name: "Settings", href: "/admin/waivers/settings" },
    ],
  },
  // Flat link: Newsletter / Campaigns / Automations / Surveys / Settings open as desk tabs on the page.
  {
    type: "link",
    name: "Marketing",
    href: "/admin/marketing",
    icon: "marketing",
  },
  {
    type: "group",
    // UI-hidden via adminUiHidden (entire group; routes kept)
    name: "Tailors",
    icon: "tailors",
    children: [
      { name: "Tailor profiles", href: "/admin/tailors" },
      { name: "Tailoring jobs", href: "/admin/tailoring-jobs" },
    ],
  },
  {
    type: "group",
    name: "AI Chats",
    icon: "ai",
    children: [
      { name: "Conversations", href: "/admin/ai-chats" },
      { name: "Assistant settings", href: "/admin/ai-settings" },
    ],
  },
  {
    type: "link",
    name: "Users",
    href: "/admin/users",
    icon: "users",
  },
  {
    type: "link",
    name: "Company workspaces",
    href: "/admin/registered-companies",
    icon: "workspaces",
  },
  {
    type: "group",
    name: "Workspace settings",
    icon: "settings",
    children: [
      // Registered-company surfaces — storefront project owner still sees them
      // via isAdminPageAllowed / isStorefrontPlatformSuperAdmin.
      // Venues is a top-level sidebar link (parks are primary ops, not settings).
      { name: "Enterprise HQ", href: "/admin/hq" },
      { name: "Company profile", href: "/admin/company-profile" },
      { name: "Billing", href: "/admin/billing" },
      { name: "Payouts", href: "/admin/payouts" },
      // Storefront CMS — UI-hidden via adminUiHidden (routes kept)
      { name: "Homepage", href: "/admin/homepage-content" },
      { name: "Ad banners", href: "/admin/ad-banners" },
      { name: "Tax", href: "/admin/tax-settings" },
      { name: "Shipping", href: "/admin/shipping-settings" },
    ],
  },
];

/** True when href is under Marketing admin nav. */
export function isMarketingNavHref(href: string): boolean {
  const path = (href.split("?")[0] ?? href).split("#")[0] ?? href;
  return path === "/admin/marketing" || path.startsWith("/admin/marketing/");
}

/** True when pathname is under Marketing admin nav. */
export function isMarketingNavPath(pathname: string): boolean {
  const p =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  return p === "/admin/marketing" || p.startsWith("/admin/marketing/");
}

/** True when href is part of the Online Booking sidebar group. */
export function isOnlineBookingNavHref(href: string): boolean {
  const group = ADMIN_NAV_ITEMS.find(
    (item) => item.type === "group" && item.name === ONLINE_BOOKING_NAV_NAME
  );
  if (!group || group.type !== "group") return false;
  return group.children.some((child) => child.href === href);
}

/** True when pathname is under any Online Booking nav entry (incl. nested). */
export function isOnlineBookingNavPath(pathname: string): boolean {
  const p =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  const group = ADMIN_NAV_ITEMS.find(
    (item) => item.type === "group" && item.name === ONLINE_BOOKING_NAV_NAME
  );
  if (!group || group.type !== "group") return false;
  return group.children.some(
    (child) => p === child.href || p.startsWith(`${child.href}/`)
  );
}

/**
 * Prefetch / warm href for the current admin pathname.
 * Keeps Online Booking sub-routes (sessions, calendar, new) instead of truncating.
 */
export function adminWarmHrefFromPathname(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length <= 1) return "/admin";
  if (parts[0] !== "admin") return `/${parts[0]}`;

  const section = parts[1] ?? "";
  const leaf = parts[2];

  if (section === "ticketing" && leaf) {
    // /admin/ticketing/sessions | add-ons | passes | resources | settings
    // Skip dynamic product ids under /products/[id]
    if (leaf === "products") {
      return "/admin/ticketing";
    }
    return `/admin/ticketing/${leaf}`;
  }
  if (section === "memberships" && leaf) {
    return `/admin/memberships/${leaf}`;
  }
  if (section === "waivers") {
    if (leaf === "forms" && parts[3] === "responses") {
      return "/admin/waivers/forms/responses";
    }
    if (leaf === "templates" || leaf === "records" || leaf === "guests") {
      return leaf === "templates" ? "/admin/waivers/templates" : "/admin/waivers";
    }
    if (leaf) return `/admin/waivers/${leaf}`;
    return "/admin/waivers";
  }
  if (section === "marketing") {
    if (leaf === "surveys" && parts[3]) {
      return "/admin/marketing/surveys";
    }
    if (leaf) return `/admin/marketing/${leaf}`;
    return "/admin/marketing";
  }
  if (section === "pos") {
    // Station tools live as modals on the terminal — warm the shell, not leaf routes.
    return "/admin/pos";
  }
  if (section === "accounting") {
    if (!leaf) return "/admin/accounting";
    // Warm list shells for dynamic detail segments.
    if (
      [
        "journals",
        "customers",
        "invoices",
        "receipts",
        "suppliers",
        "purchase-orders",
        "bills",
        "supplier-payments",
        "expenses",
        "banking",
        "reconciliations",
        "inventory",
        "reports",
        "chart-of-accounts",
      ].includes(leaf) &&
      parts[3]
    ) {
      if (leaf === "inventory" && parts[3] === "movements") {
        return "/admin/accounting/inventory/movements";
      }
      if (leaf === "reports") return `/admin/accounting/reports/${parts[3]}`;
      return `/admin/accounting/${leaf}`;
    }
    if (leaf === "inventory" && parts[3] === "movements") {
      return "/admin/accounting/inventory/movements";
    }
    return `/admin/accounting/${leaf}`;
  }
  if (section === "bookings" && leaf) {
    if (leaf === "calendar" || leaf === "new") {
      return `/admin/bookings/${leaf}`;
    }
    // /admin/bookings/[id] → warm list
    return "/admin/bookings";
  }
  if (section === "parties" && leaf) {
    if (["new", "packages", "rooms", "menu", "balances", "settings", "run-sheets"].includes(leaf)) {
      return `/admin/parties/${leaf}`;
    }
    // /admin/parties/[bookingId] → warm list
    return "/admin/parties";
  }
  if (
    (section === "booking-accounts" ||
      section === "booking-invoices" ||
      section === "booking-payments" ||
      section === "booking-packages") &&
    leaf
  ) {
    return `/admin/${section}`;
  }
  return `/admin/${section}`;
}

/** Dashboard quick-link cards (permission-gated in UI). */
export const ADMIN_DASHBOARD_QUICK_LINKS = {
  store: [
    {
      title: "Venues",
      href: "/admin/venues",
      permission: "venues:read" as const,
    },
    {
      title: "Enterprise HQ",
      href: "/admin/hq",
      permission: "hq:read" as const,
    },
    {
      title: "Company profile",
      href: "/admin/company-profile",
      permission: "company_profile:read" as const,
    },
    {
      title: "Billing",
      href: "/admin/billing",
      permission: "billing:read" as const,
    },
    {
      title: "Payouts",
      href: "/admin/payouts",
      permission: "payouts:read" as const,
    },
    {
      title: "Homepage content",
      href: "/admin/homepage-content",
      permission: "settings:manage" as const,
    },
    {
      title: "Ad banners",
      href: "/admin/ad-banners",
      permission: "settings:manage" as const,
    },
    { title: "Checkout tax", href: "/admin/tax-settings", permission: "tax:manage" as const },
    {
      title: "Shipping",
      href: "/admin/shipping-settings",
      permission: "shipping:read" as const,
    },
    { title: "Team members", href: "/admin/users", permission: "users:read" as const },
  ],
  ai: [
    { title: "Conversations", href: "/admin/ai-chats", permission: "ai:chats_read" as const },
    { title: "Assistant settings", href: "/admin/ai-settings", permission: "ai:manage" as const },
  ],
  operations: [
    { title: "Orders", href: "/admin/orders", permission: "orders:read" as const },
    {
      title: "Customizations",
      href: "/admin/customizations",
      permission: "customizations:read" as const,
    },
    { title: "Deliveries", href: "/admin/deliveries", permission: "deliveries:read" as const },
    { title: "Reviews", href: "/admin/reviews", permission: "reviews:read" as const },
  ],
  bookings: [
    { title: "Bookings", href: "/admin/bookings", permission: "bookings:read" as const },
    {
      title: "Create booking",
      href: "/admin/bookings/new",
      permission: "bookings:create" as const,
    },
    { title: "Ticketing", href: "/admin/ticketing", permission: "ticketing_products:read" as const },
    {
      title: "Booking category",
      href: "/admin/ticketing/categories",
      permission: "ticketing_products:read" as const,
    },
    {
      title: "Companies",
      href: "/admin/booking-accounts",
      permission: "booking_accounts:read" as const,
    },
    { title: "Parties", href: "/admin/parties", permission: "parties:read" as const },
    {
      title: "Invoices",
      href: "/admin/booking-invoices",
      permission: "booking_invoices:read" as const,
    },
    {
      title: "Payments",
      href: "/admin/booking-payments",
      permission: "bookings:payments_read" as const,
    },
    {
      title: "Booking packages",
      href: "/admin/booking-packages",
      permission: "booking_packages:read" as const,
    },
    {
      title: "Memberships",
      href: "/admin/memberships/members",
      permission: "memberships:read" as const,
    },
    {
      title: "Membership reports",
      href: "/admin/memberships/reports",
      permission: "memberships:read" as const,
    },
    {
      title: "Membership redeem",
      href: "/admin/memberships/redeem",
      permission: "memberships:redeem" as const,
    },
    {
      title: "Waivers",
      href: "/admin/waivers",
      permission: "waivers:read" as const,
    },
    {
      title: "Marketing",
      href: "/admin/marketing",
      permission: "marketing:read" as const,
    },
    {
      title: "POS terminal",
      href: "/admin/pos",
      permission: "pos:sell" as const,
    },
    {
      title: "Accounting",
      href: "/admin/accounting",
      permission: "accounting:read" as const,
    },
    {
      title: "Expenses",
      href: "/admin/accounting/expenses",
      permission: "accounting:expenses_submit" as const,
    },
    {
      title: "Accounting reports",
      href: "/admin/accounting/reports",
      permission: "accounting:reports_read" as const,
    },
  ],
  tailors: [
    { title: "Tailor profiles", href: "/admin/tailors", permission: "tailors:read" as const },
    {
      title: "Tailoring jobs",
      href: "/admin/tailoring-jobs",
      permission: "tailoring_jobs:read" as const,
    },
  ],
  catalog: [
    { title: "Menu items", href: "/admin/products", permission: "products:read" as const },
    { title: "Categories", href: "/admin/categories", permission: "categories:read" as const },
    { title: "Fabrics", href: "/admin/fabrics", permission: "fabrics:read" as const },
  ],
};
