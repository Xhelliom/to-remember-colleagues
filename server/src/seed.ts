import { sql } from "drizzle-orm";
import { db, pool } from "./db/client.ts";
import { companies, colleagues } from "./db/schema.ts";

type SeedColleague = { name: string; quote: string; departedOn: string };
type SeedCompany = {
  name: string;
  slug: string;
  description: string;
  colleagues: SeedColleague[];
};

const DATA: SeedCompany[] = [
  {
    name: "Pixel & Cie",
    slug: "pixel-et-cie",
    description: "Studio créatif. Ici reposent les pixels poussés trop loin.",
    colleagues: [
      { name: "Camille Dubois", quote: "Je serai toujours à un pixel près.", departedOn: "2021-09-15" },
      { name: "Hugo Mercier", quote: "Parti déployer en prod un vendredi soir.", departedOn: "2022-03-02" },
      { name: "Léa Fontaine", quote: "Elle a fini par trouver un meilleur café ailleurs.", departedOn: "2023-06-20" },
      { name: "Sofiane Baki", quote: "Ses commits étaient courts, sa légende est longue.", departedOn: "2020-11-30" },
      { name: "Marina Lopez", quote: "Elle a quitté l'open space pour les open spaces du large.", departedOn: "2024-01-10" },
    ],
  },
  {
    name: "DataForge",
    slug: "dataforge",
    description: "Usine à données. Tombes triées, indexées, jamais oubliées.",
    colleagues: [
      { name: "Thomas Renard", quote: "404 : collègue non trouvé.", departedOn: "2022-07-07" },
      { name: "Aïcha Benali", quote: "Elle a normalisé jusqu'à son départ.", departedOn: "2023-02-14" },
      { name: "Pierre Garnier", quote: "Reposé en lecture seule.", departedOn: "2021-05-19" },
      { name: "Nadia Khelifi", quote: "Sa dernière requête a enfin renvoyé la paix.", departedOn: "2024-09-01" },
    ],
  },
  {
    name: "Brasserie du Coin",
    slug: "brasserie-du-coin",
    description: "On y servait des bières et de belles histoires.",
    colleagues: [
      { name: "Gérard Petit", quote: "La tournée est pour lui, à jamais.", departedOn: "2019-12-24" },
      { name: "Manon Girard", quote: "Elle a rendu son tablier, pas son sourire.", departedOn: "2022-08-11" },
      { name: "Yanis Moreau", quote: "Service terminé.", departedOn: "2023-10-31" },
    ],
  },
];

async function main() {
  console.log("Nettoyage des données existantes…");
  await db.execute(sql`truncate table ${colleagues}, ${companies} restart identity cascade`);

  for (const company of DATA) {
    const [createdCompany] = await db
      .insert(companies)
      .values({ name: company.name, slug: company.slug, description: company.description })
      .returning();

    let seed = company.slug.length * 1000;
    for (const c of company.colleagues) {
      seed += 137; // graine déterministe et reproductible
      await db.insert(colleagues).values({
        companyId: createdCompany.id,
        name: c.name,
        quote: c.quote,
        departedOn: c.departedOn,
        graveSeed: seed,
      });
    }
    console.log(`  ✓ ${company.name} (${company.colleagues.length} tombes)`);
  }

  console.log("Seed terminé.");
  await pool.end();
}

main().catch((err) => {
  console.error("Échec du seed :", err);
  process.exit(1);
});
