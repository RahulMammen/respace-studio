// Manual live check of the visual review with a real canvas screenshot (one AI call).
// Run with:  LIVE_AI=1 npx playwright test live-review   (never in CI)
import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

test.skip(!process.env.LIVE_AI, "set LIVE_AI=1 for the manual live check");

test("live visual review of a synthetic sample", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Name").fill("Live Review");
  await page.getByLabel("Email").fill(`live-${Date.now()}@respace.test`);
  await page.getByLabel("Password").fill("live-review-pass-2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("button", { name: "Add sample projects" }).first().click();
  await page.getByRole("button", { name: "Open Sample · Warm living room" }).click();
  await expect(page.locator("[data-testid=scene-canvas] canvas")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2500);
  await expect(page.getByText("Test double provider")).toHaveCount(0);
  await page.getByRole("button", { name: "Review this view" }).click();
  await page.getByRole("tab", { name: /Checks/ }).click();
  const panel = page.locator(".review");
  await expect(panel).toBeVisible({ timeout: 180_000 });
  const text = await panel.innerText();
  writeFileSync(join(import.meta.dirname, "..", "test-results", "live-review.txt"), text);
  await page.screenshot({ path: join(import.meta.dirname, "..", "test-results", "live-review.png") });
  expect(text).toContain("View review");
});
