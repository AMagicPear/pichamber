import { expect, test } from "@playwright/test";

test("opens a project and completes the core workspace flow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Pichamber", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start with a project" })).toBeVisible();

  await page.getByRole("button", { name: "Open project" }).click();
  await expect(page.getByText("pichamber-demo", { exact: true })).toBeVisible();
  const composer = page.getByPlaceholder("Ask Pi to work on this project");
  await composer.fill("Inspect the project and summarize the workspace.");
  await composer.press("Enter");
  await expect(page.getByText("Inspect the project and summarize the workspace.")).toBeVisible();
  await expect(page.getByText(/The workspace is ready/)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("read", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Toggle files" }).click();
  await page.getByRole("button", { name: "App.tsx" }).click();
  await expect(page.getByText("export function App()", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Toggle terminal" }).click();
  await expect(page.getByText("ready", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).last().click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Default thinking")).toBeVisible();
});

test("remains usable in a narrow desktop window", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open project" }).click();
  await expect(page.getByPlaceholder("Ask Pi to work on this project")).toBeVisible();
  const dimensions = await page.locator(".composer").evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, width: box.width, viewport: window.innerWidth };
  });
  expect(dimensions.left).toBeGreaterThanOrEqual(0);
  expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.width).toBeGreaterThan(300);
});
