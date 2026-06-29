import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db/client.ts";
import { user, session, account, verification } from "./db/auth-schema.ts";

const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";
const isDev = process.env.NODE_ENV !== "production";

// Origines locales (localhost + IP privées RFC 1918) sur n'importe quel port.
// Autorisées seulement en dev, pour tester le multijoueur via `pnpm dev:host`
// depuis un autre appareil du réseau (ex. http://10.69.0.30:5173).
const PRIVATE_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET ?? process.env.JWT_SECRET ?? "change-me-in-production",
  baseURL: process.env.BETTER_AUTH_URL ?? `http://localhost:${process.env.PORT ?? "3300"}`,
  basePath: "/api/auth",
  trustedOrigins: (request) => {
    // request est undefined à l'initialisation et lors des appels auth.api.
    const origin = request?.headers.get("origin");
    if (isDev && origin && PRIVATE_ORIGIN.test(origin)) return [corsOrigin, origin];
    return [corsOrigin];
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 6,
  },
});

export type AuthSession = typeof auth.$Infer.Session;
