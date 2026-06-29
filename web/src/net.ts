// Présence temps réel côté client (issue #4).
// Transport natif : EventSource (SSE) pour recevoir l'état des pairs, fetch POST
// pour publier le sien. Le serveur (autoritatif-relais) attribue notre id.

export type PeerState = { id: string; name: string; x: number; y: number; z: number; ry: number };

export type PresenceHandlers = {
  onPeerState: (peer: PeerState) => void;
  onPeerLeave: (id: string) => void;
  onEmote: (id: string, emote: string) => void;
  onCount: (n: number) => void;
};

const STATE_INTERVAL_MS = 100; // ~10 publications/s

export class Presence {
  private es: EventSource | null = null;
  private room = "";
  private myId: string | null = null;
  private name = "Visiteur";
  private lastSent = 0;
  private pending: { x: number; y: number; z: number; ry: number } | null = null;

  /** Rejoint un salon (cimetière ou hub). Idempotent : reconnecte si le salon change. */
  connect(room: string, name: string, handlers: PresenceHandlers) {
    this.disconnect();
    this.room = room;
    this.name = name;
    const es = new EventSource(`/api/rooms/${encodeURIComponent(room)}/stream`, { withCredentials: true });
    this.es = es;

    es.addEventListener("welcome", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { id: string; peers: PeerState[] };
      this.myId = data.id;
      for (const p of data.peers) handlers.onPeerState(p);
      // Publie immédiatement notre nom/position de départ.
      if (this.pending) this.flush(true);
    });
    es.addEventListener("state", (e) => handlers.onPeerState(JSON.parse((e as MessageEvent).data) as PeerState));
    es.addEventListener("leave", (e) => handlers.onPeerLeave((JSON.parse((e as MessageEvent).data) as { id: string }).id));
    es.addEventListener("emote", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as { id: string; emote: string };
      handlers.onEmote(d.id, d.emote);
    });
    es.addEventListener("count", (e) => handlers.onCount((JSON.parse((e as MessageEvent).data) as { n: number }).n));
  }

  /** Mémorise notre position ; publiée au plus à ~10 Hz. */
  setState(x: number, y: number, z: number, ry: number) {
    this.pending = { x, y, z, ry };
    this.flush(false);
  }

  private flush(force: boolean) {
    if (!this.myId || !this.pending) return;
    const now = performance.now();
    if (!force && now - this.lastSent < STATE_INTERVAL_MS) return;
    this.lastSent = now;
    const body = JSON.stringify({ id: this.myId, name: this.name, ...this.pending });
    void fetch(`/api/rooms/${encodeURIComponent(this.room)}/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body,
      keepalive: true,
    }).catch(() => {});
  }

  emote(emote: string) {
    if (!this.myId) return;
    void fetch(`/api/rooms/${encodeURIComponent(this.room)}/emote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id: this.myId, emote }),
      keepalive: true,
    }).catch(() => {});
  }

  disconnect() {
    if (!this.es) return;
    this.es.close();
    this.es = null;
    if (this.myId) {
      // Balise de départ (fiable même à la fermeture de l'onglet).
      const blob = new Blob([JSON.stringify({ id: this.myId })], { type: "application/json" });
      navigator.sendBeacon(`/api/rooms/${encodeURIComponent(this.room)}/leave`, blob);
    }
    this.myId = null;
    this.pending = null;
  }
}
