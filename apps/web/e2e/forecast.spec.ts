import { test, expect } from "@playwright/test";

test.describe("311 forecast release flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#forecast");
  });

  test("loads release and shows release status with combination count", async ({ page }) => {
    await page.click("text=Load 311 Release");

    const status = page.locator("[data-testid='release-status']");
    await expect(status).toContainText("20260810-165551");
    await expect(page.locator("[data-testid='combination-count']")).toHaveText(
      "2 combinations"
    );
  });

  test("populates selectors from valid combinations only", async ({ page }) => {
    await page.click("text=Load 311 Release");

    const zipSelect = page.locator("#forecast-zip-select");
    await expect(zipSelect).toContainText("10027");
    await expect(zipSelect).toContainText("10025");

    const typeSelect = page.locator("#forecast-type-select");

    // Default selection is the alphabetically first ZIP.
    await expect(zipSelect).toHaveValue("10025");
    await expect(typeSelect).toHaveValue("street condition");

    // Switching ZIP should filter complaint types to valid combinations.
    await zipSelect.selectOption("10027");
    await expect(typeSelect).toHaveValue("heat/hot water");
    await expect(typeSelect).not.toContainText("street condition");
  });

  test("runs a forecast and displays prediction, metrics, caveat, and provenance", async ({ page }) => {
    test.setTimeout(30000);
    await page.click("text=Load 311 Release");
    await page.click("text=Predict 2026 locally");

    await expect(page.locator("text=predicted complaints")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=Validation MAE")).toBeVisible();
    await expect(page.locator("text=Validation RMSE")).toBeVisible();
    await expect(
      page.locator("text=Forecasts are estimates based on historical patterns")
    ).toBeVisible();

    await page.click("text=Provenance");
    await expect(page.locator("text=Dataset version")).toBeVisible();
    await expect(page.locator("text=Embedding version")).toBeVisible();
    await expect(page.locator("text=Model name")).toBeVisible();
    await expect(page.locator("text=Firestore release")).toBeVisible();
  });

  test("switches forecast model", async ({ page }) => {
    await page.click("text=Load 311 Release");
    await page.selectOption("#forecast-model-select", "lightgbm");
    await page.click("text=Predict 2026 locally");

    await expect(page.locator("[data-testid='forecast-model-name']")).toHaveText(
      "lightgbm"
    );
  });

  test("is usable at mobile width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click("text=Load 311 Release");

    const zipSelect = page.locator("#forecast-zip-select");
    await expect(zipSelect).toBeVisible();

    await page.selectOption("#forecast-zip-select", "10025");
    await expect(page.locator("#forecast-type-select")).toHaveValue("street condition");
  });

  test("is usable at tablet width", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.click("text=Load 311 Release");

    await expect(page.locator("#forecast-zip-select")).toBeVisible();
    await expect(page.locator("#forecast-type-select")).toBeVisible();
  });

  test("keyboard navigation reaches all forecast controls", async ({ page }) => {
    await page.click("text=Load 311 Release");

    const zipSelect = page.locator("#forecast-zip-select");
    await zipSelect.focus();
    await page.keyboard.press("Tab");

    const typeSelect = page.locator("#forecast-type-select");
    await expect(typeSelect).toBeFocused();

    await page.keyboard.press("Tab");
    const modelSelect = page.locator("#forecast-model-select");
    await expect(modelSelect).toBeFocused();
  });
});
