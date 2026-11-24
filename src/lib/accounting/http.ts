/**
 * Accounting HTTP helpers shared by the staff, me, and public catch-all routes.
 */
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { authErrorToResponse, authAudit, badRequest, created, ok, serverError } from "@/lib/response";
import { isAuthHttpError } from "@/lib/auth/http-error";
import { accountingErrorToResponse, isAccountingError } from "@/lib/accounting/errors";

export type RouteParams = Record<string, string>;

export type RouteDef<C> = {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  pattern: string;
  multipart?: boolean;
  requireInitialized?: boolean;
  status?: 200 | 201;
  handler: (args: { ctx: C; params: RouteParams; body: Record<string, unknown>; sp: URLSearchParams; req: NextRequest; form: FormData | null }) => Promise<unknown>;
};

function compile(pattern: string): { regex: RegExp; keys: string[] } {
  const keys: string[] = [];
  const src = pattern
    .split("/")
    .map((seg) => {
      const m = /^\[(\w+)\]$/.exec(seg);
      if (m) {
        keys.push(m[1]!);
        return "([^/]+)";
      }
      return seg.replace(/[.*+?^${}()|\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${src}$`), keys };
}

export function matchRoute<C>(routes: RouteDef<C>[], method: string, pathname: string): { def: RouteDef<C>; params: RouteParams } | null {
  let best: { def: RouteDef<C>; params: RouteParams; staticLen: number } | null = null;
  for (const def of routes) {
    if (def.method !== method) continue;
    const { regex, keys } = compile(def.pattern);
    const m = regex.exec(pathname);
    if (!m) continue;
    const params: RouteParams = {};
    keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]!)));
    const staticLen = def.pattern.replace(/\[\w+\]/g, "").length;
    if (!best || staticLen > best.staticLen) best = { def, params, staticLen };
  }
  return best ? { def: best.def, params: best.params } : null;
}

export async function readJsonBody(req: NextRequest): Promise<Record<string, unknown>> {
  if (req.method === "GET" || req.method === "DELETE") return {};
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { value: parsed };
  } catch {
    throw new SyntaxError("Invalid JSON");
  }
}

export function zodFields(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function accountingRouteError(err: unknown, req: NextRequest, route: string): NextResponse {
  const acct = accountingErrorToResponse(err);
  if (acct) return acct;
  if (err instanceof ZodError) {
    return NextResponse.json(
      { success: false, error: "ACCT_VALIDATION", code: "ACCT_VALIDATION", fields: zodFields(err) },
      { status: 400 }
    );
  }
  if (err instanceof SyntaxError) return badRequest("Invalid JSON");
  if (isAuthHttpError(err)) return authErrorToResponse(err, authAudit(req, route)) ?? serverError("Failed to authorize");
  const auth = authErrorToResponse(err, authAudit(req, route));
  if (auth) return auth;
  if (err instanceof Error && /^(.+) is (required|invalid)$/.test(err.message)) {
    return NextResponse.json({ success: false, error: "ACCT_VALIDATION", code: "ACCT_VALIDATION", fields: { _: err.message } }, { status: 400 });
  }
  console.error(`[accounting] ${route}`, err);
  return serverError("Accounting request failed");
}

export function respond(data: unknown, status: 200 | 201 = 200) {
  return status === 201 ? created(data as never) : ok(data as never);
}

export function isAcctErr(err: unknown) {
  return isAccountingError(err);
}

export function parseOptionalDate(raw: string | null): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
