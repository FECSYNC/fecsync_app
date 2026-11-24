import type { QueryClient } from '@tanstack/react-query';
import {
  P,
  adminPathRequiresStorefrontOrg,
  isPlatformAdminActor,
} from '@/lib/auth/permissions';
import { isStorefrontOrgSession, type UserProfile } from '@/services/auth';
import { api, unwrap, type MaybeWrapped } from '@/utils/api';
import { prefetchAdminDashboard } from '@/lib/prefetchAdminDashboard';
import { adminProductKeys } from '@/hooks/useProducts';
import { adminGetProducts } from '@/services/products';
import { categoryKeys } from '@/hooks/useCategories';
import { getAdminCategories } from '@/services/product-category';
import { fabricKeys } from '@/hooks/useFabrics';
import { getAdminFabrics } from '@/services/fabric';
import { orderKeys } from '@/hooks/useOrders';
import { getOrders } from '@/services/order';
import { customizationKeys } from '@/hooks/useCustomizations';
import { getAllCustomizations } from '@/services/customization';
import {
  fashionChatAdminKeys,
  FASHION_CHAT_PAGE_SIZE,
} from '@/hooks/useAdminFashionChats';
import { listAdminFashionChats } from '@/services/fashionChat';
import { aiSettingsKeys } from '@/hooks/useAiSettings';
import { getAdminAiSettings } from '@/services/aiSettings';
import { memberKeys } from '@/hooks/useMembers';
import { listOrgMembers } from '@/services/members';
import { taxSettingsKeys } from '@/hooks/useTaxSettings';
import { getAdminTaxSettings } from '@/services/tax';
import {
  accountingAuditDefaultFilters,
  accountingKeys,
} from '@/hooks/useAccounting';
import {
  getAccountingSettings,
  getAccountingSetupPreview,
  getAccountingLookups,
  listAccountingAccounts,
  getAccountingMappings,
  listAccountingTaxCodes,
  listAccountingPeriods,
  getOpeningBalances,
  listBankAccounts,
  listExpenseCategories,
  listAccountingJournals,
  listAccountingCustomers,
  listAccountingInvoices,
  listAccountingReceipts,
  listAccountingSuppliers,
  listAccountingBills,
  listAccountingExpenses,
  listPostingQueue,
  getAccountingAudit,
  listAccountingReports,
  getAccountingReport,
  listInventoryMovements,
  getInventoryValuation,
  listReconciliations,
  listBankTransfers,
  getAccountingDashboard,
  accountingDashboardDefaultRange,
  listAccountingApprovals,
  getAccountingLedger,
  listPurchaseOrders,
  listSupplierPayments,
} from '@/services/accounting';
import { companyProfileKeys } from '@/hooks/useCompanyProfile';
import { getAdminCompanyProfile } from '@/services/companyProfile';
import { billingKeys } from '@/hooks/useBilling';
import { getBillingPlans, getBillingUsage, getBillingState } from '@/services/billing';
import { listAdminVenueLocations, venueLocationKeys } from '@/services/venueLocations';
import {
  getAdminHqOverview,
  getAdminHqLocationContext,
  hqKeys,
  type HqLocationContextDto,
} from '@/services/hq';
import {
  getAdminParkContext,
  parkContextKeys,
} from '@/services/parkContext';
import { shippingSettingsKeys } from '@/hooks/useShippingSettings';
import { getAdminShippingSettings } from '@/services/shippingSettings';
import { homepageContentKeys } from '@/hooks/useHomepageContent';
import { getAdminHomepageSections } from '@/services/homepageContent';
import { adBannerKeys } from '@/hooks/useAdBanners';
import { getAdminAdBanners } from '@/services/adBanners';
import { userBlacklistKeys } from '@/hooks/useUserBlacklist';
import { listUserBlacklist } from '@/services/userBlacklist';
import { roleTemplateKeys } from '@/hooks/useRoleTemplates';
import { listRoleTemplates } from '@/services/roleTemplates';
import { notificationKeys } from '@/hooks/useNotifications';
import { getMyNotifications } from '@/services/notifications';
import { ADMIN_NOTIFICATIONS_LIVE_MS } from '@/utils/adminLiveRefresh';
import { jobKeys } from '@/hooks/useTailoringJobs';
import { getAdminTailoringJobs } from '@/services/tailoringJobs';
import { tailorKeys } from '@/hooks/useTailors';
import { getAdminTailors } from '@/services/tailors';
import { listShipments } from '@/services/shipping';
import { shipmentKeys } from '@/hooks/useShipments';
import {
  ticketingKeys,
  listTicketingProducts,
  listTicketSessions,
  listCapacityResources,
  getTicketingSettings,
  listStockPeriods,
} from '@/services/ticketing';
import {
  bookingCategoryKeys,
  listBookingCategories,
} from '@/services/bookingCategories';
import {
  bookingAccountKeys,
  listBookingAccounts,
} from '@/services/bookingAccounts';
import {
  adminBookingKeys,
  listAdminBookings,
} from '@/services/adminBookings';
import {
  adminInvoiceKeys,
  listAdminBookingInvoices,
} from '@/services/adminBookingInvoices';
import {
  adminPaymentKeys,
  listAdminBookingPayments,
} from '@/services/adminBookingPayments';
import {
  adminPartyKeys,
  getAdminPartySettings,
  listAdminParties,
  listAdminPartyBalances,
  listAdminPartyMenu,
  listAdminPartyPackages,
  listAdminPartyRooms,
  listAdminPartyRunSheets,
} from '@/services/adminParties';
import {
  getMembershipDunningQueue,
  getMembershipReports,
  getMembershipSettings,
  listMembershipCategories,
  listMembershipMembers,
  listMembershipPlans,
  membershipKeys,
  membershipP4Keys,
  searchMembershipGuests,
} from '@/services/memberships';
import { isPlatformSoftwareOwner } from '@/lib/platformSoftwareOwner';
import {
  listComplianceGuides,
  listKioskDevices,
  listWaiverRecords,
  listWaiverRequirements,
  listWaiverTemplates,
  getWaiverSettings,
  waiverKeys,
} from '@/services/waivers';
import { ADMIN_LIST_STALE_MS } from '@/lib/adminListCache';
import { hydrateAdminListQuery } from '@/lib/adminListSnapshot';
import { useAuthStore } from '@/store/authStore';
import {
  adminWarmHrefFromPathname,
  isOnlineBookingNavPath,
} from '@/lib/adminNav';

/** Default bookings list page size — keep in sync with BookingsListShellPage. */
export const DEFAULT_ADMIN_BOOKINGS_PAGE = {
  skip: 0,
  take: 50,
} as const;

export { ADMIN_LIST_STALE_MS };

type CanFn = (permission: string) => boolean;

/** Must match ProductsPage defaults (page 1, 10 rows, newest). */
export const DEFAULT_ADMIN_PRODUCTS = {
  page: 1,
  limit: 10,
  gender: '',
  sort: 'newest',
} as const;

/** Must match AiChatsPage / overview default list key. */
export const DEFAULT_ADMIN_AI_CHATS = {
  page: 1,
  limit: FASHION_CHAT_PAGE_SIZE,
} as const;

const EMPTY_PRODUCTS_PAGE = {
  items: [] as unknown[],
  pagination: {
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
    hasMore: false,
  },
};

const EMPTY_MEMBERS = { orgId: '', members: [] as unknown[] };

const EMPTY_ROLE_TEMPLATES = { orgId: '', templates: [] as unknown[] };

const EMPTY_BLACKLIST = { orgId: '', entries: [] as unknown[] };

const EMPTY_AI_CHATS = {
  chats: [] as unknown[],
  stats: {
    handoffCount: 0,
    waitingCount: 0,
    returned: 0,
    total: 0,
    page: 1,
    limit: FASHION_CHAT_PAGE_SIZE,
    totalPages: 1,
  },
};

