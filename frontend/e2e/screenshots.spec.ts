// Captures authentic screenshots of the running app for review and the README.
// Run with:  SCREENSHOTS=1 npx playwright test screenshots
// Uses synthetic sample projects and the CI test double for any AI step (labelled in the UI).
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = join(import.meta.dirname, "..", "..", "docs", "screenshots");
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to capture screenshots");
test.describe.configure({ mode: "serial" });

let page: Page;

test.beforeAll(async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
});

const shot = (name: string) => page.screenshot({ path: join(OUT, `${name}.png`) });

test("capture", async () => {
  test.setTimeout(240_000);
  await page.goto("/");
  await page.waitForTimeout(400);
  await shot("01-sign-in");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Name").fill("Studio Reviewer");
  await page.getByLabel("Email").fill(`shots-${Date.now()}@respace.test`);
  await page.getByLabel("Password").fill("screenshot-pass-2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("button", { name: "Add sample projects" }).first().click();
  await expect(page.locator(".project-card")).toHaveCount(3);
  await page.waitForTimeout(800);
  await shot("02-projects");

  // plan editor on the study sample
  await page.getByRole("button", { name: "Open Sample · Study to trace" }).click();
  await expect(page.locator("[data-testid=plan-canvas] image")).toBeVisible();
  await page.waitForTimeout(600);
  await shot("03-plan-import");

  // living room sample: design workspace
  await page.goto("/");
  await page.getByRole("button", { name: "Open Sample · Warm living room" }).click();
  await expect(page.locator("[data-testid=scene-canvas] canvas")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Got it" }).click();
  await page.waitForTimeout(2500);
  await shot("04-design-orbit");
  await page.getByTestId("object-sofa").click();
  await page.waitForTimeout(800);
  await shot("05-design-selection");
  await page.keyboard.press("Escape");
  await page.keyboard.press("1");
  await page.waitForTimeout(1500);
  await shot("06-design-plan");
  await page.keyboard.press("2");
  await page.getByRole("button", { name: "Evening" }).click();
  await page.getByLabel("Warm accent lighting").check();
  await page.waitForTimeout(2000);
  await shot("07-design-evening");

  // conversational edit with preview (test double)
  await page.getByTestId("open-chat").click();
  await page.getByTestId("chat-input").fill("Keep everything except the flooring. Make it pale oak.");
  await page.getByTestId("chat-input").press("Enter");
  await expect(page.getByTestId("proposal-bar")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await shot("08-proposal-preview");
  await page.getByRole("button", { name: "Discard" }).click();
  await page.getByRole("button", { name: "Close assistant" }).click();

  await page.getByRole("tab", { name: /Checks/ }).click();
  await page.waitForTimeout(500);
  await shot("09-checks");

  // furnish step
  await page.getByTestId("step-furnish").click();
  await page.waitForTimeout(600);
  await shot("10-furnish");

  // phone width
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("step-design").click();
  await page.waitForTimeout(2500);
  await shot("11-mobile-design");
});
