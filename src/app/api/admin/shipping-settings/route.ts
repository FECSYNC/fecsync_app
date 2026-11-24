import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requirePermissionFresh, requireAnyPermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { apiRateLimited } from "@/lib/rateLimit";
import { isPlainObject } from "@/lib/catalogWrite";
import { requireActorOrgId } from "@/lib/staffOrg";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import type { ShippingProviderCode } from "@prisma/client";
import {
  getOrCreateShippingSettings,
  upsertShippingSettings,
} from "@/lib/shipping/settings";
import { fetchRatesWithFallback } from "@/lib/shipping/providerRouter";
import { ensureShippingEnvValidated } from "@/lib/shipping/validateEnv";
import type {
  ParcelDimensions,
  ShippingOriginAddress,
  ShippingSettingsDoc,
} from "@/lib/shipping/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_PROVIDERS = new Set<ShippingProviderCode>([
  "shipbubble",
  "fez",
  "manual",
]);

function toPublicSettings(settings: ShippingSettingsDoc) {
  return {
    orgId: settings.orgId,
    originAddress: settings.originAddress,
    defaultWeightKg: settings.defaultWeightKg,
    defaultDimensions: settings.defaultDimensions,
    autoBookOnPaid: settings.autoBookOnPaid,
    primaryProvider: settings.primaryProvider,
    enabledProviders: settings.enabledProviders,
    updatedAt: settings.updatedAt,
  };
}

function parseOrigin(
  value: unknown
): ShippingOriginAddress | undefined {
  if (!isPlainObject(value)) return undefined;
  const asText = (v: unknown, fallback = ""): string => {
    if (typeof v === "number" && Number.isFinite(v)) return String(v).trim();
    if (typeof v === "string") return v.trim();
    return fallback;
  };
  return {
    line1: asText(value.line1),
    line2: asText(value.line2) || undefined,
    city: asText(value.city, "Lagos") || "Lagos",
    state: asText(value.state, "Lagos") || "Lagos",
    lga: asText(value.lga) || undefined,
    zip: asText(value.zip) || undefined,
    country: asText(value.country, "NG") || "NG",
    phone: asText(value.phone),
    contactName: asText(value.contactName, "FECSYNC") || "FECSYNC",
  };
}

function parseDimensions(value: unknown): ParcelDimensions | undefined {
  if (!isPlainObject(value)) return undefined;
  const n = (v: unknown, fallback: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x > 0 ? x : fallback;
  };
  return {
    length: n(value.length, 30),
    width: n(value.width, 20),
    height: n(value.height, 10),
  };
}

function parseProviders(value: unknown): ShippingProviderCode[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map((v) => String(v).trim() as ShippingProviderCode)
    .filter((v) => ALLOWED_PROVIDERS.has(v));
  return out.length ? out : undefined;
}

/**
 * GET /api/admin/shipping-settings → shipping:read on actor.orgId.
 */
export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.ShippingRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/admin/shipping-settings", {
          permission: P.ShippingRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const orgId = requireActorOrgId(actor);
    const { assertNotParkLockedCompanyHq } = await import(
      "@/lib/assertNotParkLockedCompanyHq"
    );
    await assertNotParkLockedCompanyHq(actor);
    ensureShippingEnvValidated();
    const settings = await getOrCreateShippingSettings(orgId);
    return ok({ settings: toPublicSettings(settings) });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "GET /api/admin/shipping-settings", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.ShippingRead,
      })
    );
    if (authRes) return authRes;
    console.error("Error fetching shipping settings:", err);
    return serverError("Failed to fetch shipping settings");
  }
}

/**
 * PUT /api/admin/shipping-settings → shipping:write on actor.orgId.
 */
