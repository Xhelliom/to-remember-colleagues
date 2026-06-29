import { fromNodeHeaders } from "better-auth/node";
import type { FastifyReply, FastifyRequest } from "fastify";
import { auth } from "./auth.ts";

export type SessionUser = { id: string; email: string; name: string };

/** Renvoie l'utilisateur connecté à partir des cookies de la requête, ou null. */
export async function getSessionUser(request: FastifyRequest): Promise<SessionUser | null> {
  const result = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });
  if (!result?.user) return null;
  return { id: result.user.id, email: result.user.email, name: result.user.name };
}

/** Variante qui renvoie 401 si l'utilisateur n'est pas connecté. */
export async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<SessionUser | null> {
  const user = await getSessionUser(request);
  if (!user) {
    reply.code(401).send({ error: "Connexion requise." });
    return null;
  }
  return user;
}
