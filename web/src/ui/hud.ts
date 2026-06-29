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
const ambianceBtn = document.getElementById("ambiance-btn") as HTMLButtonElement;
const ambiancePanel = document.getElementById("ambiance-panel") as HTMLDivElement;
const timeSelect = document.getElementById("ambiance-time") as HTMLSelectElement;
const seasonSelect = document.getElementById("ambiance-season") as HTMLSelectElement;
const addGraveBtn = document.getElementById("add-grave-btn") as HTMLButtonElement;
const backMenuBtn = document.getElementById("back-menu-btn") as HTMLButtonElement;

let currentCompanyId: string | null = null;

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" });
}

export function setupHud(
  cemetery: Cemetery,
  handlers: { onBack: () => void; onColleagueAdded: () => void },
) {
  cemetery.onFocusChange((colleague) => showGrave(colleague));

  cemetery.onLockChange((locked) => {
    lockPrompt.classList.toggle("hidden", locked);
    if (!locked) gravePanel.classList.add("hidden");
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

export function showHud(companyName: string, companyId: string) {
  currentCompanyId = companyId;
  nameEl.textContent = companyName;
  hudEl.classList.remove("hidden");
}

export function hideHud() {
  hudEl.classList.add("hidden");
  ambiancePanel.classList.add("hidden");
  gravePanel.classList.add("hidden");
}
