// Dashboard service - transforms real data for dashboard components
import { getOrders, getOrderCustomerName } from './order';
import { adminGetProducts } from './products';
import { formatPrice } from '@/utils/currency';
import {
  Product,
  Transaction,
  Order,
  ChartData,
  MetricChangeType,
  type DashboardOrderStatus,
} from '../components/Protected/admin/pages/types/dashboard';
import { weekOverWeekChange, formatCompact } from './analytics';

/** Map store order.status → dashboard badge label (must stay in sync with Orders tabs). */
export function mapOrderStatusToDashboard(
  rawStatus: unknown
): DashboardOrderStatus {
  const normalized =
    typeof rawStatus === 'string' ? rawStatus.toLowerCase().trim() : '';

  switch (normalized) {
    case 'pending':
      return 'Pending';
    case 'initiated':
      return 'Initiated';
    case 'paid':
      return 'Paid';
    case 'shipped':
    case 'shipping':
      return 'Shipped';
    case 'delivered':
    case 'completed':
      return 'Delivered';
    case 'cancelled':
    case 'canceled':
      return 'Cancelled';
    case 'processing':
      return 'Processing';
    default:
      return 'Pending';
  }
}

// Transform orders to recent orders format
export function transformOrdersToRecent(orders: any[]): Order[] {
  if (!Array.isArray(orders) || orders.length === 0) {
    return [];
  }

  return orders
    .filter(order => order && order._id && order.createdAt)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5)
    .map(order => {
      const customerName = getOrderCustomerName(order.user);

      return {
        id: order._id,
        customer: customerName === 'Unknown' ? 'Unknown Customer' : customerName,
        status: mapOrderStatusToDashboard(order.status),
        amount: formatPrice(Number(order.amount || order.total || 0))
      };
    });
}

// Transform orders to transactions format
export function transformOrdersToTransactions(orders: any[]): Transaction[] {
  if (!Array.isArray(orders) || orders.length === 0) {
    return [];
  }

  return orders
    .filter(order => order && order._id && order.createdAt)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6)
    .map(order => {
      const createdDate = new Date(order.createdAt);
      const issuedDate = !isNaN(createdDate.getTime()) 
        ? createdDate.toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
          })
        : 'Unknown Date';

      return {
        id: order._id,
        issuedDate,
        total: formatPrice(Number(order.amount || order.total || 0)),
        status: order.status || 'pending'
      };
    });
}

// Transform products to popular products format
export function transformProductsToPopular(products: any[]): Product[] {
  if (!Array.isArray(products) || products.length === 0) {
    return [];
  }

  return products
    .filter(product => product && product._id && product.name)
    .slice(0, 6)
    .map(product => {
      const itemCode = product._id 
        ? `#${product._id.slice(-8).toUpperCase()}`
        : '#UNKNOWN';

      const price = Number(product.price || 0);
      const priceFormatted = formatPrice(price);

      // Handle image - could be array or single string
      let image = undefined;
      if (product.images && Array.isArray(product.images) && product.images.length > 0) {
        image = product.images[0];
      } else if (product.image) {
        image = product.image;
      } else if (product.imageUrl) {
        image = product.imageUrl;
      }

      return {
        id: product._id,
        name: product.name,
        itemCode,
        price: priceFormatted,
        image
      };
    });
}

