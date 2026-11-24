'use client';

import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';
import ReportCard from './ReportCard';
import { ReportMetric } from '../../types/dashboard';
import SafeResponsiveContainer from './SafeResponsiveContainer';

interface ReportsSectionProps {
  metrics: ReportMetric[];
  onMetricClick?: (metric: ReportMetric) => void;
  className?: string;
}

function formatTick(value: number, currency: boolean) {
  if (currency) {
    if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(1)}k`;
    return `$${value}`;
  }
  return String(value);
}

export default function ReportsSection({
  metrics,
  onMetricClick,
  className = '',
}: ReportsSectionProps) {
  const defaultId =
    metrics.find((m) => m.chartData.length > 0)?.id ?? metrics[0]?.id;
  const [selectedId, setSelectedId] = useState(defaultId);

  const selected = useMemo(
    () => metrics.find((m) => m.id === selectedId) ?? metrics[0],
    [metrics, selectedId]
  );

  const series = selected?.chartData ?? [];
  const isCurrency = selected?.format === 'currency';
  const showChart = series.length > 0;

  return (
    <div className={`bg-white p-6 rounded-lg border border-gray-200 ${className}`}>
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Reports</h3>
        <p className="text-sm text-gray-600">Last 7 Days</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {metrics.map((metric) => (
          <ReportCard
            key={metric.id}
            label={metric.label}
            value={metric.value}
            active={metric.id === selected?.id}
            onClick={() => {
              setSelectedId(metric.id);
              onMetricClick?.(metric);
            }}
          />
        ))}
      </div>

      {showChart ? (
        <div className="h-64 min-h-[16rem] min-w-0">
          <SafeResponsiveContainer>
            <LineChart data={series}>
              <XAxis
                dataKey="day"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: '#6B7280' }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: '#6B7280' }}
                allowDecimals={isCurrency}
                tickFormatter={(value: number) => formatTick(value, isCurrency)}
              />
              <Tooltip
                formatter={(value) => [
                  isCurrency
                    ? `$${Number(value).toLocaleString()}`
                    : Number(value).toLocaleString(),
                  selected?.label ?? 'Value',
                ]}
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #E5E7EB',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#D4AF37"
                strokeWidth={3}
                dot={{ fill: '#D4AF37', strokeWidth: 2, r: 5 }}
                activeDot={{ r: 7, stroke: '#D4AF37', strokeWidth: 2 }}
              />
            </LineChart>
          </SafeResponsiveContainer>
        </div>
      ) : (
        <div className="h-24 flex items-center justify-center rounded-lg bg-gray-50 text-sm text-gray-500">
          {selected?.hint ?? 'No daily trend for this metric'}
        </div>
      )}
    </div>
  );
}
