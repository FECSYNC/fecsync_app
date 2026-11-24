/**
 * B2B BookingAccount + contacts (NOT a SaaS Organization).
 */
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId, requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  assertTicketingStaffMutate,
  assertTicketingStaffRead,
  assertLocationInHqScope,
  assertVenueActiveForTicketingMutate,
  locationScopeFilter,
  parseOptionalId,
  rejectClientOrgFields,
  requireActorVenue,
  ACCOUNT_NOT_FOUND,
  type TicketingActor,
} from "@/lib/ticketing/common";

export type CreateAccountInput = {
  name: string;
  billingEmail?: string | null;
  phone?: string | null;
  taxId?: string | null;
  notes?: string | null;
  defaultTaxExempt?: boolean;
  locationId?: string | null;
};

export type CreateContactInput = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  isPrimary?: boolean;
};

function requireName(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("Company name is required");
  const name = raw.trim();
  if (name.length < 2) throw new Error("Company name is required");
  if (name.length > 200) throw new Error("Company name is too long");
  return name;
}

export function toAccountDto(row: {
  id: string;
  orgId: string;
  locationId: string | null;
  name: string;
  billingEmail: string | null;
  phone: string | null;
  taxId: string | null;
  notes: string | null;
  defaultTaxExempt: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { contacts?: number; bookings?: number };
  contacts?: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    title: string | null;
    isPrimary: boolean;
  }>;
  storedPaymentMethods?: Array<{
    id: string;
    brand: string | null;
    last4: string | null;
    expMonth: number | null;
    expYear: number | null;
    isDefault: boolean;
  }>;
}) {
  return {
    id: row.id,
    orgId: row.orgId,
    locationId: row.locationId,
    name: row.name,
    billingEmail: row.billingEmail,
    phone: row.phone,
    taxId: row.taxId,
    notes: row.notes,
    defaultTaxExempt: row.defaultTaxExempt,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    contactsCount: row._count?.contacts ?? row.contacts?.length ?? 0,
    bookingsCount: row._count?.bookings ?? 0,
    contacts: row.contacts,
    storedCards: (row.storedPaymentMethods ?? []).map((m) => ({
      id: m.id,
      brand: m.brand,
      last4: m.last4,
      expMonth: m.expMonth,
      expYear: m.expYear,
      isDefault: m.isDefault,
    })),
  };
}

export async function listBookingAccounts(actor: TicketingActor) {
  await assertTicketingStaffRead(actor);
  const scope = await locationScopeFilter(actor);
  const where: Prisma.BookingAccountWhereInput = {
    orgId: scope.orgId,
    archivedAt: null,
  };
  if (scope.parkLocked) {
    if (scope.locationId) {
      where.locationId = scope.locationId;
    } else if (scope.locationIds?.length) {
      where.locationId = { in: scope.locationIds };
    } else {
      where.locationId = { in: [] };
    }
  } else if (scope.locationId) {
    where.OR = [{ locationId: scope.locationId }, { locationId: null }];
  }

  const rows = await prisma.bookingAccount.findMany({
    where,
    include: {
      _count: { select: { contacts: true, bookings: true } },
    },
    orderBy: { name: "asc" },
  });
  return rows.map(toAccountDto);
}

export async function getBookingAccount(
  actor: TicketingActor,
  accountId: string
) {
  await assertTicketingStaffRead(actor);
  const orgId = (await locationScopeFilter(actor)).orgId;
  const row = await prisma.bookingAccount.findFirst({
    where: { id: requireId(accountId, "accountId"), orgId },
    include: {
      contacts: { orderBy: [{ isPrimary: "desc" }, { lastName: "asc" }] },
      storedPaymentMethods: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          brand: true,
          last4: true,
          expMonth: true,
          expYear: true,
          isDefault: true,
        },
      },
      _count: { select: { contacts: true, bookings: true } },
    },
  });
  if (!row) throw new ForbiddenError(ACCOUNT_NOT_FOUND);
  await assertLocationInHqScope(actor, row.locationId);
  return toAccountDto(row);
}

export async function createBookingAccount(
  actor: TicketingActor,
  input: CreateAccountInput
) {
  const orgId = await assertTicketingStaffMutate(actor);
  const scope = await locationScopeFilter(actor);
  let locationId = parseOptionalId(input.locationId, "locationId") ?? null;
  if (scope.parkLocked) {
    if (!locationId) {
      locationId =
        scope.locationId ??
        (scope.locationIds?.length === 1 ? scope.locationIds[0]! : null);
    }
    await assertLocationInHqScope(actor, locationId);
  } else if (scope.locationId) {
    locationId = scope.locationId;
  }
  if (locationId) {
    await requireActorVenue(orgId, locationId);
    await assertLocationInHqScope(actor, locationId);
  }

  const row = await prisma.bookingAccount.create({
    data: {
      orgId,
      locationId,
      name: requireName(input.name),
      billingEmail: input.billingEmail?.trim() || null,
      phone: input.phone?.trim() || null,
      taxId: input.taxId?.trim() || null,
      notes: input.notes?.trim() || null,
      defaultTaxExempt: Boolean(input.defaultTaxExempt),
    },
    include: {
      _count: { select: { contacts: true, bookings: true } },
      contacts: true,
    },
  });
  return toAccountDto(row);
}

