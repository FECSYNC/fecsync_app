// Dashboard data types
import { ReactNode } from 'react';

export type MetricChangeType = 'positive' | 'negative' | 'neutral';

export interface MetricData {
  title: string;
  value: string;
  change: string;
  changeType: MetricChangeType;
  icon?: ReactNode;
  trendData?: number[];
}

export interface Product {
  id: string;
  name: string;
  itemCode: string;
  price: string;
  image?: string;
}

export interface Transaction {
  id: string;
  issuedDate: string;
  total: string;
  status?: string;
}

/** Display labels aligned with store order statuses (and legacy dashboard labels). */
export type DashboardOrderStatus =
  | 'Pending'
  | 'Initiated'
  | 'Paid'
  | 'Shipped'
  | 'Delivered'
  | 'Completed'
  | 'Cancelled'
  | 'Processing';

export interface Order {
  id: string;
  customer: string;
  status: DashboardOrderStatus;
  amount: string;
}

export interface ReportMetric {
  id: string;
  label: string;
  value: string;
  chartData: ChartData[];
  format?: 'number' | 'currency';
  hint?: string;
}

export interface ChartData {
  day: string;
  value?: number;
  orders?: number;
}