// Transform orders to chart data format
export function transformOrdersToChart(orders: any[]): {
  chartData: ChartData[];
  totalOrders: string;
  changePercentage: string;
  changeType: MetricChangeType;
} {
  const emptyDays = (): ChartData[] => {
    const days: ChartData[] = [];
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (let i = 6; i >= 0; i--) {
      const day = new Date(today);
      day.setUTCDate(today.getUTCDate() - i);
      days.push({
        day: day.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
        orders: 0,
      });
    }
    return days;
  };

  if (!Array.isArray(orders)) {
    const change = weekOverWeekChange(0, 0);
    return {
      chartData: emptyDays(),
      totalOrders: "0",
      changePercentage: change.label,
      changeType: change.changeType,
    };
  }

  const startOfUtcDay = (d: Date) =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

  const today = startOfUtcDay(new Date());
  const sevenDaysAgo = today - 6 * 24 * 60 * 60 * 1000;
  const fourteenDaysAgo = today - 13 * 24 * 60 * 60 * 1000;

  const counted = orders.filter((order) => {
    if (!order?.createdAt || order.status === 'cancelled') return false;
    const orderDate = new Date(order.createdAt);
    return !isNaN(orderDate.getTime());
  });

  const inWindow = (from: number, to: number) =>
    counted.filter((order) => {
      const t = startOfUtcDay(new Date(order.createdAt));
      return t >= from && t <= to;
    });

  const currentWeek = inWindow(sevenDaysAgo, today);
  const previousWeek = inWindow(fourteenDaysAgo, sevenDaysAgo - 24 * 60 * 60 * 1000);

  const dailyData: Record<string, number> = {};
  currentWeek.forEach((order) => {
    const key = new Date(order.createdAt).toISOString().slice(0, 10);
    dailyData[key] = (dailyData[key] || 0) + 1;
  });

  const chartData: ChartData[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(today);
    day.setUTCDate(new Date(today).getUTCDate() - i);
    const key = day.toISOString().slice(0, 10);
    chartData.push({
      day: day.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
      orders: dailyData[key] || 0,
    });
  }

  const change = weekOverWeekChange(currentWeek.length, previousWeek.length);

  return {
    chartData,
    totalOrders: formatCompact(currentWeek.length),
    changePercentage: change.label,
    changeType: change.changeType,
  };
}

// Main dashboard data fetcher.
// Step 6.3 / RBAC: only call domain APIs the actor can read (API is source of truth;
// skip avoids noisy 403s when analytics:read is held without products/orders:read).
// Orders/products lists remain actor.orgId-scoped in those APIs (Step 5.3).
export type DashboardDataOptions = {
  includeOrders?: boolean;
  includeProducts?: boolean;
};

export async function getDashboardData(options: DashboardDataOptions = {}) {
  // Opt-in only — undefined must not default to true (avoids 403 storms).
  const includeOrders = options.includeOrders === true;
  const includeProducts = options.includeProducts === true;

  try {
    // Lean recent rows only (lists need 5–6 items).
    const [orders, productsResponse] = await Promise.all([
      includeOrders
        ? getOrders({ limit: 12, hydrate: 0 }).catch((err) => {
            if (
              !(err instanceof Error && err.message.includes("Missing required permission")) &&
              !(err instanceof Error &&
                (err.message.toLowerCase().includes("database temporarily unavailable") ||
                  err.message.toLowerCase().includes("failed to authorize")))
            ) {
              console.warn("Error fetching orders:", err);
            }
            return [];
          })
        : Promise.resolve([]),
      includeProducts
        ? adminGetProducts({ page: 1, limit: 6, totals: 0, lean: 1 }).catch((err) => {
            if (
              !(err instanceof Error && err.message.includes("Missing required permission")) &&
              !(err instanceof Error &&
                (err.message.toLowerCase().includes("database temporarily unavailable") ||
                  err.message.toLowerCase().includes("failed to authorize")))
            ) {
              console.warn("Error fetching products:", err);
            }
            return [];
          })
        : Promise.resolve([]),
    ]);

    const products =
      productsResponse &&
      typeof productsResponse === 'object' &&
      'items' in productsResponse
        ? (productsResponse as { items: unknown }).items
        : productsResponse;
    const productsArray = Array.isArray(products) ? products : [];
    const ordersArray = Array.isArray(orders) ? orders : [];

    return {
      recentOrders: includeOrders ? transformOrdersToRecent(ordersArray) : [],
      lastTransactions: includeOrders
        ? transformOrdersToTransactions(ordersArray)
        : [],
      popularProducts: includeProducts
        ? transformProductsToPopular(productsArray)
        : [],
      todayOrderChart: includeOrders
        ? transformOrdersToChart(ordersArray)
        : {
            chartData: [],
            totalOrders: '0',
            changePercentage: 'No change vs last 7 days',
            changeType: 'neutral' as const,
          },
    };
  } catch (error) {
    console.error('❌ Error in getDashboardData:', error);
    throw error;
  }
}