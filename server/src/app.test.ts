import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.ts";

describe("app (sans base de données)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("répond sur /api/health", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("applique les en-têtes CORS", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/companies",
      headers: { origin: "http://localhost:5173", "access-control-request-method": "POST" },
    });
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });
});
