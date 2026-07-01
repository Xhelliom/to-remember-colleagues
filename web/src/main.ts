import { getColleagues, getCompanies, getCurrentUser, getColleagueById } from "./api.ts";
import { Cemetery } from "./cemetery.ts";
import { hideAuth, setupAuth, showAuth } from "./ui/auth.ts";
import { hideMenu, refreshMenu, setMenuUser, setupMenu, showMenu } from "./ui/menu.ts";
import { hideHud, setupHud, showWorldHud } from "./ui/hud.ts";

const loader = document.getElementById("loader") as HTMLDivElement;
const canvas = document.getElementById("scene") as HTMLCanvasElement;

const cemetery = new Cemetery(canvas);
// Chargement « à vue » des tombes d'un cimetière à l'approche (issue #5).
cemetery.setColleagueLoader((id) => getColleagues(id));

function hideLoader() {
  loader.classList.add("hidden");
}

async function goToMenu() {
  cemetery.setActive(false);
  cemetery.leavePresence();
  cemetery.clearWorld();
  hideAuth();
  hideHud();
  await refreshMenu();
  showMenu();
}

function goToAuth() {
  cemetery.setActive(false);
  cemetery.leavePresence();
  hideHud();
  hideMenu();
  showAuth();
}

/** Navigation directe vers une tombe via lien de partage (issue #18). */
async function enterCemeteryByGrave(graveId: string) {
  try {
    const { company } = await getColleagueById(graveId);
    await goToWorld(company.id);
    history.replaceState(null, "", window.location.pathname);
  } catch {
    await goToMenu();
  }
}

// Monde continu : la route sinueuse bordée des cimetières (issue #5).
// `spawnCompanyId` → spawn directement à l'entrée d'un cimetière (voyage rapide).
async function goToWorld(spawnCompanyId?: string) {
  hideMenu();
  hideAuth();
  const companies = await getCompanies();
  cemetery.enterWorld(companies, spawnCompanyId);
  showWorldHud(companies.length);
  cemetery.setActive(true);
}

setupAuth(async () => {
  const user = await getCurrentUser();
  if (user) {
    setMenuUser(user);
    cemetery.setVisitorName(user.name);
  }
  const graveId = new URLSearchParams(window.location.search).get("grave");
  if (graveId) {
    await enterCemeteryByGrave(graveId);
  } else {
    await goToMenu();
  }
});

setupMenu({
  onEnter: (company) => {
    void goToWorld(company.id); // voyage rapide : spawn à l'entrée de ce cimetière
  },
  onExplore: () => {
    void goToWorld();
  },
  onSignOut: () => goToAuth(),
});

setupHud(cemetery, {
  onBack: () => {
    void goToMenu();
  },
  onColleagueAdded: () => {
    /* la tombe est déjà ajoutée à la scène ; rien d'autre à faire ici */
  },
});

// Détermine l'écran de départ selon la session.
(async () => {
  try {
    const user = await getCurrentUser();
    const graveId = new URLSearchParams(window.location.search).get("grave");
    if (user) {
      setMenuUser(user);
      cemetery.setVisitorName(user.name);
      if (graveId) {
        await enterCemeteryByGrave(graveId);
      } else {
        await goToMenu();
      }
    } else {
      goToAuth();
    }
  } catch {
    goToAuth();
  } finally {
    hideLoader();
  }
})();
