import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import type { Role } from "@/core/types";
import { requireAuth, type AuthContext } from "./auth";
import { ApiError, badRequest } from "./errors";
import { checkRateLimit, RATE_LIMITS, type RateLimitRule } from "./rate-limit";

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
  if (err instanceof ApiError) {
    const res = NextResponse.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
    if (err.status === 429) res.headers.set("Retry-After", String((err.details as { retryAfterSeconds: number }).retryAfterSeconds));
    return res;
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
      const rule = options.rateLimit ?? (req.method === "GET" ? RATE_LIMITS.default : RATE_LIMITS.write);
      checkRateLimit(`ip:${clientIp(req)}`, { ...rule, limit: rule.limit * 3 }); // coarse per-IP guard
      const auth = await requireAuth(req, options.roles);
      checkRateLimit(`uid:${auth.uid}`, rule);
      const params = (await routeCtx?.params) ?? ({} as P);
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
