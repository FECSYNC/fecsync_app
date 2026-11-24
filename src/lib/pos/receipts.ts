import prisma from "@/lib/prisma";
import { PosError } from "@/lib/pos/errors";
import { num } from "@/lib/pos/money";
import { posListLocationWhere, type PosActor } from "@/lib/pos/scope";
import { sendReceiptMail } from "@/lib/sendReceipts";

export async function emailPosReceipt(actor: PosActor, saleId: string, to?: string | null) {
  const where = await posListLocationWhere(actor);
  const sale = await prisma.posSale.findFirst({
    where: { id: saleId, orgId: where.orgId },
    include: { lines: true, payments: true, bookings: { include: { booking: { include: { credentials: true } } } } },
  });
  if (!sale) throw new PosError("NOT_FOUND", "Sale not found", 404);
  const email = (to || sale.receiptEmail || "").trim();
  if (!email) throw new PosError("EMAIL", "A receipt email is required");
  const codes = sale.bookings.flatMap((b) => b.booking.credentials.map((c) => c.code));
  await sendReceiptMail({
    to: email,
    subject: `Receipt ${sale.publicId}`,
    orgId: sale.orgId,
    data: {
      customerName: "Guest",
      receiptId: sale.publicId,
      amountPaid: num(sale.amountPaid),
      paymentMethod: sale.payments.map((p) => p.tender).join(", ") || "pos",
      date: sale.createdAt.toISOString(),
      confirmationPath: codes.length ? `tickets:${codes.join(",")}` : undefined,
    },
  });
  return {
    sent: true,
    publicId: sale.publicId,
    credentialCodes: codes,
    lines: sale.lines.map((l) => ({ name: l.name, qty: l.qty, total: num(l.lineTotal) })),
    tenders: sale.payments.map((p) => ({ tender: p.tender, amount: num(p.amount) })),
  };
}
