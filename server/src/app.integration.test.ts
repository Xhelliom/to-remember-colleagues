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

    // En tant que membre, les vrais noms sont visibles (issue #22).
    const list = await app.inject({
      method: "GET",
      url: `/api/companies/${companyId}/colleagues`,
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.colleagues).toHaveLength(1);
    expect(body.colleagues[0].name).toBe("Jean Test");
    expect(body.colleagues[0].quote).toContain("commit");
    // Karma inclus dans la réponse (issue #3).
    expect(typeof body.karma).toBe("number");
    expect(body.anonymized).toBe(false);
  });

  it("expose le détail d'une tombe par id avec son cimetière (issue #18)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/colleagues/${colleagueId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(colleagueId);
    expect(body.name).toBe("Jean Test");
    expect(body.company.id).toBe(companyId);
    expect(typeof body.karma).toBe("number");
    expect(body.anonymized).toBe(false);
  });

  it("anonymise les noms pour les non-membres (issue #22)", async () => {
    const list = await app.inject({ method: "GET", url: `/api/companies/${companyId}/colleagues` });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.anonymized).toBe(true);
    // Le nom est un anagramme déterministe, pas le vrai nom.
    expect(body.colleagues[0].name).not.toBe("Jean Test");
    // Les lettres de chaque mot sont identiques (anagramme par mot).
    const sorted = (s: string) => s.split("").sort().join("");
    const origWords = "Jean Test".split(" ");
    const anonWords = (body.colleagues[0].name as string).split(" ");
    for (let i = 0; i < origWords.length; i++) {
      expect(sorted(anonWords[i]!)).toBe(sorted(origWords[i]!));
    }
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

  it("ajoute une tombe en construction (départ futur) et vérifie le flag (issue #21)", async () => {
    const futureDate = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const add = await app.inject({
      method: "POST",
      url: `/api/companies/${companyId}/colleagues`,
      headers: { cookie },
      payload: { name: "Futur Partant", quote: "Je pars bientôt.", departedOn: futureDate },
    });
    expect(add.statusCode).toBe(201);
    const constructionId = add.json().id as string;

    const list = await app.inject({
      method: "GET",
      url: `/api/companies/${companyId}/colleagues`,
      headers: { cookie },
    });
    const found = (list.json().colleagues as { id: string; construction: boolean }[]).find(
      (c) => c.id === constructionId,
    );
    expect(found?.construction).toBe(true);

    // Tombe avec date passée : construction=false.
    expect(
      (list.json().colleagues as { id: string; construction: boolean }[]).find((c) => c.id === colleagueId)
        ?.construction,
    ).toBe(false);
  });

  it("dépose une offrande et récupère le compteur mis à jour (issue #7)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/colleagues/${colleagueId}/offerings`,
      headers: { cookie },
      payload: { type: "candle" },
    });
    expect(res.statusCode).toBe(201);
    const counts = res.json() as { flower: number; candle: number; stone: number };
    expect(counts.candle).toBe(1);
    expect(counts.flower).toBe(0);
    expect(counts.stone).toBe(0);
  });

  it("liste les offrandes actives d'une tombe (issue #7)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/colleagues/${colleagueId}/offerings`,
    });
    expect(res.statusCode).toBe(200);
    const list = res.json() as { type: string; authorName: string }[];
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].type).toBe("candle");
    expect(list[0].authorName).toBe("Testeur");
  });

  it("inclut les comptes d'offrandes dans la liste des collègues (issue #7)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/companies/${companyId}/colleagues`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { colleagues: { id: string; offeringCounts: { candle: number } }[] };
    const found = body.colleagues.find((c) => c.id === colleagueId);
    expect(found?.offeringCounts.candle).toBeGreaterThanOrEqual(1);
  });

  it("refuse une offrande sans authentification (401, issue #7)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/colleagues/${colleagueId}/offerings`,
      payload: { type: "flower" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("entretient une tombe et augmente son niveau de soin (issue #14)", async () => {
    // La maintenance effective décroît depuis la création ; un entretien l'augmente.
    const before = await app.inject({
      method: "GET",
      url: `/api/companies/${companyId}/colleagues`,
    });
    const maintenanceBefore = (before.json().colleagues as { id: string; maintenance: number }[])
      .find((c) => c.id === colleagueId)?.maintenance ?? 0;

    const res = await app.inject({
      method: "POST",
      url: `/api/colleagues/${colleagueId}/maintain`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const { maintenance: afterMaintenance } = res.json() as { maintenance: number };
    expect(afterMaintenance).toBeGreaterThan(maintenanceBefore);
    expect(afterMaintenance).toBeLessThanOrEqual(1);
  });

  it("refuse l'entretien sans authentification (401, issue #14)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/colleagues/${colleagueId}/maintain`,
    });
    expect(res.statusCode).toBe(401);
  });
});
