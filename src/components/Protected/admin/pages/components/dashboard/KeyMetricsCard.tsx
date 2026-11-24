'use client';

import { ReactNode } from 'react';
import { LineChart, Line } from 'recharts';
import { MetricChangeType } from '../../types/dashboard';
import SafeResponsiveContainer from './SafeResponsiveContainer';

interface KeyMetricsCardProps {
  title: string;
  value: string;
  change: string;
  changeType: MetricChangeType;
  icon: ReactNode;
  trendData?: number[];
  className?: string;
}

export default function KeyMetricsCard({
  title,
  value,
  change,
  changeType,
  icon,
  trendData,
  className = '',
}: KeyMetricsCardProps) {
  const changeColor =
    changeType === 'positive'
      ? 'text-green-600'
      : changeType === 'negative'
        ? 'text-red-600'
        : 'text-gray-500';
  const iconBgColor =
    changeType === 'negative' ? 'bg-red-100' : 'bg-green-100';
  const iconColor =
    changeType === 'negative' ? 'text-red-600' : 'text-green-600';
  const stroke =
    changeType === 'positive'
      ? '#10B981'
      : changeType === 'negative'
        ? '#EF4444'
        : '#9CA3AF';
  const arrow =
    changeType === 'positive' ? '↑' : changeType === 'negative' ? '↓' : '';

  return (
    <div className={`bg-white p-6 rounded-lg border border-gray-200 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="text-[11px] text-gray-400">All time</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          <p className={`text-sm ${changeColor} mt-1`}>
            {arrow}
            {change}
          </p>
        </div>
        <div
          className={`w-12 h-12 ${iconBgColor} rounded-lg flex items-center justify-center`}
        >
          <div className={iconColor}>{icon}</div>
        </div>
      </div>

      {trendData && trendData.length > 0 && (
        <div className="mt-4 h-8 min-h-[2rem] min-w-0">
          <SafeResponsiveContainer>
            <LineChart
              data={trendData.map((value, index) => ({ value, index }))}
            >
              <Line
                type="monotone"
                dataKey="value"
                stroke={stroke}
                strokeWidth={2}
                dot={false}
                activeDot={false}
              />
            </LineChart>
          </SafeResponsiveContainer>
        </div>
      )}
    </div>
  );
}
