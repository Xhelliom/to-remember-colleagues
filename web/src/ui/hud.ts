import "./social.css";
import type { Cemetery } from "../cemetery.ts";
import { createColleague, getMyVote, voteColleague } from "../api.ts";
import type { Colleague } from "../types.ts";
import type { SeasonSetting, TimeSetting } from "../ambiance.ts";
import { openDialog } from "./dialog.ts";
import { openGuestbook } from "./guestbook.ts";

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
const voteUpBtn = document.getElementById("vote-up-btn") as HTMLButtonElement;
const voteDownBtn = document.getElementById("vote-down-btn") as HTMLButtonElement;
const voteScoreEl = document.getElementById("vote-score") as HTMLSpanElement;
const guestbookBtn = document.getElementById("guestbook-btn") as HTMLButtonElement;
const karmaGauge = document.getElementById("karma-gauge") as HTMLDivElement;
const karmaLabel = document.getElementById("karma-label") as HTMLSpanElement;
const karmaBar = document.getElementById("karma-bar") as HTMLDivElement;

let currentCompanyId: string | null = null;
let focusedColleague: Colleague | null = null;
let myVote: -1 | 0 | 1 = 0;

const KARMA_MAX = 50;

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" });
}

function updateVoteButtons(vote: -1 | 0 | 1, score: number) {
  myVote = vote;
  voteScoreEl.textContent = String(score);
  voteUpBtn.classList.toggle("active-up", vote === 1);
  voteDownBtn.classList.toggle("active-down", vote === -1);
}

async function loadMyVote(colleague: Colleague) {
  updateVoteButtons(0, colleague.voteScore);
  try {
    const v = await getMyVote(colleague.id);
    // Guard contre la course : l'utilisateur a pu focaliser une autre tombe pendant la requête.
    if (focusedColleague?.id !== colleague.id) return;
    updateVoteButtons(v, colleague.voteScore);
  } catch {
    /* pas connecté ou réseau — boutons neutres */
  }
}

async function handleVote(value: 1 | -1) {
  if (!focusedColleague) return;
  const next: -1 | 0 | 1 = myVote === value ? 0 : value;
  try {
    const { voteScore } = await voteColleague(focusedColleague.id, next);
    focusedColleague = { ...focusedColleague, voteScore };
    updateVoteButtons(next, voteScore);
  } catch (err) {
    console.error("Erreur vote:", err);
  }
}

/** Affiche la jauge de karma du cimetière (issue #3). */
function updateKarma(karma: number) {
  const capped = Math.max(-KARMA_MAX, Math.min(KARMA_MAX, karma));
  const norm = (capped + KARMA_MAX) / (2 * KARMA_MAX); // 0..1
  const pct = Math.round(norm * 100);
  karmaBar.style.width = `${pct}%`;
  if (karma >= 10) {
    karmaBar.style.backgroundColor = "#b9a06b";
    karmaLabel.textContent = `Paradis ★`;
  } else if (karma <= -10) {
    karmaBar.style.backgroundColor = "#d4796a";
    karmaLabel.textContent = `Enfer ☠`;
  } else {
    karmaBar.style.backgroundColor = "rgba(200,200,200,0.5)";
    karmaLabel.textContent = "Neutre";
  }
  karmaGauge.classList.remove("hidden");
}

function setupCemeteryListeners(cemetery: Cemetery) {
  cemetery.onFocusChange((colleague) => {
    focusedColleague = colleague;
    showGrave(colleague);
    if (colleague) void loadMyVote(colleague);
  });

  cemetery.onPortalChange((portal) => {
    if (!portal) {
      portalPrompt.classList.add("hidden");
      return;
    }
    portalPrompt.textContent = `Appuyez sur E pour entrer · ${portal.company.name}`;
    portalPrompt.classList.remove("hidden");
  });

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
}

function setupAmbianceControls(cemetery: Cemetery) {
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
}

