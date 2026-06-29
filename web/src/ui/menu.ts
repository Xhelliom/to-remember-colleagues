import { createCompany, getCompanies, signOut } from "../api.ts";
import type { Company, User } from "../types.ts";
import { openDialog } from "./dialog.ts";

const menuEl = document.getElementById("menu") as HTMLDivElement;
const listEl = document.getElementById("company-list") as HTMLDivElement;
const addBtn = document.getElementById("add-company-btn") as HTMLButtonElement;
const userNameEl = document.getElementById("menu-user-name") as HTMLSpanElement;
const signoutBtn = document.getElementById("signout-btn") as HTMLButtonElement;

export function setupMenu(handlers: {
  onEnter: (company: Company) => void;
  onSignOut: () => void;
}) {
  addBtn.addEventListener("click", () => {
    openDialog(
      "Nouvelle entreprise",
      [
        { name: "name", label: "Nom de l'entreprise", required: true, maxLength: 160 },
        { name: "description", label: "Description (optionnel)", type: "textarea", maxLength: 2000 },
      ],
      async (values) => {
        await createCompany(values.name, values.description);
        await refreshMenu();
      },
    );
  });

  signoutBtn.addEventListener("click", async () => {
    await signOut();
    handlers.onSignOut();
  });

  listEl.addEventListener("click", (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(".company-card");
    if (!card) return;
    const company = JSON.parse(card.dataset.company!) as Company;
    handlers.onEnter(company);
  });
}

export function setMenuUser(user: User) {
  userNameEl.textContent = user.name;
}

export async function refreshMenu() {
  listEl.innerHTML = '<p class="muted">Chargement…</p>';
  try {
    const companies = await getCompanies();
    if (companies.length === 0) {
      listEl.innerHTML = '<p class="muted">Aucun cimetière pour l\'instant. Créez-en un.</p>';
      return;
    }
    listEl.innerHTML = "";
    for (const company of companies) {
      const card = document.createElement("div");
      card.className = "company-card";
      card.dataset.company = JSON.stringify(company);
      card.innerHTML = `
        <h3>${escapeHtml(company.name)}</h3>
        <p>${escapeHtml(company.description ?? "")}</p>
        <span class="grave-count">⚰️ ${company.graveCount} collègue${company.graveCount > 1 ? "s" : ""}</span>
      `;
      listEl.appendChild(card);
    }
  } catch (err) {
    listEl.innerHTML = `<p class="muted">Erreur : ${escapeHtml(
      err instanceof Error ? err.message : "inconnue",
    )}</p>`;
  }
}

export function showMenu() {
  menuEl.classList.remove("hidden");
}

export function hideMenu() {
  menuEl.classList.add("hidden");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!;
  });
}
