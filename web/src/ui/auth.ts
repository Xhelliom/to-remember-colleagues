import { signIn, signUp } from "../api.ts";

const authEl = document.getElementById("auth") as HTMLDivElement;
const form = document.getElementById("auth-form") as HTMLFormElement;
const tabs = Array.from(form.querySelectorAll<HTMLButtonElement>(".auth-tab"));
const signupOnly = form.querySelector(".signup-only") as HTMLLabelElement;
const errorEl = form.querySelector(".auth-error") as HTMLParagraphElement;

let mode: "signin" | "signup" = "signin";

function setMode(next: "signin" | "signup") {
  mode = next;
  for (const tab of tabs) tab.classList.toggle("active", tab.dataset.mode === next);
  signupOnly.classList.toggle("hidden", next !== "signup");
  (signupOnly.querySelector("input") as HTMLInputElement).required = next === "signup";
  errorEl.classList.add("hidden");
}

export function setupAuth(onAuthenticated: () => void) {
  for (const tab of tabs) {
    tab.addEventListener("click", () => setMode(tab.dataset.mode as "signin" | "signup"));
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const name = String(data.get("name") ?? "").trim();
    errorEl.classList.add("hidden");

    try {
      if (mode === "signup") {
        await signUp(name || email.split("@")[0], email, password);
      } else {
        await signIn(email, password);
      }
      onAuthenticated();
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : "Échec de l'authentification.";
      errorEl.classList.remove("hidden");
    }
  });
}

export function showAuth() {
  authEl.classList.remove("hidden");
}

export function hideAuth() {
  authEl.classList.add("hidden");
}
