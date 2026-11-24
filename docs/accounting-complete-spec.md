# Accounting module — complete spec (Steps 1–2 shipped)

**Audience:** operators and agents extending ledger, posting, or UI under `/admin/accounting/**`.

Growth and Enterprise companies enable Accounting from setup (`POST /api/admin/accounting/setup`). Until initialized, only settings/setup preview routes respond; module screens gate with `AccountingGate`.

## Step 1 (foundation)

Prisma models (`AccountingSettings`, `LedgerAccount`, `JournalEntry`, `JournalLine`, `AccountingPostingQueue`, AR/AP, banking, inventory, tax, periods) are org-scoped (`orgId`, optional `locationId`). Staff APIs live under `/api/admin/accounting/[...path]` with `requireAccountingActor`. Auto-posting enqueue hooks in booking, POS, shop, memberships, tailoring, and marketplace paths stamp `AccountingPostingQueue` rows; `processPostingQueue` posts idempotent journals.

## Step 2 (connections + ops UI)

Admin hub: dashboard KPIs, chart, journals, ledger, customers/invoices/receipts, suppliers/bills/payments, expenses, banking, reconciliations, inventory, reports, posting queue, approvals, audit, tax codes (SALES syncs from checkout Tax settings), opening balances, settings.

**Module deep-links (Step 2-C):** shared `AccountingEntriesPanel` on booking/party, POS sale, booking invoice, membership payments, shop order, tailoring job (when `postTailoringJobs`), supplier bill, expense, and manual invoice detail — via `GET /api/admin/accounting/source-entries`.

**HQ:** Enterprise `/api/admin/hq/overview` soft-includes MTD revenue, expenses, net, cash, and AR from `getAccountingDashboard` when Accounting is initialized (respects HQ location scope).

**Notifications:** in-app `type: accounting` with `metadata.href` / `metadata.deepLink`; header bell shows calculator icon.

QuickBooks/Xero sync is **not** shipped (see Feature 28 catalog note).

Prompts / tracker: [`docs/accounting-two-step-prompts.md`](./accounting-two-step-prompts.md), [`docs/accounting-implementation-tracker.md`](./accounting-implementation-tracker.md).
