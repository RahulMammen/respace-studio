// Manual live check of the visual review with a real canvas screenshot (one AI call).
// Never in CI. Run after backend/scripts/live_ai_check.py so both share one budget file:
//   $env:LIVE_AI=1; $env:AI_CALL_BUDGET=8; $env:AI_BUDGET_FILE="<repo>\backend\data\live-run\ai-budget.json"
//   npx playwright test live-review
// Writes backend/data/live-run/review.json with PASS, FAIL or INCOMPLETE.
import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

test.skip(!process.env.LIVE_AI, "set LIVE_AI=1 for the manual live check");

const OUT = join(import.meta.dirname, "..", "..", "backend", "data", "live-run");

test("live visual review of a synthetic sample", async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });
  const record = (data: Record<string, unknown>) =>
    writeFileSync(join(OUT, "review.json"), JSON.stringify({ date: new Date().toISOString(), ...data }, null, 1));

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
  await expect(page.getByText("Test double provider")).toHaveCount(0); // real provider only

  const reviewResponse = page.waitForResponse((r) => r.url().includes("/review") && r.request().method() === "POST", { timeout: 200_000 });
  await page.getByRole("button", { name: "Review this view" }).click();
  const resp = await reviewResponse;
  const body = await resp.json();
  if (!resp.ok()) {
    const code = body?.detail?.code ?? "";
    record({ status: ["ai_quota", "ai_budget"].includes(code) ? "INCOMPLETE" : "FAIL", http: resp.status(), detail: body?.detail });
    expect(["ai_quota", "ai_budget"], `review failed: ${JSON.stringify(body?.detail)}`).toContain(code);
    test.skip(true, `INCOMPLETE: ${body?.detail?.message}`);
    return;
  }
  // Assertions on the live result (the server already drops observations citing unknown objects).
  await page.getByRole("tab", { name: /Checks/ }).click();
  await expect(page.locator(".review")).toBeVisible();
  const problems: string[] = [];
  if (!body.summary || body.summary.length < 10) problems.push("empty summary");
  if (body.test_double) problems.push("test double used");
  if (!Array.isArray(body.observations) || body.observations.length === 0) problems.push("no grounded observations");
  if ((body.suggestions as { title: string; finish: string }[]).some((s) => /https?:\/\/|\$|€|£/.test(JSON.stringify(s)))) problems.push("suggestion contains URL or price");
  await page.screenshot({ path: join(OUT, "live-review.png") });
  record({
    status: problems.length ? "FAIL" : "PASS",
    problems,
    model: body.model,
    summary: body.summary,
    observations: body.observations,
    dropped_ungrounded: body.dropped_ungrounded,
    suggestions: body.suggestions,
    proposal_operations: body.proposal?.operations?.length ?? 0,
  });
  expect(problems).toEqual([]);
});
