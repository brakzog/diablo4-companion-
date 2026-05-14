import express from "express";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");
const CURRENT_BUILD_PATH = join(DATA_DIR, "current.json");

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const app = express();
const PORT = 4734;

// CORS explicite pour autoriser les requêtes depuis mobalytics.gg (bookmarklet)
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.options("/{*path}", cors()); // pre-flight requests
app.use(express.json({ limit: "20mb" }));

// ─── Helpers ──────────────────────────────────────────────────────────────────
const PARAGON_BOARD_NAMES = {
  "warlock-starter-board": "Starting Board",
  "warlock-greater-hex": "Greater Hex",
  "warlock-demonic-spicules": "Demonic Spicules",
  "warlock-ritualism": "Ritualism",
  "warlock-dominion": "Dominion",
};

const GLYPH_NAMES = {
  "warlock-unbound": "Unbound",
  "warlock-abyssal": "Abyssal",
  "warlock-attrition": "Attrition",
  "warlock-destruction": "Destruction",
  "warlock-demonologist": "Demonologist",
};

const SKILL_SECTION_BASES = {
  "dread-claws": "Core",
  "nether-step": "Mobility",
  "dark-prison": "Defensive",
  "profane-sentinel": "Conjuration",
  "rampage-v2": "Ultimate",
  "metamorphosis": "Key Passive",
  "sigil-of-summons": "Summon",
};

function inferSection(slug) {
  const base = Object.keys(SKILL_SECTION_BASES).find(k => slug.startsWith(k));
  return base ? SKILL_SECTION_BASES[base] : "Passive";
}

