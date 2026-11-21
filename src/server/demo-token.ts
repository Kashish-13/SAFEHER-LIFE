import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getDemoSecret } from "./env";

/**
 * Signed demo session tokens: base64url(JSON payload) + "." + HMAC-SHA256.
 * Only accepted while demo mode is enabled. Never used when Firebase is configured.
 */
const PREFIX = "demo.";

export function signDemoToken(uid: string, ttlSeconds = 60 * 60 * 12): string {
  const payload = Buffer.from(JSON.stringify({ uid, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  const sig = createHmac("sha256", getDemoSecret()).update(payload).digest("base64url");
  return `${PREFIX}${payload}.${sig}`;
}

export function verifyDemoToken(token: string): { uid: string } | null {
  if (!token.startsWith(PREFIX)) return null;
  const [payload, sig] = token.slice(PREFIX.length).split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", getDemoSecret()).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { uid?: unknown; exp?: unknown };
    if (typeof data.uid !== "string" || typeof data.exp !== "number") return null;
    if (data.exp < Date.now() / 1000) return null;
    return { uid: data.uid };
  } catch {
    return null;
  }
}
