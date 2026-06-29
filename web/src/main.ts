import { getColleagues, getCompanies, getCurrentUser } from "./api.ts";
import { Cemetery } from "./cemetery.ts";
import type { Company } from "./types.ts";
import { hideAuth, setupAuth, showAuth } from "./ui/auth.ts";
import { hideMenu, refreshMenu, setMenuUser, setupMenu, showMenu } from "./ui/menu.ts";
import { hideHud, setupHud, showHubHud, showHud } from "./ui/hud.ts";

const loader = document.getElementById("loader") as HTMLDivElement;
const canvas = document.getElementById("scene") as HTMLCanvasElement;

const cemetery = new Cemetery(canvas);

function hideLoader() {
  loader.classList.add("hidden");
}

async function goToMenu() {
  cemetery.setActive(false);
  cemetery.leavePresence();
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

async function enterCemetery(company: Company) {
  hideMenu();
  // Chargement à la demande des tombes de ce cimetière (issue #5).
  const detail = await getColleagues(company.id);
  cemetery.setCemetery(detail);
  showHud(company.name, company.id, detail.karma, company.status === "Fermé", detail.anonymized);
  cemetery.setActive(true);
  // L'utilisateur clique sur l'invite pour capturer la souris et commencer à marcher.
}

// Hub : la route commune d'où l'on rejoint les entrées des cimetières (issue #5).
async function goToHub() {
  hideMenu();
  hideAuth();
  const companies = await getCompanies();
  cemetery.enterHub(companies);
  showHubHud(companies.length);
  cemetery.setActive(true);
}

setupAuth(async () => {
  const user = await getCurrentUser();
  if (user) {
    setMenuUser(user);
    cemetery.setVisitorName(user.name);
  }
  await goToMenu();
});

setupMenu({
  onEnter: (company) => {
    void enterCemetery(company); // voyage rapide directement dans un cimetière
  },
  onExplore: () => {
    void goToHub();
  },
  onSignOut: () => goToAuth(),
});

// Entrée d'un portail depuis le hub → chargement de ce cimetière.
cemetery.onEnterPortal((company) => {
  void enterCemetery(company);
});

setupHud(cemetery, {
  onBack: () => {
    void goToMenu();
  },
  onBackToRoad: () => {
    void goToHub();
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
      cemetery.setVisitorName(user.name);
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
