// Browser pass over the manual test areas, with the AI provider simulating an
// exhausted quota offline (MOCK_AI_FAIL=quota, no Gemini requests).
// Run with:  MOCK_AI_FAIL=quota npx playwright test manual-areas
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test.skip(process.env.MOCK_AI_FAIL !== "quota", "set MOCK_AI_FAIL=quota");
test.describe.configure({ mode: "serial" });

const FIX = join(import.meta.dirname, "fixtures");
let page: Page;
let url = "";
let sofaRotation = 0;
const errors: string[] = [];

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ acceptDownloads: true });
  page.on("pageerror", (e) => errors.push(e.message));
});
test.afterAll(async () => page.close());

async function planPoint(u: number, v: number) {
  const box = (await page.locator("[data-testid=plan-canvas] image").boundingBox())!;
  return { x: box.x + (u / 680) * box.width, y: box.y + (v / 620) * box.height };
}
const saved = () => expect(page.getByTestId("save-state")).toHaveText("All changes saved", { timeout: 10_000 });

test("1. project creation and saving", async () => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Name").fill("Manual Tester");
  await page.getByLabel("Email").fill(`manual-${Date.now()}@respace.test`);
  await page.getByLabel("Password").fill("manual-test-pass-2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByTestId("new-project").first().click();
  await page.getByLabel("Project name").fill("Manual test flat");
  await page.getByTestId("create-project").click();
  await expect(page.getByRole("heading", { name: "Import the plan" })).toBeVisible();
  url = page.url();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Manual test flat" })).toBeVisible();
  await page.goto(url);
});

