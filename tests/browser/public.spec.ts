import { test, expect } from "@playwright/test";

test("landing fits viewport and animation controls work", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Pause illustration animation" }).click();
  await expect(page.locator(".rescue-orbit")).toHaveCSS("animation-play-state", "paused");
  await page.getByRole("button", { name: "Play illustration animation" }).click();
  await expect(page.locator(".rescue-orbit")).toHaveCSS("animation-play-state", "running");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("reduced motion is respected", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".rescue-orbit")).toHaveCSS("animation-name", "none");
});

test("signup role selection excludes admin and uses stronger passwords", async ({ page }) => {
  await page.goto("/auth");
  await page.getByRole("tab", { name: "Create account" }).click();
  await expect(page.locator("#su-pass")).toHaveAttribute("minlength", "12");
  await page.locator("#su-role").click();
  await expect(page.getByRole("option")).toHaveCount(3);
  await expect(page.getByRole("option", { name: /admin/i })).toHaveCount(0);
});

test("password reset requires email and signup entry works", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Get started" }).click();
  await expect(page).toHaveURL(/\/auth$/);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByText("Enter your email address first")).toBeVisible();
});
