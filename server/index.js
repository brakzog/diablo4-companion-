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
  "warlock-starting-board": "Starting Board",
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

function canonicalBoardSlug(slug) {
  if (slug === "warlock-starting-board") return "warlock-starter-board";
  return slug;
}

function parseParagonNodeSlug(slug) {
  const m = String(slug ?? "").match(/^warlock-(.+)-x(-?\d+)-y(-?\d+)$/);
  if (!m) {
    return {
      slug,
      boardSlug: "unknown",
      boardName: "Board inconnu",
      x: null,
      y: null,
    };
  }

  const rawBoard = m[1];
  const boardSlug = canonicalBoardSlug(`warlock-${rawBoard}`);

  return {
    slug,
    boardSlug,
    boardName: boardName(boardSlug),
    x: Number(m[2]),
    y: Number(m[3]),
  };
}

function inferParagonNodeKind(node, index, boards, priorityList) {
  if (index === 0) return "start";

  const sameBoard = boards.find(b => b.slug === node.boardSlug);
  if (sameBoard?.glyph && index > 5) return "path";

  const prioritySlugs = new Set(priorityList.map(p => p?.slug).filter(Boolean));
  if (prioritySlugs.size && sameBoard?.glyph && prioritySlugs.has(sameBoard.glyph)) {
    return "glyph-route";
  }

  return "path";
}

function buildParagonNodePath(variant, boards) {
  const rawNodes = variant.paragon?.nodes ?? [];
  const priorityList = variant.paragon?.priorityList ?? [];

  return rawNodes
    .map((n, i) => {
      const parsed = parseParagonNodeSlug(n?.slug ?? "");
      const board = boards.find(b => b.slug === parsed.boardSlug);

      return {
        order: i + 1,
        point: i + 1,
        slug: parsed.slug,
        x: parsed.x,
        y: parsed.y,
        boardSlug: parsed.boardSlug,
        boardName: parsed.boardName,
        boardOrder: board?.order ?? null,
        glyph: board?.glyph ?? null,
        glyphName: board?.glyphName ?? null,
        kind: inferParagonNodeKind(parsed, i, boards, priorityList),
      };
    });
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
      rotation: b?.rotation ?? 0,
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

  // Full ordered paragon node path from Mobalytics JSON.
  // IMPORTANT: nodes are already ordered in the exported variant; the UI can map
  // paragonLevel N => next node path[N].
  const paragonPath = buildParagonNodePath(variant, boards);

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
    paragonPath,
    totalParagonNodes: paragonPath.length,
    equipment,
    equipFull,
    talismans,
    mercenary,
    importedAt: new Date().toISOString(),
    sourceUrl: null, // will be set by caller
  };
}