function humanize(slug) {
  return (slug ?? "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function boardName(slug) {
  return PARAGON_BOARD_NAMES[slug] ?? humanize(slug);
}

function glyphName(slug) {
  return GLYPH_NAMES[slug] ?? humanize(slug);
}

// ─── Core parser ──────────────────────────────────────────────────────────────
function parseBuildJson(raw, activeVariantId = null) {
  const _rawStr = JSON.stringify(raw);
  // Accepts the full Apollo JSON (data.game.documents...) regardless of nesting
  const game = raw?.data?.game ?? raw?.game;
  if (!game) throw new Error("Clé 'game' introuvable. Vérifie que le bookmarklet a bien capturé les données Apollo.");

  const docData = game?.documents?.userGeneratedDocumentBySlug?.data;
  if (!docData) throw new Error("Clé userGeneratedDocumentBySlug introuvable.");

  const variants = docData?.data?.buildVariants?.values ?? [];
  if (!variants.length) throw new Error("Aucune variante de build trouvée.");

  // Select variant: prefer activeVariantId (from URL param), otherwise first
  let variant = variants[0];
  if (activeVariantId) {
    const found = variants.find(v => String(v.id) === String(activeVariantId));
    if (found) variant = found;
  }

  // Build skill metadata from the assigned skills bar (has icon, name, maxRank, section)
  const skillMeta = {};
  for (const s of (variant.assignedSkills?.skills ?? [])) {
    const sk = s?.skill;
    if (!sk?.slug) continue;
    skillMeta[sk.slug] = {
      name: sk.name ?? humanize(sk.slug),
      icon: sk.iconUrl ?? "",
      section: sk.section?.name ?? inferSection(sk.slug),
      maxRank: sk.maxRank ?? 1,
    };
  }

  // Build ordered skill path from priorityList (= the real level-by-level order Mobalytics defines)
  const priorityList = variant.skillTree?.priorityList ?? variant.skillTree?.skills ?? [];
  const rankCounter = {};
  const skillPath = [];

  for (let i = 0; i < priorityList.length; i++) {
    const entry = priorityList[i];
    const slug = entry?.slug ?? entry?.skill?.slug;
    if (!slug) continue;

    rankCounter[slug] = (rankCounter[slug] ?? 0) + 1;
    const rank = rankCounter[slug];
    const meta = skillMeta[slug] ?? {};
    const maxRank = meta.maxRank ?? 1;
    const section = meta.section ?? inferSection(slug);

    skillPath.push({
      skillPoint: i + 1,
      slug,
      name: meta.name ?? humanize(slug),
      rank,
      maxRank,
      icon: meta.icon ?? "",
      section,
      isNew: rank === 1,
      isUpgrade: rank > 1,
      isMaxed: rank === maxRank,
    });
  }

  // Paragon boards (ordered by their position in the array = unlock order)
  const boards = (variant.paragon?.boards ?? []).map((b, i) => {
    const bSlug = b?.board?.slug ?? "";
    const gSlug = b?.glyph?.slug ?? null;
    return {
      order: i + 1,
      slug: bSlug,
      name: boardName(bSlug),
      glyph: gSlug,
      glyphName: gSlug ? glyphName(gSlug) : null,
      glyphLevel: b?.glyphLevel ?? 0,
      position: { x: b?.x ?? 0, y: b?.y ?? 0 },
    };
  });

  // Glyph priority (the order to level them in)
  const paragonPriority = (variant.paragon?.priorityList ?? []).map((p, i) => ({
    order: i + 1,
    slug: p?.slug,
    name: glyphName(p?.slug ?? ""),
    board: boards.find(b => b.glyph === p?.slug)?.name ?? "?",
  }));

  // Equipment priority list
  const equipment = (variant.equipmentPriorityList ?? []).map((item, i) => ({
    order: i + 1,
    slug: item?.slug,
    name: humanize(item?.slug ?? ""),
    type: item?.type,
    icon: item?.iconURL ?? "",
    modifiers: (item?.modifiers ?? []).map(m => ({
      slug: m?.slug,
      name: humanize(m?.slug ?? ""),
      type: m?.type,
    })),
  }));

  // ── Talismans (from genericBuilder slots) ────────────────────────────────
  const gbSlots = (variant.genericBuilder?.slots ?? []);
  
  const talismans = (variant.talismansPriorityList ?? []).map((t, i) => {
    const slot = gbSlots.find(s => s.gameEntity?.slug === t.slug);
    const ge = slot?.gameEntity ?? {};
    return {
      order: i + 1,
      slug: t.slug,
      name: ge.title ?? humanize(t.slug),
      type: t.type,
      icon: ge.iconUrl ?? t.iconURL ?? "",
      color: ge.color ?? "",
      category: t.type?.includes("seal") ? "Sceau" : "Charme",
    };
  });

  // ── Equipment from genericBuilder (has real names + aspects) ─────────────
  const SLOT_LABELS = {
    "helm":"Casque","chest-armor":"Plastron","gloves":"Gants","pants":"Pantalon",
    "boots":"Bottes","amulet":"Amulette","ring-1":"Bague 1","ring-2":"Bague 2",
    "weapon":"Arme","offhand":"Main gauche",
  };
  const equipFull = gbSlots
    .filter(s => SLOT_LABELS[s.gameSlotSlug])
    .map((s, i) => {
      const ge = s.gameEntity ?? {};
      const mods = ge.modifiers ?? {};
      const gearStats = (mods.gearStats ?? []).filter(Boolean).map(m => ({
        id: m.id,
        name: humanize(m.id ?? ""),
        isGreater: m.isGreater ?? false,
        isMasterwork: m.isMasterwork ?? false,
      }));
      return {
        order: i + 1,
        slot: s.gameSlotSlug,
        slotLabel: SLOT_LABELS[s.gameSlotSlug] ?? s.gameSlotSlug,
        slug: ge.slug ?? "",
        name: ge.title ?? humanize(ge.slug ?? ""),
        type: ge.type ?? "",
        icon: ge.iconUrl ?? "",
        color: ge.color ?? "",
        isAspect: ge.type === "aspects",
        isUnique: ge.type === "uniqueItems",
        gearStats,
      };
    });

  // ── Mercenary ─────────────────────────────────────────────────────────────
  const MERC_NAMES = {
    "varyana-the-berserker-crone": "Varyana la Crone Berserk",
    "aldkin-the-cursed-child": "Aldkin l'Enfant Maudit",
    "raheir-the-shield-serf": "Raheir le Serf-Bouclier",
    "subo-the-disgraced-archer": "Subo l'Archer Disgracié",
  };
  const merc = variant.mercenary ?? {};
  const mercenary = {
    primary: {
      slug: merc.primaryMercenary?.slug ?? "",
      name: MERC_NAMES[merc.primaryMercenary?.slug] ?? humanize(merc.primaryMercenary?.slug ?? ""),
    },
    reinforcement: {
      slug: merc.reinforcementMercenary?.slug ?? "",
      name: MERC_NAMES[merc.reinforcementMercenary?.slug] ?? humanize(merc.reinforcementMercenary?.slug ?? ""),
    },
    skill: merc.skill?.slug ? humanize(merc.skill.slug) : null,
    opportunity: merc.opportunity?.opportunity?.slug ? humanize(merc.opportunity.opportunity.slug) : null,
    skillTree: (merc.skillTree ?? []).map(s => ({
      action: s.actionType,
      slug: s.skill?.slug ?? "",
      name: humanize(s.skill?.slug ?? ""),
    })),
  };

  const title = (docData?.data?.name ?? docData?.seo?.title ?? "Build Mobalytics")
    .replace(/\s*[-–]\s*(Mobalytics|Diablo 4).*$/i, "").trim();

  // Extract maxLevel from skillTree widget in content
  const maxLevelMatch = _rawStr.match(/"maxLevel":\s*(\d+)/);
  const maxLevel = maxLevelMatch ? parseInt(maxLevelMatch[1]) : 70;
  const paragonUnlockLevel = maxLevel - 1; // paragon unlocks 1 level before cap

  return {
    buildName: title,
    author: docData?.author?.name ?? "Mobalytics",
    slug: docData?.slugifiedName ?? "",
    activeVariantId: String(variant.id),
    variantCount: variants.length,
    variantIds: variants.map(v => String(v.id)),
    maxLevel,
    paragonUnlockLevel,
    skillPath,
    totalSkillPoints: skillPath.length,
    boards,
    paragonPriority,
    totalParagonNodes: (variant.paragon?.nodes ?? []).length,
    equipment,
    equipFull,
    talismans,
    mercenary,
    importedAt: new Date().toISOString(),
    sourceUrl: null, // will be set by caller
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Bookmarklet posts here: { data: <apollo json>, activeVariantId: "6", sourceUrl: "https://..." }
app.post("/api/push-build", (req, res) => {
  try {
    const { data, activeVariantId, sourceUrl } = req.body ?? {};
    if (!data) return res.status(400).json({ error: "Payload vide — clé 'data' manquante." });

    const build = parseBuildJson(data, activeVariantId);
    build.sourceUrl = sourceUrl ?? null;

    writeFileSync(CURRENT_BUILD_PATH, JSON.stringify(build, null, 2), "utf-8");
    console.log(`[D4] ✓ Build importé : "${build.buildName}" (variant ${build.activeVariantId}, ${build.totalSkillPoints} pts)`);

    res.json({ ok: true, buildName: build.buildName, skillPoints: build.totalSkillPoints, boards: build.boards.length });
  } catch (e) {
    console.error("[D4] ✗ Erreur import :", e.message);
    res.status(500).json({ error: e.message });
  }
});

// App fetches the current build
app.get("/api/build", (req, res) => {
  if (!existsSync(CURRENT_BUILD_PATH)) {
    return res.status(404).json({ error: "no_build" });
  }
  try {
    const raw = readFileSync(CURRENT_BUILD_PATH, "utf-8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw);
    // If already a parsed build (has skillPath), serve directly
    if (parsed.skillPath) return res.json(parsed);
    // Otherwise raw Mobalytics JSON — parse on the fly
    const build = parseBuildJson(parsed, req.query.variantId ?? null);
    res.json(build);
  } catch (e) {
    console.error("[D4] Erreur lecture build:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Heartbeat so the bookmarklet can confirm the server is running
app.get("/api/status", (_req, res) => {
  res.json({ ok: true, hasBuild: existsSync(CURRENT_BUILD_PATH), port: PORT });
});

// ─── Vite dev server ──────────────────────────────────────────────────────────
const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
app.use(vite.middlewares);

app.listen(PORT, () => {
  console.log(`\nD4 Companion → http://localhost:${PORT}`);
  console.log(`Bookmarklet : colle le code bookmarklet.js dans un favori de ton navigateur.\n`);
});