export async function PUT(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.ShippingWrite);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "PUT /api/admin/shipping-settings", {
          permission: P.ShippingWrite,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  if (!isPlainObject(body)) {
    return badRequest("Invalid JSON");
  }

  try {
    const orgId = requireActorOrgId(actor);
    const { assertNotParkLockedCompanyHq } = await import(
      "@/lib/assertNotParkLockedCompanyHq"
    );
    await assertNotParkLockedCompanyHq(actor);
    const originAddress = parseOrigin(body.originAddress);
    const defaultDimensions = parseDimensions(body.defaultDimensions);
    const enabledProviders = parseProviders(body.enabledProviders);

    let defaultWeightKg: number | undefined;
    if (body.defaultWeightKg !== undefined && body.defaultWeightKg !== null) {
      const w = Number(body.defaultWeightKg);
      if (!Number.isFinite(w) || w <= 0) {
        return badRequest("defaultWeightKg must be a positive number");
      }
      defaultWeightKg = w;
    }

    let autoBookOnPaid: boolean | undefined;
    if (typeof body.autoBookOnPaid === "boolean") {
      autoBookOnPaid = body.autoBookOnPaid;
    }

    let primaryProvider: ShippingProviderCode | undefined;
    if (typeof body.primaryProvider === "string") {
      const p = body.primaryProvider.trim() as ShippingProviderCode;
      if (!ALLOWED_PROVIDERS.has(p)) {
        return badRequest("Invalid primaryProvider");
      }
      primaryProvider = p;
    }

    if (
      originAddress === undefined &&
      defaultWeightKg === undefined &&
      defaultDimensions === undefined &&
      autoBookOnPaid === undefined &&
      primaryProvider === undefined &&
      enabledProviders === undefined
    ) {
      return badRequest("Provide at least one settings field to update");
    }

    const current = await getOrCreateShippingSettings(orgId);
    const nextEnabled =
      enabledProviders ??
      (current.enabledProviders?.length
        ? current.enabledProviders
        : [current.primaryProvider]);
    const nextPrimary = primaryProvider ?? current.primaryProvider;
    if (!nextEnabled.includes(nextPrimary)) {
      return badRequest("primaryProvider must be included in enabledProviders");
    }

    const settings = await upsertShippingSettings(orgId, {
      originAddress,
      defaultWeightKg,
      defaultDimensions,
      autoBookOnPaid,
      primaryProvider: nextPrimary,
      enabledProviders: nextEnabled,
    });

    logStaffActivityEntry(actor, {
      action: "Shipping Settings Updated",
      entityType: "Settings",
      entityId: settings._id,
      description: "Updated shipping settings",
      request: req,
    });

    return ok({
      message: "Shipping settings updated successfully",
      settings: toPublicSettings(settings),
    });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "PUT /api/admin/shipping-settings", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.ShippingWrite,
      })
    );
    if (authRes) return authRes;
    console.error("Error updating shipping settings:", err);
    return serverError("Failed to update shipping settings");
  }
}

/**
 * POST /api/admin/shipping-settings — test connection (sandbox rate fetch).
 * Body optional: `{ destinationState?: string }`
 */
export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.ShippingWrite);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "POST /api/admin/shipping-settings", {
          permission: P.ShippingWrite,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const limited = apiRateLimited(
    req,
    "shipping-settings-test",
    10,
    60_000,
    actor.sub
  );
  if (limited) return limited;

  let body: Record<string, unknown> = {};
  try {
    const raw = await req.json();
    if (isPlainObject(raw)) body = raw;
  } catch {
    body = {};
  }

  try {
    const orgId = requireActorOrgId(actor);
    const { assertNotParkLockedCompanyHq } = await import(
      "@/lib/assertNotParkLockedCompanyHq"
    );
    await assertNotParkLockedCompanyHq(actor);
    ensureShippingEnvValidated();
    const settings = await getOrCreateShippingSettings(orgId);
    const origin = settings.originAddress;
    if (!origin.line1?.trim() || !origin.phone?.trim()) {
      return badRequest(
        "Configure origin address (line1 + phone) before testing connection"
      );
    }

    const destState =
      typeof body.destinationState === "string" && body.destinationState.trim()
        ? body.destinationState.trim()
        : "Lagos";

    const live = await fetchRatesWithFallback({
      cart: {
        lines: [{ quantity: 1, lineType: "product" }],
      } as never,
      settings,
      origin,
      destination: {
        line1: "Test Destination",
        city: destState,
        state: destState,
        country: "NG",
        phone: origin.phone || "08000000000",
      },
      recipientEmail: "shipping-test@fecsync.com",
      senderEmail: process.env.SHIPBUBBLE_SENDER_EMAIL || undefined,
    });

    return ok({
      message:
        live.quotes.length > 0
          ? `Connection OK — ${live.quotes.length} quote(s) from ${live.providersTried.join(", ")}`
          : `Providers tried (${live.providersTried.join(", ") || "none"}) but no quotes returned`,
      providersTried: live.providersTried,
      quoteCount: live.quotes.length,
      sampleFees: live.quotes.slice(0, 5).map((q) => ({
        provider: q.provider,
        courierName: q.courierName,
        fee: q.fee,
        currency: q.currency,
      })),
    });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "POST /api/admin/shipping-settings", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.ShippingWrite,
      })
    );
    if (authRes) return authRes;
    console.error("Shipping connection test failed:", err);
    return serverError("Connection test failed");
  }
}
