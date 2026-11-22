import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";

export const VIEWPORTS = [
  { name: "375", width: 375, height: 812 },
  { name: "768", width: 768, height: 1024 },
  { name: "1280", width: 1280, height: 800 },
] as const;

/**
 * Gets a demo session token for a fictional persona (demo mode only).
 * Tokens are cached per persona: demo sign-in is rate-limited (10/min/IP) and the
 * tests must respect that limit rather than weaken it. `fresh` forces a new token
 * (needed after sign-out-everywhere invalidates old ones).
 */
const tokenCache = new Map<string, string>();
export async function demoToken(request: APIRequestContext, personaId: string, fresh = false): Promise<string> {
  if (!fresh && tokenCache.has(personaId)) return tokenCache.get(personaId)!;
  const r = await request.post("/api/demo/session", { data: { personaId } });
  if (!r.ok()) throw new Error(`demo login failed for ${personaId}: ${r.status()}`);
  const token = (await r.json()).token as string;
  tokenCache.set(personaId, token);
  return token;
}

/** Signs a browser context in as a persona by seeding the demo token before any page script runs. */
export async function signIn(context: BrowserContext, request: APIRequestContext, personaId: string) {
  const token = await demoToken(request, personaId);
  await context.addInitScript((t) => { try { localStorage.setItem("safeher.demoToken", t); } catch {} }, token);
  return token;
}

export async function api<T = unknown>(request: APIRequestContext, token: string, method: string, path: string, data?: unknown): Promise<{ status: number; body: T }> {
  const r = await request.fetch(path, { method, data, headers: { authorization: `Bearer ${token}` } });
  return { status: r.status(), body: (await r.json().catch(() => ({}))) as T };
}

/** Waits until the client app has finished loading (no spinners / skeletons). */
export async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"], [aria-label="Loading"]'), undefined, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(300);
}

/** True if the page scrolls horizontally (a responsive-layout bug). */
export async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return { overflow: el.scrollWidth > window.innerWidth + 1, scrollWidth: el.scrollWidth, viewport: window.innerWidth };
  });
}