test("2. plan upload, calibration and tracing", async () => {
  await page.getByTestId("plan-file").setInputFiles(join(FIX, "synthetic-plan.png"));
  await expect(page.locator("[data-testid=plan-canvas] image")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /Calibrate a known length/ }).click();
  for (const [u, v] of [[90, 45], [590, 45]]) {
    const p = await planPoint(u, v);
    await page.mouse.click(p.x, p.y);
  }
  await page.getByTestId("calibration-length").fill("5000");
  await page.getByTestId("apply-calibration").click();
  await expect(page.getByText("1 px = 10.0 mm", { exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  for (const [u, v] of [[90, 90], [590, 90], [590, 490], [90, 490], [90, 90]]) {
    const p = await planPoint(u, v);
    await page.mouse.click(p.x, p.y);
  }
  await expect(page.getByText("20.0 m²").first()).toBeVisible();
  await page.getByRole("button", { name: /Add door/ }).click();
  let p = await planPoint(190, 90);
  await page.mouse.click(p.x, p.y);
  await page.getByRole("button", { name: /Add window/ }).click();
  p = await planPoint(340, 490);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByText(/2 openings/)).toBeVisible();
  await page.getByTestId("confirm-geometry").click();
  await page.getByTestId("confirm-geometry-yes").click();
  await expect(page.getByRole("heading", { name: "Furniture and brief" })).toBeVisible();
});

test("3. furniture inventory and sample layouts", async () => {
  for (const c of ["sofa", "armchair", "table", "bookshelf"]) await page.getByTestId(`add-${c}`).click();
  await expect(page.locator(".inv-card")).toHaveCount(4);
  await expect(page.getByText("Main walkway between doors")).toBeVisible();
  await expect(page.getByText("Access path to furniture")).toBeVisible();
  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("to-design").click();
  await page.getByTestId("rule-based").click();
  await expect(page.locator(".alt-card")).toHaveCount(1);
  await expect(page.locator(".alt-card").getByText("Sample · not AI")).toBeVisible();
  await expect(page.locator("[data-testid=scene-canvas] canvas")).toBeVisible();
});

test("4. plan, orbit and walkthrough views", async () => {
  await page.getByRole("group", { name: "View mode" }).getByRole("button", { name: "Plan" }).click();
  await page.waitForTimeout(600);
  await page.getByRole("group", { name: "View mode" }).getByRole("button", { name: "Walk" }).click();
  await expect(page.getByLabel("Walk controls")).toBeVisible();
  await page.getByLabel("Walk forward").dispatchEvent("pointerdown");
  await page.waitForTimeout(300);
  await page.getByLabel("Walk forward").dispatchEvent("pointerup");
  await page.getByRole("group", { name: "View mode" }).getByRole("button", { name: "Orbit" }).click();
  await page.getByLabel("Camera viewpoint").selectOption("corner-b");
  await page.getByLabel("Wall visibility").selectOption("low");
  await page.getByLabel("Wall visibility").selectOption("cutaway");
  expect(errors).toEqual([]);
});

test("5. moving, rotating, resizing, materials and lighting", async () => {
  await page.getByTestId("object-sofa").click();
  const x = page.getByTestId("pos-x");
  const target = (Number(await x.inputValue()) - 0.1).toFixed(2);
  await x.fill(target);
  await x.press("Enter");
  await saved();
  const rot = page.getByLabel("Rotation", { exact: true });
  const r0 = Number(await rot.inputValue());
  await page.getByRole("button", { name: "Rotate 15 degrees clockwise" }).click();
  await saved();
  sofaRotation = (r0 + 15) % 360;
  await expect(rot).toHaveValue(String(sofaRotation));
  await page.getByTestId("size-w").fill("2.00");
  await page.getByTestId("size-w").press("Enter");
  await saved();
  await page.getByRole("radio", { name: "Velvet" }).click();
  await saved();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Evening" }).click();
  await saved();
});

test("6. locks, undo/redo, revisions and comparison", async () => {
  await page.getByTestId("object-sofa").click();
  await page.getByTestId("lock-all").click();
  await saved();
  await expect(page.getByTestId("pos-x")).toBeDisabled();
  await page.getByTestId("undo").click();
  await expect(page.getByTestId("pos-x")).toBeEnabled();
  await page.getByTestId("redo").click();
  await expect(page.getByTestId("pos-x")).toBeDisabled();
  await saved();
  await page.getByRole("button", { name: "History" }).click();
  await page.getByRole("button", { name: /Name revision/ }).first().click();
  await page.getByPlaceholder("e.g. Shown to client").fill("Before AI attempt");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Before AI attempt")).toBeVisible();
  await page.getByRole("button", { name: "Compare" }).first().click();
  await expect(page.getByRole("heading", { name: "Compare" })).toBeVisible();
  await expect(page.getByText(/sofa: /).first()).toBeVisible();
  await page.keyboard.press("Escape");
});

test("AI quota error keeps existing work and manual editing", async () => {
  await page.keyboard.press("Escape");
  const before = await page.locator(".object-row").allInnerTexts();
  const revBefore = await page.locator(".alt-card.active").innerText();
  await page.getByTestId("generate").click();
  await expect(page.getByText(/daily free-tier request limit/).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".alt-card")).toHaveCount(1);
  expect(await page.locator(".object-row").allInnerTexts()).toEqual(before);
  expect(await page.locator(".alt-card.active").innerText()).toEqual(revBefore);
  // chat with an exhausted quota: error shown, no proposal, scene unchanged
  await page.getByTestId("open-chat").click();
  await page.getByTestId("chat-input").fill("Make the lighting warmer.");
  await page.getByTestId("chat-input").press("Enter");
  await expect(page.locator(".msg.system").filter({ hasText: /daily free-tier request limit/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("proposal-bar")).toHaveCount(0);
  await page.getByRole("button", { name: "Close assistant" }).click();
  // manual editing still works afterwards
  await page.getByTestId("object-table").click();
  const tx = page.getByTestId("pos-x");
  const t2 = (Number(await tx.inputValue()) + 0.05).toFixed(2);
  await tx.fill(t2);
  await tx.press("Enter");
  await saved();
  await expect(page.getByTestId("pos-x")).toHaveValue(t2);
});

test("7. exports, reload persistence and feedback", async () => {
  const png = page.waitForEvent("download");
  await page.getByTestId("export-png").click();
  expect(readFileSync((await (await png).path())!).subarray(0, 4).toString("hex")).toBe("89504e47");
  const json = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export project JSON" }).click();
  const doc = JSON.parse(readFileSync((await (await json).path())!, "utf-8"));
  const sofa = doc.alternatives[0].scene.objects.find((o: { id: string }) => o.id === "sofa");
  expect(sofa.rotation_deg).toBe(sofaRotation);
  expect(sofa.size.w).toBe(2);
  expect(sofa.finish.material).toBe("velvet");
  expect(sofa.locks).toContain("position");
  expect(doc.alternatives[0].scene.lighting.mood).toBe("evening");

  await page.reload();
  await expect(page.locator("[data-testid=scene-canvas] canvas")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("object-sofa").click();
  await expect(page.getByTestId("pos-x")).toBeDisabled();
  await expect(page.getByTestId("size-w")).toHaveValue("2.00");
  await expect(page.getByRole("radio", { name: "Velvet" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Evening" })).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("feedback").click();
  await page.getByRole("radio", { name: "5 of 5" }).click();
  await page.getByTestId("feedback-text").fill("Manual pass: editing kept working while AI quota was exhausted.");
  await page.getByTestId("submit-feedback").click();
  await expect(page.getByText("Feedback saved with this design revision.")).toBeVisible();
  expect(errors).toEqual([]);
});
