// End-to-end architect workflow against the production build.
// AI calls use the CI-only test double (AI_PROVIDER=mock): this verifies the UI and
// pipeline wiring, NOT live AI behaviour.
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = join(import.meta.dirname, "fixtures");
// Test-only account on a throwaway database created by start-server.mjs.
const USER = { email: `architect-${Date.now()}@respace.test`, password: "e2e-test-password-2026", name: "E2E Architect" };

test.describe.configure({ mode: "serial" });

let page: Page;
let projectUrl = "";

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ acceptDownloads: true });
});

test.afterAll(async () => {
  await page.close();
});

async function planPoint(u: number, v: number) {
  // Map plan-image pixels to screen coordinates using the rendered <image> element.
  const box = await page.locator("[data-testid=plan-canvas] image").boundingBox();
  if (!box) throw new Error("plan image not rendered");
  const { w, h } = await page.locator("[data-testid=plan-canvas] image").evaluate((el) => ({ w: 680, h: 620, rw: el.getAttribute("width") }));
  return { x: box.x + (u / w) * box.width, y: box.y + (v / h) * box.height };
}

test("1. register, create a project and import a plan (PDF page)", async () => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Name").fill(USER.name);
  await page.getByLabel("Email").fill(USER.email);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  await page.getByTestId("new-project").first().click();
  await page.getByLabel("Project name").fill("E2E living room");
  await page.getByTestId("create-project").click();
  await expect(page.getByRole("heading", { name: "Import the plan" })).toBeVisible();
  projectUrl = page.url();

  await page.getByTestId("plan-file").setInputFiles(join(FIXTURES, "synthetic-plan.pdf"));
  await expect(page.getByRole("heading", { name: "Choose a PDF page" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /Page 1/ }).click();
  await expect(page.locator("[data-testid=plan-canvas] image")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/PDF page 1 of 1/)).toBeVisible();
});

test("2. calibrate, trace, add a door and confirm geometry", async () => {
  // The PDF page was rasterised at a different resolution; replace it with the PNG
  // fixture whose pixel layout we know exactly.
  await page.getByRole("button", { name: "Replace plan" }).click();
  await page.getByTestId("plan-file").setInputFiles(join(FIXTURES, "synthetic-plan.png"));
  await expect(page.getByText("image upload")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);

  // Calibrate along the 5000 mm dimension line (pixels 90 to 590 at v = 45).
  await page.getByRole("button", { name: /Calibrate a known length/ }).click();
  let p = await planPoint(90, 45);
  await page.mouse.click(p.x, p.y);
  p = await planPoint(590, 45);
  await page.mouse.click(p.x, p.y);
  await page.getByTestId("calibration-length").fill("5000");
  await page.getByTestId("apply-calibration").click();
  await expect(page.getByText("1 px = 10.0 mm", { exact: true })).toBeVisible();

  // Trace the interior corners; tracing tool is active after calibration.
  await page.waitForTimeout(300);
  for (const [u, v] of [
    [90, 90],
    [590, 90],
    [590, 490],
    [90, 490],
    [90, 90],
  ]) {
    p = await planPoint(u, v);
    await page.mouse.click(p.x, p.y);
  }
  await expect(page.getByRole("button", { name: /Room 1/ })).toBeVisible();
  await expect(page.getByText("20.0 m²").first()).toBeVisible();

  // Correct the wall height in the properties panel.
  await page.getByLabel("Wall height").fill("2.8");
  await page.getByLabel("Wall height").press("Enter");

  // Add the door on the top wall.
  await page.getByRole("button", { name: /Add door/ }).click();
  p = await planPoint(190, 90);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByText(/door/i).first()).toBeVisible();

  await page.getByTestId("confirm-geometry").click();
  await page.getByTestId("confirm-geometry-yes").click();
  await expect(page.getByRole("heading", { name: "Furniture and brief" })).toBeVisible();
});

test("3. configure furniture and the design brief", async () => {
  await page.getByTestId("add-sofa").click();
  await page.getByTestId("add-armchair").click();
  await page.getByTestId("add-table").click();
  await page.getByRole("button", { name: "More" }).nth(1).click(); // two armchairs
  await page.getByTestId("brief-text").fill(
    "Living room with a three-seater sofa, two accent chairs and a coffee table. Warm contemporary, oak, muted green accents. Preserve a clear main walkway.",
  );
  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("to-design").click();
  await expect(page.getByRole("heading", { name: "Alternatives" })).toBeVisible();
});

