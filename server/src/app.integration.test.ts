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

  let colleagueId = "";

  it("ajoute un collègue puis le retrouve dans la liste avec le karma", async () => {
    const add = await app.inject({
      method: "POST",
      url: `/api/companies/${companyId}/colleagues`,
      headers: { cookie },
      payload: { name: "Jean Test", quote: "Dernier commit poussé.", departedOn: "2024-05-01" },
    });
    expect(add.statusCode).toBe(201);
    colleagueId = add.json().id as string;

    const list = await app.inject({ method: "GET", url: `/api/companies/${companyId}/colleagues` });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.colleagues).toHaveLength(1);
    expect(body.colleagues[0].name).toBe("Jean Test");
    expect(body.colleagues[0].quote).toContain("commit");
    // Karma inclus dans la réponse (issue #3).
    expect(typeof body.karma).toBe("number");
  });

  it("vote upvote sur une tombe, met à jour le voteScore (issue #2)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/colleagues/${colleagueId}/vote`,
      headers: { cookie },
      payload: { value: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().voteScore).toBe(1);
  });

  it("récupère le vote actuel de l'utilisateur (issue #2)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/colleagues/${colleagueId}/vote`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().value).toBe(1);
  });

  it("retire le vote en renvoyant 0, voteScore revient à 0 (issue #2)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/colleagues/${colleagueId}/vote`,
      headers: { cookie },
      payload: { value: 0 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().voteScore).toBe(0);
  });

  it("laisse un message dans le livre d'or (issue #9)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/colleagues/${colleagueId}/messages`,
      headers: { cookie },
      payload: { content: "On ne t'oubliera jamais !" },
    });
    expect(res.statusCode).toBe(201);
    const msg = res.json();
    expect(msg.authorName).toBe("Testeur");
    expect(msg.content).toBe("On ne t'oubliera jamais !");
  });

  it("liste les messages du livre d'or (issue #9)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/colleagues/${colleagueId}/messages`,
    });
    expect(res.statusCode).toBe(200);
    const messages = res.json() as { authorName: string; content: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[0].authorName).toBe("Testeur");
  });

  it("refuse un message sans authentification (401, issue #9)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/colleagues/${colleagueId}/messages`,
      payload: { content: "Tentative anonyme" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("ferme un cimetière et bloque l'ajout de tombe (issue #6)", async () => {
    const close = await app.inject({
      method: "POST",
      url: `/api/companies/${companyId}/close`,
      headers: { cookie },
    });
    expect(close.statusCode).toBe(200);
    expect(close.json().closed).toBe(true);

    // Le statut renvoyé par la liste des entreprises doit être "Fermé".
    const list = await app.inject({ method: "GET", url: "/api/companies" });
    const found = (list.json() as { id: string; status: string }[]).find((c) => c.id === companyId);
    expect(found?.status).toBe("Fermé");

    // Ajout de tombe refusé (403).
    const add = await app.inject({
      method: "POST",
      url: `/api/companies/${companyId}/colleagues`,
      headers: { cookie },
      payload: { name: "Bloqué", quote: "Ne peut pas être inhumé." },
    });
    expect(add.statusCode).toBe(403);
  });

  it("réouvre le cimetière et permet à nouveau l'ajout (issue #6)", async () => {
    const reopen = await app.inject({
      method: "POST",
      url: `/api/companies/${companyId}/reopen`,
      headers: { cookie },
    });
    expect(reopen.statusCode).toBe(200);
    expect(reopen.json().closed).toBe(false);

    const add = await app.inject({
      method: "POST",
      url: `/api/companies/${companyId}/colleagues`,
      headers: { cookie },
      payload: { name: "Réintégré", quote: "Le cimetière est rouvert." },
    });
    expect(add.statusCode).toBe(201);
  });
});
