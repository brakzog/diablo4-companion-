
import express from "express";
import cors from "cors";
import * as cheerio from "cheerio";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 4734;
app.use(cors());
app.use(express.json({ limit: "8mb" }));

const DEFAULT_SKILL_PATH = [
  { level: "70", name: "Dread Claws", type: "core", why: "Mécanique principale du build : vérifie que tu as bien la base du setup." },
  { level: "70+", name: "Command Fallen", type: "core", why: "Élément central de la rotation / synergie du build." },
  { level: "70+", name: "Nether Step", type: "mobility", why: "Mobilité et confort : utile pour fluidifier les combats." },
  { level: "70+", name: "Profane Sentinel", type: "synergy", why: "Synergie importante à comparer avec la variante choisie." },
  { level: "70+", name: "Terror Swarm", type: "damage", why: "Complète les dégâts et la rotation." },
  { level: "70+", name: "Ready at Hand", type: "comfort", why: "Améliore la fluidité globale du build." },
  { level: "70+", name: "Trip Mines", type: "optional", why: "Option de dégâts/contrôle selon variante." }
];

const DEFAULT_PARAGON_PATH = [
  { step: 1, name: "Plateau de départ", type: "board", why: "Commence par sécuriser les premiers nœuds utiles et le chemin vers le socket." },
  { step: 2, name: "Premier glyphe utile", type: "glyph", why: "Place le glyphe conseillé par le guide et commence à le monter." },
  { step: 3, name: "Nœuds rares proches", type: "rare", why: "Prends les rares qui apportent survie/ressource avant le min-max." },
  { step: 4, name: "Deuxième plateau endgame", type: "board", why: "Ajoute le plateau suivant seulement quand la base est stable." },
  { step: 5, name: "Glyphes niveau 15+", type: "glyph", why: "Premier vrai cap endgame : augmente la portée/valeur des glyphes." }
];

const FALLBACK_GOALS = [
  ["Aspect du péril", "CORE", "survie", "Aide à stabiliser le build. Prioritaire si tu galères en Pénitence."],
  ["Maximum ressource", "CORE", "fluidité", "Évite de tomber à court de ressource pendant les combats."],
  ["Aspect du maître d’armes", "IMPORTANT", "dégâts", "Augmente les dégâts. À prioriser quand le build est déjà stable."],
  ["Aspect du destin élémentaire", "IMPORTANT", "dégâts", "Synergie offensive importante du build."],
  ["Aspect d’accélération", "CONFORT", "fluidité", "Rend le gameplay plus fluide et plus nerveux."],
  ["Aspect insidieux", "IMPORTANT", "synergie", "Synergie utile du build, à récupérer progressivement."],
  ["Aspect du Mastodonte", "IMPORTANT", "survie", "Ajoute de la solidité si les mobs te font exploser."],
  ["Réduction du temps de recharge", "CONFORT", "fluidité", "Réduit les temps morts : tes compétences importantes reviennent plus souvent."],
  ["Chances de coup critique", "ENDGAME", "dégâts", "À pousser quand le build est déjà stable."],
  ["Multiplicateur dégâts vulnérable", "ENDGAME", "dégâts", "Optimisation offensive, surtout utile quand les bases sont posées."]
];

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function iconFor(kind) {
  if (kind === "survie") return "🛡";
  if (kind === "fluidité") return "⚡";
  if (kind === "dégâts") return "💥";
  if (kind === "mobilité") return "👟";
  if (kind === "core") return "🔥";
  if (kind === "glyph") return "🔷";
  if (kind === "board") return "🧩";
  return "🔗";
}

function makeGoal(name, priority, kind, why) {
  return {
    id: `goal:${normalize(name)}`,
    type: "gear",
    name,
    action: `Trouver puis équiper : ${name}`,
    why,
    priority,
    kind,
    icon: iconFor(kind)
  };
}