// ─── Talion parser ────────────────────────────────────────────────────────────
function stripHtml(html = "") {
  return String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractFirstBase64Image(html = "") {
  const m = String(html).match(/<img[^>]+src=["'](data:image\/[a-zA-Z0-9+.-]+;base64,[^"']+)["']/i);
  return m ? m[1] : "";
}

function extractTalionLootFilter(html = "") {
  const text = stripHtml(html);
  const m = text.match(/(CrYB[A-Za-z0-9+/=\n\r]+)/);
  return m ? m[1].replace(/\s+/g, "") : "";
}

function normalizeTalionBuild(raw) {
  if (!raw?.slug || !Array.isArray(raw?.tabs)) {
    throw new Error("JSON Talion invalide : clés 'slug' ou 'tabs' introuvables.");
  }

  const tabs = [...raw.tabs].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
  const tabByTitle = (name) => tabs.find(t => String(t.title ?? "").toLowerCase().includes(name));
  const paragonText = stripHtml(tabByTitle("parangon")?.content ?? "");
  const glyphLine = paragonText.match(/Glyphes à monter\s*:?\s*([^\n]+)/i)?.[1] ?? "";
  const glyphs = glyphLine
    .split(/\s*-\s*/)
    .map(x => x.trim())
    .filter(Boolean)
    .map((name, i) => ({ order: i + 1, slug: name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-"), name, board: "Talion" }));

  const guideTabs = tabs.map(t => ({
    title: t.title,
    ordre: t.ordre,
    html: t.content,
    text: stripHtml(t.content),
    firstImage: extractFirstBase64Image(t.content),
  }));

  return {
    provider: "talion",
    buildName: raw.title ?? raw.slug,
    author: raw.author?.username ?? "Talion",
    slug: raw.slug,
    activeVariantId: String(raw.id),
    variantCount: 1,
    variantIds: [String(raw.id)],
    maxLevel: 70,
    paragonUnlockLevel: 70,

    // Talion currently exposes the actionable build mostly as HTML + embedded images.
    // We keep the classic fields empty so the existing UI stays stable, then expose guideTabs.
    skillPath: [],
    totalSkillPoints: 0,
    boards: glyphs.map(g => ({ order: g.order, slug: `talion-board-${g.order}`, name: `Plateau ${g.order}`, glyph: g.slug, glyphName: g.name })),
    paragonPriority: glyphs,
    paragonPath: [],
    totalParagonNodes: 0,
    equipment: [],
    equipFull: [],
    talismans: [],
    mercenary: null,

    talion: {
      id: raw.id,
      tags: raw.tags ?? [],
      className: raw.class?.name ?? raw.class?.slug ?? "",
      classSlug: raw.class?.slug ?? "",
      videoUrl: raw.video_url ?? "",
      introHtml: raw.content ?? "",
      introText: stripHtml(raw.content ?? ""),
      guideTabs,
      lootFilter: extractTalionLootFilter(tabByTitle("filtre")?.content ?? ""),
      note: "Import Talion en mode guide : données disponibles en HTML/images. Le next-skill automatique nécessite un mapping visuel ou une source structurée supplémentaire.",
    },

    importedAt: new Date().toISOString(),
    sourceUrl: null,
  };
}

async function fetchTalionBuildFromUrl(sourceUrl) {
  const url = new URL(sourceUrl);
  const slug = url.pathname.split("/").filter(Boolean).pop();
  if (!slug) throw new Error("Slug Talion introuvable dans l'URL.");

  // If the URL itself already contains a numeric id, use it directly.
  if (/^\d+$/.test(slug)) {
    const detail = await fetch(`https://api.talion.tv/api/builds/${slug}/front`);
    if (!detail.ok) throw new Error(`Talion detail HTTP ${detail.status}`);
    return detail.json();
  }

  const list = await fetch("https://api.talion.tv/api/builds/front");
  if (!list.ok) throw new Error(`Talion list HTTP ${list.status}`);
  const builds = await list.json();
  const found = Array.isArray(builds) ? builds.find(b => b.slug === slug) : null;
  if (!found?.id) throw new Error(`Build Talion '${slug}' introuvable dans la liste.`);

  const detail = await fetch(`https://api.talion.tv/api/builds/${found.id}/front`);
  if (!detail.ok) throw new Error(`Talion detail HTTP ${detail.status}`);
  return detail.json();
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



// Import Talion from a pasted JSON: { data: <talion json>, sourceUrl?: "https://..." }
app.post("/api/push-talion", (req, res) => {
  try {
    const { data, sourceUrl } = req.body ?? {};
    if (!data) return res.status(400).json({ error: "Payload vide — clé 'data' manquante." });

    const build = normalizeTalionBuild(data);
    build.sourceUrl = sourceUrl ?? null;

    writeFileSync(CURRENT_BUILD_PATH, JSON.stringify(build, null, 2), "utf-8");
    console.log(`[D4] ✓ Build Talion importé : "${build.buildName}" (${build.talion?.guideTabs?.length ?? 0} onglets)`);

    res.json({ ok: true, buildName: build.buildName, provider: "talion", tabs: build.talion?.guideTabs?.length ?? 0 });
  } catch (e) {
    console.error("[D4] ✗ Erreur import Talion :", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Import Talion directly from the public URL: /api/import-talion?url=https://www.talion.tv/...
app.get("/api/import-talion", async (req, res) => {
  try {
    const sourceUrl = String(req.query.url ?? "");
    if (!sourceUrl) return res.status(400).json({ error: "Paramètre url manquant." });

    const raw = await fetchTalionBuildFromUrl(sourceUrl);
    const build = normalizeTalionBuild(raw);
    build.sourceUrl = sourceUrl;

    writeFileSync(CURRENT_BUILD_PATH, JSON.stringify(build, null, 2), "utf-8");
    console.log(`[D4] ✓ Build Talion importé depuis URL : "${build.buildName}"`);

    res.json({ ok: true, buildName: build.buildName, provider: "talion", tabs: build.talion?.guideTabs?.length ?? 0 });
  } catch (e) {
    console.error("[D4] ✗ Erreur import Talion URL :", e.message);
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