export async function updateBookingAccount(
  actor: TicketingActor,
  accountId: string,
  patch: Partial<CreateAccountInput> & {
    archive?: boolean;
    unarchive?: boolean;
  }
) {
  const orgId = await assertTicketingStaffMutate(actor);
  const existing = await prisma.bookingAccount.findFirst({
    where: { id: requireId(accountId, "accountId"), orgId },
  });
  if (!existing) throw new ForbiddenError(ACCOUNT_NOT_FOUND);
  await assertLocationInHqScope(actor, existing.locationId);
  if (existing.archivedAt && patch.archive) {
    const row = await prisma.bookingAccount.findFirst({
      where: { id: existing.id },
      include: {
        contacts: true,
        _count: { select: { contacts: true, bookings: true } },
      },
    });
    return toAccountDto(row!);
  }

  if (existing.locationId) {
    await assertVenueActiveForTicketingMutate(orgId, existing.locationId, {
      allowArchived: Boolean(patch.archive),
    });
  }

  if (existing.archivedAt && !patch.unarchive) {
    throw new Error("Archived accounts cannot be edited — unarchive first");
  }

  const data: Prisma.BookingAccountUpdateInput = {};
  if (patch.name !== undefined) data.name = requireName(patch.name);
  if (patch.billingEmail !== undefined) {
    data.billingEmail = patch.billingEmail?.trim() || null;
  }
  if (patch.phone !== undefined) data.phone = patch.phone?.trim() || null;
  if (patch.taxId !== undefined) data.taxId = patch.taxId?.trim() || null;
  if (patch.notes !== undefined) data.notes = patch.notes?.trim() || null;
  if (patch.defaultTaxExempt !== undefined) {
    data.defaultTaxExempt = Boolean(patch.defaultTaxExempt);
  }
  if (patch.archive) data.archivedAt = new Date();
  if (patch.unarchive) data.archivedAt = null;

  const row = await prisma.bookingAccount.update({
    where: { id: existing.id },
    data,
    include: {
      contacts: true,
      _count: { select: { contacts: true, bookings: true } },
    },
  });
  return toAccountDto(row);
}

export async function archiveBookingAccount(
  actor: TicketingActor,
  accountId: string
) {
  return updateBookingAccount(actor, accountId, { archive: true });
}

export async function createAccountContact(
  actor: TicketingActor,
  accountId: string,
  input: CreateContactInput
) {
  const orgId = await assertTicketingStaffMutate(actor);
  const account = await prisma.bookingAccount.findFirst({
    where: { id: requireId(accountId, "accountId"), orgId },
  });
  if (!account) throw new ForbiddenError(ACCOUNT_NOT_FOUND);
  if (account.archivedAt) {
    throw new Error("Archived accounts cannot be edited — unarchive first");
  }
  await assertLocationInHqScope(actor, account.locationId);
  if (account.locationId) {
    await assertVenueActiveForTicketingMutate(orgId, account.locationId);
  }

  const firstName = input.firstName?.trim() || null;
  const lastName = input.lastName?.trim() || null;
  const email = input.email?.trim() || null;
  const phone = input.phone?.trim() || null;
  const title = input.title?.trim() || null;
  if (!firstName && !lastName && !email && !phone) {
    throw new Error("Contact requires a name, email, or phone");
  }

  const isPrimary = Boolean(input.isPrimary);

  return prisma.$transaction(async (tx) => {
    if (isPrimary) {
      await tx.bookingAccountContact.updateMany({
        where: { accountId: account.id },
        data: { isPrimary: false },
      });
    }

    return tx.bookingAccountContact.create({
      data: {
        accountId: account.id,
        orgId,
        firstName,
        lastName,
        email,
        phone,
        title,
        isPrimary,
      },
    });
  });
}

export async function requireOrgBookingAccount(
  orgId: string,
  accountId: string
) {
  const account = await prisma.bookingAccount.findFirst({
    where: {
      id: requireId(accountId, "accountId"),
      orgId,
      archivedAt: null,
    },
    select: { id: true },
  });
  if (!account) throw new ForbiddenError(ACCOUNT_NOT_FOUND);
  return account;
}

export async function listAccountContacts(
  actor: TicketingActor,
  accountId: string
) {
  const account = await getBookingAccount(actor, accountId);
  return account.contacts ?? [];
}

export function parseCreateAccountBody(body: unknown): CreateAccountInput {
  if (!body || typeof body !== "object") throw new Error("Invalid JSON");
  const b = body as Record<string, unknown>;
  rejectClientOrgFields(b);
  return {
    name: requireName(b.name),
    billingEmail: typeof b.billingEmail === "string" ? b.billingEmail : null,
    phone: typeof b.phone === "string" ? b.phone : null,
    taxId: typeof b.taxId === "string" ? b.taxId : null,
    notes: typeof b.notes === "string" ? b.notes : null,
    defaultTaxExempt: Boolean(b.defaultTaxExempt),
    locationId: parseOptionalId(b.locationId, "locationId") ?? null,
  };
}

export function parseCreateContactBody(body: unknown): CreateContactInput {
  if (!body || typeof body !== "object") throw new Error("Invalid JSON");
  const b = body as Record<string, unknown>;
  rejectClientOrgFields(b);
  return {
    firstName: typeof b.firstName === "string" ? b.firstName : null,
    lastName: typeof b.lastName === "string" ? b.lastName : null,
    email: typeof b.email === "string" ? b.email : null,
    phone: typeof b.phone === "string" ? b.phone : null,
    title: typeof b.title === "string" ? b.title : null,
    isPrimary: Boolean(b.isPrimary),
  };
}