function cleanLine(value) {
  return String(value || "").replace(/\s+/g, " ").replace(/["{}[\]]/g, "").trim();
}

function collect(obj, bag = []) {
  if (!obj || bag.length > 4000) return bag;
  if (Array.isArray(obj)) {
    obj.forEach(v => collect(v, bag));
    return bag;
  }
  if (typeof obj === "object") {
    const title = obj.title || obj.name || obj.label || obj.slug || obj.id;
    if (title && typeof title === "string") bag.push(title);
    for (const v of Object.values(obj)) collect(v, bag);
  }
  return bag;
}

function detectSkill(raw) {
  const x = normalize(raw);
  const known = [
    ["dread claws", "Dread Claws", "core"],
    ["command fallen", "Command Fallen", "core"],
    ["nether step", "Nether Step", "mobility"],
    ["profane sentinel", "Profane Sentinel", "synergy"],
    ["terror swarm", "Terror Swarm", "damage"],
    ["ready at hand", "Ready at Hand", "comfort"],
    ["trip mines", "Trip Mines", "optional"],
    ["fallen rush", "Fallen Rush", "damage"],
    ["recall shadows", "Recall Shadows", "synergy"]
  ];
  for (const [needle, name, type] of known) {
    if (x.includes(needle)) {
      return { level: "auto", name, type, why: `Détecté dans le guide. À vérifier dans ton arbre de talents.` };
    }
  }
  return null;
}

function detectParagon(raw) {
  const x = normalize(raw);
  if (x.includes("glyph") || x.includes("glyphe")) return { step: 0, name: "Glyphe détecté dans le guide", type: "glyph", why: "À monter progressivement via donjons cauchemar / activités endgame." };
  if (x.includes("paragon") || x.includes("plateau")) return { step: 0, name: "Plateau parangon détecté", type: "board", why: "À comparer avec le planner du guide." };
  return null;
}

function detectGoal(raw) {
  const x = normalize(raw);
  const dict = [
    ["aspect of peril", "Aspect du péril", "CORE", "survie"],
    ["aspect du péril", "Aspect du péril", "CORE", "survie"],
    ["maximum resource", "Maximum ressource", "CORE", "fluidité"],
    ["maximum ressource", "Maximum ressource", "CORE", "fluidité"],
    ["edgemaster", "Aspect du maître d’armes", "IMPORTANT", "dégâts"],
    ["elemental fate", "Aspect du destin élémentaire", "IMPORTANT", "dégâts"],
    ["destin élémentaire", "Aspect du destin élémentaire", "IMPORTANT", "dégâts"],
    ["accelerating", "Aspect d’accélération", "CONFORT", "fluidité"],
    ["accélération", "Aspect d’accélération", "CONFORT", "fluidité"],
    ["insidious", "Aspect insidieux", "IMPORTANT", "synergie"],
    ["insidieux", "Aspect insidieux", "IMPORTANT", "synergie"],
    ["juggernaut", "Aspect du Mastodonte", "IMPORTANT", "survie"],
    ["mastodonte", "Aspect du Mastodonte", "IMPORTANT", "survie"],
    ["cooldown", "Réduction du temps de recharge", "CONFORT", "fluidité"],
    ["recharge", "Réduction du temps de recharge", "CONFORT", "fluidité"],
    ["critical strike", "Chances de coup critique", "ENDGAME", "dégâts"],
    ["critique", "Chances de coup critique", "ENDGAME", "dégâts"],
    ["vulnerable", "Multiplicateur dégâts vulnérable", "ENDGAME", "dégâts"],
    ["vulnérable", "Multiplicateur dégâts vulnérable", "ENDGAME", "dégâts"]
  ];
  for (const [needle, name, priority, kind] of dict) {
    if (x.includes(normalize(needle))) {
      const fallback = FALLBACK_GOALS.find(g => g[0] === name);
      return makeGoal(name, priority, kind, fallback?.[3] || "Objectif utile du build.");
    }
  }
  return null;
}

function dedupe(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item) continue;
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function cleanTitle(title) {
  return String(title || "Build importé").replace(/\s*-\s*Mobalytics.*$/i, "").trim();
}

app.post("/api/import", async (req, res) => {
  const url = req.body?.url;
  if (!url) return res.status(400).json({ error: "URL manquante" });

  try {
    const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 D4LiteCompanion/1.2" }});
    const html = await response.text();
    const $ = cheerio.load(html);

    const raw = [];
    $("script").each((_, el) => {
      const txt = $(el).text();
      if (!txt || txt.length < 100) return;
      const chunks = txt.match(/\{[\s\S]{100,}\}/g);
      if (!chunks) return;
      for (const chunk of chunks.slice(0, 10)) {
        try { collect(JSON.parse(chunk), raw); } catch {}
      }
    });
    $("body").text().split("\n").map(cleanLine).filter(Boolean).slice(0, 900).forEach(x => raw.push(x));

    const skills = dedupe(raw.map(detectSkill), x => normalize(x.name)).slice(0, 20);
    const paragon = dedupe(raw.map(detectParagon), x => normalize(x.name + x.type)).slice(0, 10);
    const goals = dedupe(raw.map(detectGoal), x => x.id).slice(0, 22);

    res.json({
      title: cleanTitle($("title").text()),
      description: $('meta[name="description"]').attr("content") || "Build importé.",
      goals: goals.length ? goals : FALLBACK_GOALS.map(g => makeGoal(g[0], g[1], g[2], g[3])),
      skillPath: skills.length ? skills.map((s, i) => ({ ...s, level: i < 2 ? "70" : "70+" })) : DEFAULT_SKILL_PATH,
      paragonPath: paragon.length ? paragon.map((p, i) => ({ ...p, step: i + 1 })) : DEFAULT_PARAGON_PATH,
      rawCount: raw.length,
      parserNote: skills.length || paragon.length ? "Import automatique best-effort depuis la page." : "Fallback utilisé : Mobalytics ne donne pas un chemin node-par-node facilement lisible."
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
app.use(vite.middlewares);
app.listen(PORT, () => console.log(`D4 Lite Companion v12 running on http://localhost:${PORT}`));
