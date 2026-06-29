import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { auth } from "./auth.ts";
import { companyRoutes } from "./routes/companies.ts";
import { colleagueRoutes } from "./routes/colleagues.ts";
import { messageRoutes } from "./routes/messages.ts";
import { voteRoutes } from "./routes/votes.ts";
import { offeringRoutes } from "./routes/offerings.ts";
import { realtimeRoutes } from "./realtime.ts";

const DEFAULT_CORS_ORIGIN = "http://localhost:5173";
const AUTH_HANDLER_ERROR = 500;

/** Convertit une requête Fastify en Request Web standard pour Better Auth. */
function toWebRequest(url: string, method: string, headers: NodeJS.Dict<string | string[]>, body: unknown): Request {
  const webHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => webHeaders.append(key, v));
    else webHeaders.append(key, String(value));
  }
  return new Request(url, {
    method,
    headers: webHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Construit l'instance Fastify (sans démarrer l'écoute) — utilisable en test via inject(). */
export async function buildApp(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const corsOrigin = process.env.CORS_ORIGIN ?? DEFAULT_CORS_ORIGIN;
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(cors, {
    origin: corsOrigin,
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
        const req = toWebRequest(url.toString(), request.method, request.headers, request.body);
        const response = await auth.handler(req);
        reply.code(response.status);
        response.headers.forEach((value, key) => reply.header(key, value));
        reply.send(response.body ? await response.text() : null);
      } catch (err) {
        request.log.error(err, "Erreur du handler Better Auth");
        reply.code(AUTH_HANDLER_ERROR).send({ error: "Erreur d'authentification interne." });
      }
    },
  });

  await app.register(companyRoutes);
  await app.register(colleagueRoutes);
  await app.register(messageRoutes);
  await app.register(voteRoutes);
  await app.register(offeringRoutes);
  await app.register(realtimeRoutes);

  app.get("/api/health", async () => ({ status: "ok" }));

  return app;
}
