import { createCompany, getCompanies, signOut } from "../api.ts";
import type { Company, User } from "../types.ts";
import { openDialog } from "./dialog.ts";
import { escapeHtml } from "./utils.ts";

const menuEl = document.getElementById("menu") as HTMLDivElement;
const listEl = document.getElementById("company-list") as HTMLDivElement;
const addBtn = document.getElementById("add-company-btn") as HTMLButtonElement;
const exploreBtn = document.getElementById("explore-btn") as HTMLButtonElement;
const userNameEl = document.getElementById("menu-user-name") as HTMLSpanElement;
const signoutBtn = document.getElementById("signout-btn") as HTMLButtonElement;
const sortBtns = document.querySelectorAll<HTMLButtonElement>(".sort-btn");

type SortKey = "name" | "karma" | "graves";
let currentSort: SortKey = "name";
let cachedCompanies: Company[] = [];

function sortCompanies(companies: Company[], sort: SortKey): Company[] {
  return [...companies].sort((a, b) => {
    if (sort === "karma") return b.karma - a.karma;
    if (sort === "graves") return b.graveCount - a.graveCount;
    return a.name.localeCompare(b.name, "fr");
  });
}

function karmaLabel(karma: number): string {
  if (karma >= 10) return "⭐ Paradis";
  if (karma <= -10) return "💀 Enfer";
  return "";
}

function renderCompanies(companies: Company[]) {
  if (companies.length === 0) {
    listEl.innerHTML = '<p class="muted">Aucun cimetière pour l\'instant. Créez-en un.</p>';
    return;
  }
  const sorted = sortCompanies(companies, currentSort);
  listEl.innerHTML = "";
  sorted.forEach((company, rank) => {
    const card = document.createElement("div");
    card.className = "company-card";
    card.dataset.company = JSON.stringify(company);
    const medal = rank === 0 && currentSort !== "name" ? "🥇 " : rank === 1 && currentSort !== "name" ? "🥈 " : rank === 2 && currentSort !== "name" ? "🥉 " : "";
    const karmaStr = karmaLabel(company.karma);
    const offeringStr = company.offeringCount > 0 ? `🌸 ${company.offeringCount}` : "";
    card.innerHTML = `
      <div class="card-header">
        <h3>${medal}${escapeHtml(company.name)}</h3>
        ${karmaStr ? `<span class="karma-badge">${karmaStr}</span>` : ""}
      </div>
      <p class="card-desc">${escapeHtml(company.description ?? "")}</p>
      <div class="card-stats">
        <span>⚰️ ${company.graveCount} collègue${company.graveCount !== 1 ? "s" : ""}</span>
        <span>⚖️ ${company.karma > 0 ? "+" : ""}${company.karma}</span>
        ${offeringStr ? `<span>${offeringStr}</span>` : ""}
        <span class="status-tag">${escapeHtml(company.status)}</span>
      </div>
    `;
    listEl.appendChild(card);
  });
}

function setupSortButtons() {
  sortBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      currentSort = btn.dataset.sort as SortKey;
      sortBtns.forEach((b) => b.classList.toggle("active", b === btn));
      renderCompanies(cachedCompanies);
    });
  });
}

export function setupMenu(handlers: {
  onEnter: (company: Company) => void;
  onExplore: () => void;
  onSignOut: () => void;
}) {
  exploreBtn.addEventListener("click", () => handlers.onExplore());
  setupSortButtons();

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
    cachedCompanies = await getCompanies();
    renderCompanies(cachedCompanies);
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

