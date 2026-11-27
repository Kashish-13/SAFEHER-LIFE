import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import type { Role } from "@/core/types";
import { requireAuth, type AuthContext } from "./auth";
import { assertServerConfigured, ConfigError } from "./env";
import { ApiError, badRequest, notFound } from "./errors";
import { checkRateLimit, RATE_LIMITS, type RateLimitRule } from "./rate-limit";
import { StoreError, type StoreErrorCode } from "./store/errors";
import { isValidDocId } from "./store/validate";

/**
 * Store failures → HTTP. Messages are generic: store details (paths, project ids) are
 * logged on the server only. Quota exhaustion keeps the 112 advice visible, because the
 * person may be trying to raise an emergency.
 */
const STORE_ERROR_HTTP: Partial<Record<StoreErrorCode, { status: number; message: string }>> = {
  not_found: { status: 404, message: "Not found" },
  already_exists: { status: 409, message: "This was changed by someone else at the same moment. Please try again." },
  aborted: { status: 409, message: "This was changed by someone else at the same moment. Please try again." },
  unavailable: { status: 503, message: "The service is temporarily unavailable. Please try again. If you are in danger, call 112." },
  quota_exhausted: { status: 503, message: "The service is over capacity right now. If you are in danger, call 112." },
};

type Params = Record<string, string>;

interface HandlerContext<P extends Params> {
  req: NextRequest;
  auth: AuthContext;
  params: P;
}

interface Options {
  roles?: Role[];
  rateLimit?: RateLimitRule;
}

function clientIp(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export function errorResponse(err: unknown) {
  if (err instanceof ConfigError) {
    // Details are logged server-side only; clients get a generic message.
    console.error("[config]", err.problems.join(" | "));
    return NextResponse.json({ error: { code: "server_misconfigured", message: "SafeHer is not configured correctly on the server. If you are in danger, call 112." } }, { status: 503 });
  }
  if (err instanceof ApiError) {
    const res = NextResponse.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
    if (err.status === 429) res.headers.set("Retry-After", String((err.details as { retryAfterSeconds: number }).retryAfterSeconds));
    return res;
  }
  if (err instanceof StoreError) {
    console.error(`[store] ${err.code}: ${err.message}`);
    const mapped = STORE_ERROR_HTTP[err.code];
    if (mapped) return NextResponse.json({ error: { code: err.code, message: mapped.message } }, { status: mapped.status });
    return NextResponse.json({ error: { code: "internal_error", message: "Something went wrong. Please try again." } }, { status: 500 });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "validation_error", message: err.issues[0]?.message ?? "Invalid input", details: err.flatten() } },
      { status: 400 },
    );
  }
  console.error("[api] unhandled error", err);
  return NextResponse.json({ error: { code: "internal_error", message: "Something went wrong. Please try again." } }, { status: 500 });
}

/**
 * Wraps an authenticated route handler with: authentication, role checks,
 * rate limiting, and uniform error responses. Every API route except public
 * ones goes through this.
 */
export function authed<P extends Params = Params>(
  handler: (ctx: HandlerContext<P>) => Promise<unknown>,
  options: Options = {},
) {
  return async (req: NextRequest, routeCtx: { params: Promise<P> }) => {
    try {
      assertServerConfigured();
      const rule = options.rateLimit ?? (req.method === "GET" ? RATE_LIMITS.default : RATE_LIMITS.write);
      // Coarse per-IP guard for authenticated calls. Uses its OWN counter so authenticated
      // traffic can't exhaust the public sign-in budget (publicRoute's `ip:` counter).
      checkRateLimit(`authed-ip:${clientIp(req)}`, { ...rule, limit: rule.limit * 3 });
      const auth = await requireAuth(req, options.roles);
      checkRateLimit(`uid:${auth.uid}`, rule);
      const params = (await routeCtx?.params) ?? ({} as P);
      // Every dynamic route segment ([id], [token]) names a document. An id the store would reject
      // (e.g. "../users/x", which in Firestore addresses a DIFFERENT document) can't exist, so the
      // honest answer is a generic 404, before any service or store code runs.
      for (const value of Object.values(params)) {
        if (!isValidDocId(value)) throw notFound();
      }
      const result = await handler({ req, auth, params });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Public (unauthenticated) handler wrapper with IP rate limiting. */
export function publicRoute(handler: (req: NextRequest) => Promise<unknown>, rule: RateLimitRule = RATE_LIMITS.auth) {
  return async (req: NextRequest) => {
    try {
      assertServerConfigured();
      checkRateLimit(`ip:${clientIp(req)}`, rule);
      const result = await handler(req);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Parses and validates a JSON body. Rejects bodies over 64 KB. */
export async function parseBody<T>(req: Request, schema: ZodType<T, any, any>): Promise<T> {
  const text = await req.text();
  if (text.length > 64 * 1024) throw badRequest("Request body too large");
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw badRequest("Invalid JSON body");
  }
  return schema.parse(json);
}
