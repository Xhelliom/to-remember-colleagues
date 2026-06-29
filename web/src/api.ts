import { createAuthClient } from "better-auth/client";
import type { Company, CompanyDetail, Colleague, User } from "./types.ts";

export const authClient = createAuthClient({
  basePath: "/api/auth",
});

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Erreur ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* corps non-JSON */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

// --- Auth ---

export async function getCurrentUser(): Promise<User | null> {
  const { data } = await authClient.getSession();
  if (!data?.user) return null;
  const u = data.user;
  return { id: u.id, email: u.email, name: u.name };
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await authClient.signIn.email({ email, password });
  if (error) throw new Error(error.message ?? "Connexion impossible.");
}

export async function signUp(name: string, email: string, password: string): Promise<void> {
  const { error } = await authClient.signUp.email({ name, email, password });
  if (error) throw new Error(error.message ?? "Inscription impossible.");
}

export async function signOut(): Promise<void> {
  await authClient.signOut();
}

// --- API métier ---

export async function getCompanies(): Promise<Company[]> {
  return json<Company[]>(await fetch("/api/companies", { credentials: "include" }));
}

export async function createCompany(name: string, description: string): Promise<Company> {
  const res = await fetch("/api/companies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name, description }),
  });
  return json<Company>(res);
}

export async function getColleagues(companyId: string): Promise<CompanyDetail> {
  return json<CompanyDetail>(
    await fetch(`/api/companies/${companyId}/colleagues`, { credentials: "include" }),
  );
}

export async function createColleague(
  companyId: string,
  payload: { name: string; quote: string; departedOn?: string },
): Promise<Colleague> {
  const res = await fetch(`/api/companies/${companyId}/colleagues`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return json<Colleague>(res);
}
