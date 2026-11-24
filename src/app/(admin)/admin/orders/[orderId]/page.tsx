'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Package, Calendar, User, MapPin, Printer } from 'lucide-react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import { getOrderStatusInfo, getOrderCustomerName, type Order } from '@/services/order';
import { formatPrice } from '@/utils/currency';
import { useToast } from '@/contexts/toast-context';
import { OrderPrint } from '@/components/Protected/admin/pages/orders/print';
import { getOrderDisplayLines } from '@/utils/orderCartLines';
import { useAdminOrderByIdQuery, useUpdateOrderStatusMutation } from '@/hooks/useOrders';
import { formatTaxRateLabel, formatOrderShippingFeeLabel, getOrderMoneySummary } from '@/utils/tax';
import { useCatalogActionPermissions } from '@/hooks/useAdminPermission';
import OrderShipmentPanel from '@/components/common/OrderShipmentPanel';
import { useQueryClient } from '@tanstack/react-query';
import { orderKeys } from '@/hooks/useOrders';
import { shipmentKeys } from '@/hooks/useShipments';
import { P } from '@/lib/auth/permissions';
import { useAuthStore } from '@/store/authStore';
import { AccountingEntriesPanel } from '@/components/Protected/admin/pages/accounting/shared';

interface PageProps {
    params: Promise<{
        orderId: string;
    }>;
}