function safePrefetch<T>(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  queryFn: () => Promise<T>,
  emptyFallback?: T,
  staleTime = ADMIN_LIST_STALE_MS
) {
  // Instant paint from last visit before the network round-trip.
  const orgId = useAuthStore.getState().user?.orgId ?? null;
  hydrateAdminListQuery(queryClient, orgId, queryKey);

  void queryClient.prefetchQuery({
    queryKey,
    queryFn: async () => {
      try {
        return await queryFn();
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (
          emptyFallback !== undefined &&
          msg.toLowerCase().includes('missing required permission')
        ) {
          return emptyFallback;
        }
        throw err;
      }
    },
    staleTime,
    meta: { suppressErrorBanner: true },
  });
}

type RegisteredCompaniesMetrics = {
  pendingCount: number;
  activeCompanyCount: number;
  suspendedCount: number;
  subscribedCount: number;
  expiringWithin7Days: number;
};

async function fetchRegisteredCompaniesMetrics(): Promise<RegisteredCompaniesMetrics> {
  const raw = await api<MaybeWrapped<{ metrics: RegisteredCompaniesMetrics }>>(
    '/api/admin/registered-companies/metrics'
  );
  return unwrap(raw).metrics;
}

async function fetchRegisteredCompaniesList(
  status: 'pending' | 'active' | 'suspended' | 'offboard' | 'all' = 'pending',
  cursor: string | null = null
) {
  const { listRegisteredCompaniesClient } = await import(
    '@/services/registeredCompanies'
  );
  return listRegisteredCompaniesClient(status, { cursor });
}

async function fetchAdminProductsPage() {
  const response = await adminGetProducts({ ...DEFAULT_ADMIN_PRODUCTS });
  if (Array.isArray(response)) {
    return {
      items: response,
      pagination: {
        page: 1,
        limit: 10,
        total: response.length,
        totalPages: 1,
        hasMore: false,
      },
    };
  }
  return response;
}

/**
 * Prefetch list data for a single admin href (call on hover / pointerdown / expand).
 */
