import { getColleagues, getCurrentUser } from "./api.ts";
import { Cemetery } from "./cemetery.ts";
import type { Company } from "./types.ts";
import { hideAuth, setupAuth, showAuth } from "./ui/auth.ts";
import { hideMenu, refreshMenu, setMenuUser, setupMenu, showMenu } from "./ui/menu.ts";
import { hideHud, setupHud, showHud } from "./ui/hud.ts";

const loader = document.getElementById("loader") as HTMLDivElement;
const canvas = document.getElementById("scene") as HTMLCanvasElement;

const cemetery = new Cemetery(canvas);

function hideLoader() {
  loader.classList.add("hidden");
}

async function goToMenu() {
  cemetery.setActive(false);
  hideAuth();
  hideHud();
  await refreshMenu();
  showMenu();
}

function goToAuth() {
  cemetery.setActive(false);
  hideHud();
  hideMenu();
  showAuth();
}

async function enterCemetery(company: Company) {
  hideMenu();
  const detail = await getColleagues(company.id);
  cemetery.setCemetery(detail);
  showHud(company.name, company.id);
  cemetery.setActive(true);
  // Petit délai pour laisser le HUD s'afficher avant la capture de la souris.
  setTimeout(() => cemetery.requestLock(), 150);
}

setupAuth(async () => {
  const user = await getCurrentUser();
  if (user) setMenuUser(user);
  await goToMenu();
});

setupMenu({
  onEnter: (company) => {
    void enterCemetery(company);
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
    if (user) {
      setMenuUser(user);
      await goToMenu();
    } else {
      goToAuth();
    }
  } catch {
    goToAuth();
  } finally {
    hideLoader();
  }
})();
