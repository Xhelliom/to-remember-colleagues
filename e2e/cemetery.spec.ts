import { test, expect, type Page } from "@playwright/test";

const password = "motdepasse123";
const uniqueEmail = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

async function register(page: Page) {
  await page.goto("/");
  await expect(page.locator("#auth")).toBeVisible();
  await page.click('.auth-tab[data-mode="signup"]');
  await page.fill('input[name="name"]', "Testeur E2E");
  await page.fill('input[name="email"]', uniqueEmail());
  await page.fill('input[name="password"]', password);
  await page.click("#auth-form .primary-btn");
  await expect(page.locator("#menu")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("inscription puis affichage du menu", async ({ page }) => {
  await register(page);
  await expect(page.locator("#menu-user-name")).toHaveText("Testeur E2E");
});

test("création d'un cimetière, entrée et rendu WebGL", async ({ page }) => {
  await register(page);

  // Crée une entreprise (le test ne dépend pas des données de seed).
  const name = `Studio E2E ${Date.now()}`;
  await page.click("#add-company-btn");
  await page.fill('#dialog-form input[name="name"]', name);
  await page.fill('#dialog-form textarea[name="description"]', "Cimetière e2e");
  await page.click("#dialog-form .primary-btn");

  // La carte apparaît ; on entre dans le cimetière.
  const card = page.locator(".company-card", { hasText: name });
  await expect(card).toBeVisible();
  await card.click();

  await expect(page.locator("#hud")).toBeVisible();
  await expect(page.locator("#cemetery-name")).toHaveText(name);

  // Contexte WebGL bien actif sur le canvas.
  const hasGL = await page.evaluate(() => {
    const c = document.getElementById("scene") as HTMLCanvasElement | null;
    return !!(c && (c.getContext("webgl2") || c.getContext("webgl")));
  });
  expect(hasGL).toBe(true);
});

test("ajout d'un collègue depuis le cimetière", async ({ page }) => {
  await register(page);
  const name = `Studio E2E ${Date.now()}`;
  await page.click("#add-company-btn");
  await page.fill('#dialog-form input[name="name"]', name);
  await page.click("#dialog-form .primary-btn");
  await page.locator(".company-card", { hasText: name }).click();
  await expect(page.locator("#hud")).toBeVisible();

  await page.click("#add-grave-btn");
  await page.fill('#dialog-form input[name="name"]', "Camille E2E");
  await page.fill('#dialog-form textarea[name="quote"]', "Partie vers d'autres aventures.");
  await page.click("#dialog-form .primary-btn");

  // Le dialogue se ferme sans erreur (la tombe est ajoutée à la scène).
  await expect(page.locator("#dialog")).toBeHidden();
});

test("changement d'ambiance vers Halloween sans erreur", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await register(page);
  const name = `Studio E2E ${Date.now()}`;
  await page.click("#add-company-btn");
  await page.fill('#dialog-form input[name="name"]', name);
  await page.click("#dialog-form .primary-btn");
  await page.locator(".company-card", { hasText: name }).click();
  await expect(page.locator("#hud")).toBeVisible();

  await page.click("#ambiance-btn");
  await page.selectOption("#ambiance-season", "halloween");
  await page.waitForTimeout(500);

  expect(errors).toEqual([]);
});
