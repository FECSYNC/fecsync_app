'use client';

import KeyMetricsCard from './KeyMetricsCard';
import { MetricData } from '../../types/dashboard';
import { OrdersIcon, ProfitIcon, CustomersIcon } from './icons';

interface KeyMetricsGridProps {
  metrics: MetricData[];
  className?: string;
}

function iconFor(title: string) {
  if (title === 'Total Revenue') return <ProfitIcon />;
  if (title === 'Total Customers') return <CustomersIcon />;
  return <OrdersIcon />;
}

export default function KeyMetricsGrid({ metrics, className = "" }: KeyMetricsGridProps) {
  return (
    <div className={`grid grid-cols-1 md:grid-cols-3 gap-6 ${className}`}>
      {metrics.map((metric) => (
        <KeyMetricsCard
          key={metric.title}
          title={metric.title}
          value={metric.value}
          change={metric.change}
          changeType={metric.changeType}
          icon={metric.icon ?? iconFor(metric.title)}
          trendData={metric.trendData}
        />
      ))}
    </div>
  );
}
