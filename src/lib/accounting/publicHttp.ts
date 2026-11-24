/**
 * Public accounting catch-all: invoice view/pay by viewToken + statement token.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import connectDB from "@/lib/db";
import prisma from "@/lib/prisma";
import { lookupApiPermission } from "@/lib/auth/permissions";
import { clientIpFromHeaders, consumeRateLimit } from "@/lib/rateLimit";
import { createCheckoutSession } from "@/lib/stripe";
import { publicAppBaseUrl } from "@/lib/publicAppBaseUrl";
import { newPublicToken } from "@/lib/ticketing/publicTokens";
import { payViaPaymentLink } from "@/lib/ticketing/paymentLinks";
import {
  accountingRouteError,
  matchRoute,
  readJsonBody,
  respond,
  type RouteDef,
} from "@/lib/accounting/http";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { D, round2, toApiString, toMinor } from "@/lib/accounting/money";
import { resolveStatementToken } from "@/lib/accounting/receivables/statements";

type PublicCtx = Record<string, never>;

function rateLimitOrThrow(bucket: string, req: NextRequest, limit: number, windowMs: number) {
  const ip = clientIpFromHeaders(req.headers);
  const result = consumeRateLimit(`${bucket}:${ip}`, limit, windowMs);
  if (!result.allowed) {
    throw acctError(ACCT.RATE_LIMITED, { details: { retryAfterSec: result.retryAfterSec } });
  }
}

async function loadPublicInvoice(token: string) {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) throw acctError(ACCT.TOKEN_INVALID);
  const inv = await prisma.bookingInvoice.findFirst({
    where: { viewToken: token },
    include: {
      lines: { orderBy: { lineNo: "asc" } },
      org: {
        select: {
          id: true,
          name: true,
          slug: true,
          isDefault: true,
          companyProfile: {
            select: {
              tradingName: true,
              legalName: true,
              logoUrl: true,
              letterheadColor: true,
              country: true,
            },
          },
          accountingSettings: { select: { enabled: true, baseCurrency: true, statementFooter: true } },
        },
      },
    },
  });
  if (!inv || inv.org.isDefault) throw acctError(ACCT.TOKEN_INVALID);
  if (!inv.org.accountingSettings?.enabled && inv.kind !== "booking") {
    throw acctError(ACCT.TOKEN_INVALID);
  }
  return inv;
}

function publicInvoiceDto(inv: Awaited<ReturnType<typeof loadPublicInvoice>>) {
  const profile = inv.org.companyProfile;
  return {
    number: inv.number,
    kind: inv.kind,
    status: inv.status,
    issueDate: inv.issueDate?.toISOString() ?? null,
    dueAt: inv.dueAt?.toISOString() ?? null,
    currency: inv.currency,
    customerName: inv.customerName,
    customerEmail: inv.customerEmail,
    subtotal: toApiString(inv.subtotal),
    taxTotal: toApiString(inv.taxTotal),
    amount: toApiString(inv.amount),
    amountPaid: toApiString(inv.amountPaid),
    amountDue: toApiString(inv.amountDue),
    memo: inv.memo,
    writtenOffAt: inv.writtenOffAt?.toISOString() ?? null,
    lines: inv.lines.map((l) => ({
      lineNo: l.lineNo,
      description: l.description,
      qty: D(l.qty).toString(),
      unitPrice: D(l.unitPrice).toFixed(4),
      taxAmount: toApiString(l.taxAmount),
      lineTotal: toApiString(l.lineTotal),
    })),
    branding: {
      orgName: profile?.tradingName || profile?.legalName || inv.org.name,
      logoUrl: profile?.logoUrl ?? null,
      brandPrimary: profile?.letterheadColor ?? null,
      country: profile?.country ?? null,
      footer: inv.org.accountingSettings?.statementFooter ?? null,
    },
    payable: ["sent", "overdue"].includes(inv.status) && D(inv.amountDue).greaterThan(0),
  };
}

async function payBookingInvoice(inv: Awaited<ReturnType<typeof loadPublicInvoice>>) {
  if (!inv.bookingId) throw acctError(ACCT.INVOICE_KIND_LOCKED, { message: "Booking invoice has no booking" });
  const booking = await prisma.booking.findFirst({
    where: { id: inv.bookingId, orgId: inv.orgId },
    select: {
      id: true,
      locationId: true,
      amountDue: true,
      status: true,
      primaryContactEmail: true,
      primaryContactPhone: true,
    },
  });
  if (!booking) throw acctError(ACCT.NOT_FOUND);
  const amountDue = D(booking.amountDue);
  if (!amountDue.greaterThan(0)) throw acctError(ACCT.VALIDATION, { message: "Nothing due" });

  const existing = await prisma.bookingPaymentLink.findFirst({
    where: {
      bookingId: booking.id,
      orgId: inv.orgId,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  let token = existing?.token;
  if (!token) {
    const link = await prisma.bookingPaymentLink.create({
      data: {
        token: newPublicToken(),
        orgId: inv.orgId,
        locationId: booking.locationId,
        bookingId: booking.id,
        amountDue: round2(amountDue),
        expiresAt: new Date(Date.now() + 72 * 3600_000),
        channel: "email",
        sentTo: booking.primaryContactEmail || booking.primaryContactPhone || null,
      },
    });
    token = link.token;
  }
  return payViaPaymentLink(token);
}

async function payManualInvoice(inv: Awaited<ReturnType<typeof loadPublicInvoice>>) {
  const amountDue = D(inv.amountDue);
  if (!amountDue.greaterThan(0)) throw acctError(ACCT.VALIDATION, { message: "Nothing due" });
  if (!["sent", "overdue"].includes(inv.status)) {
    throw acctError(ACCT.INVOICE_NOT_ISSUED, { message: "Invoice is not payable" });
  }
  if (["paid", "void"].includes(inv.status) || !amountDue.greaterThan(0)) {
    throw acctError(ACCT.VALIDATION, { message: "Invoice is not payable" });
  }
  const base = publicAppBaseUrl();
  const amountMinor = toMinor(amountDue);
  // Stripe helper expects major units then *100 — derive from minor to avoid float drift.
  const amountMajor = amountMinor / 100;
  let connectedAccountId: string | null = null;
  let applicationFeeMinor: number | null = null;
  if (inv.locationId) {
    const { resolveVenueBookingCheckoutDestination } = await import(
      "@/lib/marketplace/guestPayoutDestination"
    );
    const dest = await resolveVenueBookingCheckoutDestination({
      orgId: inv.orgId,
      locationId: inv.locationId,
      amountMinor,
    });
    connectedAccountId = dest.connectedAccountId;
    applicationFeeMinor = dest.applicationFeeMinor;
  }
  const session = await createCheckoutSession({
    amount: amountMajor,
    currency: inv.currency.toLowerCase(),
    email: inv.customerEmail || "guest@example.com",
    productName: `Invoice ${inv.number}`,
    productDescription:
      inv.org.companyProfile?.tradingName ||
      inv.org.companyProfile?.legalName ||
      inv.org.name,
    metadata: {
      type: "accounting_invoice",
      amount: amountMajor,
      uuid: randomUUID(),
      orgId: inv.orgId,
      invoiceId: inv.id,
      locationId: inv.locationId ?? undefined,
    },
    connectedAccountId,
    applicationFeeMinor,
    successUrl: `${base}/invoice/${inv.viewToken}?paid=1`,
    cancelUrl: `${base}/invoice/${inv.viewToken}?cancelled=1`,
  });
  return { checkoutUrl: session.url, sessionId: session.id };
}

const ROUTES: RouteDef<PublicCtx>[] = [
  {
    method: "GET",
    pattern: "invoices/[token]",
    handler: async ({ params, req }) => {
      rateLimitOrThrow("acct:public-invoice", req, 30, 60_000);
      const inv = await loadPublicInvoice(params.token!);
      return { invoice: publicInvoiceDto(inv) };
    },
  },
  {
    method: "POST",
    pattern: "invoices/[token]/pay",
    handler: async ({ params, req }) => {
      rateLimitOrThrow("acct:public-invoice-pay", req, 10, 60_000);
      const inv = await loadPublicInvoice(params.token!);
      if (inv.kind === "booking") return payBookingInvoice(inv);
      return payManualInvoice(inv);
    },
  },
  {
    method: "GET",
    pattern: "statements/[token]",
    handler: async ({ params, req }) => {
      rateLimitOrThrow("acct:public-statement", req, 30, 60_000);
      return resolveStatementToken(params.token!);
    },
  },
];

export async function handleAccountingPublicRequest(req: NextRequest, pathname: string) {
  const method = req.method.toUpperCase();
  const rule = lookupApiPermission(method, pathname);
  if (!rule) {
    return NextResponse.json({ success: false, error: "Not found", code: "ACCT_NOT_FOUND" }, { status: 404 });
  }
  const relative = pathname.replace(/^\/api\/public\/accounting\/?/, "");
  const matched = matchRoute(ROUTES, method, relative);
  if (!matched) {
    return NextResponse.json({ success: false, error: "Not found", code: "ACCT_NOT_FOUND" }, { status: 404 });
  }

  try {
    await connectDB();
    if (method !== "GET") await readJsonBody(req); // discard body; amount never trusted
    const data = await matched.def.handler({
      ctx: {},
      params: matched.params,
      body: {},
      sp: req.nextUrl.searchParams,
      req,
      form: null,
    });
    return respond(data);
  } catch (err) {
    return accountingRouteError(err, req, `${method} ${pathname}`);
  }
}
