'use client';

import { LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';
import { ChartData, MetricChangeType } from '../../types/dashboard';
import SafeResponsiveContainer from './SafeResponsiveContainer';

interface TodayOrderChartProps {
  data: ChartData[];
  totalOrders: string;
  change: string;
  changeType: MetricChangeType;
  className?: string;
}

export default function TodayOrderChart({
  data,
  totalOrders,
  change,
  changeType,
  className = '',
}: TodayOrderChartProps) {
  const changeColor =
    changeType === 'positive'
      ? 'text-green-600'
      : changeType === 'negative'
        ? 'text-red-600'
        : 'text-gray-500';
  const arrow =
    changeType === 'positive' ? '↑' : changeType === 'negative' ? '↓' : '';

  return (
    <div className={`bg-white p-6 rounded-lg border border-gray-200 ${className}`}>
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Orders</h3>
        <p className="text-2xl font-bold text-gray-900">{totalOrders}</p>
        <p className={`text-sm ${changeColor}`}>
          {arrow}
          {change}
        </p>
        <p className="text-sm text-gray-600">Last 7 days</p>
      </div>

      <div className="h-32 min-h-[8rem] min-w-0">
        <SafeResponsiveContainer>
          <LineChart data={data}>
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
              allowDecimals={false}
            />
            <Tooltip
              formatter={(value) => [Number(value).toLocaleString(), 'Orders']}
              contentStyle={{
                backgroundColor: 'white',
                border: '1px solid #E5E7EB',
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              }}
            />
            <Line
              type="monotone"
              dataKey="orders"
              stroke="#D4AF37"
              strokeWidth={2}
              dot={{ fill: '#D4AF37', strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6, stroke: '#D4AF37', strokeWidth: 2 }}
            />
          </LineChart>
        </SafeResponsiveContainer>
      </div>
    </div>
  );
}
