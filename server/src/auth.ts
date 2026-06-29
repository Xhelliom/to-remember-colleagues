import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db/client.ts";
import { user, session, account, verification } from "./db/auth-schema.ts";

const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET ?? process.env.JWT_SECRET ?? "change-me-in-production",
  baseURL: process.env.BETTER_AUTH_URL ?? `http://localhost:${process.env.PORT ?? "3300"}`,
  basePath: "/api/auth",
  trustedOrigins: [corsOrigin],
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
