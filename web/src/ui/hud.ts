import type { Cemetery } from "../cemetery.ts";
import { createColleague } from "../api.ts";
import type { Colleague } from "../types.ts";
import type { SeasonSetting, TimeSetting } from "../ambiance.ts";
import { openDialog } from "./dialog.ts";

const hudEl = document.getElementById("hud") as HTMLDivElement;
const nameEl = document.getElementById("cemetery-name") as HTMLDivElement;
const gravePanel = document.getElementById("grave-panel") as HTMLDivElement;
const graveName = gravePanel.querySelector(".grave-panel-name") as HTMLDivElement;
const graveDates = gravePanel.querySelector(".grave-panel-dates") as HTMLDivElement;
const graveQuote = gravePanel.querySelector(".grave-panel-quote") as HTMLQuoteElement;
const lockPrompt = document.getElementById("lock-prompt") as HTMLDivElement;
const lockPromptText = lockPrompt.querySelector("p") as HTMLParagraphElement;
const ambianceBtn = document.getElementById("ambiance-btn") as HTMLButtonElement;
const ambiancePanel = document.getElementById("ambiance-panel") as HTMLDivElement;
const timeSelect = document.getElementById("ambiance-time") as HTMLSelectElement;
const seasonSelect = document.getElementById("ambiance-season") as HTMLSelectElement;
const addGraveBtn = document.getElementById("add-grave-btn") as HTMLButtonElement;
const backRoadBtn = document.getElementById("back-road-btn") as HTMLButtonElement;
const backMenuBtn = document.getElementById("back-menu-btn") as HTMLButtonElement;
const portalPrompt = document.getElementById("portal-prompt") as HTMLDivElement;
const visitorCount = document.getElementById("visitor-count") as HTMLDivElement;

let currentCompanyId: string | null = null;

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" });
}

export function setupHud(
  cemetery: Cemetery,
  handlers: { onBack: () => void; onBackToRoad: () => void; onColleagueAdded: () => void },
) {
  cemetery.onFocusChange((colleague) => showGrave(colleague));

  // Invite « Appuyez sur E pour entrer » à l'approche d'un portail (hub, issue #5).
  cemetery.onPortalChange((portal) => {
    if (!portal) {
      portalPrompt.classList.add("hidden");
      return;
    }
    portalPrompt.textContent = `Appuyez sur E pour entrer · ${portal.company.name}`;
    portalPrompt.classList.remove("hidden");
  });

  // Compteur de visiteurs présents dans le salon, soi inclus (issue #4).
  cemetery.onVisitorCount((n) => {
    visitorCount.textContent = n > 0 ? `👥 ${n} visiteur${n > 1 ? "s" : ""}` : "";
  });

  cemetery.onLockChange((locked) => {
    lockPrompt.classList.toggle("hidden", locked);
    if (!locked) {
      gravePanel.classList.add("hidden");
      portalPrompt.classList.add("hidden");
    }
  });

  lockPrompt.addEventListener("click", () => cemetery.requestLock());

  ambianceBtn.addEventListener("click", () => {
    ambiancePanel.classList.toggle("hidden");
  });

  const applyAmbiance = () => {
    cemetery.setAmbianceSettings(
      timeSelect.value as TimeSetting,
      seasonSelect.value as SeasonSetting,
    );
  };
  timeSelect.addEventListener("change", applyAmbiance);
  seasonSelect.addEventListener("change", applyAmbiance);

  addGraveBtn.addEventListener("click", () => {
    if (!currentCompanyId) return;
    const wasLocked = cemetery.isLocked;
    if (wasLocked) cemetery.unlock();
    openDialog(
      "Ajouter un collègue",
      [
        { name: "name", label: "Nom du collègue", required: true, maxLength: 160 },
        { name: "quote", label: "Citation", type: "textarea", required: true, maxLength: 1000 },
        { name: "departedOn", label: "Date de départ (optionnel)", type: "date" },
      ],
      async (values) => {
        const colleague = await createColleague(currentCompanyId!, {
          name: values.name,
          quote: values.quote,
          departedOn: values.departedOn || undefined,
        });
        cemetery.addColleague(colleague);
        handlers.onColleagueAdded();
      },
    );
  });

  backRoadBtn.addEventListener("click", () => {
    cemetery.unlock();
    handlers.onBackToRoad();
  });

  backMenuBtn.addEventListener("click", () => {
    cemetery.unlock();
    handlers.onBack();
  });
}

function showGrave(colleague: Colleague | null) {
  if (!colleague) {
    gravePanel.classList.add("hidden");
    return;
  }
  graveName.textContent = colleague.name;
  graveDates.textContent = colleague.departedOn ? `Parti·e le ${formatDate(colleague.departedOn)}` : "";
  graveQuote.textContent = `« ${colleague.quote} »`;
  gravePanel.classList.remove("hidden");
}

/** Boutons réservés au cimetière (sans objet dans le hub). */
function setCemeteryButtons(visible: boolean) {
  addGraveBtn.classList.toggle("hidden", !visible);
  backRoadBtn.classList.toggle("hidden", !visible);
}

export function showHud(companyName: string, companyId: string) {
  currentCompanyId = companyId;
  nameEl.textContent = companyName;
  lockPromptText.textContent = "Cliquez pour entrer dans le cimetière";
  setCemeteryButtons(true);
  portalPrompt.classList.add("hidden");
  hudEl.classList.remove("hidden");
}

/** HUD du hub : pas de tombe à gérer, on parcourt la route (issue #5). */
export function showHubHud(cemeteryCount: number) {
  currentCompanyId = null;
  nameEl.textContent = `La route des cimetières · ${cemeteryCount} entrée${cemeteryCount > 1 ? "s" : ""}`;
  lockPromptText.textContent = "Cliquez pour parcourir la route";
  setCemeteryButtons(false);
  hudEl.classList.remove("hidden");
}

export function hideHud() {
  hudEl.classList.add("hidden");
  ambiancePanel.classList.add("hidden");
  gravePanel.classList.add("hidden");
  portalPrompt.classList.add("hidden");
  visitorCount.textContent = "";
}