export function prefetchAdminRoute(
  queryClient: QueryClient,
  href: string,
  can: CanFn,
  user?: Pick<
    UserProfile,
    'orgId' | 'storefrontOrgId' | 'preset' | 'membershipRole' | 'enterpriseHqEnabled'
  > | null
) {
  if (
    adminPathRequiresStorefrontOrg(href) &&
    user &&
    !isStorefrontOrgSession(user)
  ) {
    return;
  }

  // Report viewer detail — match hub hover-prefetch default period filters.
  const reportMatch = href.match(/^\/admin\/accounting\/reports\/([^/?#]+)$/);
  if (reportMatch) {
    if (!(can(P.AccountingReportsRead) || can(P.AccountingRead))) return;
    if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
    const reportId = reportMatch[1]!;
    if (reportId === "audit-trail" && !(can(P.AccountingAuditRead) || can(P.AccountingManage))) {
      return;
    }
    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .slice(0, 10);
    const filters = { from, to, asOf: to };
    safePrefetch(queryClient, accountingKeys.reports(), listAccountingReports);
    safePrefetch(queryClient, accountingKeys.report(reportId, filters), () =>
      getAccountingReport(reportId, filters)
    );
    return;
  }

  switch (href) {
    case '/admin':
      // Hovering Dashboard must not warm tax/members/AI/billing×3/metrics —
      // that stampeded the compile queue. AdminDashboard staggers the rest.
      prefetchAdminDashboard(queryClient, {
        canAnalytics: can(P.AnalyticsRead),
        includeOrders: can(P.OrdersRead),
        includeProducts: can(P.ProductsRead),
      });
      if (
        user?.parkLocked === true &&
        !isStorefrontOrgSession(user) &&
        (can(P.SettingsManage) ||
          can(P.AnalyticsRead) ||
          can(P.OrdersRead) ||
          can(P.ProductsRead) ||
          can(P.TicketingRead) ||
          can(P.BookingsRead))
      ) {
        safePrefetch(
          queryClient,
          parkContextKeys.context(),
          getAdminParkContext
        );
      }
      return;

    case '/admin/registered-companies':
      if (
        !isStorefrontOrgSession(user) ||
        !can(P.UsersManageRoles) ||
        !isPlatformAdminActor(user)
      ) {
        return;
      }
      // Dev: page useQuery owns the only list flight. Prefetching pending+active
      // + metrics stampeded compile/DB and left hard refresh spinning forever.
      if (process.env.NODE_ENV === 'development') {
        return;
      }
      // Prod: warm the default pending tab only; Active loads on filter click.
      void queryClient.prefetchInfiniteQuery({
        queryKey: ['registered-companies', 'list', 'pending'],
        queryFn: ({ pageParam }) =>
          fetchRegisteredCompaniesList('pending', pageParam as string | null),
        initialPageParam: null as string | null,
        staleTime: ADMIN_LIST_STALE_MS,
      });
      return;

    case '/admin/products':
      if (!can(P.ProductsRead)) return;
      safePrefetch(
        queryClient,
        adminProductKeys.list({ ...DEFAULT_ADMIN_PRODUCTS }),
        fetchAdminProductsPage,
        EMPTY_PRODUCTS_PAGE
      );
      // Products page also renders category/fabric filter labels.
      if (can(P.CategoriesRead)) {
        safePrefetch(
          queryClient,
          categoryKeys.adminLists(),
          async () => (await getAdminCategories()) ?? [],
          []
        );
      }
      if (can(P.FabricsRead)) {
        safePrefetch(
          queryClient,
          fabricKeys.adminLists(),
          async () => (await getAdminFabrics()) ?? [],
          []
        );
      }
      return;

    case '/admin/categories':
      if (!can(P.CategoriesRead)) return;
      safePrefetch(
        queryClient,
        categoryKeys.adminLists(),
        async () => (await getAdminCategories()) ?? [],
        []
      );
      return;

    case '/admin/fabrics':
      if (!can(P.FabricsRead)) return;
      safePrefetch(
        queryClient,
        fabricKeys.adminLists(),
        async () => (await getAdminFabrics()) ?? [],
        []
      );
      return;

    case '/admin/orders':
      if (!can(P.OrdersRead)) return;
      safePrefetch(
        queryClient,
        orderKeys.admin(),
        async () => (await getOrders({ limit: 200 })) ?? [],
        []
      );
      // Warm print brand for order staff (GET company-profile allows orders:read).
      if (
        can(P.OrdersRead) ||
        can(P.OrdersManage) ||
        can(P.SettingsManage)
      ) {
        safePrefetch(
          queryClient,
          companyProfileKeys.admin(user?.orgId ?? null),
          () => getAdminCompanyProfile()
        );
      }
      return;

    case '/admin/customizations':
      if (!can(P.CustomizationsRead)) return;
      safePrefetch(
        queryClient,
        customizationKeys.admin(),
        async () => (await getAllCustomizations()) ?? [],
        []
      );
      return;

    case '/admin/ai-chats':
      if (can(P.AiChatsRead)) {
        safePrefetch(
          queryClient,
          fashionChatAdminKeys.list({ ...DEFAULT_ADMIN_AI_CHATS }),
          () => listAdminFashionChats({ ...DEFAULT_ADMIN_AI_CHATS }),
          EMPTY_AI_CHATS as never
        );
      }
      if (can(P.AiManage)) {
        safePrefetch(queryClient, aiSettingsKeys.admin, getAdminAiSettings);
      }
      return;

    case '/admin/ai-settings':
      if (!can(P.AiManage)) return;
      safePrefetch(queryClient, aiSettingsKeys.admin, getAdminAiSettings);
      return;

    case '/admin/users':
    case '/admin/permissions':
      if (can(P.UsersRead)) {
        safePrefetch(
          queryClient,
          memberKeys.list(user?.orgId),
          () => listOrgMembers(),
          EMPTY_MEMBERS as never
        );
        safePrefetch(
          queryClient,
          roleTemplateKeys.list(),
          listRoleTemplates,
          EMPTY_ROLE_TEMPLATES as never
        );
      }
      if (can(P.UsersBlacklist)) {
        safePrefetch(
          queryClient,
          userBlacklistKeys.list(),
          listUserBlacklist,
          EMPTY_BLACKLIST as never
        );
      }
      return;

    case '/admin/tax-settings':
      if (!can(P.TaxManage) || user?.parkLocked === true) return;
      safePrefetch(queryClient, taxSettingsKeys.admin, getAdminTaxSettings);
      return;

    case '/admin/accounting':
      if (!(can(P.AccountingRead) || can(P.AccountingManage))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.settings(), getAccountingSettings);
      {
        const range = accountingDashboardDefaultRange();
        const dashFilters = {
          from: range.from,
          to: range.to,
          locationId: null as string | null,
        };
        safePrefetch(queryClient, accountingKeys.dashboard(dashFilters), () =>
          getAccountingDashboard(dashFilters)
        );
      }
      return;

    case '/admin/accounting/settings':
      if (!(can(P.AccountingRead) || can(P.AccountingManage))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.settings(), getAccountingSettings);
      return;

    case '/admin/accounting/setup':
      if (!can(P.AccountingManage)) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.settings(), getAccountingSettings);
      safePrefetch(
        queryClient,
        accountingKeys.setupPreview(),
        getAccountingSetupPreview
      );
      return;

    case '/admin/accounting/chart-of-accounts':
      if (!(can(P.AccountingRead) || can(P.AccountingManage))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.accounts(), () =>
        listAccountingAccounts()
      );
      return;

    case '/admin/accounting/mappings':
      if (!(can(P.AccountingRead) || can(P.AccountingManage))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      // Empty key matches AccountingMappingsPage default (location is client-side).
      safePrefetch(queryClient, accountingKeys.mappings(), () =>
        getAccountingMappings()
      );
      // Warm chart so AccountPicker opens without a cold fetch.
      safePrefetch(queryClient, accountingKeys.accounts(), () =>
        listAccountingAccounts()
      );
      return;

    case '/admin/accounting/tax-codes':
      if (!(can(P.AccountingRead) || can(P.AccountingManage))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      // Match AccountingTaxCodesPage default filters for split-second open.
      safePrefetch(queryClient, accountingKeys.taxCodes({ includeInactive: true }), () =>
        listAccountingTaxCodes({ includeInactive: true })
      );
      safePrefetch(queryClient, accountingKeys.accounts(), () =>
        listAccountingAccounts()
      );
      return;

    case '/admin/accounting/periods':
      if (!(can(P.AccountingRead) || can(P.AccountingManage))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.periods(), () =>
        listAccountingPeriods()
      );
      return;

    case '/admin/accounting/opening-balances':
      if (!can(P.AccountingManage)) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      // Keys match OpeningBalancesPage (empty accounts filter; postable filtered client-side).
      safePrefetch(queryClient, accountingKeys.openingBalances(), getOpeningBalances);
      safePrefetch(queryClient, accountingKeys.accounts(), () =>
        listAccountingAccounts()
      );
      safePrefetch(queryClient, accountingKeys.suppliers({}), () =>
        listAccountingSuppliers({})
      );
      return;

    case '/admin/accounting/bank-accounts':
      if (
        !(
          can(P.AccountingBankingRead) ||
          can(P.AccountingManage) ||
          can(P.AccountingRead)
        )
      ) {
        return;
      }
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.settings(), getAccountingSettings);
      // Match BankAccountsPage list key ({ includeArchived: true }) for instant desk open.
      safePrefetch(
        queryClient,
        accountingKeys.bankAccounts({ includeArchived: true }),
        () => listBankAccounts({ includeArchived: true })
      );
      return;

    case '/admin/accounting/expense-categories':
      if (
        !(
          can(P.AccountingRead) ||
          can(P.AccountingManage) ||
          can(P.AccountingExpensesSubmit)
        )
      ) {
        return;
      }
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.settings(), getAccountingSettings);
      safePrefetch(
        queryClient,
        accountingKeys.expenseCategories({ includeInactive: true }),
        () => listExpenseCategories({ includeInactive: true })
      );
      safePrefetch(queryClient, accountingKeys.accounts(), () =>
        listAccountingAccounts()
      );
      safePrefetch(queryClient, accountingKeys.taxCodes({}), () =>
        listAccountingTaxCodes({})
      );
      return;

    case '/admin/accounting/approvals':
      if (
        !(
          can(P.AccountingJournalsApprove) ||
          can(P.AccountingPayablesApprove) ||
          can(P.AccountingExpensesApprove) ||
          can(P.AccountingRead)
        )
      ) {
        return;
      }
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.approvals({}), () =>
        listAccountingApprovals({})
      );
      safePrefetch(queryClient, accountingKeys.settings(), getAccountingSettings);
      return;

    case '/admin/accounting/ledger':
      if (!(can(P.AccountingRead) || can(P.AccountingManage))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      // Ledger requires accountId — warm settings + chart so the picker opens fast.
      safePrefetch(queryClient, accountingKeys.settings(), getAccountingSettings);
      safePrefetch(
        queryClient,
        accountingKeys.accounts({ includeArchived: true }),
        () => listAccountingAccounts({ includeArchived: true })
      );
      return;

    case '/admin/accounting/journals':
      if (!(can(P.AccountingRead) || can(P.AccountingManage))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.journals({}), () =>
        listAccountingJournals({})
      );
      return;

    case '/admin/accounting/journals/new':
      if (!(can(P.AccountingJournalsWrite) || can(P.AccountingManage))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.settings(), getAccountingSettings);
      safePrefetch(queryClient, accountingKeys.journals({}), () =>
        listAccountingJournals({})
      );
      return;

    case '/admin/accounting/customers':
      if (!(can(P.AccountingReceivablesRead) || can(P.AccountingRead))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.customers({}), () =>
        listAccountingCustomers({})
      );
      return;

    case '/admin/accounting/invoices':
      if (!(can(P.AccountingReceivablesRead) || can(P.AccountingRead))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.invoices({}), () =>
        listAccountingInvoices({})
      );
      return;

    case '/admin/accounting/invoices/new':
      if (!(can(P.AccountingReceivablesWrite) || can(P.AccountingManage))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      // Form deps first — settings, locations, revenue accounts, tax codes.
      safePrefetch(queryClient, accountingKeys.settings(), getAccountingSettings);
      safePrefetch(queryClient, accountingKeys.lookups(), getAccountingLookups);
      safePrefetch(queryClient, accountingKeys.accounts(), () =>
        listAccountingAccounts()
      );
      safePrefetch(queryClient, accountingKeys.taxCodes({}), () =>
        listAccountingTaxCodes({})
      );
      safePrefetch(queryClient, accountingKeys.customers({}), () =>
        listAccountingCustomers({})
      );
      safePrefetch(queryClient, accountingKeys.invoices({}), () =>
        listAccountingInvoices({})
      );
      return;

    case '/admin/accounting/receipts':
      if (!(can(P.AccountingReceivablesRead) || can(P.AccountingRead))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.settings(), getAccountingSettings);
      safePrefetch(queryClient, accountingKeys.receipts({}), () =>
        listAccountingReceipts({})
      );
      // Warm Record-receipt form deps while the list is open.
      if (can(P.AccountingReceivablesWrite) || can(P.AccountingManage)) {
        safePrefetch(queryClient, accountingKeys.lookups(), getAccountingLookups);
        safePrefetch(queryClient, accountingKeys.bankAccounts(), () =>
          listBankAccounts()
        );
      }
      return;

    case '/admin/accounting/receipts/new':
      if (!(can(P.AccountingReceivablesWrite) || can(P.AccountingManage))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.settings(), getAccountingSettings);
      safePrefetch(queryClient, accountingKeys.lookups(), getAccountingLookups);
      safePrefetch(queryClient, accountingKeys.bankAccounts(), () =>
        listBankAccounts()
      );
      safePrefetch(queryClient, accountingKeys.receipts({}), () =>
        listAccountingReceipts({})
      );
      return;

    case '/admin/accounting/suppliers':
      if (!(can(P.AccountingPayablesRead) || can(P.AccountingRead))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.settings(), getAccountingSettings);
      // Default list filter is Active — warm that key for instant desk open.
      safePrefetch(
        queryClient,
        accountingKeys.suppliers({ active: "true" }),
        () => listAccountingSuppliers({ active: "true" })
      );
      safePrefetch(queryClient, accountingKeys.suppliers({}), () =>
        listAccountingSuppliers({})
      );
      // Warm New-supplier form deps while the list is open.
      if (can(P.AccountingPayablesWrite) || can(P.AccountingManage)) {
        safePrefetch(queryClient, accountingKeys.lookups(), getAccountingLookups);
        safePrefetch(queryClient, accountingKeys.accounts(), () =>
          listAccountingAccounts()
        );
        safePrefetch(queryClient, accountingKeys.taxCodes({}), () =>
          listAccountingTaxCodes({})
        );
      }
      return;

    case '/admin/accounting/purchase-orders':
      if (!(can(P.AccountingPayablesRead) || can(P.AccountingRead))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.settings(), getAccountingSettings);
      safePrefetch(queryClient, accountingKeys.purchaseOrders({}), () =>
        listPurchaseOrders({})
      );
      // Warm New-PO form deps while the list is open.
      if (can(P.AccountingPayablesWrite) || can(P.AccountingManage)) {
        safePrefetch(
          queryClient,
          accountingKeys.suppliers({ active: "true" }),
          () => listAccountingSuppliers({ active: "true" })
        );
        safePrefetch(queryClient, accountingKeys.lookups(), getAccountingLookups);
        safePrefetch(queryClient, accountingKeys.taxCodes({}), () =>
          listAccountingTaxCodes({})
        );
      }
      return;

    case '/admin/accounting/purchase-orders/new':
      if (!(can(P.AccountingPayablesWrite) || can(P.AccountingManage))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.settings(), getAccountingSettings);
      safePrefetch(queryClient, accountingKeys.lookups(), getAccountingLookups);
      safePrefetch(queryClient, accountingKeys.taxCodes({}), () =>
        listAccountingTaxCodes({})
      );
      safePrefetch(queryClient, accountingKeys.purchaseOrders({}), () =>
        listPurchaseOrders({})
      );
      safePrefetch(
        queryClient,
        accountingKeys.suppliers({ active: "true" }),
        () => listAccountingSuppliers({ active: "true" })
      );
      safePrefetch(queryClient, accountingKeys.suppliers({}), () =>
        listAccountingSuppliers({})
      );
      return;

    case '/admin/accounting/bills':
      if (!(can(P.AccountingPayablesRead) || can(P.AccountingRead))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.settings(), getAccountingSettings);
      safePrefetch(queryClient, accountingKeys.bills({}), () =>
        listAccountingBills({})
      );
      // Warm New-bill form deps while the list is open.
      if (can(P.AccountingPayablesWrite) || can(P.AccountingManage)) {
        safePrefetch(
          queryClient,
          accountingKeys.suppliers({ active: "true" }),
          () => listAccountingSuppliers({ active: "true" })
        );
        safePrefetch(queryClient, accountingKeys.lookups(), getAccountingLookups);
        safePrefetch(queryClient, accountingKeys.taxCodes({}), () =>
          listAccountingTaxCodes({})
        );
      }
      return;

    case '/admin/accounting/supplier-payments':
      if (!(can(P.AccountingPayablesRead) || can(P.AccountingRead))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.supplierPayments({}), () =>
        listSupplierPayments({})
      );
      safePrefetch(queryClient, accountingKeys.settings(), getAccountingSettings);
      return;

    case '/admin/accounting/supplier-payments/new':
      if (!(can(P.AccountingPayablesWrite) || can(P.AccountingManage))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.settings(), getAccountingSettings);
      safePrefetch(queryClient, accountingKeys.supplierPayments({}), () =>
        listSupplierPayments({})
      );
      safePrefetch(queryClient, accountingKeys.bankAccounts(), () =>
        listBankAccounts()
      );
      safePrefetch(
        queryClient,
        accountingKeys.suppliers({ active: "true" }),
        () => listAccountingSuppliers({ active: "true" })
      );
      return;

    case '/admin/accounting/expenses':
      if (
        !(
          can(P.AccountingRead) ||
          can(P.AccountingExpensesRead) ||
          can(P.AccountingExpensesSubmit) ||
          can(P.AccountingExpensesApprove)
        )
      ) {
        return;
      }
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.settings(), getAccountingSettings);
      safePrefetch(queryClient, accountingKeys.expenses({}), () =>
        listAccountingExpenses({})
      );
      safePrefetch(queryClient, accountingKeys.expenses({ mine: "1" }), () =>
        listAccountingExpenses({ mine: "1" })
      );
      if (can(P.AccountingExpensesApprove) || can(P.AccountingManage)) {
        safePrefetch(
          queryClient,
          accountingKeys.expenses({ status: "submitted" }),
          () => listAccountingExpenses({ status: "submitted" })
        );
      }
      return;

    case '/admin/accounting/expenses/new':
      if (
        !(
          can(P.AccountingExpensesSubmit) ||
          can(P.AccountingExpensesWrite) ||
          can(P.AccountingManage)
        )
      ) {
        return;
      }
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.settings(), getAccountingSettings);
      safePrefetch(queryClient, accountingKeys.expenseCategories({}), () =>
        listExpenseCategories({})
      );
      safePrefetch(queryClient, accountingKeys.bankAccounts(), () =>
        listBankAccounts()
      );
      safePrefetch(queryClient, accountingKeys.lookups(), getAccountingLookups);
      safePrefetch(queryClient, accountingKeys.taxCodes({}), () =>
        listAccountingTaxCodes({})
      );
      safePrefetch(
        queryClient,
        accountingKeys.suppliers({ active: "true" }),
        () => listAccountingSuppliers({ active: "true" })
      );
      return;

    case '/admin/accounting/bills/new':
      if (!(can(P.AccountingPayablesWrite) || can(P.AccountingManage))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.settings(), getAccountingSettings);
      safePrefetch(queryClient, accountingKeys.lookups(), getAccountingLookups);
      safePrefetch(queryClient, accountingKeys.taxCodes({}), () =>
        listAccountingTaxCodes({})
      );
      safePrefetch(
        queryClient,
        accountingKeys.suppliers({ active: "true" }),
        () => listAccountingSuppliers({ active: "true" })
      );
      safePrefetch(queryClient, accountingKeys.suppliers({}), () =>
        listAccountingSuppliers({})
      );
      safePrefetch(queryClient, accountingKeys.bills({}), () =>
        listAccountingBills({})
      );
      return;

    case '/admin/accounting/suppliers/new':
      if (!(can(P.AccountingPayablesWrite) || can(P.AccountingManage))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.settings(), getAccountingSettings);
      safePrefetch(queryClient, accountingKeys.lookups(), getAccountingLookups);
      safePrefetch(queryClient, accountingKeys.accounts(), () =>
        listAccountingAccounts()
      );
      safePrefetch(queryClient, accountingKeys.taxCodes({}), () =>
        listAccountingTaxCodes({})
      );
      return;

    case '/admin/accounting/banking':
      if (
        !(
          can(P.AccountingBankingRead) ||
          can(P.AccountingManage) ||
          can(P.AccountingRead)
        )
      ) {
        return;
      }
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.settings(), getAccountingSettings);
      safePrefetch(queryClient, accountingKeys.bankAccounts({}), () =>
        listBankAccounts({})
      );
      return;

    case '/admin/accounting/transfers':
      if (
        !(
          can(P.AccountingBankingRead) ||
          can(P.AccountingManage) ||
          can(P.AccountingRead)
        )
      ) {
        return;
      }
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      // List only — bank accounts warm when New transfer opens (avoid mount stampede).
      safePrefetch(queryClient, accountingKeys.settings(), getAccountingSettings);
      safePrefetch(queryClient, accountingKeys.transfers({}), () =>
        listBankTransfers({})
      );
      return;

    case '/admin/accounting/reconciliations':
      if (
        !(
          can(P.AccountingBankingRead) ||
          can(P.AccountingManage) ||
          can(P.AccountingRead)
        )
      ) {
        return;
      }
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      // List only — bank accounts warm when Start reconciliation opens.
      safePrefetch(queryClient, accountingKeys.settings(), getAccountingSettings);
      safePrefetch(queryClient, accountingKeys.reconciliations({}), () =>
        listReconciliations({})
      );
      return;

    case '/admin/accounting/reports':
      if (!(can(P.AccountingReportsRead) || can(P.AccountingRead))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.reports(), listAccountingReports);
      return;

    case '/admin/accounting/posting-queue':
      if (!(can(P.AccountingRead) || can(P.AccountingManage))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.postingQueue({ status: 'failed' }), () =>
        listPostingQueue({ status: 'failed' })
      );
      return;

    case '/admin/accounting/audit': {
      if (!(can(P.AccountingAuditRead) || can(P.AccountingManage) || can(P.AccountingRead)))
        return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      // Match AccountingAuditPage initial filters for split-second desk open.
      const auditFilters = accountingAuditDefaultFilters();
      safePrefetch(queryClient, accountingKeys.audit(auditFilters), () =>
        getAccountingAudit(auditFilters)
      );
      return;
    }

    case '/admin/accounting/tax': {
      if (
        !(
          can(P.AccountingReportsRead) ||
          can(P.AccountingRead) ||
          can(P.AccountingManage)
        )
      ) {
        return;
      }
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      // Match AccountingTaxPage default period (month-to-date) for instant open.
      const now = new Date();
      const to = now.toISOString().slice(0, 10);
      const from = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .slice(0, 10);
      const taxFilters = { from, to };
      safePrefetch(
        queryClient,
        accountingKeys.report("tax-summary", taxFilters),
        () => getAccountingReport("tax-summary", taxFilters)
      );
      safePrefetch(queryClient, accountingKeys.taxCodes({ includeInactive: true }), () =>
        listAccountingTaxCodes({ includeInactive: true })
      );
      return;
    }

    case '/admin/accounting/inventory':
      if (!(can(P.AccountingInventoryRead) || can(P.AccountingRead))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.inventory({}), () =>
        getInventoryValuation({})
      );
      return;

    case '/admin/accounting/inventory/movements':
      if (!(can(P.AccountingInventoryRead) || can(P.AccountingRead))) return;
      if (isStorefrontOrgSession(user) && !isPlatformAdminActor(user)) return;
      safePrefetch(queryClient, accountingKeys.inventoryMovements({}), () =>
        listInventoryMovements({})
      );
      return;

    case '/admin/company-profile':
      if (!can(P.SettingsManage) || user?.parkLocked === true) return;
      safePrefetch(
        queryClient,
        companyProfileKeys.admin(user?.orgId ?? null),
        getAdminCompanyProfile
      );
      return;

    case '/admin/venues':
      if (
        !(
          can(P.VenuesRead) ||
          can(P.VenuesWrite) ||
          can(P.SettingsManage)
        )
      ) {
        return;
      }
      // Registered company OR platform Super admin on storefront host.
      if (
        isStorefrontOrgSession(user) &&
        !isPlatformSoftwareOwner(user)
      ) {
        return;
      }
      if (can(P.SettingsManage) || can(P.VenuesWrite) || can(P.AnalyticsRead)) {
        safePrefetch(
          queryClient,
          billingKeys.usage(user?.orgId ?? null),
          getBillingUsage
        );
      }
      // Parallel warm — VenuesPage reads company-wide list immediately.
      safePrefetch(
        queryClient,
        venueLocationKeys.list('all'),
        () => listAdminVenueLocations({ scope: 'all' }),
        []
      );
      if (user?.enterpriseHqEnabled === true) {
        safePrefetch(
          queryClient,
          hqKeys.locationContext(),
          getAdminHqLocationContext
        );
      } else if (user?.parkLocked === true || user?.companyWideView !== false) {
        safePrefetch(
          queryClient,
          parkContextKeys.context(),
          getAdminParkContext
        );
      }
      return;

    case '/admin/hq':
      if (!can(P.SettingsManage) || user?.parkLocked === true) return;
      // Project owner may warm HQ on the storefront host for QA.
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      if (
        user?.enterpriseHqEnabled !== true &&
        !isPlatformSoftwareOwner(user)
      ) {
        return;
      }
      safePrefetch(
        queryClient,
        venueLocationKeys.list('all'),
        () => listAdminVenueLocations({ scope: 'all' }),
        []
      );
      // Prefetch context, then overview under the matching scope key.
      void queryClient
        .prefetchQuery({
          queryKey: hqKeys.locationContext(),
          queryFn: getAdminHqLocationContext,
          staleTime: ADMIN_LIST_STALE_MS,
          meta: { suppressErrorBanner: true },
        })
        .then(() => {
          const ctx = queryClient.getQueryData<HqLocationContextDto>(
            hqKeys.locationContext()
          );
          const locId = ctx?.locationId ?? null;
          safePrefetch(
            queryClient,
            hqKeys.overview(locId),
            getAdminHqOverview
          );
        });
      return;

    case '/admin/billing':
      if (!can(P.SettingsManage) || user?.parkLocked === true) return;
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(
        queryClient,
        billingKeys.plans(user?.orgId ?? null),
        getBillingPlans
      );
      safePrefetch(
        queryClient,
        billingKeys.state(user?.orgId ?? null),
        getBillingState
      );
      safePrefetch(
        queryClient,
        billingKeys.usage(user?.orgId ?? null),
        getBillingUsage
      );
      return;

    case '/admin/payouts':
      if (user?.parkLocked === true) return;
      if (!can(P.SettingsManage) && !can(P.AnalyticsRead)) return;
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      // Marketplace account load is page-local (api()); warm plan meters for parity
      // with Billing / Booking packages soft-gates.
      safePrefetch(
        queryClient,
        billingKeys.usage(user?.orgId ?? null),
        getBillingUsage
      );
      return;

    case '/admin/booking-packages':
      if (
        !can(P.BookingPackagesManage) &&
        !can(P.MarketplaceRefunds)
      ) {
        return;
      }
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      if (can(P.BookingPackagesManage)) {
        safePrefetch(
          queryClient,
          billingKeys.usage(user?.orgId ?? null),
          getBillingUsage
        );
      }
      return;

    case '/admin/shipping-settings':
      if (!can(P.SettingsManage) || user?.parkLocked === true) return;
      safePrefetch(
        queryClient,
        shippingSettingsKeys.admin,
        getAdminShippingSettings
      );
      return;

    case '/admin/homepage-content':
      if (!can(P.SettingsManage)) return;
      safePrefetch(
        queryClient,
        homepageContentKeys.admin,
        getAdminHomepageSections
      );
      return;

    case '/admin/ad-banners':
      if (!can(P.SettingsManage)) return;
      safePrefetch(queryClient, adBannerKeys.admin, getAdminAdBanners);
      return;

    case '/admin/tailors':
      if (!can(P.TailorsRead)) return;
      safePrefetch(
        queryClient,
        tailorKeys.admin(user?.orgId ?? null, '', ''),
        () => getAdminTailors({}),
        []
      );
      return;

    case '/admin/tailoring-jobs':
      if (!can(P.TailoringJobsRead)) return;
      safePrefetch(
        queryClient,
        jobKeys.admin('', ''),
        () => getAdminTailoringJobs({}),
        []
      );
      return;

    case '/admin/deliveries':
      if (!can(P.DeliveriesRead)) return;
      safePrefetch(
        queryClient,
        shipmentKeys.list({ page: 1, limit: 100 }),
        () => listShipments({ page: 1, limit: 100 }),
        { items: [], total: 0, page: 1, limit: 100 }
      );
      return;

    case '/admin/reviews':
      // Light pages — Next.js route prefetch from the sidebar is enough.
      return;

    case '/admin/bookings':
    case '/admin/bookings/calendar':
      if (!can(P.BookingsRead)) return;
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(
        queryClient,
        adminBookingKeys.list({ ...DEFAULT_ADMIN_BOOKINGS_PAGE }),
        () => listAdminBookings({ ...DEFAULT_ADMIN_BOOKINGS_PAGE }),
        { bookings: [], total: 0, take: 50, skip: 0 }
      );
      safePrefetch(
        queryClient,
        venueLocationKeys.list('all'),
        () => listAdminVenueLocations({ scope: 'all' }),
        []
      );
      if (user?.enterpriseHqEnabled === true) {
        safePrefetch(
          queryClient,
          hqKeys.locationContext(),
          getAdminHqLocationContext
        );
      } else if (user?.parkLocked === true || user?.companyWideView !== false) {
        safePrefetch(
          queryClient,
          parkContextKeys.context(),
          getAdminParkContext
        );
      }
      return;

    case '/admin/bookings/new':
      if (!(can(P.BookingsCreate) || can(P.BookingsWrite))) return;
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(
        queryClient,
        venueLocationKeys.list('all'),
        () => listAdminVenueLocations({ scope: 'all' }),
        []
      );
      if (can(P.BookingAccountsRead)) {
        safePrefetch(
          queryClient,
          bookingAccountKeys.list(),
          listBookingAccounts
        );
      }
      // First wizard steps need venues (+ products once a park is known).
      // Warm the shared product catalog so Product & session paints from cache.
      if (
        can(P.TicketingRead) ||
        can(P.BookingsWrite) ||
        can(P.BookingsCreate)
      ) {
        safePrefetch(
          queryClient,
          ticketingKeys.products({ includeArchived: false }),
          () => listTicketingProducts({ includeArchived: false })
        );
      }
      return;

    case '/admin/parties/packages':
    case '/admin/parties/packages/new':
      if (!can(P.PartiesRead)) return;
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(
        queryClient,
        adminPartyKeys.packages({ status: 'all' }),
        () => listAdminPartyPackages({ status: 'all' }),
        []
      );
      safePrefetch(queryClient, adminPartyKeys.rooms({}), () => listAdminPartyRooms({}), []);
      safePrefetch(
        queryClient,
        venueLocationKeys.list('all'),
        () => listAdminVenueLocations({ scope: 'all' }),
        []
      );
      return;

    case '/admin/parties/rooms':
      if (!can(P.PartiesRead)) return;
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(
        queryClient,
        adminPartyKeys.rooms({ includeArchived: true }),
        () => listAdminPartyRooms({ includeArchived: true }),
        []
      );
      return;

    case '/admin/parties/menu':
      if (!can(P.PartiesRead)) return;
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(
        queryClient,
        adminPartyKeys.menu({ includeArchived: true }),
        () => listAdminPartyMenu({ includeArchived: true }),
        []
      );
      return;

    case '/admin/parties/settings':
      if (!can(P.PartiesRead)) return;
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(queryClient, adminPartyKeys.settings(null), () => getAdminPartySettings(null));
      return;

    case '/admin/parties/run-sheets':
      if (!can(P.PartiesRead)) return;
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      {
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        safePrefetch(queryClient, adminPartyKeys.runSheets(today, undefined), () => listAdminPartyRunSheets(today, undefined), []);
      }
      return;

    case '/admin/parties/balances':
      if (!can(P.PartiesRead)) return;
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(
        queryClient,
        adminPartyKeys.balances({ take: 500 }),
        () => listAdminPartyBalances({ take: 500 })
      );
      return;

    case '/admin/parties/new':
      if (!can(P.PartiesWrite)) return;
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(
        queryClient,
        adminPartyKeys.packages({ status: 'published' }),
        () => listAdminPartyPackages({ status: 'published' }),
        []
      );
      return;

    case '/admin/parties':
      if (!can(P.PartiesRead)) return;
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      {
        const listFilters = { date: 'today', take: 25, skip: 0 };
        safePrefetch(
          queryClient,
          adminPartyKeys.list(listFilters),
          () => listAdminParties(listFilters),
          { parties: [], total: 0, take: 25, skip: 0, waiversEnabled: false }
        );
      }
      safePrefetch(
        queryClient,
        venueLocationKeys.list('all'),
        () => listAdminVenueLocations({ scope: 'all' }),
        []
      );
      return;

    case '/admin/booking-invoices':
      if (!can(P.BookingInvoicesRead)) return;
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(
        queryClient,
        adminInvoiceKeys.list(),
        () => listAdminBookingInvoices(),
        []
      );
      return;

    case '/admin/booking-payments':
      if (!can(P.BookingsPaymentsRead)) return;
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(
        queryClient,
        adminPaymentKeys.list({}),
        () => listAdminBookingPayments({}),
        []
      );
      safePrefetch(
        queryClient,
        venueLocationKeys.list('all'),
        () => listAdminVenueLocations({ scope: 'all' }),
        []
      );
      return;

    case '/admin/ticketing':
      if (!can(P.TicketingRead)) return;
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(
        queryClient,
        ticketingKeys.products({
          type: 'all',
          published: 'all',
          includeArchived: false,
        }),
        () =>
          listTicketingProducts({
            type: 'all',
            published: 'all',
            includeArchived: false,
          })
      );
      safePrefetch(
        queryClient,
        bookingCategoryKeys.list(false),
        () => listBookingCategories({ includeArchived: false }),
        []
      );
      safePrefetch(
        queryClient,
        venueLocationKeys.list('all'),
        () => listAdminVenueLocations({ scope: 'all' }),
        []
      );
      return;

    case '/admin/ticketing/categories':
      if (
        !(
          can(P.TicketingRead) ||
          can(P.TicketingProductsRead) ||
          can(P.TicketingWrite) ||
          can(P.TicketingProductsWrite)
        )
      ) {
        return;
      }
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(
        queryClient,
        bookingCategoryKeys.list(false),
        () => listBookingCategories({ includeArchived: false }),
        []
      );
      return;

    case '/admin/ticketing/add-ons':
      if (!can(P.TicketingRead)) return;
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(
        queryClient,
        ticketingKeys.products({ type: 'add_on', includeArchived: false }),
        () => listTicketingProducts({ type: 'add_on', includeArchived: false })
      );
      safePrefetch(
        queryClient,
        ticketingKeys.stockPeriods({}),
        () => listStockPeriods({})
      );
      safePrefetch(
        queryClient,
        venueLocationKeys.list('all'),
        () => listAdminVenueLocations({ scope: 'all' }),
        []
      );
      return;

    case '/admin/ticketing/passes':
      if (!can(P.TicketingRead)) return;
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(
        queryClient,
        ticketingKeys.products({ type: 'pass', includeArchived: false }),
        () => listTicketingProducts({ type: 'pass', includeArchived: false })
      );
      safePrefetch(
        queryClient,
        venueLocationKeys.list('all'),
        () => listAdminVenueLocations({ scope: 'all' }),
        []
      );
      return;

    case '/admin/ticketing/products/new':
      if (!can(P.TicketingWrite)) return;
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(
        queryClient,
        venueLocationKeys.list('all'),
        () => listAdminVenueLocations({ scope: 'all' }),
        []
      );
      safePrefetch(
        queryClient,
        bookingCategoryKeys.list(false),
        () => listBookingCategories({ includeArchived: false }),
        []
      );
      safePrefetch(
        queryClient,
        ticketingKeys.products({ type: 'add_on', includeArchived: false }),
        () => listTicketingProducts({ type: 'add_on', includeArchived: false })
      );
      return;

    case '/admin/ticketing/sessions':
      if (!can(P.TicketingRead)) return;
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      {
        const now = new Date();
        const from = new Date(now.getFullYear(), now.getMonth(), 1);
        const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        const monthFilters = {
          includeClosed: false as const,
          from: from.toISOString(),
          to: to.toISOString(),
        };
        safePrefetch(
          queryClient,
          ticketingKeys.sessions(monthFilters),
          () => listTicketSessions(monthFilters)
        );
      }
      safePrefetch(
        queryClient,
        ticketingKeys.products({ includeArchived: false }),
        () => listTicketingProducts({ includeArchived: false })
      );
      safePrefetch(
        queryClient,
        venueLocationKeys.list('all'),
        () => listAdminVenueLocations({ scope: 'all' }),
        []
      );
      return;

    case '/admin/ticketing/resources':
      if (!can(P.TicketingRead)) return;
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(
        queryClient,
        ticketingKeys.resources({ includeArchived: false }),
        () => listCapacityResources({ includeArchived: false })
      );
      safePrefetch(
        queryClient,
        venueLocationKeys.list('all'),
        () => listAdminVenueLocations({ scope: 'all' }),
        []
      );
      return;

    case '/admin/ticketing/settings':
      if (!can(P.TicketingRead) && !can(P.TicketingManage)) return;
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(
        queryClient,
        ticketingKeys.settings(null),
        () => getTicketingSettings(null)
      );
      safePrefetch(
        queryClient,
        venueLocationKeys.list('all'),
        () => listAdminVenueLocations({ scope: 'all' }),
        []
      );
      return;

    case '/admin/booking-accounts':
      if (!can(P.BookingAccountsRead)) return;
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(
        queryClient,
        bookingAccountKeys.list(),
        listBookingAccounts
      );
      return;

    case '/admin/memberships':
    case '/admin/memberships/plans': {
      if (
        !(
          can(P.MembershipsRead) ||
          can(P.MembershipsWrite) ||
          can(P.MembershipsSell) ||
          can(P.MembershipsBilling) ||
          can(P.MembershipsCancel) ||
          can(P.MembershipsRedeem) ||
          can(P.MembershipsAdmin)
        )
      ) {
        return;
      }
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(
        queryClient,
        membershipKeys.plans(false),
        () => listMembershipPlans({ includeArchived: false }),
        []
      );
      safePrefetch(
        queryClient,
        membershipKeys.categories(false),
        () => listMembershipCategories({ includeArchived: false }),
        []
      );
      // Add-ons product picker on Create plan — warm Online Booking catalog.
      if (
        can(P.TicketingRead) ||
        can(P.TicketingWrite) ||
        can(P.MembershipsWrite) ||
        can(P.MembershipsAdmin)
      ) {
        safePrefetch(
          queryClient,
          ticketingKeys.products({ includeArchived: false }),
          () => listTicketingProducts({ includeArchived: false }),
          []
        );
      }
      return;
    }

    case '/admin/memberships/categories': {
      if (
        !(
          can(P.MembershipsRead) ||
          can(P.MembershipsWrite) ||
          can(P.MembershipsSell) ||
          can(P.MembershipsBilling) ||
          can(P.MembershipsCancel) ||
          can(P.MembershipsRedeem) ||
          can(P.MembershipsAdmin)
        )
      ) {
        return;
      }
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(
        queryClient,
        membershipKeys.categories(false),
        () => listMembershipCategories({ includeArchived: false }),
        []
      );
      return;
    }

    case '/admin/memberships/members': {
      if (
        !(
          can(P.MembershipsRead) ||
          can(P.MembershipsWrite) ||
          can(P.MembershipsSell) ||
          can(P.MembershipsBilling) ||
          can(P.MembershipsCancel) ||
          can(P.MembershipsAdmin)
        )
      ) {
        return;
      }
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(
        queryClient,
        membershipKeys.members(''),
        () => listMembershipMembers(''),
        { members: [], note: '', nextCursor: null }
      );
      safePrefetch(
        queryClient,
        membershipKeys.guests(''),
        () => searchMembershipGuests(''),
        []
      );
      if (
        can(P.MembershipsSell) ||
        can(P.MembershipsBilling) ||
        can(P.MembershipsAdmin)
      ) {
        safePrefetch(
          queryClient,
          membershipKeys.plans(false),
          () => listMembershipPlans({ includeArchived: false }),
          []
        );
      }
      if (can(P.MembershipsSell) || can(P.MembershipsAdmin)) {
        safePrefetch(
          queryClient,
          ['admin', 'venue-locations', 'memberships-sell'],
          () => listAdminVenueLocations({ scope: 'all' }),
          []
        );
      }
      return;
    }

    case '/admin/memberships/redeem': {
      if (
        !(
          can(P.MembershipsRedeem) ||
          can(P.MembershipsAdmin) ||
          can(P.MembershipsRead) ||
          can(P.MembershipsWrite) ||
          can(P.MembershipsSell) ||
          can(P.MembershipsBilling) ||
          can(P.MembershipsCancel)
        )
      ) {
        return;
      }
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(
        queryClient,
        ['admin', 'venue-locations', 'memberships-redeem'],
        () => listAdminVenueLocations({ scope: 'all' }),
        []
      );
      return;
    }

    case '/admin/memberships/eligibility': {
      if (
        !(
          can(P.MembershipsRead) ||
          can(P.MembershipsWrite) ||
          can(P.MembershipsAdmin)
        )
      ) {
        return;
      }
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(
        queryClient,
        membershipKeys.plans(false),
        () => listMembershipPlans({ includeArchived: false }),
        []
      );
      safePrefetch(
        queryClient,
        venueLocationKeys.list('hq'),
        () => listAdminVenueLocations(),
        []
      );
      return;
    }

    case '/admin/memberships/settings': {
      if (
        !(
          can(P.MembershipsRead) ||
          can(P.MembershipsWrite) ||
          can(P.MembershipsAdmin)
        )
      ) {
        return;
      }
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      safePrefetch(
        queryClient,
        venueLocationKeys.list('hq'),
        () => listAdminVenueLocations(),
        []
      );
      safePrefetch(
        queryClient,
        membershipKeys.settings(null),
        () => getMembershipSettings(null)
      );
      return;
    }

    case '/admin/memberships/reports': {
      if (
        !(
          can(P.MembershipsRead) ||
          can(P.MembershipsWrite) ||
          can(P.MembershipsSell) ||
          can(P.MembershipsBilling) ||
          can(P.MembershipsCancel) ||
          can(P.MembershipsRedeem) ||
          can(P.MembershipsAdmin)
        )
      ) {
        return;
      }
      if (isStorefrontOrgSession(user) && !isPlatformSoftwareOwner(user)) return;
      {
        const today = new Date();
        const toDay = today.toISOString().slice(0, 10);
        const fromDay = new Date(today.getTime() - 30 * 86_400_000)
          .toISOString()
          .slice(0, 10);
        safePrefetch(
          queryClient,
          membershipP4Keys.reports(fromDay, toDay, '', false),
          () =>
            getMembershipReports({
              from: new Date(`${fromDay}T00:00:00.000Z`).toISOString(),
              to: new Date(`${toDay}T23:59:59.999Z`).toISOString(),
            })
        );
      }
      if (
        can(P.MembershipsBilling) ||
        can(P.MembershipsRead) ||
        can(P.MembershipsAdmin)
      ) {
        safePrefetch(
          queryClient,
          membershipP4Keys.dunningQueue(),
          getMembershipDunningQueue
        );
      }
      safePrefetch(
        queryClient,
        ['admin', 'venue-locations', 'memberships-reports'],
        () => listAdminVenueLocations({ scope: 'all' }),
        []
      );
      return;
    }

    case '/admin/waivers': {
      if (!can(P.WaiversRead)) return;
      safePrefetch(
        queryClient,
        waiverKeys.records('||||||||', ''),
        () => listWaiverRecords()
      );
      safePrefetch(
        queryClient,
        waiverKeys.templates('all'),
        () => listWaiverTemplates('all')
      );
      safePrefetch(
        queryClient,
        venueLocationKeys.list(),
        () => listAdminVenueLocations(),
        []
      );
      return;
    }
    case '/admin/waivers/verify': {
      if (!can(P.WaiversVerify) && !can(P.WaiversRead)) return;
      safePrefetch(
        queryClient,
        waiverKeys.templates('documents'),
        () => listWaiverTemplates('documents')
      );
      safePrefetch(
        queryClient,
        venueLocationKeys.list(),
        () => listAdminVenueLocations(),
        []
      );
      return;
    }
    case '/admin/waivers/new': {
      if (!can(P.WaiversWrite)) return;
      safePrefetch(
        queryClient,
        waiverKeys.templates('published-sign'),
        () => listWaiverTemplates('all')
      );
      safePrefetch(
        queryClient,
        venueLocationKeys.list(),
        () => listAdminVenueLocations(),
        []
      );
      return;
    }
    case '/admin/waivers/templates': {
      if (!can(P.WaiversRead)) return;
      safePrefetch(
        queryClient,
        waiverKeys.templates('documents'),
        () => listWaiverTemplates('documents')
      );
      safePrefetch(
        queryClient,
        waiverKeys.requirements(),
        () => listWaiverRequirements()
      );
      safePrefetch(
        queryClient,
        venueLocationKeys.list(),
        () => listAdminVenueLocations(),
        []
      );
      return;
    }
    case '/admin/waivers/forms': {
      if (!can(P.WaiversRead)) return;
      safePrefetch(
        queryClient,
        waiverKeys.templates('all'),
        () => listWaiverTemplates('all')
      );
      // Membership plan “Waiver settings” deep-links here for Required before entry.
      // Desk panel keys include park scope (`all` or locationId).
      safePrefetch(
        queryClient,
        waiverKeys.requirements(),
        () => listWaiverRequirements()
      );
      safePrefetch(
        queryClient,
        [...waiverKeys.requirements(), 'all'],
        () => listWaiverRequirements()
      );
      return;
    }
    case '/admin/waivers/forms/responses': {
      if (!can(P.WaiversRead)) return;
      safePrefetch(queryClient, ['waiver-responses'], async () => {
        const raw = await api<MaybeWrapped<{ responses: unknown[] }>>(
          '/api/admin/waivers/responses',
          { method: 'GET', credentials: 'include' }
        );
        return unwrap(raw)?.responses ?? [];
      });
      return;
    }
    case '/admin/waivers/import':
    case '/admin/waivers/signage': {
      if (href.endsWith('/import') && !can(P.WaiversAdmin)) return;
      if (href.endsWith('/signage') && !can(P.WaiversWrite) && !can(P.WaiversRead)) return;
      if (href.endsWith('/signage')) {
        safePrefetch(
          queryClient,
          waiverKeys.templates('signage'),
          () => listWaiverTemplates('documents')
        );
      }
      safePrefetch(
        queryClient,
        venueLocationKeys.list(),
        () => listAdminVenueLocations(),
        []
      );
      return;
    }
    case '/admin/waivers/kiosk': {
      if (!can(P.WaiversAdmin)) return;
      safePrefetch(queryClient, waiverKeys.kiosks(), () => listKioskDevices());
      safePrefetch(
        queryClient,
        waiverKeys.templates('all-kiosk'),
        () => listWaiverTemplates('all')
      );
      safePrefetch(
        queryClient,
        venueLocationKeys.list(),
        () => listAdminVenueLocations(),
        []
      );
      return;
    }
    case '/admin/waivers/settings': {
      if (!can(P.WaiversAdmin)) return;
      safePrefetch(queryClient, waiverKeys.settings('org'), () =>
        getWaiverSettings(null)
      );
      safePrefetch(
        queryClient,
        venueLocationKeys.list(),
        () => listAdminVenueLocations(),
        []
      );
      return;
    }
    case '/admin/waivers/compliance': {
      if (!can(P.WaiversRead)) return;
      safePrefetch(queryClient, waiverKeys.guides(), () => listComplianceGuides());
      return;
    }

    case '/admin/marketing':
    case '/admin/marketing/newsletter':
    case '/admin/marketing/campaigns':
    case '/admin/marketing/automations':
    case '/admin/marketing/surveys':
    case '/admin/marketing/settings': {
      if (!can(P.MarketingRead) && !can(P.MarketingSurveys)) return;
      // Storefront never holds park marketing — skip API warm (gate paints instantly).
      if (isStorefrontOrgSession(user)) return;
      // Lazy-load client so hover warm does not bloat every admin prefetch chunk.
      void import('@/services/marketing').then((m) => {
        if (href === '/admin/marketing') {
          safePrefetch(
            queryClient,
            m.marketingKeys.overview('org'),
            () => m.getMarketingOverview(null)
          );
        } else if (href === '/admin/marketing/newsletter') {
          safePrefetch(queryClient, m.marketingKeys.leads(''), () =>
            m.listMarketingLeads()
          );
        } else if (href === '/admin/marketing/campaigns') {
          safePrefetch(queryClient, m.marketingKeys.campaigns(), () =>
            m.listMarketingCampaigns()
          );
        } else if (href === '/admin/marketing/automations') {
          safePrefetch(
            queryClient,
            m.marketingKeys.automations('org'),
            () => m.getMarketingAutomations(null)
          );
        } else if (href === '/admin/marketing/surveys') {
          safePrefetch(queryClient, m.marketingKeys.surveys(), () =>
            m.listMarketingSurveys()
          );
        } else if (href === '/admin/marketing/settings') {
          safePrefetch(
            queryClient,
            m.marketingKeys.settings('org'),
            () => m.getMarketingSettings(null)
          );
        }
      });
      return;
    }

    default:
      return;
  }
}

