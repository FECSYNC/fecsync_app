'use client';

import { type Order, getOrderCustomerName } from '@/services/order';
import type { CompanyProfile } from '@/services/companyProfile';

interface OrderPrintHeaderProps {
  order: Order;
  brand?: Pick<
    CompanyProfile,
    | 'displayName'
    | 'legalName'
    | 'tradingName'
    | 'logoUrl'
    | 'addressLine1'
    | 'addressLine2'
    | 'city'
    | 'state'
    | 'country'
    | 'postalCode'
    | 'taxId'
    | 'supportEmail'
    | 'letterheadColor'
  > | null;
}

export default function OrderPrintHeader({ order, brand }: OrderPrintHeaderProps) {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const getStatusDisplay = (status: string) => {
    const statusMap: Record<string, string> = {
      pending: 'Pending',
      initiated: 'Initiated',
      paid: 'Paid',
      shipping: 'Shipping',
      shipped: 'Shipped',
      delivered: 'Delivered',
      cancelled: 'Cancelled',
    };
    return statusMap[status] || status;
  };

  const companyName =
    brand?.displayName?.trim() ||
    brand?.legalName?.trim() ||
    brand?.tradingName?.trim() ||
    'Company';
  const address = brand
    ? [
        brand.addressLine1,
        brand.addressLine2,
        [brand.city, brand.state, brand.postalCode].filter(Boolean).join(', '),
        brand.country,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <div className="print-header">
      <div className="company-header">
        <div className="company-logo">
          <div className="logo-container">
            {brand?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brand.logoUrl}
                alt={companyName}
                style={{ maxHeight: 56, maxWidth: 180, objectFit: 'contain' }}
              />
            ) : (
              <p
                className="text-lg font-semibold tracking-tight text-gray-900"
                style={{ margin: 0 }}
              >
                {companyName}
              </p>
            )}
          </div>
          {brand?.logoUrl ? (
            <p className="mt-2 text-sm font-semibold text-gray-900">{companyName}</p>
          ) : null}
          {address ? <p className="text-xs text-gray-600">{address}</p> : null}
          {brand?.taxId ? (
            <p className="text-xs text-gray-600">Tax ID: {brand.taxId}</p>
          ) : null}
        </div>
        <div className="order-info">
          <h2 className="order-title">ORDER INVOICE</h2>
          <div className="order-details">
            <div className="order-detail-row">
              <span className="label">Order ID:</span>
              <span className="value">{order._id}</span>
            </div>
            <div className="order-detail-row">
              <span className="label">Date:</span>
              <span className="value">{formatDate(order.createdAt)}</span>
            </div>
            <div className="order-detail-row">
              <span className="label">Status:</span>
              <span className="value status">{getStatusDisplay(order.status)}</span>
            </div>
            <div className="order-detail-row">
              <span className="label">Total:</span>
              <span className="value total">{formatPrice(order.amount)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="customer-section">
        <h3 className="section-title">Customer Information</h3>
        <div className="customer-details">
          <div className="customer-detail-row">
            <span className="label">Name:</span>
            <span className="value">{getOrderCustomerName(order.user)}</span>
          </div>
          <div className="customer-detail-row">
            <span className="label">Customer ID:</span>
            <span className="value">
              {typeof order.user === 'object' && order.user?._id
                ? order.user._id
                : String(order.user)}
            </span>
          </div>
          <div className="customer-detail-row">
            <span className="label">Delivery Address:</span>
            <span className="value">
              {order.shippingAddress
                ? [
                    order.shippingAddress.line1,
                    order.shippingAddress.line2,
                    order.shippingAddress.city,
                    order.shippingAddress.lga,
                    order.shippingAddress.state,
                    order.shippingAddress.zip,
                    order.shippingAddress.country,
                    order.shippingAddress.phone
                      ? `Tel: ${order.shippingAddress.phone}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(', ')
                : order.address}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
