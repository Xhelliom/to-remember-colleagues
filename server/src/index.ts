import Fastify from "fastify";
import cors from "@fastify/cors";
import { auth } from "./auth.ts";
import { companyRoutes } from "./routes/companies.ts";
import { colleagueRoutes } from "./routes/colleagues.ts";

const PORT = Number(process.env.PORT ?? 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:5173";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: CORS_ORIGIN,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
});

// Better Auth gère toutes les routes /api/auth/* (inscription, connexion, session…).
app.route({
  method: ["GET", "POST"],
  url: "/api/auth/*",
  async handler(request, reply) {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
        else headers.append(key, String(value));
      }
      const req = new Request(url.toString(), {
        method: request.method,
        headers,
        body: request.body ? JSON.stringify(request.body) : undefined,
      });
      const response = await auth.handler(req);
      reply.code(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      reply.send(response.body ? await response.text() : null);
    } catch (err) {
      request.log.error(err, "Erreur du handler Better Auth");
      reply.code(500).send({ error: "Erreur d'authentification interne." });
    }
  },
});

await app.register(companyRoutes);
await app.register(colleagueRoutes);

app.get("/api/health", async () => ({ status: "ok" }));

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
