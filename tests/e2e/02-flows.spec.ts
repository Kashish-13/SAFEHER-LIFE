import { expect, test, type Browser, type APIRequestContext } from "@playwright/test";
import { api, demoToken, settle } from "./helpers";

/**
 * Phase 0 security flows driven through the real UI in a real browser.
 * Demo mode only: every person is fictional and every alert is simulated.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = "gate-a/screenshots/flows";
const location = { latitude: 28.6315, longitude: 77.2167 };

async function personaPage(browser: Browser, request: APIRequestContext, personaId: string, viewport = { width: 1280, height: 900 }) {
  const token = await demoToken(request, personaId);
  const context = await browser.newContext({ viewport, reducedMotion: "reduce", permissions: ["geolocation"], geolocation: location });
  await context.addInitScript((t) => { try { localStorage.setItem("safeher.demoToken", t); } catch {} }, token);
  return { context, page: await context.newPage(), token };
}

test("owner sees the REAL identity behind a forwarded invitation and can reject it", async ({ browser, request }) => {
  const { context, page } = await personaPage(browser, request, "demo_priya", { width: 390, height: 844 });
  await page.goto("/circle");
  await settle(page);
  const card = page.getByRole("region", { name: "Requests waiting for your approval" });
  await expect(card.getByText("Approve R. Kumar as your brother?")).toBeVisible();
  await expect(card.getByText("rk.forwarded.demo@example.com")).toBeVisible();          // actual claimant
  await expect(card.getByText("rohan.demo@safeher.app")).toBeVisible();                 // who was invited
  await expect(card.getByText("This account doesn't match who you invited")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-forwarded-invite-approval-card-mobile.png`, fullPage: true });

  await card.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByText("Request rejected. No access was granted.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Requests waiting for your approval" })).toHaveCount(0);
  await context.close();
});

test("invitation claim → owner approval → linked identity shown", async ({ browser, request }) => {
  const meera = await demoToken(request, "demo_meera");
  const created = await api<{ inviteLink: string }>(request, meera, "POST", "/api/contacts",
    { name: "Anita Sharma", relationship: "Mother", email: "anita.demo@safeher.app", priority: "primary" });
  expect(created.status).toBe(200);
  const invitePath = new URL(created.body.inviteLink).pathname;

  // Anita accepts in her browser → only a claim; she waits for approval.
  const anita = await personaPage(browser, request, "demo_anita");
  await anita.page.goto(invitePath);
  await settle(anita.page);
  await expect(anita.page.getByText("will see your account's")).toBeVisible();
  await anita.page.screenshot({ path: `${SHOTS}/02-invitation-page.png`, fullPage: true });
  await anita.page.getByRole("button", { name: "Accept" }).click();
  await expect(anita.page.getByRole("heading", { name: "Waiting for Meera to approve" })).toBeVisible();
  await anita.page.screenshot({ path: `${SHOTS}/03-claimant-waiting-for-approval.png`, fullPage: true });

  // The same (forwarded) link cannot be used again by anyone.
  const third = await demoToken(request, "demo_admin");
  const reuse = await api(request, third, "POST", "/api/invitations/respond", { token: invitePath.split("/invite/")[1], decision: "accept" });
  expect(reuse.status).toBe(404);

  // Meera sees Anita's verified identity, with a match, and approves.
  const owner = await personaPage(browser, request, "demo_meera");
  await owner.page.goto("/circle");
  await settle(owner.page);
  const card = owner.page.getByRole("region", { name: "Requests waiting for your approval" });
  await expect(card.getByText("Approve Anita Sharma as your mother?")).toBeVisible();
  await expect(card.getByText("Email matches")).toBeVisible();
  await owner.page.screenshot({ path: `${SHOTS}/04-owner-approval-matching-identity.png`, fullPage: true });
  await card.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(owner.page.getByText("Anita Sharma can now receive your alerts")).toBeVisible();
  await expect(owner.page.getByText("Linked account:").first()).toBeVisible();
  await anita.context.close();
  await owner.context.close();
});

test("SOS → contact acknowledges → blocking revokes the contact's access immediately", async ({ browser, request }) => {
  const priya = await personaPage(browser, request, "demo_priya");
  await priya.page.goto("/sos");
  await settle(priya.page);
  await priya.page.getByRole("button", { name: /Send SOS emergency alert/ }).click();
  await expect(priya.page.getByRole("button", { name: /Cancel. I.m OK/ })).toBeVisible();
  await priya.page.waitForURL(/\/emergency\/sos_/, { timeout: 30_000 });
  const eventId = priya.page.url().split("/emergency/")[1];
  await settle(priya.page);
  await expect(priya.page.getByRole("heading", { name: "Your emergency alert" })).toBeVisible();

  // Contact side: banner, open, acknowledge.
  const anita = await personaPage(browser, request, "demo_anita", { width: 390, height: 844 });
  await anita.page.goto("/dashboard");
  await expect(anita.page.getByText(/Priya Sharma needs help/).first()).toBeVisible({ timeout: 30_000 });
  await anita.page.goto(`/emergency/${eventId}`);
  await settle(anita.page);
  await expect(anita.page.getByRole("heading", { name: "Priya Sharma needs help" })).toBeVisible();
  await anita.page.screenshot({ path: `${SHOTS}/05-contact-view-active-emergency-mobile.png`, fullPage: true });
  await anita.page.getByRole("button", { name: /I.m responding/ }).click();
  await expect(anita.page.getByText(/You acknowledged this alert/)).toBeVisible();

  // Owner sees the acknowledgement (poll ≤ 4 s).
  await expect(priya.page.getByText("Acknowledged").first()).toBeVisible({ timeout: 15_000 });
  await priya.page.screenshot({ path: `${SHOTS}/06-owner-view-acknowledged.png`, fullPage: true });

  // Block Anita → her access ends at once, even though the emergency is still active.
  const block = await api(request, priya.token, "PATCH", "/api/contacts/tc_demo_anita", { action: "block" });
  expect(block.status).toBe(200);
  await anita.page.reload();
  await settle(anita.page);
  await expect(anita.page.getByText(/no longer have access|don't have access/).first()).toBeVisible();
  await expect(anita.page.getByRole("heading", { name: "Priya Sharma needs help" })).toHaveCount(0);
  await anita.page.screenshot({ path: `${SHOTS}/07-blocked-contact-access-revoked-mobile.png`, fullPage: true });

  // Restore for later flows and close the emergency.
  await api(request, priya.token, "PATCH", "/api/contacts/tc_demo_anita", { action: "unblock" });
  await priya.page.getByRole("button", { name: /I.m safe now/ }).click();
  await expect(priya.page.getByText(/Your contacts can view this emergency until/)).toBeVisible({ timeout: 15_000 });
  await priya.page.screenshot({ path: `${SHOTS}/08-owner-resolved-24h-window.png`, fullPage: true });
  await priya.context.close();
  await anita.context.close();
});

test("sign out everywhere invalidates other sessions", async ({ browser, request }) => {
  const a = await personaPage(browser, request, "demo_admin");
  const b = await personaPage(browser, request, "demo_admin");
  await b.page.goto("/dashboard");
  await settle(b.page);
  await expect(b.page.locator("h1").first()).toBeVisible();

  await a.page.goto("/settings/account");
  await settle(a.page);
  a.page.once("dialog", (d) => d.accept());
  await a.page.getByRole("button", { name: "Sign out everywhere" }).click();
  await a.page.waitForURL(/\/login/);

  // The OTHER device's token is now rejected by the server.
  expect((await api(request, b.token, "GET", "/api/me")).status).toBe(401);
  await a.context.close();
  await b.context.close();
});

test("account deletion requires confirming identity first", async ({ browser, request }) => {
  const m = await personaPage(browser, request, "demo_meera");
  await m.page.goto("/settings/account");
  await settle(m.page);
  await m.page.getByRole("button", { name: "Delete my account" }).click();
  const dialog = m.page.getByRole("dialog");
  await expect(dialog.getByText("For your security, confirm it's you first.")).toBeVisible();
  await m.page.screenshot({ path: `${SHOTS}/09-delete-requires-reauth.png` });
  await dialog.getByRole("button", { name: /Confirm it.s me/ }).click();
  await expect(dialog.getByText("Identity confirmed")).toBeVisible();
  await dialog.getByLabel("Confirmation").fill("DELETE");
  await dialog.getByRole("button", { name: "Permanently delete" }).click();
  await m.page.waitForURL((u) => u.pathname === "/");
  await m.context.close();

  // The account really is gone (checked via the admin API, which never exposes location).
  const admin = await demoToken(request, "demo_admin", true);
  const users = await api<{ users: { id: string }[] }>(request, admin, "GET", "/api/admin/users");
  expect(users.status).toBe(200);
  expect(users.body.users.map((u) => u.id)).not.toContain("demo_meera");
  // Stale-session rejection (sign-in older than 5 min → 401 reauth_required) is covered in tests/server/phase0-security.test.ts.
});
