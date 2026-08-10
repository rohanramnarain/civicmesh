import { test, expect } from "@playwright/test";

test.describe("unavailable Firestore state", () => {
  test("shows an error when Firebase is not configured and mock fallback is disabled", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#forecast");

    await page.click("text=Load 311 Release");

    await expect(page.locator("[role='alert']")).toContainText(
      "Firebase is not configured"
    );
  });
});
