// src/services/analytics.ts
import { api, isTransientApiError } from "@/utils/api";
import { MetricData, ReportMetric, ChartData, MetricChangeType } from '../components/Protected/admin/pages/types/dashboard';

interface DailyRow {
  _id: string;
  orders: number;
  revenue: number;
  customers?: number;
}

type DailyField = 'orders' | 'revenue' | 'customers';

interface AnalyticsResponse {
  success: boolean;
  message: string;
  data: {
    totals: {
      orders: number;
      revenue: number;
      customers: number;
      products?: number;
      tailoringJobs?: number;
      tailoringJobsActive?: number;
    };
    dailyData: DailyRow[];
    mostPopularOrders: Array<{
      totalQuantity: number;
      productId: string;
      name: string;
    }>;
    activityLog: Array<{
      _id?: string;
      action?: string;
      description?: string;
      entityType?: string;
      createdAt?: string;
      user?: { email?: string; username?: string } | string | null;
    }>;
  };
}

/**
 * Fetch analytics data from backend
 */
export async function getAnalytics(): Promise<AnalyticsResponse['data']> {
  try {
    const response = await api("/api/analytics", { method: "GET" });
    return response.data || response;
  } catch (error) {
    console.error('Error fetching analytics:', error);
    throw error;
  }
}

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Last `count` UTC calendar days, oldest first. `offsetDays` shifts the window back. */
function utcDayKeys(count: number, offsetDays = 0): string[] {
  const end = startOfUtcDay(new Date());
  end.setUTCDate(end.getUTCDate() - offsetDays);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const day = new Date(end);
    day.setUTCDate(end.getUTCDate() - i);
    keys.push(utcDayKey(day));
  }
  return keys;
}

function weekdayLabel(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
}

function dailyMap(dailyData: DailyRow[]): Map<string, DailyRow> {
  const map = new Map<string, DailyRow>();
  for (const row of dailyData) {
    if (!row?._id) continue;
    map.set(row._id, {
      _id: row._id,
      orders: Number(row.orders) || 0,
      revenue: Number(row.revenue) || 0,
      customers: Number(row.customers) || 0,
    });
  }
  return map;
}

function seriesForWindow(
  map: Map<string, DailyRow>,
  field: DailyField,
  count: number,
  offsetDays = 0
): number[] {
  return utcDayKeys(count, offsetDays).map((key) => map.get(key)?.[field] ?? 0);
}

function chartForWindow(
  map: Map<string, DailyRow>,
  field: DailyField,
  count = 7
): ChartData[] {
  return utcDayKeys(count).map((key) => ({
    day: weekdayLabel(key),
    value: map.get(key)?.[field] ?? 0,
    orders: map.get(key)?.orders ?? 0,
  }));
}

function sum(values: number[]): number {
  return values.reduce((total, n) => total + n, 0);
}

