import { addGraveMessage, getGraveMessages } from "../api.ts";
import type { GraveMessage } from "../types.ts";

const overlay = document.getElementById("guestbook") as HTMLDivElement;
const titleEl = document.getElementById("guestbook-title") as HTMLHeadingElement;
const messagesEl = document.getElementById("guestbook-messages") as HTMLDivElement;
const form = document.getElementById("guestbook-form") as HTMLFormElement;
const contentInput = document.getElementById("guestbook-content") as HTMLTextAreaElement;
const errorEl = form.querySelector(".guestbook-error") as HTMLParagraphElement;
const closeBtn = document.getElementById("guestbook-close") as HTMLButtonElement;

let activeColleagueId: string | null = null;
let onCloseCallback: (() => void) | null = null;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!;
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function renderMessages(messages: GraveMessage[]) {
  if (messages.length === 0) {
    messagesEl.innerHTML = `<p class="guestbook-empty">Aucun hommage pour l'instant. Soyez le premier.</p>`;
    return;
  }
  messagesEl.innerHTML = messages
    .map(
      (m) => `
    <div class="guestbook-msg">
      <div class="guestbook-msg-header">
        <strong>${escapeHtml(m.authorName)}</strong>
        <span class="guestbook-msg-date">${formatDate(m.createdAt)}</span>
      </div>
      <p class="guestbook-msg-body">${escapeHtml(m.content)}</p>
    </div>`,
    )
    .join("");
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendMessage(m: GraveMessage) {
  const empty = messagesEl.querySelector(".guestbook-empty");
  if (empty) empty.remove();
  const div = document.createElement("div");
  div.className = "guestbook-msg";
  div.innerHTML = `
    <div class="guestbook-msg-header">
      <strong>${escapeHtml(m.authorName)}</strong>
      <span class="guestbook-msg-date">${formatDate(m.createdAt)}</span>
    </div>
    <p class="guestbook-msg-body">${escapeHtml(m.content)}</p>`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function close() {
  overlay.classList.add("hidden");
  activeColleagueId = null;
  onCloseCallback?.();
  onCloseCallback = null;
}

closeBtn.addEventListener("click", close);
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) close();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!activeColleagueId) return;
  const content = contentInput.value.trim();
  if (!content) return;
  errorEl.classList.add("hidden");
  try {
    const msg = await addGraveMessage(activeColleagueId, content);
    contentInput.value = "";
    appendMessage(msg);
  } catch (err) {
    errorEl.textContent = err instanceof Error ? err.message : "Erreur lors de l'envoi.";
    errorEl.classList.remove("hidden");
  }
});

/** Ouvre le livre d'or pour un collègue donné. */
export async function openGuestbook(colleagueId: string, colleagueName: string, onClose?: () => void) {
  activeColleagueId = colleagueId;
  onCloseCallback = onClose ?? null;
  titleEl.textContent = `Livre d'or · ${colleagueName}`;
  messagesEl.innerHTML = `<p class="guestbook-empty">Chargement…</p>`;
  errorEl.classList.add("hidden");
  contentInput.value = "";
  overlay.classList.remove("hidden");

  try {
    const messages = await getGraveMessages(colleagueId);
    // Guard contre la course : l'utilisateur a pu basculer vers une autre tombe pendant le chargement.
    if (activeColleagueId !== colleagueId) return;
    renderMessages(messages);
  } catch {
    if (activeColleagueId === colleagueId) {
      messagesEl.innerHTML = `<p class="guestbook-empty">Impossible de charger les messages.</p>`;
    }
  }
}
