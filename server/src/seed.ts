import { eq } from "drizzle-orm";
import { db, pool } from "./db/client.ts";
import { companies, colleagues } from "./db/schema.ts";

// voteScore (axe 2) et maintenance (axe 3) sont optionnels : valeurs par défaut
// neutres si absents. departedOn pilote l'axe 1 (vieillissement).
type SeedColleague = {
  name: string;
  quote: string;
  departedOn: string;
  voteScore?: number;
  maintenance?: number;
};
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
      // Cas combiné #25 : très vieille (axe 1) + paradisiaque (axe 2) + négligée (axe 3).
      { name: "Camille Dubois", quote: "Je serai toujours à un pixel près.", departedOn: "1985-09-15", voteScore: 32, maintenance: 0.1 },
      // Récente, hantée (downvotée), mais impeccablement entretenue.
      { name: "Hugo Mercier", quote: "Parti déployer en prod un vendredi soir.", departedOn: "2024-03-02", voteScore: -28, maintenance: 0.95 },
      { name: "Léa Fontaine", quote: "Elle a fini par trouver un meilleur café ailleurs.", departedOn: "2023-06-20", voteScore: 12 },
      { name: "Sofiane Baki", quote: "Ses commits étaient courts, sa légende est longue.", departedOn: "2000-11-30", maintenance: 0.2 },
      { name: "Marina Lopez", quote: "Elle a quitté l'open space pour les open spaces du large.", departedOn: "2024-01-10", voteScore: -8, maintenance: 0.5 },
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
      { name: "Laurent Perrot", quote: "Il indexait tout, même ses souvenirs.", departedOn: "2022-11-20" },
      { name: "Yasmine Chaoui", quote: "Sa pipeline coulait sans accroc.", departedOn: "2023-06-05", voteScore: 15 },
      { name: "Cédric Breton", quote: "Parti sans laisser de trace dans les logs.", departedOn: "2021-08-15", voteScore: -5 },
      { name: "Julie Marceau", quote: "Elle a migré vers de meilleurs serveurs.", departedOn: "2024-01-22", maintenance: 0.9 },
      { name: "Bastien Hulot", quote: "Son ETL était une œuvre d'art.", departedOn: "2022-03-09", voteScore: 20 },
      { name: "Sandrine Vogt", quote: "Elle partitionnait la vie avec méthode.", departedOn: "2023-09-18" },
      { name: "François Delorme", quote: "Sa requête finale : un peu de repos.", departedOn: "2021-12-07", maintenance: 0.3 },
      { name: "Imane Ouali", quote: "Elle a dénormalisé son existence pour mieux vivre.", departedOn: "2024-04-14", voteScore: 8 },
      { name: "Kevin Barre", quote: "Son cluster ne tombait jamais en panne.", departedOn: "2022-08-01", voteScore: -12, maintenance: 0.6 },
      { name: "Anne-Laure Saunier", quote: "Elle a rendu le schéma lisible pour tous.", departedOn: "2023-11-30", voteScore: 25 },
      { name: "Mehdi Tahir", quote: "Parti en prod le dernier jour, sans retour.", departedOn: "2021-10-22", maintenance: 0.1 },
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
      { name: "Marie Dupont", quote: "Elle houblonnait la vie avec art.", departedOn: "2021-03-15", voteScore: 10 },
      { name: "Jean-Pierre Blanc", quote: "Son tire-bouchon ne rouillera jamais.", departedOn: "2020-07-22", maintenance: 0.7 },
      { name: "Corinne Favre", quote: "Elle savait quand couper le service.", departedOn: "2022-01-10", voteScore: 5 },
      { name: "Robert Lagrange", quote: "Bière après bière, il a bâti une légende.", departedOn: "2019-05-18", voteScore: 30, maintenance: 0.2 },
      { name: "Sandrine Collet", quote: "Partie vers d'autres houblons.", departedOn: "2023-02-28" },
      { name: "Thierry Marchand", quote: "Il connaissait chaque client par son verre.", departedOn: "2020-11-05", voteScore: 18 },
      { name: "Brigitte Morel", quote: "Sa mousse était parfaite, comme elle.", departedOn: "2021-09-14", maintenance: 0.95 },
      { name: "Pascal Renard", quote: "Tireuse perfectionniste, barman poète.", departedOn: "2022-06-01", voteScore: -3 },
      { name: "Nathalie Lebrun", quote: "Elle a troqué le comptoir pour l'horizon.", departedOn: "2023-04-17" },
      { name: "Didier Salmon", quote: "Ses bières gardaient toujours la bonne température.", departedOn: "2020-08-30", voteScore: 7 },
      { name: "Isabelle Perrin", quote: "Partie vers des cieux plus maltés.", departedOn: "2021-12-03", maintenance: 0.4 },
      { name: "Franck Guillot", quote: "Il terminait toujours son service avec le sourire.", departedOn: "2022-10-25", voteScore: 22 },
      { name: "Valérie Chevalier", quote: "La cave était son royaume, le comptoir son trône.", departedOn: "2019-08-12", voteScore: 35, maintenance: 0.1 },
      { name: "Stéphane Mallet", quote: "Parti mais ses recettes restent.", departedOn: "2023-07-08" },
      { name: "Chantal Bousquet", quote: "Elle a versé des milliers de bières avec amour.", departedOn: "2020-04-22", voteScore: 14 },
      { name: "Laurent Bourgeois", quote: "Son ardoise était toujours à jour.", departedOn: "2021-06-30", maintenance: 0.6 },
      { name: "Aurélie Picard", quote: "Elle donnait du relief à chaque verre.", departedOn: "2022-09-16", voteScore: -8 },
      { name: "Christophe Arnaud", quote: "Ses fûts ne tombaient jamais à plat.", departedOn: "2020-02-14", voteScore: 9 },
      { name: "Delphine Roy", quote: "Elle a quitté le bar, pas la fête.", departedOn: "2023-08-19", maintenance: 0.85 },
      { name: "Alain Dumas", quote: "Vingt ans de service, mille bières versées.", departedOn: "2000-03-07", voteScore: 40, maintenance: 0.15 },
      { name: "Véronique Poirier", quote: "Ses cocktails étaient des œuvres d'art.", departedOn: "2021-11-22", voteScore: 28 },
      { name: "Sébastien Giraud", quote: "Il jonglait avec les chopes comme avec la vie.", departedOn: "2022-03-14" },
      { name: "Élodie Vidal", quote: "Son départ a laissé un vide derrière le bar.", departedOn: "2023-01-05", voteScore: -15, maintenance: 0.9 },
      { name: "Bernard Lecomte", quote: "Il gérait la cave comme un chef étoilé.", departedOn: "2020-06-18", voteScore: 20 },
      { name: "Céline Bertrand", quote: "Partie sans oublier de débrancher la machine à café.", departedOn: "2021-04-09" },
      { name: "Olivier Fontaine", quote: "Ses nuits de service valaient des romans.", departedOn: "2022-12-01", maintenance: 0.5 },
      { name: "Patricia Roussel", quote: "Elle savait accueillir même les jours difficiles.", departedOn: "2019-10-15", voteScore: 16 },
      { name: "Michel Gauthier", quote: "Le bon verre, au bon moment, toujours.", departedOn: "2020-09-28", voteScore: 11 },
      { name: "Laure Meunier", quote: "Elle houblonnait les lundis avec entrain.", departedOn: "2023-05-12", maintenance: 0.75 },
      { name: "Jacques Poulain", quote: "Retraité du comptoir, vivant dans les mémoires.", departedOn: "2005-01-20", voteScore: 45, maintenance: 0.05 },
      { name: "Mélanie Gosselin", quote: "Elle tournait les pages de la carte avec passion.", departedOn: "2021-08-07" },
      { name: "Romain Jacquet", quote: "Ses blagues valaient leur poids en bière.", departedOn: "2022-07-23", voteScore: -20 },
      { name: "Florence Benoist", quote: "Elle a passé le flambeau, mais garde la recette.", departedOn: "2020-03-11", voteScore: 6 },
      { name: "Sylvain Charrier", quote: "Vingt-cinq ans à tenir le bar sans vaciller.", departedOn: "2010-07-04", voteScore: 38, maintenance: 0.08 },
      { name: "Amélie Tessier", quote: "Ses Happy Hours étaient des instants magiques.", departedOn: "2023-03-29", maintenance: 0.92 },
      { name: "Philippe Leblanc", quote: "Il fermait toujours la caisse à l'heure.", departedOn: "2021-02-16" },
      { name: "Nadège Cordier", quote: "Partie là où les bières sont gratuites.", departedOn: "2022-11-08", voteScore: -6 },
      { name: "Jérôme Lacroix", quote: "Son registre de fidélité était le plus long de la ville.", departedOn: "2020-05-03", voteScore: 13 },
      { name: "Anne-Marie Collin", quote: "Elle a versé ses dernières larmes en bière blonde.", departedOn: "2021-10-18", maintenance: 0.3 },
      { name: "Frédéric Dupuy", quote: "Il réparait les cœurs brisés avec une pinte.", departedOn: "2023-06-14", voteScore: 19 },
      { name: "Sylvie Caron", quote: "Partie en paix, ardoise effacée.", departedOn: "2019-11-27", voteScore: 2 },
      { name: "Grégoire Sanchez", quote: "Ses conseils en vins valaient de l'or.", departedOn: "2020-01-15", voteScore: 24 },
      { name: "Muriel Leconte", quote: "Elle transformait chaque soirée en souvenir.", departedOn: "2022-04-06", maintenance: 0.65 },
      { name: "Bruno Martineau", quote: "Il ne laissait jamais un verre vide sur le comptoir.", departedOn: "2021-07-19", voteScore: 17 },
      { name: "Dominique Hervy", quote: "Elle a servi avec constance pendant dix ans.", departedOn: "2023-09-02" },
      { name: "Cédric Bouchard", quote: "Parti vers d'autres établissements, toujours en service.", departedOn: "2020-10-08", voteScore: -10 },
      { name: "Évelyne Perrault", quote: "Son regard réchauffait les soirées froides.", departedOn: "2022-02-20", voteScore: 33, maintenance: 0.88 },
      { name: "Xavier Lejeune", quote: "Il connaissait le nom de chaque bière par cœur.", departedOn: "2019-06-09", voteScore: 21 },
      { name: "Hélène Pilon", quote: "Elle a fini son tour de service avec dignité.", departedOn: "2021-03-28", maintenance: 0.45 },
      { name: "Damien Aubert", quote: "Parti un soir de carnaval, jamais revenu.", departedOn: "2022-08-05", voteScore: -18 },
      { name: "Isabelle Marceau", quote: "Elle trimait derrière le zinc depuis quinze ans.", departedOn: "2009-12-14", voteScore: 36, maintenance: 0.12 },
      { name: "Fabien Laurent", quote: "Son quart de travail durait parfois jusqu'à l'aube.", departedOn: "2023-04-01", voteScore: 4 },
      { name: "Karine Bourdon", quote: "Elle a versé sa dernière bière un soir d'automne.", departedOn: "2019-09-21", maintenance: 0.55 },
      { name: "Vincent Chardon", quote: "Ses tournées improvisées étaient légendaires.", departedOn: "2021-01-11", voteScore: 27 },
      { name: "Lucie Renaud", quote: "Elle a quitté le tablier, gardé l'esprit.", departedOn: "2022-05-17" },
      { name: "Patrice Guillon", quote: "Son sourire valait toutes les fidélités.", departedOn: "2020-07-01", voteScore: 12 },
      { name: "Joëlle Savard", quote: "Elle avait une mémoire infaillible pour les commandes.", departedOn: "2023-02-09", maintenance: 0.8 },
      { name: "Thiébault Renoud", quote: "Il a brassé la vie à pleine puissance.", departedOn: "2015-04-30", voteScore: 42, maintenance: 0.07 },
      { name: "Christelle Moulin", quote: "Ses bières pression étaient toujours à la bonne mousse.", departedOn: "2021-06-05", voteScore: 8 },
      { name: "Arnaud Pichon", quote: "Il se souviendra de chaque soirée du vendredi.", departedOn: "2022-09-30", voteScore: -4 },
      { name: "Geneviève Lamy", quote: "Elle portait les plateaux avec grâce et efficacité.", departedOn: "2020-11-19", maintenance: 0.6 },
      { name: "Sébastien Monnier", quote: "Ses playlists de soirée restent inégalées.", departedOn: "2023-07-22", voteScore: 15 },
      { name: "Marjolaine Vallet", quote: "Elle a brassé ses derniers espoirs ici.", departedOn: "2021-09-08", voteScore: -22, maintenance: 0.93 },
      { name: "Yves Marechal", quote: "Le barman aux mille anecdotes.", departedOn: "2008-12-15", voteScore: 48, maintenance: 0.03 },
      { name: "Émeline Cauchy", quote: "Ses sourires accompagnaient chaque pinte.", departedOn: "2022-01-28", voteScore: 23 },
      { name: "Stéphanie Durand", quote: "Elle gérait la cave et la caisse avec la même rigueur.", departedOn: "2020-08-07", maintenance: 0.7 },
      { name: "Guillaume Payet", quote: "Parti le jour de son anniversaire, verre en main.", departedOn: "2023-05-01", voteScore: 31 },
      { name: "Angélique Foret", quote: "Elle était l'âme de chaque soirée karaoké.", departedOn: "2019-02-17", voteScore: 26, maintenance: 0.35 },
      { name: "Marc-Antoine Roux", quote: "Son double expresso du lundi matin manque à tous.", departedOn: "2021-12-30", voteScore: -9 },
      { name: "Caroline Lebègue", quote: "Elle a tiré sa révérence avec élégance.", departedOn: "2022-06-19", maintenance: 0.82 },
      { name: "Henri Galland", quote: "Quarante ans de brassage, une vie de passion.", departedOn: "1998-03-25", voteScore: 50, maintenance: 0.02 },
      { name: "Simone Bénard", quote: "La doyenne du comptoir. Irremplaçable.", departedOn: "2003-08-03", voteScore: 44, maintenance: 0.06 },
    ],
  },
];

async function main() {
  for (const company of DATA) {
    // Upsert idempotent : met à jour si le slug existe déjà.
    const [createdCompany] = await db
      .insert(companies)
      .values({ name: company.name, slug: company.slug, description: company.description })
      .onConflictDoUpdate({
        target: companies.slug,
        set: { name: company.name, description: company.description },
      })
      .returning();

    // Supprime les collègues existants pour éviter les doublons au rejeu.
    await db.delete(colleagues).where(eq(colleagues.companyId, createdCompany.id));

    let seed = company.slug.length * 1000;
    for (const c of company.colleagues) {
      seed += 137; // graine déterministe et reproductible
      await db.insert(colleagues).values({
        companyId: createdCompany.id,
        name: c.name,
        quote: c.quote,
        departedOn: c.departedOn,
        graveSeed: seed,
        voteScore: c.voteScore ?? 0,
        maintenance: c.maintenance ?? 0.8,
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
