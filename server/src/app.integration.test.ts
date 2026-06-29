import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.ts";
import { db, pool } from "./db/client.ts";

/** Vérifie que la base est joignable ; sinon les tests d'intégration sont ignorés. */
async function dbReachable(): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  }
}

const online = await dbReachable();
if (!online) {
  console.warn("⚠ Base de données injoignable — tests d'intégration ignorés (définissez DATABASE_URL).");
}

describe.skipIf(!online)("API métier (avec base de données)", () => {
  let app: FastifyInstance;
  const email = `it-${Date.now()}@example.com`;
  let cookie = "";
  let companyId = "";

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "./drizzle" });
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("refuse la création d'entreprise sans authentification (401)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/companies",
      payload: { name: "Interdit" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("inscrit un utilisateur et renvoie un cookie de session", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { name: "Testeur", email, password: "motdepasse123" },
    });
    expect(res.statusCode).toBe(200);
    const setCookie = res.headers["set-cookie"];
    cookie = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie);
    expect(cookie).toContain("better-auth");
  });

  it("crée une entreprise une fois authentifié (201)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/companies",
      headers: { cookie },
      payload: { name: "Studio Intégration", description: "Test" },
    });
    expect(res.statusCode).toBe(201);
    companyId = res.json().id as string;
    expect(companyId).toBeTruthy();
  });

  it("ajoute un collègue puis le retrouve dans la liste", async () => {
    const add = await app.inject({
      method: "POST",
      url: `/api/companies/${companyId}/colleagues`,
      headers: { cookie },
      payload: { name: "Jean Test", quote: "Dernier commit poussé.", departedOn: "2024-05-01" },
    });
    expect(add.statusCode).toBe(201);

    const list = await app.inject({ method: "GET", url: `/api/companies/${companyId}/colleagues` });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.colleagues).toHaveLength(1);
    expect(body.colleagues[0].name).toBe("Jean Test");
    expect(body.colleagues[0].quote).toContain("commit");
  });
});
