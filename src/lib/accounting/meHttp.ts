/**
 * Customer "me" accounting endpoints (own invoices / statement / summary).
 */
import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import prisma from "@/lib/prisma";
import { requireAnyPermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { accountingRouteError, matchRoute, parseOptionalDate, respond, type RouteDef } from "@/lib/accounting/http";
import { toAccountingInvoiceDto } from "@/lib/accounting/receivables/manualInvoices";
import { D, add, toApiString, ZERO } from "@/lib/accounting/money";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { systemCtx } from "@/lib/accounting/types";
import { buildCustomerStatement } from "@/lib/accounting/receivables/statements";

type MeCtx = { userId: string; guestProfileIds: string[] };

async function loadMe(userId: string): Promise<MeCtx> {
  const guests = await prisma.guestProfile.findMany({
    where: { userId },
    select: { id: true },
    take: 200,
  });
  return { userId, guestProfileIds: guests.map((g) => g.id) };
}

function ownInvoiceWhere(me: MeCtx) {
  return {
    OR: [
      { customerUserId: me.userId },
      ...(me.guestProfileIds.length ? [{ guestProfileId: { in: me.guestProfileIds } }] : []),
    ],
  };
}

const routes: RouteDef<MeCtx>[] = [
  {
    method: "GET",
    pattern: "summary",
    handler: async ({ ctx }) => {
      const orgs = await prisma.accountingSettings.findMany({
        where: { enabled: true },
        select: { orgId: true, baseCurrency: true },
        take: 200,
      });
      const orgIds = orgs.map((o) => o.orgId);
      if (!orgIds.length) return { balanceDue: "0.00", invoiceCount: 0, orgs: [] };

      const invoices = await prisma.bookingInvoice.findMany({
        where: {
          orgId: { in: orgIds },
          kind: { in: ["manual", "booking", "credit_note"] },
          status: { in: ["sent", "overdue", "paid"] },
          ...ownInvoiceWhere(ctx),
        },
        select: { orgId: true, amountDue: true, currency: true, status: true },
        take: 2000,
      });

      let balance = ZERO;
      const byOrg = new Map<string, { balanceDue: ReturnType<typeof D>; count: number; currency: string }>();
      for (const inv of invoices) {
        const due = D(inv.amountDue);
        balance = add(balance, due);
        const cur = byOrg.get(inv.orgId) ?? { balanceDue: ZERO, count: 0, currency: inv.currency };
        cur.balanceDue = add(cur.balanceDue, due);
        cur.count += 1;
        byOrg.set(inv.orgId, cur);
      }

      return {
        balanceDue: toApiString(balance),
        invoiceCount: invoices.length,
        orgs: [...byOrg.entries()].map(([orgId, v]) => ({
          orgId,
          balanceDue: toApiString(v.balanceDue),
          invoiceCount: v.count,
          currency: v.currency,
        })),
      };
    },
  },
  {
    method: "GET",
    pattern: "invoices",
    handler: async ({ ctx, sp }) => {
      const limit = Math.min(Math.max(Number(sp.get("limit") ?? 50), 1), 100);
      const rows = await prisma.bookingInvoice.findMany({
        where: {
          ...ownInvoiceWhere(ctx),
          org: { accountingSettings: { enabled: true } },
        },
        include: { lines: true },
        orderBy: [{ issueDate: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(sp.get("cursor") ? { cursor: { id: sp.get("cursor")! }, skip: 1 } : {}),
      });
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      return {
        items: page.map((i) => toAccountingInvoiceDto(i)),
        nextCursor: hasMore ? page[page.length - 1]!.id : null,
      };
    },
  },
  {
    method: "GET",
    pattern: "invoices/[id]",
    handler: async ({ ctx, params }) => {
      const inv = await prisma.bookingInvoice.findFirst({
        where: { id: params.id!, ...ownInvoiceWhere(ctx), org: { accountingSettings: { enabled: true } } },
        include: { lines: true },
      });
      if (!inv) throw acctError(ACCT.NOT_FOUND);
      return { invoice: toAccountingInvoiceDto(inv) };
    },
  },
  {
    method: "GET",
    pattern: "statement",
    handler: async ({ ctx, sp }) => {
      const orgId = sp.get("orgId");
      if (!orgId) throw acctError(ACCT.VALIDATION, { fields: { orgId: "Required" } });
      const settings = await prisma.accountingSettings.findUnique({ where: { orgId } });
      if (!settings?.enabled) throw acctError(ACCT.NOT_FOUND);
      const from = parseOptionalDate(sp.get("from")) ?? new Date(Date.now() - 90 * 86_400_000);
      const to = parseOptionalDate(sp.get("to")) ?? new Date();
      const guest = ctx.guestProfileIds[0];
      const partyKey = guest ? `guest:${guest}` : `user:${ctx.userId}`;
      return buildCustomerStatement(systemCtx(orgId), partyKey, from, to);
    },
  },
];

export async function handleAccountingMeRequest(req: NextRequest, pathname: string) {
  const relative = pathname.replace(/^\/api\/me\/accounting\/?/, "");
  const matched = matchRoute(routes, req.method, relative);
  if (!matched) {
    return NextResponse.json({ success: false, error: "Not found", code: "ACCT_NOT_FOUND" }, { status: 404 });
  }
  try {
    await connectDB();
    const actor = await requireAnyPermissionFresh(req, [P.AccountingStatementsReadOwn]);
    const userId = String(actor.sub ?? "");
    if (!userId) throw acctError(ACCT.NOT_FOUND);
    const me = await loadMe(userId);
    const data = await matched.def.handler({
      ctx: me,
      params: matched.params,
      body: {},
      sp: req.nextUrl.searchParams,
      req,
      form: null,
    });
    return respond(data);
  } catch (err) {
    return accountingRouteError(err, req, pathname);
  }
}