export default function OrderDetailsPage({ params }: PageProps) {
    const { orderId } = use(params);
    const router = useRouter();
    const { addToast } = useToast();
    const [showPrint, setShowPrint] = useState(false);
    const [pendingStatus, setPendingStatus] = useState<Order['status'] | null>(null);
    const updateStatusMutation = useUpdateOrderStatusMutation();
    const { canManageOrders, canManageDeliveries } = useCatalogActionPermissions();
    const can = useAuthStore((s) => s.can);
    const canReadDeliveries = can(P.DeliveriesRead);
    const queryClient = useQueryClient();
    // Seed from list cache so View opens immediately when coming from Orders table.
    const { data: order, isLoading, error } = useAdminOrderByIdQuery(orderId);

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getUserName = (): string => {
        return getOrderCustomerName(order?.user);
    };

    const getUserEmail = (): string | null => {
        if (!order?.user || typeof order.user === 'string') return null;
        return order.user.email || null;
    };

    const canMarkShipped = order && (order.status === 'paid' || order.status === 'shipping');
    const canMarkDelivered = order && (order.status === 'shipped' || order.status === 'shipping');

    const handleStatusUpdate = async (status: Order['status']) => {
        if (!canManageOrders || !order || updateStatusMutation.isPending) return;
        setPendingStatus(status);
        try {
            await updateStatusMutation.mutateAsync({
                orderId: order._id,
                status,
            });
            addToast(`Order marked as ${status}`, 'success');
        } catch (err) {
            console.error('Failed to update order status:', err);
            addToast('Failed to update order status. Please try again.', 'error');
        } finally {
            setPendingStatus(null);
        }
    };

    const getDisplayLines = () => getOrderDisplayLines(order?.carts);

    const calculatedSubtotal = getDisplayLines().reduce(
        (total, line) => total + line.lineTotal,
        0
    );
    const money = order
        ? getOrderMoneySummary(order, calculatedSubtotal)
        : { subtotal: 0, taxAmount: 0, shippingFee: 0, taxRate: 0, taxLabel: 'Tax', total: 0 };

    // Only block when we have nothing cached to show yet.
    if (isLoading && !order) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="w-8 h-8 animate-spin text-[#D4AF37]" />
            </div>
        );
    }

    if (error || !order) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="text-center">
                    <Package className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">Order Not Found</h2>
                    <p className="text-gray-600 mb-6">
                        {error?.message || "The order you're looking for doesn't exist."}
                    </p>
                    <button
                        onClick={() => router.push('/admin/orders')}
                        className="px-6 py-3 bg-[#D4AF37] text-black font-semibold rounded-lg hover:bg-[#B8941F] transition-colors"
                    >
                        Back to Orders
                    </button>
                </div>
            </div>
        );
    }

    const displayLines = getDisplayLines();
    const statusInfo = getOrderStatusInfo(order.status);

    return (
        <div className="min-w-0">
            {/* Header */}
            <div className="mb-4 sm:mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                    <button
                        onClick={() => router.push('/admin/orders')}
                        className="p-2 hover:bg-gray-200 rounded-full transition-colors shrink-0"
                    >
                        <ArrowLeft className="w-6 h-6 text-gray-700" />
                    </button>
                    <div className="min-w-0">
                        <h1 className="text-xl sm:text-3xl font-bold text-gray-900">Order Details</h1>
                        <p className="text-gray-600 mt-1 text-sm sm:text-base truncate">Order #{order._id.slice(-8)}</p>
                    </div>
                </div>
                <button
                    onClick={() => setShowPrint(true)}
                    className="flex items-center justify-center gap-2 w-full sm:w-auto px-4 sm:px-6 py-3 bg-[#D4AF37] text-black font-semibold rounded-lg hover:bg-[#B8941F] transition-colors shrink-0"
                >
                    <Printer className="w-5 h-5" />
                    Print Order
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main Content */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Order Status */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-white rounded-lg shadow-sm p-6"
                    >
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-semibold text-gray-900">Order Status</h2>
                            <span className={`px-4 py-2 rounded-full text-sm font-medium ${statusInfo.color}`}>
                                {statusInfo.label}
                            </span>
                        </div>
                        <div className="mb-4 flex flex-wrap gap-2">
                            {canManageOrders && (
                              <>
                                <button
                                    type="button"
                                    onClick={() => void handleStatusUpdate('shipped')}
                                    disabled={!canMarkShipped || updateStatusMutation.isPending}
                                    className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                                >
                                    {pendingStatus === 'shipped' && <Loader2 className="h-4 w-4 animate-spin" />}
                                    Mark as Shipped
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void handleStatusUpdate('delivered')}
                                    disabled={!canMarkDelivered || updateStatusMutation.isPending}
                                    className="inline-flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 transition-colors hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                                >
                                    {pendingStatus === 'delivered' && <Loader2 className="h-4 w-4 animate-spin" />}
                                    Mark as Delivered
                                </button>
                              </>
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                                <div className="flex items-center gap-2 text-gray-600 mb-1">
                                    <Calendar className="w-4 h-4" />
                                    <span className="font-medium">Created:</span>
                                </div>
                                <p className="text-gray-900">{formatDate(order.createdAt)}</p>
                            </div>
                            <div>
                                <div className="flex items-center gap-2 text-gray-600 mb-1">
                                    <Calendar className="w-4 h-4" />
                                    <span className="font-medium">Updated:</span>
                                </div>
                                <p className="text-gray-900">{formatDate(order.updatedAt)}</p>
                            </div>
                            <div>
                                <p className="font-medium text-gray-600 mb-1">Updated by</p>
                                <p className="text-gray-900">
                                    {typeof order.updatedByName === 'string' &&
                                    order.updatedByName.trim()
                                        ? order.updatedByName.trim()
                                        : '—'}
                                </p>
                            </div>
                            {order.paymentProvider && (
                                <div>
                                    <p className="font-medium text-gray-600 mb-1">Payment method</p>
                                    <p className="text-gray-900 capitalize">{order.paymentProvider}</p>
                                </div>
                            )}
                            {order.paymentReference && (
                                <div>
                                    <p className="font-medium text-gray-600 mb-1">Payment reference</p>
                                    <p className="text-gray-900 break-all text-xs sm:text-sm">
                                        {order.paymentReference}
                                    </p>
                                </div>
                            )}
                            {order.fulfilledAt && (
                                <div>
                                    <p className="font-medium text-gray-600 mb-1">Fulfilled</p>
                                    <p className="text-gray-900">{formatDate(order.fulfilledAt)}</p>
                                </div>
                            )}
                        </div>
                    </motion.div>

                    {/* Order Items */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                        className="bg-white rounded-lg shadow-sm p-6"
                    >
                        <h2 className="text-xl font-semibold text-gray-900 mb-4">Order Items</h2>
                        <div className="space-y-4">
                            {displayLines.length > 0 ? (
                                displayLines.map((line) => (
                                    <div key={line.key} className="flex gap-4 p-4 border border-gray-200 rounded-lg">
                                        <div className="w-20 h-20 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
                                            {line.imageUrl ? (
                                                <Image
                                                    src={line.imageUrl}
                                                    alt={line.name}
                                                    width={80}
                                                    height={80}
                                                    unoptimized
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center">
                                                    <Package className="w-8 h-8 text-gray-400" />
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <h3 className="font-semibold text-gray-900">
                                                    {line.name}
                                                </h3>
                                                <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                                                    {line.kind}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-4 text-sm text-gray-600 mb-2">
                                                <span>Qty: {line.quantity}</span>
                                                <span className="font-semibold text-gray-900">
                                                    {formatPrice(line.lineTotal)}
                                                </span>
                                            </div>
                                            <p className="text-xs text-gray-500">
                                                {formatPrice(line.unitPrice)} per {line.unitLabel}
                                            </p>
                                            {line.productNote && line.productNote.length > 0 && (
                                                <div className="flex flex-wrap gap-2 mt-2">
                                                    {line.productNote.map((note: string, noteIndex: number) => (
                                                        <span
                                                            key={noteIndex}
                                                            className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-[#D4AF37]/10 text-[#B8941F] border border-[#D4AF37]/30"
                                                        >
                                                            {note}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="text-center py-8 text-gray-500">
                                    <Package className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                                    <p>No items found in this order</p>
                                </div>
                            )}
                        </div>
                    </motion.div>
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                    {/* Order Summary */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="bg-white rounded-lg shadow-sm p-6"
                    >
                        <h2 className="text-xl font-semibold text-gray-900 mb-4">Order Summary</h2>
                        <div className="space-y-3">
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-600">Subtotal:</span>
                                <span className="font-semibold text-gray-900">
                                    {formatPrice(money.subtotal)}
                                </span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-600">Shipping:</span>
                                <span className={`font-semibold ${money.shippingFee > 0 ? 'text-gray-900' : 'text-green-600'}`}>
                                    {formatOrderShippingFeeLabel(
                                        money.shippingFee,
                                        Boolean(order.shippingMethod),
                                        formatPrice
                                    )}
                                </span>
                            </div>
                            {money.taxAmount > 0 && (
                                <div className="flex justify-between text-sm">
                                    <span className="text-gray-600">
                                        {formatTaxRateLabel(money.taxRate, money.taxLabel)}:
                                    </span>
                                    <span className="font-semibold text-gray-900">
                                        {formatPrice(money.taxAmount)}
                                    </span>
                                </div>
                            )}
                            <div className="border-t pt-3">
                                <div className="flex justify-between font-bold text-lg">
                                    <span className="text-gray-900">Total:</span>
                                    <span className="text-gray-900">
                                        {formatPrice(money.total)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </motion.div>

                    {/* Customer Information */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                        className="bg-white rounded-lg shadow-sm p-6"
                    >
                        <h2 className="text-xl font-semibold text-gray-900 mb-4">Customer Information</h2>
                        <div className="space-y-3 text-sm">
                            <div>
                                <div className="flex items-center gap-2 text-gray-600 mb-1">
                                    <User className="w-4 h-4" />
                                    <span className="font-medium">Name:</span>
                                </div>
                                <p className="text-gray-900">{getUserName()}</p>
                            </div>
                            {getUserEmail() && (
                                <div>
                                    <span className="text-gray-600 font-medium block mb-1">Email:</span>
                                    <p className="text-gray-900">{getUserEmail()}</p>
                                </div>
                            )}
                            <div>
                                <div className="flex items-center gap-2 text-gray-600 mb-1">
                                    <MapPin className="w-4 h-4" />
                                    <span className="font-medium">Delivery Address:</span>
                                </div>
                                <p className="text-gray-900">
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
                                </p>
                            </div>
                        </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.35 }}
                        className="bg-white rounded-lg shadow-sm overflow-hidden"
                    >
                        <div className="[&>div]:bg-white [&>div]:border-0 [&>div]:rounded-none">
                            <OrderShipmentPanel
                                order={order}
                                showFailureReason={canReadDeliveries}
                                canManageShipments={canManageDeliveries}
                                shippingFee={money.shippingFee}
                                onShipmentChange={() => {
                                    void queryClient.invalidateQueries({
                                        queryKey: orderKeys.byId(orderId),
                                    });
                                    void queryClient.invalidateQueries({
                                        queryKey: orderKeys.admin(),
                                    });
                                    void queryClient.invalidateQueries({
                                        queryKey: shipmentKeys.all,
                                    });
                                }}
                            />
                        </div>
                    </motion.div>

                    {/* Order Info */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 }}
                        className="bg-white rounded-lg shadow-sm p-6"
                    >
                        <h2 className="text-xl font-semibold text-gray-900 mb-4">Order Information</h2>
                        <div className="space-y-3 text-sm">
                            <div>
                                <span className="text-gray-600 font-medium block mb-1">Order ID:</span>
                                <p className="text-gray-900 font-mono text-xs break-all">{order._id}</p>
                            </div>
                            <div>
                                <span className="text-gray-600 font-medium block mb-1">Status:</span>
                                <p className="text-gray-900 capitalize">{order.status}</p>
                            </div>
                        </div>
                    </motion.div>
            </div>

            <AccountingEntriesPanel
                sourceType="shop_order"
                sourceId={order._id}
                className="lg:col-span-3"
            />
        </div>

            {/* Print Modal */}
            {showPrint && order && (
                <div
                    className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
                    onClick={() => setShowPrint(false)}
                >
                    <div
                        className="bg-white rounded-lg shadow-2xl max-w-5xl w-full max-h-[95vh] overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="p-6">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-xl font-bold text-gray-900">
                                    Print Order - {order._id}
                                </h2>
                                <button
                                    onClick={() => setShowPrint(false)}
                                    className="text-gray-400 hover:text-gray-600 text-2xl font-bold transition-colors hover:bg-gray-100 rounded-full w-8 h-8 flex items-center justify-center"
                                >
                                    ×
                                </button>
                            </div>
                            <OrderPrint order={order} onClose={() => setShowPrint(false)} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
