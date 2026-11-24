'use client';

import { type Order } from '@/services/order';
import { formatPrice } from '@/utils/currency';
import { formatTaxRateLabel, formatOrderShippingFeeLabel, getOrderMoneySummary } from '@/utils/tax';

interface OrderPrintSummaryProps {
  order: Order;
}

export default function OrderPrintSummary({ order }: OrderPrintSummaryProps) {
  const calculateProfit = (amount: number) => {
    return Math.round(amount * 0.1);
  };

  const money = getOrderMoneySummary(order);
  const profit = calculateProfit(money.total);
  const discount = 0;

  return (
    <div className="print-summary-section">
      <div className="summary-container">
        <h3 className="section-title">Order Summary</h3>

        <div className="summary-details">
          <div className="summary-row">
            <span className="summary-label">Subtotal:</span>
            <span className="summary-value">{formatPrice(money.subtotal)}</span>
          </div>

          <div className="summary-row">
            <span className="summary-label">Shipping:</span>
            <span className="summary-value">
              {formatOrderShippingFeeLabel(
                money.shippingFee,
                Boolean(order.shippingMethod || order.shipment),
                formatPrice
              )}
            </span>
          </div>

          {order.shipment?.courierName && (
            <div className="summary-row">
              <span className="summary-label">Courier:</span>
              <span className="summary-value">{order.shipment.courierName}</span>
            </div>
          )}

          {!order.shipment?.courierName && order.shippingMethod?.courierName && (
            <div className="summary-row">
              <span className="summary-label">Courier:</span>
              <span className="summary-value">
                {order.shippingMethod.courierName}
              </span>
            </div>
          )}

          {order.shipment?.trackingNumber && (
            <div className="summary-row">
              <span className="summary-label">Tracking:</span>
              <span className="summary-value">{order.shipment.trackingNumber}</span>
            </div>
          )}

          {order.shipment?.trackingUrl && (
            <div className="summary-row">
              <span className="summary-label">Track URL:</span>
              <span className="summary-value">{order.shipment.trackingUrl}</span>
            </div>
          )}

          {order.shipment?.status && (
            <div className="summary-row">
              <span className="summary-label">Shipment status:</span>
              <span className="summary-value">
                {String(order.shipment.status).replace(/_/g, ' ')}
              </span>
            </div>
          )}

          {money.taxAmount > 0 && (
            <div className="summary-row">
              <span className="summary-label">
                {formatTaxRateLabel(money.taxRate, money.taxLabel)}:
              </span>
              <span className="summary-value">{formatPrice(money.taxAmount)}</span>
            </div>
          )}

          <div className="summary-row">
            <span className="summary-label">Discount:</span>
            <span className="summary-value">-{formatPrice(discount)}</span>
          </div>

          <div className="summary-row total-row">
            <span className="summary-label">Total Amount:</span>
            <span className="summary-value total-amount">{formatPrice(money.total)}</span>
          </div>

          <div className="summary-row profit-row">
            <span className="summary-label">Estimated Profit:</span>
            <span className="summary-value profit-amount">{formatPrice(profit)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
