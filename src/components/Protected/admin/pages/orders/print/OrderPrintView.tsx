'use client';

import { forwardRef } from 'react';
import { type Order } from '@/services/order';
import OrderPrintHeader from './OrderPrintHeader';
import OrderPrintItems from './OrderPrintItems';
import OrderPrintSummary from './OrderPrintSummary';
import OrderPrintFooter from './OrderPrintFooter';
import { useAdminCompanyProfileQuery } from '@/hooks/useCompanyProfile';
import { useAdminCan } from '@/hooks/useAdminPermission';
import { P } from '@/lib/auth/permissions';

interface OrderPrintViewProps {
  order: Order;
}

const OrderPrintView = forwardRef<HTMLDivElement, OrderPrintViewProps>(
  ({ order }, ref) => {
    const { can } = useAdminCan();
    // Match GET /api/admin/company-profile: settings editors + order staff for print brand.
    const canLoadBrand =
      can(P.CompanyProfileRead) || can(P.OrdersRead) || can(P.OrdersManage);
    const { data: brand, isPending: brandPending } =
      useAdminCompanyProfileQuery(canLoadBrand, { freshForPrint: true });
    const letterhead = brand?.letterheadColor?.trim() || '#D4AF37';

    return (
      <div
        ref={ref}
        className="order-print-container"
        style={{ ['--letterhead-color' as string]: letterhead }}
      >
        <div className="print-content">
          {canLoadBrand && brandPending ? (
            <p className="p-6 text-sm text-gray-600">Loading company brand…</p>
          ) : (
            <>
              <OrderPrintHeader order={order} brand={brand ?? null} />
              <OrderPrintItems order={order} />
              <OrderPrintSummary order={order} />
              <OrderPrintFooter brand={brand ?? null} />
            </>
          )}
        </div>
      </div>
    );
  }
);

OrderPrintView.displayName = 'OrderPrintView';

export default OrderPrintView;
