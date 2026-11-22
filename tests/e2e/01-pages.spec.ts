import { expect, test } from "@playwright/test";
import { horizontalOverflow, settle, signIn, VIEWPORTS } from "./helpers";

/**
 * Renders every existing page at 375 / 768 / 1280 px and checks for:
 *  - successful load and a visible top-level heading
 *  - no uncaught JS errors and no console errors
 *  - no horizontal page scroll (responsive layout)
 * Full-page screenshots are saved to gate-a/screenshots/<width>/<page>.png
 */
type PageDef = { name: string; path: string; as?: string; expectText?: RegExp };

const PAGES: PageDef[] = [
  { name: "landing", path: "/" },
  { name: "features", path: "/features" },
  { name: "how-it-works", path: "/how-it-works" },
  { name: "privacy-safety", path: "/privacy-safety" },
  { name: "about", path: "/about" },
  { name: "contact", path: "/contact" },
  { name: "login", path: "/login" },
  { name: "signup", path: "/signup" },
  { name: "forgot-password", path: "/forgot-password" },
  { name: "not-found", path: "/this-page-does-not-exist" },
  { name: "onboarding", path: "/onboarding", as: "demo_priya" },
  { name: "dashboard", path: "/dashboard", as: "demo_priya" },
  { name: "sos", path: "/sos", as: "demo_priya" },
  { name: "circle", path: "/circle", as: "demo_priya" },
  { name: "location", path: "/location", as: "demo_priya" },
  { name: "journey", path: "/journey", as: "demo_priya" },
  { name: "emergency-services", path: "/emergency-services", as: "demo_priya" },
  { name: "fake-call", path: "/fake-call", as: "demo_priya" },
  { name: "history", path: "/history", as: "demo_priya" },
  { name: "emergency-past-owner", path: "/emergency/sos_demo_past", as: "demo_priya" },
  { name: "notifications", path: "/notifications", as: "demo_priya" },
  { name: "profile", path: "/profile", as: "demo_priya" },
  { name: "settings-sos", path: "/settings/sos", as: "demo_priya" },
  { name: "settings-voice", path: "/settings/voice", as: "demo_priya" },
  { name: "settings-privacy", path: "/settings/privacy", as: "demo_priya" },
  { name: "settings-account", path: "/settings/account", as: "demo_priya" },
  { name: "circle-as-contact", path: "/circle", as: "demo_anita" },
  // Closed 3 days ago → Anita's 24 h access has expired; the page must say so and show nothing else.
  { name: "emergency-past-expired-contact", path: "/emergency/sos_demo_past", as: "demo_anita", expectText: /don't have access|Access ended/ },
  { name: "admin", path: "/admin", as: "demo_admin" },
];

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.name}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const p of PAGES) {
      test(`${p.name}`, async ({ page, context, request }) => {
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
        page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(403|404)/.test(m.text())) errors.push(`console: ${m.text()}`); });
        if (p.as) await signIn(context, request, p.as);

        const res = await page.goto(p.path);
        expect(res?.status(), `HTTP status for ${p.path}`).toBeLessThan(p.name === "not-found" ? 500 : 400);
        await settle(page);

        if (p.expectText) {
          await expect(page.getByText(p.expectText).first()).toBeVisible();
          await expect(page.getByText("Felt followed")).toHaveCount(0); // no event details leak
        } else {
          await expect(page.locator("h1").first()).toBeVisible();
        }
        const o = await horizontalOverflow(page);
        expect(o.overflow, `horizontal scroll on ${p.path} at ${vp.width}px (scrollWidth ${o.scrollWidth})`).toBe(false);
        await page.screenshot({ path: `gate-a/screenshots/${vp.name}/${p.name}.png`, fullPage: true });
        expect(errors, `JS/console errors on ${p.path}`).toEqual([]);
      });
    }
  });
}
