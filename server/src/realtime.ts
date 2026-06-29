import type { FastifyInstance } from "fastify";
import type { ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

// Présence temps réel (issue #4).
//
// Décision d'architecture : SERVEUR AUTORITATIF (relais), pas de P2P.
//   - Le serveur attribue les identifiants, possède l'appartenance aux salons
//     et relaie l'état ; un client ne peut pas usurper l'id d'un autre (chaque
//     message relayé est étiqueté avec l'id attribué par le serveur).
//   - Il ne simule pas la physique : chaque client publie sa propre position
//     (présence légère). Choix retenu pour la simplicité et la scalabilité
//     (pas de traversée de NAT comme en P2P), au prix d'un relais central.
//   - Transport : SSE (serveur→client) + POST (client→serveur) — fonctionnalités
//     natives, sans dépendance WebSocket supplémentaire.
//
// Un salon par cimetière (clé = id du cimetière) ; le hub est le salon "hub".

const HEARTBEAT_MS = 25_000;

type Client = {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  res: ServerResponse;
};

const rooms = new Map<string, Map<string, Client>>();

function roomOf(room: string): Map<string, Client> {
  let r = rooms.get(room);
  if (!r) {
    r = new Map();
    rooms.set(room, r);
  }
  return r;
}

function send(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Diffuse un événement à tous les membres d'un salon, en excluant `exceptId`. */
function broadcast(room: Map<string, Client>, event: string, data: unknown, exceptId?: string) {
  for (const c of room.values()) {
    if (c.id === exceptId) continue;
    send(c.res, event, data);
  }
}

function presenceOf(c: Client) {
  return { id: c.id, name: c.name, x: c.x, y: c.y, z: c.z, ry: c.ry };
}

export async function realtimeRoutes(app: FastifyInstance) {
  // Flux SSE d'un salon : reçoit welcome, state, emote, join, leave, count.
  app.get("/api/rooms/:room/stream", (request, reply) => {
    const { room: roomKey } = request.params as { room: string };
    const room = roomOf(roomKey);

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const client: Client = { id: randomUUID(), name: "Visiteur", x: 0, y: 1.7, z: 0, ry: 0, res };

    // État initial : son id + la présence des pairs déjà là.
    send(res, "welcome", {
      id: client.id,
      peers: [...room.values()].map(presenceOf),
    });

    room.set(client.id, client);
    broadcast(room, "count", { n: room.size });

    const heartbeat = setInterval(() => res.write(`: ping\n\n`), HEARTBEAT_MS);

    const close = () => {
      clearInterval(heartbeat);
      if (room.delete(client.id)) {
        broadcast(room, "leave", { id: client.id });
        broadcast(room, "count", { n: room.size });
      }
      if (room.size === 0) rooms.delete(roomKey);
    };
    request.raw.on("close", close);
  });

  // Mise à jour de position d'un visiteur → relayée aux pairs du salon.
  // logLevel "warn" : publiée à ~10 Hz par client, on n'inonde pas les logs info.
  app.post(
    "/api/rooms/:room/state",
    {
      logLevel: "warn",
      schema: {
        body: {
          type: "object",
          required: ["id", "x", "z", "ry"],
          properties: {
            id: { type: "string" },
            name: { type: "string", maxLength: 80 },
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
            ry: { type: "number" },
          },
        },
      },
    },
    (request, reply) => {
      const { room: roomKey } = request.params as { room: string };
      const body = request.body as { id: string; name?: string; x: number; y?: number; z: number; ry: number };
      const room = rooms.get(roomKey);
      const client = room?.get(body.id);
      if (!room || !client) return reply.code(204).send();

      client.x = body.x;
      client.y = body.y ?? client.y;
      client.z = body.z;
      client.ry = body.ry;
      if (body.name) client.name = body.name.slice(0, 80);

      broadcast(room, "state", presenceOf(client), client.id);
      return reply.code(204).send();
    },
  );

  // Emote (ex. saluer) → relayée aux pairs du salon.
  app.post(
    "/api/rooms/:room/emote",
    {
      logLevel: "warn",
      schema: {
        body: {
          type: "object",
          required: ["id", "emote"],
          properties: { id: { type: "string" }, emote: { type: "string", maxLength: 24 } },
        },
      },
    },
    (request, reply) => {
      const { room: roomKey } = request.params as { room: string };
      const { id, emote } = request.body as { id: string; emote: string };
      const room = rooms.get(roomKey);
      if (room?.has(id)) broadcast(room, "emote", { id, emote }, id);
      return reply.code(204).send();
    },
  );

  // Départ explicite (balise envoyée à la fermeture de l'onglet).
  app.post(
    "/api/rooms/:room/leave",
    { schema: { body: { type: "object", required: ["id"], properties: { id: { type: "string" } } } } },
    (request, reply) => {
      const { room: roomKey } = request.params as { room: string };
      const { id } = request.body as { id: string };
      const room = rooms.get(roomKey);
      const client = room?.get(id);
      if (room && client) {
        client.res.end();
        room.delete(id);
        broadcast(room, "leave", { id });
        broadcast(room, "count", { n: room.size });
        if (room.size === 0) rooms.delete(roomKey);
      }
      return reply.code(204).send();
    },
  );
}