/** Prefetch every child under a nav group (Catalog, Operations, …). */
export function prefetchAdminRoutes(
  queryClient: QueryClient,
  hrefs: string[],
  can: CanFn,
  user?: Pick<
    UserProfile,
    'orgId' | 'storefrontOrgId' | 'preset' | 'membershipRole' | 'enterpriseHqEnabled'
  > | null
) {
  for (const href of hrefs) {
    prefetchAdminRoute(queryClient, href, can, user);
  }
}

/**
 * After session sync: warm the *current* route only (+ header notifications).
 * Full catalog/users/settings lists stay on sidebar hover prefetch so first
 * paint is not fighting 10+ background GETs.
 */
export function warmAdminShellCaches(
  queryClient: QueryClient,
  can: CanFn,
  pathname: string = '/admin',
  user?: Pick<
    UserProfile,
    'orgId' | 'storefrontOrgId' | 'preset' | 'membershipRole' | 'enterpriseHqEnabled'
  > | null
): () => void {
  const currentHref = adminWarmHrefFromPathname(pathname);
  const bookingSurface = isOnlineBookingNavPath(pathname);

  // Localhost: leaf useQuery already fetches — skip idle warm stampede.
  // (Registered-companies used to be excepted and dual-prefetched pending+active.)
  if (process.env.NODE_ENV === "development") {
    return () => {};
  }

  // Dashboard: defer notifications only — analytics must own the pool first.
  // Do not idle-warm other admin lists while metrics are loading.
  if (currentHref === '/admin') {
    // Notifications are low priority; under compile pressure they hit the
    // 25s client timeout and spam the console (see terminal log).
    const noteTimer = globalThis.setTimeout(() => {
      void queryClient.prefetchQuery({
        queryKey: notificationKeys.mine(),
        queryFn: getMyNotifications,
        staleTime: ADMIN_NOTIFICATIONS_LIVE_MS,
        meta: { suppressErrorBanner: true },
      });
    }, 12_000);
    return () => globalThis.clearTimeout(noteTimer);
  }

  // Warm only the route the operator is on. Idle-warming Products/Orders/…
  // stampeded the webpack compiler (60–120s), timed out auth refresh, logged
  // people out, and tripped the memory restart. Hover/click still prefetches.
  // Skip notification prefetch here — Header loads it lazily; racing compile
  // caused repeated 25s timeouts in the terminal.
  if (bookingSurface || currentHref !== '/admin') {
    prefetchAdminRoute(queryClient, currentHref, can, user);
  }

  if (
    bookingSurface &&
    (currentHref === '/admin/bookings' ||
      currentHref === '/admin/bookings/calendar' ||
      currentHref === '/admin/parties')
  ) {
    // Next click from booking list surfaces only — not the whole sidebar tree.
    const t = globalThis.setTimeout(() => {
      prefetchAdminRoute(queryClient, '/admin/bookings/new', can, user);
    }, 2000);
    return () => globalThis.clearTimeout(t);
  }

  return () => {};
}