test("4. generate proposals (test double) and see validation", async () => {
  await page.getByTestId("generate").click();
  await expect(page.getByText(/proposals? ready/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Test double provider: output is not live AI.")).toBeVisible();
  const cards = page.locator(".alt-card");
  await expect(cards).toHaveCount(3);
  await expect(page.locator(".alt-card").first().getByText("AI proposal")).toBeVisible();
  await page.getByRole("tab", { name: /Checks/ }).click();
  await expect(page.getByText("Walkway connects the entrance to furniture")).toBeVisible();
  await page.getByRole("tab", { name: /Scene|Selection/ }).click();
  // the 3D canvas is present
  await expect(page.locator("[data-testid=scene-canvas] canvas")).toBeVisible();
});

test("5. rendered furniture stays inside its validated footprint", async () => {
  await page.goto(projectUrl + "?debug=geometry");
  await expect(page.locator("[data-testid=scene-canvas] canvas")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  const bounds = (await page.evaluate(() => (globalThis as unknown as { __respaceBounds: () => unknown }).__respaceBounds())) as Record<
    string,
    { min: number[]; max: number[]; size: number[] }
  >;
  const ids = Object.keys(bounds);
  expect(ids.length).toBeGreaterThan(3);
  for (const id of ids) {
    const { min, max, size } = bounds[id];
    const [w, h, d] = size;
    const tol = 0.021;
    expect(min[0], `${id} x-min`).toBeGreaterThanOrEqual(-w / 2 - tol);
    expect(max[0], `${id} x-max`).toBeLessThanOrEqual(w / 2 + tol);
    expect(min[2], `${id} z-min`).toBeGreaterThanOrEqual(-d / 2 - tol);
    expect(max[2], `${id} z-max`).toBeLessThanOrEqual(d / 2 + tol);
    expect(min[1], `${id} y-min`).toBeGreaterThanOrEqual(-tol);
    expect(max[1], `${id} y-max`).toBeLessThanOrEqual(h + tol);
  }
});

test("6. edit manually, lock the sofa, and verify an AI edit preserves it", async () => {
  await page.getByTestId("object-sofa").click();
  await expect(page.getByTestId("object-panel")).toBeVisible();
  const x = page.getByTestId("pos-x");
  const before = Number(await x.inputValue());
  const target = (before + 0.1).toFixed(2);
  await x.fill(target);
  await x.press("Enter");
  await expect(page.getByTestId("save-state")).toHaveText("All changes saved", { timeout: 10_000 });
  await page.getByTestId("lock-all").click();
  await expect(page.getByTestId("save-state")).toHaveText("All changes saved", { timeout: 10_000 });
  await expect(page.getByTestId("pos-x")).toBeDisabled();

  // undo / redo of the lock
  await page.getByTestId("undo").click();
  await expect(page.getByTestId("pos-x")).toBeEnabled();
  await page.getByTestId("redo").click();
  await expect(page.getByTestId("pos-x")).toBeDisabled();
  await expect(page.getByTestId("save-state")).toHaveText("All changes saved", { timeout: 10_000 });

  // conversational edit (test double maps "floor" and "move sofa" to operations)
  await page.keyboard.press("Escape");
  await page.getByTestId("open-chat").click();
  await page.getByTestId("chat-input").fill("Keep everything except the flooring, and move the sofa a little.");
  await page.getByTestId("chat-input").press("Enter");
  await expect(page.getByTestId("proposal-bar")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("proposal-bar").getByText(/position is locked/)).toBeVisible();
  await page.getByTestId("apply-proposal").click();
  await expect(page.getByText("Changes applied as a new revision.")).toBeVisible();

  await page.getByRole("button", { name: "Close assistant" }).click();
  await page.getByTestId("object-sofa").click();
  await expect(page.getByTestId("pos-x")).toHaveValue(target);
});

test("7. save, reload and export", async () => {
  await page.reload();
  await expect(page.locator("[data-testid=scene-canvas] canvas")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("object-sofa").click();
  await expect(page.getByTestId("pos-x")).toBeDisabled();
  const x = await page.getByTestId("pos-x").inputValue();
  expect(Number(x)).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".swatch[aria-checked=true]").filter({ hasText: "Pale oak" })).toBeVisible();

  const png = page.waitForEvent("download");
  await page.getByTestId("export-png").click();
  const dl = await png;
  const path = await dl.path();
  expect(readFileSync(path!).subarray(0, 4).toString("hex")).toBe("89504e47");

  const json = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export project JSON" }).click();
  const doc = JSON.parse(readFileSync((await (await json).path())!, "utf-8"));
  expect(doc.format).toBe("respace-project");
  // The edited alternative carries the locked sofa; the other proposals stay unlocked.
  const sofas = doc.alternatives.flatMap((a: { scene: { objects: { id: string; locks: string[] }[] } }) => a.scene.objects).filter((o: { id: string }) => o.id === "sofa");
  expect(sofas.some((s: { locks: string[] }) => s.locks.includes("position"))).toBe(true);
});

test("8. record feedback linked to the revision", async () => {
  await page.getByTestId("feedback").click();
  await page.getByRole("radio", { name: "4 of 5" }).click();
  await page.getByTestId("feedback-text").fill("Locking the sofa before asking for a new floor worked as expected.");
  await page.getByTestId("submit-feedback").click();
  await expect(page.getByText("Feedback saved with this design revision.")).toBeVisible();
});

test("9. presentation, history and compare open without errors", async () => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("heading", { name: "Revision history" })).toBeVisible();
  await page.getByRole("button", { name: "Compare" }).first().click();
  await expect(page.getByRole("heading", { name: "Compare" })).toBeVisible();
  await expect(page.getByText(/Differences/)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Present/ }).click();
  await expect(page.getByRole("dialog", { name: "Presentation" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});