/** Libère le pointer lock, appelle fn, puis le réacquiert à la fermeture via onClose. */
function withUnlocked(cemetery: Cemetery, onClose: (() => void) | undefined, fn: (onClose: (() => void) | undefined) => void) {
  const wasLocked = cemetery.isLocked;
  if (wasLocked) cemetery.unlock();
  fn(wasLocked ? () => { cemetery.requestLock(); onClose?.(); } : onClose);
}

function setupGraveActions(cemetery: Cemetery, handlers: { onColleagueAdded: () => void }) {
  voteUpBtn.addEventListener("click", () => { void handleVote(1); });
  voteDownBtn.addEventListener("click", () => { void handleVote(-1); });

  guestbookBtn.addEventListener("click", () => {
    if (!focusedColleague) return;
    withUnlocked(cemetery, undefined, (onClose) => {
      // Le clic fermer est un geste utilisateur valide pour requestPointerLock.
      void openGuestbook(focusedColleague!.id, focusedColleague!.name, onClose);
    });
  });

  addGraveBtn.addEventListener("click", () => {
    if (!currentCompanyId) return;
    withUnlocked(cemetery, undefined, () => {
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
  });
}

function setupNavigationButtons(cemetery: Cemetery, handlers: { onBack: () => void; onBackToRoad: () => void }) {
  backRoadBtn.addEventListener("click", () => {
    cemetery.unlock();
    handlers.onBackToRoad();
  });

  backMenuBtn.addEventListener("click", () => {
    cemetery.unlock();
    handlers.onBack();
  });
}

export function setupHud(
  cemetery: Cemetery,
  handlers: { onBack: () => void; onBackToRoad: () => void; onColleagueAdded: () => void },
) {
  setupCemeteryListeners(cemetery);
  setupAmbianceControls(cemetery);
  setupGraveActions(cemetery, handlers);
  setupNavigationButtons(cemetery, handlers);
}

function showGrave(colleague: Colleague | null) {
  if (!colleague) {
    gravePanel.classList.add("hidden");
    return;
  }
  graveName.textContent = colleague.name;
  graveDates.textContent = colleague.departedOn ? `Parti·e le ${formatDate(colleague.departedOn)}` : "";
  graveQuote.textContent = `« ${colleague.quote} »`;
  voteScoreEl.textContent = String(colleague.voteScore);
  voteUpBtn.classList.remove("active-up");
  voteDownBtn.classList.remove("active-down");
  gravePanel.classList.remove("hidden");
}

/** Boutons réservés au cimetière (sans objet dans le hub). */
function setCemeteryButtons(visible: boolean) {
  addGraveBtn.classList.toggle("hidden", !visible);
  backRoadBtn.classList.toggle("hidden", !visible);
}

export function showHud(companyName: string, companyId: string, karma: number) {
  currentCompanyId = companyId;
  nameEl.textContent = companyName;
  lockPromptText.textContent = "Cliquez pour entrer dans le cimetière";
  setCemeteryButtons(true);
  portalPrompt.classList.add("hidden");
  updateKarma(karma);
  hudEl.classList.remove("hidden");
}

/** HUD du hub : pas de tombe à gérer, on parcourt la route (issue #5). */
export function showHubHud(cemeteryCount: number) {
  currentCompanyId = null;
  nameEl.textContent = `La route des cimetières · ${cemeteryCount} entrée${cemeteryCount > 1 ? "s" : ""}`;
  lockPromptText.textContent = "Cliquez pour parcourir la route";
  setCemeteryButtons(false);
  karmaGauge.classList.add("hidden");
  hudEl.classList.remove("hidden");
}

export function hideHud() {
  hudEl.classList.add("hidden");
  ambiancePanel.classList.add("hidden");
  gravePanel.classList.add("hidden");
  portalPrompt.classList.add("hidden");
  karmaGauge.classList.add("hidden");
  visitorCount.textContent = "";
}