export function formatCompact(num: number, money = false): string {
  const abs = Math.abs(num);
  if (abs >= 1_000_000) {
    return `${money ? "$" : ""}${(num / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1000) {
    return `${money ? "$" : ""}${(num / 1000).toFixed(1)}K`;
  }
  if (money) {
    return num % 1 === 0 ? `$${num}` : `$${num.toFixed(2)}`;
  }
  return String(Math.round(num));
}

export function weekOverWeekChange(current: number, previous: number): {
  label: string;
  changeType: MetricChangeType;
} {
  if (previous === 0 && current === 0) {
    return { label: "No change vs last 7 days", changeType: "neutral" };
  }
  if (previous === 0) {
    return { label: "New vs last 7 days", changeType: "positive" };
  }
  const percent = Math.round(((current - previous) / previous) * 100);
  if (percent === 0) {
    return { label: "No change vs last 7 days", changeType: "neutral" };
  }
  return {
    label: `${Math.abs(percent)}% vs last 7 days`,
    changeType: percent > 0 ? "positive" : "negative",
  };
}

/**
 * Transform analytics totals into KeyMetrics format.
 * Headlines are all-time totals; trend + % are last 7 UTC days vs the prior 7.
 */
export function transformToKeyMetrics(
  totals: AnalyticsResponse['data']['totals'],
  dailyData: AnalyticsResponse['data']['dailyData']
): MetricData[] {
  const map = dailyMap(dailyData);

  const currentOrders = sum(seriesForWindow(map, "orders", 7));
  const previousOrders = sum(seriesForWindow(map, "orders", 7, 7));
  const currentRevenue = sum(seriesForWindow(map, "revenue", 7));
  const previousRevenue = sum(seriesForWindow(map, "revenue", 7, 7));
  const currentCustomers = sum(seriesForWindow(map, "customers", 7));
  const previousCustomers = sum(seriesForWindow(map, "customers", 7, 7));

  const ordersChange = weekOverWeekChange(currentOrders, previousOrders);
  const revenueChange = weekOverWeekChange(currentRevenue, previousRevenue);
  const customersChange = weekOverWeekChange(currentCustomers, previousCustomers);

  return [
    {
      title: "Total Orders",
      value: formatCompact(totals.orders),
      change: ordersChange.label,
      changeType: ordersChange.changeType,
      trendData: seriesForWindow(map, "orders", 7),
    },
    {
      title: "Total Revenue",
      value: formatCompact(totals.revenue, true),
      change: revenueChange.label,
      changeType: revenueChange.changeType,
      trendData: seriesForWindow(map, "revenue", 7),
    },
    {
      title: "Total Customers",
      value: formatCompact(totals.customers),
      change: customersChange.label,
      changeType: customersChange.changeType,
      trendData: seriesForWindow(map, "customers", 7),
    },
    ...(typeof totals.tailoringJobs === "number"
      ? [
          {
            title: "Tailoring Jobs",
            value: formatCompact(totals.tailoringJobs),
            change:
              typeof totals.tailoringJobsActive === "number"
                ? `${formatCompact(totals.tailoringJobsActive)} active`
                : "—",
            changeType: "neutral" as MetricChangeType,
            trendData: seriesForWindow(map, "orders", 7),
          },
        ]
      : []),
  ];
}

/**
 * Reports cards are last-7-day figures so they match the "Last 7 Days" chart.
 */
export function transformToReportMetrics(
  totals: AnalyticsResponse['data']['totals'],
  mostPopularOrders: AnalyticsResponse['data']['mostPopularOrders'],
  dailyData: AnalyticsResponse['data']['dailyData']
): ReportMetric[] {
  const map = dailyMap(dailyData);
  const last7Customers = sum(seriesForWindow(map, "customers", 7));
  const last7Orders = sum(seriesForWindow(map, "orders", 7));
  const last7Revenue = sum(seriesForWindow(map, "revenue", 7));
  const unitsSold = mostPopularOrders.reduce((sumQty, p) => sumQty + (p.totalQuantity || 0), 0);

  return [
    {
      id: "customers",
      label: "Customers",
      value: formatCompact(last7Customers),
      format: "number",
      chartData: chartForWindow(map, "customers"),
    },
    {
      id: "orders",
      label: "Total Orders",
      value: formatCompact(last7Orders),
      format: "number",
      chartData: chartForWindow(map, "orders"),
    },
    {
      id: "products",
      label: "Total Products",
      value: formatCompact(totals.products ?? 0),
      format: "number",
      chartData: [],
      hint: "Catalog size (all-time)",
    },
    {
      id: "revenue",
      label: "Revenue",
      value: formatCompact(last7Revenue, true),
      format: "currency",
      chartData: chartForWindow(map, "revenue"),
    },
    {
      id: "popular",
      label: "Popular Items",
      value: formatCompact(mostPopularOrders.length),
      format: "number",
      chartData: [],
      hint: unitsSold > 0
        ? `${unitsSold} units sold in the last 7 days`
        : "Distinct products sold in the last 7 days",
    },
  ];
}

/**
 * Last 7 UTC calendar days of revenue (used as a fallback series).
 */
export function transformToReportChartData(
  dailyData: AnalyticsResponse['data']['dailyData']
): ChartData[] {
  return chartForWindow(dailyMap(dailyData), "revenue");
}

/**
 * "Orders" chart: last 7 UTC days in chronological order.
 * Headline is the 7-day order count so it matches the line.
 */
export function transformToTodayOrderChart(
  _totals: AnalyticsResponse['data']['totals'],
  dailyData: AnalyticsResponse['data']['dailyData']
): {
  chartData: Array<{ day: string; orders: number }>;
  totalOrders: string;
  changePercentage: string;
  changeType: MetricChangeType;
} {
  const map = dailyMap(dailyData);
  const current = seriesForWindow(map, "orders", 7);
  const previous = seriesForWindow(map, "orders", 7, 7);
  const change = weekOverWeekChange(sum(current), sum(previous));

  return {
    chartData: utcDayKeys(7).map((key, index) => ({
      day: weekdayLabel(key),
      orders: current[index] ?? 0,
    })),
    totalOrders: formatCompact(sum(current)),
    changePercentage: change.label,
    changeType: change.changeType,
  };
}

/**
 * Get all dashboard analytics data transformed and ready to use
 */
export async function getDashboardAnalytics(): Promise<{
  keyMetrics: MetricData[];
  reportMetrics: ReportMetric[];
  reportChartData: ChartData[];
  todayOrderChart: {
    chartData: Array<{ day: string; orders: number }>;
    totalOrders: string;
    changePercentage: string;
    changeType: MetricChangeType;
  };
  activityLog: AnalyticsResponse['data']['activityLog'];
}> {
  try {
    const analyticsData = await getAnalytics();
    const dailyData = analyticsData.dailyData ?? [];

    return {
      keyMetrics: transformToKeyMetrics(analyticsData.totals, dailyData),
      reportMetrics: transformToReportMetrics(
        analyticsData.totals,
        analyticsData.mostPopularOrders ?? [],
        dailyData
      ),
      reportChartData: transformToReportChartData(dailyData),
      todayOrderChart: transformToTodayOrderChart(
        analyticsData.totals,
        dailyData
      ),
      activityLog: analyticsData.activityLog ?? [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      message.includes("Missing required permission") ||
      isTransientApiError(error)
    ) {
      return {
        keyMetrics: [],
        reportMetrics: [],
        reportChartData: [],
        todayOrderChart: {
          chartData: [],
          totalOrders: '0',
          changePercentage: 'No change vs last 7 days',
          changeType: 'neutral',
        },
        activityLog: [],
      };
    }
    console.warn("Dashboard analytics unavailable:", message || error);
    throw error;
  }
}
