import React, { useEffect, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const LS_KEY = "d4-companion-v13";

// ── D4 skill point gain rules ─────────────────────────────────────────────────
// Lvl 1→70 = 1 SP/level = 69 SP + ~14 from Renown = ~83 SP total at 70
// We approximate: SP ≈ level - 1 (up to ~70) + renown bonus
function levelToSP(level, maxLevel = 70) {
  if (level <= 1) return 0;
  const base = Math.min(level - 1, maxLevel - 1);
  // Renown bonus: ~10 SP total
  const renown = level >= maxLevel ? 10 : Math.floor((level / maxLevel) * 10);
  return base + renown;
}

// Paragon boards unlock order roughly every 100-150 paragon points
function paragonLevelToBoard(pl) {
  if (pl < 1) return 0;
  if (pl < 25) return 0;
  if (pl < 60) return 1;
  if (pl < 100) return 2;
  if (pl < 150) return 3;
  return 4;
}

const SECTION_COLOR = {
  "Core":        "#e85d3a",
  "Mobility":    "#4db8ff",
  "Defensive":   "#5dd48f",
  "Conjuration": "#c084fc",
  "Ultimate":    "#ff4466",
  "Key Passive": "#fbbf24",
  "Summon":      "#fb923c",
  "Passive":     "#94a3b8",
};
const SECTION_ICON = {
  "Core":"⚔️","Mobility":"💨","Defensive":"🛡️",
  "Conjuration":"🔮","Ultimate":"💀","Key Passive":"🔑",
  "Summon":"👹","Passive":"✨",
};


const DIFFICULTIES = ["Normal", "Difficile", "Expert", "Pénitence", "Tourment 1", "Tourment 2", "Tourment 3", "Tourment 4"];
const GEAR_SLOTS = [
  { id: "helm", label: "Casque" },
  { id: "chest", label: "Torse" },
  { id: "gloves", label: "Gants" },
  { id: "pants", label: "Jambes" },
  { id: "boots", label: "Bottes" },
  { id: "weapon", label: "Arme" },
  { id: "amulet", label: "Amulette" },
  { id: "ring1", label: "Anneau 1" },
  { id: "ring2", label: "Anneau 2" },
];
const GLYPH_FIELDS = [
  { id: "primary", label: "Glyphe 1" },
  { id: "secondary", label: "Glyphe 2" },
  { id: "third", label: "Glyphe 3" },
  { id: "fourth", label: "Glyphe 4" },
];
const RESISTANCE_FIELDS = [
  { id: "fire", label: "Feu" },
  { id: "cold", label: "Froid" },
  { id: "lightning", label: "Foudre" },
  { id: "poison", label: "Poison" },
  { id: "shadow", label: "Ombre" },
];

const ADVENTURE_STEPS = [
  { id: "lilith", label: "Lilith terminée", hint: "Campagne principale validée" },
  { id: "exp1", label: "Extension 1 terminée", hint: "Contenu d’extension débloqué" },
  { id: "exp2", label: "Extension 2 terminée", hint: "Suite extension / contenu débloqué" },
  { id: "season", label: "Saisonnier débloqué", hint: "Mécaniques saisonnières accessibles" },
  { id: "t1", label: "Tourment 1 débloqué", hint: "Premier vrai palier endgame" },
  { id: "glyph15", label: "1 glyphe niveau 15", hint: "Premier gros spike glyphe" },
];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function avgItemPower(itemPower = {}) {
  const values = Object.values(itemPower).map(Number).filter(v => Number.isFinite(v) && v > 0);
  if (!values.length) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function avgGlyphLevel(glyphLevels = {}) {
  const values = Object.values(glyphLevels).map(Number).filter(v => Number.isFinite(v) && v > 0);
  if (!values.length) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}


function glyphProgress(glyphLevels = {}) {
  const entries = GLYPH_FIELDS.map((field, index) => {
    const raw = Number(glyphLevels[field.id] ?? 0);
    const level = Number.isFinite(raw) ? clamp(raw, 0, 100) : 0;
    const to15 = Math.max(0, 15 - level);
    const to46 = Math.max(0, 46 - level);
    return { ...field, index: index + 1, level, to15, to46 };
  });

  const active = entries.filter(g => g.level > 0);
  const lowestActive = active.length
    ? [...active].sort((a, b) => a.level - b.level)[0]
    : entries[0];
  const firstBelow15 = entries.find(g => g.level > 0 && g.level < 15) ?? entries.find(g => g.level === 0) ?? entries[0];
  const ready15 = entries.filter(g => g.level >= 15).length;
  const ready46 = entries.filter(g => g.level >= 46).length;
  const totalToNext15 = entries.reduce((sum, g) => sum + (g.level > 0 && g.level < 15 ? g.to15 : 0), 0);
  const priority = firstBelow15 ?? lowestActive;

  let title = "Monte ton premier glyphe";
  let detail = "Fais des Donjons du Cauchemar / activités qui donnent de l’XP de glyphe, puis mets toute l’XP dans le glyphe prioritaire.";
  let tone = "wait";

  if (ready15 === 0 && priority?.level > 0) {
    title = `${priority.label} → niveau 15`;
    detail = `${priority.to15} niveau${priority.to15 > 1 ? "x" : ""} à gagner pour atteindre le premier vrai palier.`;
  } else if (ready15 === 0) {
    title = "Choisis ton glyphe principal";
    detail = "Renseigne le glyphe que tu utilises dans ton premier plateau, puis vise niveau 15.";
  } else if (ready15 < 4) {
    const next = entries.find(g => g.level < 15) ?? priority;
    title = `${next.label} → niveau 15`;
    detail = `${ready15}/4 glyphes au palier 15. Continue les NMD pour sécuriser les autres.`;
    tone = "steady";
  } else if (ready46 === 0) {
    title = "Tous les glyphes sont 15+";
    detail = "Très bon cap. Le prochain gros objectif long terme : pousser ton glyphe principal vers 46.";
    tone = "push";
  } else {
    title = "Glyphes solides";
    detail = `${ready46} glyphe${ready46 > 1 ? "s" : ""} au palier 46. Tu peux surtout optimiser les rolls/stuff et pousser la Fosse.`;
    tone = "push";
  }

  return { entries, active, priority, ready15, ready46, totalToNext15, title, detail, tone };
}



function glyphActionPlan(glyphPlan, resStats = {}, state = {}) {
  const priority = glyphPlan?.priority;
  const level = priority?.level ?? 0;
  const ready15 = glyphPlan?.ready15 ?? 0;
  const weakest = resStats?.weakest;
  const weakestLabel = weakest ? (RESISTANCE_FIELDS.find(r => r.id === weakest.id)?.label ?? weakest.id) : null;

  let title = "Plan de session : XP glyphe";
  let subtitle = "Activité conseillée : Donjons du Cauchemar";
  let tone = "wait";
  const steps = [];

  if (!priority || ready15 >= 4) {
    return {
      tone: "push",
      title: "Glyphes 15+ sécurisés",
      subtitle: "Tu peux passer en optimisation : Fosse, parangon, glyphes vers 46.",
      steps: [
        "Continue les Donjons du Cauchemar si tu veux pousser un glyphe vers 46.",
        "Sinon, fais un test Fosse court pour mesurer si le palier supérieur est confortable.",
      ],
      warning: weakestLabel && weakest.score < 50 ? `Attention : ${weakestLabel} reste ta résistance faible.` : "",
      cta: "Tester une Fosse courte",
    };
  }

  if (level <= 0) {
    title = "Choisis ton glyphe principal";
    subtitle = "Regarde le plateau Talion actif, équipe le glyphe conseillé, puis renseigne son niveau ici.";
    steps.push("Ouvre le panneau Parangon dans D4 et vérifie le glyphe socketé sur le premier plateau.");
    steps.push("Renseigne son niveau dans Glyphe 1, puis lance des Donjons du Cauchemar.");
    steps.push("À la fin du donjon, mets toute l’XP sur ce glyphe jusqu’au niveau 15.");
  } else if (level < 15) {
    title = `${priority.label} → niveau 15`;
    subtitle = `Activité conseillée : Donjons du Cauchemar jusqu’à +${priority.to15} niveau${priority.to15 > 1 ? "x" : ""}.`;
    steps.push("Lance des Donjons du Cauchemar au niveau où tu clear sans mourir en boucle.");
    steps.push("À chaque fin de donjon, clique l’autel/la bulle de fin et mets 100% de l’XP sur ce glyphe.");
    steps.push("Stop objectif quand ce glyphe atteint 15, puis reteste une Fosse courte.");
    tone = level >= 10 ? "steady" : "wait";
  } else if (ready15 < 4) {
    const next = glyphPlan.entries.find(g => g.level < 15);
    title = `${next?.label ?? "Glyphe suivant"} → niveau 15`;
    subtitle = `${ready15}/4 glyphes au palier 15. Continue les NMD pour stabiliser le build.`;
    steps.push("Continue les Donjons du Cauchemar, mais passe l’XP sur le glyphe suivant sous 15.");
    steps.push("Garde le même rythme : 1 glyphe complet à la fois, pas tout éparpiller.");
    steps.push("Quand 2 glyphes sont 15+, le test de difficulté devient plus crédible.");
    tone = "steady";
  }

  const warnings = [];
  if (weakestLabel && weakest.score < 50) warnings.push(`${weakestLabel} est faible (${weakest.score}/70) : évite de push trop haut avant de corriger.`);
  if ((state?.paragonLevel ?? 0) < 25) warnings.push("Parangon encore bas : chaque point aide, donc les NMD sont rentables même si le loot est moyen.");

  return {
    tone,
    title,
    subtitle,
    steps,
    warning: warnings.join(" "),
    cta: "Faire des Donjons du Cauchemar",
  };
}

function resistanceRawToScore(value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return 0;

  // Mode manuel compatible : si tu saisis encore un pourcentage 0–85,
  // on l'utilise tel quel. Si tu saisis la valeur brute affichée dans Diablo
  // 4, on la convertit en score de confort 0–70. Ce n'est pas le calcul exact
  // Blizzard, mais une lecture pratique pour savoir si une résistance est faible.
  if (v <= 85) return clamp(v, 0, 70);
  if (v >= 1250) return 70;
  if (v >= 1000) return Math.round(60 + ((v - 1000) / 250) * 10);
  if (v >= 700) return Math.round(42 + ((v - 700) / 300) * 18);
  if (v >= 400) return Math.round(22 + ((v - 400) / 300) * 20);
  return Math.round((v / 400) * 22);
}

function resistanceLevel(score) {
  if (score >= 62) return "safe";
  if (score >= 48) return "ok";
  if (score >= 32) return "low";
  return "danger";
}

function resistanceStats(resistances = {}) {
  const entries = Object.entries(resistances)
    .map(([id, raw]) => ({ id, raw: Number(raw), score: resistanceRawToScore(raw) }))
    .filter(e => Number.isFinite(e.raw) && e.raw > 0);

  if (!entries.length) {
    return { average: 0, lowest: 0, filled: 0, mode: "raw", weakest: null, entries: [] };
  }

  const rawMode = entries.some(e => e.raw > 100);
  const scores = entries.map(e => e.score);
  const weakest = entries.reduce((a, b) => (b.score < a.score ? b : a), entries[0]);

  return {
    average: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    lowest: Math.min(...scores),
    filled: entries.length,
    mode: rawMode ? "raw" : "percent",
    weakest,
    entries: entries.map(e => ({ ...e, level: resistanceLevel(e.score) })),
  };
}

function difficultyRank(name) {
  return Math.max(0, DIFFICULTIES.indexOf(name));
}

function changeDifficulty(current, delta) {
  const i = difficultyRank(current);
  return DIFFICULTIES[clamp(i + delta, 0, DIFFICULTIES.length - 1)];
}

function readinessScore({
  level,
  paragonLevel,
  avgPower,
  difficulty,
  doneGlyphs,
  boardsCount,
  gearCheckedCount,
  gearCount,
  pitDeaths,
  pitResult,
  avgGlyph,
  resistAverage,
  resistLowest,
  resistFilled,
}) {
  const levelScore = Math.min(15, Math.round((level / 70) * 15));
  const paragonScore = Math.min(18, Math.round((paragonLevel / 140) * 18));
  const gearScore = avgPower ? Math.min(24, Math.round(((avgPower - 600) / 325) * 24)) : 5;

  const manualGlyphScore = avgGlyph
    ? Math.min(18, Math.round((avgGlyph / 46) * 18))
    : 0;
  const checkedGlyphScore = boardsCount
    ? Math.min(12, Math.round((doneGlyphs / boardsCount) * 12))
    : 0;
  const glyphScore = Math.max(manualGlyphScore, checkedGlyphScore);

  const resistanceScore = resistFilled
    ? Math.min(15, Math.round((resistLowest / 70) * 12 + (resistAverage / 70) * 3))
    : 4;

  const checklistScore = gearCount ? Math.min(10, Math.round((gearCheckedCount / gearCount) * 10)) : 5;
  const deathPenalty = pitDeaths >= 6 ? 12 : pitDeaths >= 3 ? 7 : pitDeaths >= 1 ? 3 : 0;
  const resultBonus = pitResult === "success" ? 7 : pitResult === "failed" ? -8 : 0;
  return clamp(levelScore + paragonScore + gearScore + glyphScore + resistanceScore + checklistScore - deathPenalty + resultBonus, 0, 100);
}

function pushConfidence({ readiness, avgPower, paragonLevel, avgGlyph, resistLowest, pitDeaths, pitResult }) {
  let confidence = readiness;
  if (avgPower >= 830) confidence += 8;
  if (paragonLevel < 25) confidence -= 10;
  if (!avgGlyph) confidence -= 8;
  else if (avgGlyph >= 15) confidence += 8;
  if (!resistLowest) confidence -= 7;
  else if (resistLowest >= 60) confidence += 6;
  else if (resistLowest < 45) confidence -= 10;
  if (pitDeaths >= 4) confidence -= 10;
  if (pitResult === "success") confidence += 10;
  if (pitResult === "failed") confidence -= 12;
  return clamp(Math.round(confidence), 0, 100);
}

function progressionAdvice({
  difficulty,
  readiness,
  avgPower,
  paragonLevel,
  doneGlyphs,
  boardsCount,
  pitDeaths,
  pitResult,
  pitLevel,
  avgGlyph,
  resistAverage,
  resistLowest,
  resistFilled,
}) {
  const rank = difficultyRank(difficulty);
  const nextDifficulty = DIFFICULTIES[clamp(rank + 1, 0, DIFFICULTIES.length - 1)];
  const glyphRatio = boardsCount ? doneGlyphs / boardsCount : 0;
  const confidence = pushConfidence({ readiness, avgPower, paragonLevel, avgGlyph, resistLowest, pitDeaths, pitResult });
  const missing = [];
  const strengths = [];

  if (avgPower >= 830) strengths.push("item power très correct");
  else if (avgPower >= 780) strengths.push("item power en bonne voie");

  if (paragonLevel >= 40) strengths.push("parangon qui commence à peser");
  if (avgGlyph >= 15) strengths.push("glyphes au premier gros palier");
  if (resistLowest >= 60) strengths.push("résistances rassurantes");
  if (pitResult === "success" && pitDeaths <= 2) strengths.push("test Fosse validé");

  if (!avgPower) missing.push("renseigne l'item power de ton stuff");
  else if (avgPower < 725) missing.push("améliore ton item power moyen");

  if (paragonLevel < 25) missing.push("gagne quelques points parangon");
  if (!avgGlyph && glyphRatio < 0.25) missing.push("renseigne ou monte tes glyphes");
  else if (avgGlyph > 0 && avgGlyph < 15) missing.push("vise au moins un glyphe niveau 15");
  if (!resistFilled) missing.push("renseigne tes résistances");
  else if (resistLowest < 50) missing.push("remonte ta résistance la plus basse");
  if (pitDeaths >= 5) missing.push("réduis les morts sur tes essais de Fosse");

  let title = "Continue à consolider";
  let tone = "steady";
  let detail = "Farm tranquillement, renseigne les infos manquantes, puis fais un test court.";

  if (pitResult === "success" && pitDeaths <= 1) {
    title = `Push validé : tente plus haut que Fosse ${pitLevel}`;
    tone = "push";
    detail = "Tu as validé l'essai proprement. Tu peux monter progressivement.";
  } else if (pitResult === "failed" || pitDeaths >= 6) {
    title = "Trop tôt : consolide avant de retenter";
    tone = "wait";
    detail = `Trop de morts sur la Fosse ${pitLevel}. Priorité survie, glyphes et parangon.`;
  } else if (confidence >= 68 && rank < DIFFICULTIES.length - 1) {
    title = `Tente un test ${nextDifficulty}`;
    tone = "push";
    detail = "Pas besoin de s'engager longtemps : fais un essai court, compte les morts, puis l'app ajuste.";
  } else if (confidence >= 52) {
    title = `Test prudent possible, mais sans forcer`;
    tone = "steady";
    detail = "Ton stuff est encourageant, mais il manque encore des preuves côté glyphes/résistances/parangon.";
  } else {
    title = `Reste en ${difficulty} pour l'instant`;
    tone = "wait";
    detail = "Le build n'a pas encore assez de signaux verts pour monter confortablement.";
  }

  return {
    title,
    tone,
    detail,
    missing: missing.slice(0, 5),
    strengths: strengths.slice(0, 4),
    nextDifficulty,
    confidence,
  };
}


function adventureDone(state, id) {
  return !!(state.adventure ?? {})[id];
}

function buildAdventureRoadmap(state, glyphPlan, advice) {
  return ADVENTURE_STEPS.map(step => {
    if (step.id === "t1") {
      return { ...step, done: adventureDone(state, "t1") || (DIFFICULTIES.indexOf(state.difficulty || "Pénitence") >= DIFFICULTIES.indexOf("Tourment 1")) };
    }
    if (step.id === "glyph15") {
      return { ...step, done: adventureDone(state, "glyph15") || (glyphPlan?.ready15 ?? 0) > 0 };
    }
    return { ...step, done: adventureDone(state, step.id) };
  });
}

function nextBestAction({ state, advice, glyphPlan, resStats, avgPower }) {
  const adventure = state.adventure ?? {};
  const shortSession = (state.sessionMode ?? "short") === "short";
  const difficultyRank = DIFFICULTIES.indexOf(state.difficulty || "Pénitence");
  const t1Unlocked = adventure.t1 || difficultyRank >= DIFFICULTIES.indexOf("Tourment 1");
  const glyphReady = (glyphPlan?.ready15 ?? 0) > 0;
  const weakRes = resStats?.filled && resStats.lowest < 55;
  const weakName = RESISTANCE_FIELDS.find(r => r.id === resStats?.weakest?.id)?.label ?? "résistance faible";

  let action = {
    icon: "🧭",
    title: "Joue une session propre",
    subtitle: "Continue la progression sans forcer le push.",
    why: "Le coach manque encore de signaux forts pour choisir une priorité unique.",
    steps: ["Ouvre le mode G9", "Suis le focus Talion", "Note les morts si tu testes une Fosse"],
    tone: "steady",
  };

  if (!adventure.lilith) {
    action = {
      icon: "👑",
      title: "Termine la campagne principale",
      subtitle: "Lilith non cochée dans la roadmap.",
      why: "Avant d’optimiser trop fort, sécurise le contenu principal et les déblocages associés.",
      steps: ["Avance la quête principale", "Coche Lilith terminée ensuite", "Reviens au coach pour choisir glyphes/fosse"],
      tone: "story",
    };
  } else if (!adventure.exp1 || !adventure.exp2) {
    action = {
      icon: "📜",
      title: shortSession ? "Session courte : Donjon du Cauchemar" : "Continue une campagne d’extension",
      subtitle: shortSession ? "Tu gardes le fil endgame sans lancer un long chapitre." : "Ton build semble assez solide pour avancer l’histoire confortablement.",
      why: "Tu as tué Lilith, mais les extensions ne sont pas encore cochées. Les finir évite de rester bloqué sur du contenu non débloqué.",
      steps: shortSession
        ? ["Lance 1 Donjon du Cauchemar", "Mets toute l’XP sur le glyphe prioritaire", "Reprends l’extension sur une session plus longue"]
        : ["Continue l’extension non cochée", "Garde G9 sur Talion/Parangon", "Si ça pique, repasse sur NMD/glyphes"],
      tone: "story",
    };
  } else if (!glyphReady) {
    action = {
      icon: "🔷",
      title: "Monter le glyphe prioritaire → 15",
      subtitle: "Activité conseillée : Donjons du Cauchemar.",
      why: "Tes glyphes sont le plus gros multiplicateur manquant. C’est souvent plus rentable que forcer une difficulté supérieure.",
      steps: ["Lance des Donjons du Cauchemar", "À l’autel de fin, mets toute l’XP sur Glyphe 1", "Stoppe quand au moins 1 glyphe est niveau 15"],
      tone: "glyph",
    };
  } else if (weakRes) {
    action = {
      icon: "🛡️",
      title: `Corrige ${weakName} avant gros push`,
      subtitle: `Score actuel le plus bas : ${resStats.lowest}/70`,
      why: "Un seul trou de résistance peut rendre une Fosse ou un palier Tourment beaucoup plus violent que prévu.",
      steps: ["Compare les drops qui donnent cette résistance", "Utilise gemmes/affixes si possible", "Retente quand la faiblesse remonte vers 60+"],
      tone: "defense",
    };
  } else if (!t1Unlocked && (advice?.confidence ?? 0) >= 52) {
    action = {
      icon: "🕳️",
      title: "Tente une petite Fosse test pour débloquer T1",
      subtitle: "Objectif : mesurer le confort, pas prouver un truc.",
      why: "Ton profil devient suffisamment propre pour un test prudent. Si ça se passe mal, le coach te renverra vers glyphes/survie.",
      steps: ["Lance une Fosse basse", "Compte les morts dans l’app", "Si ≤ 3 morts : coche résultat OK / sinon trop dur"],
      tone: "push",
    };
  } else if (t1Unlocked && (advice?.confidence ?? 0) >= 60) {
    action = {
      icon: "🔥",
      title: "Farm T1 / petites Fosses puis augmente doucement",
      subtitle: `Confiance push : ${advice?.confidence ?? 0}%`,
      why: "Tu as assez de signaux verts pour monter par paliers contrôlés.",
      steps: ["Fais 1–2 Fosses confort", "Si 0–2 morts, augmente légèrement", "Continue à monter les glyphes"],
      tone: "push",
    };
  }

  const roadmap = buildAdventureRoadmap(state, glyphPlan, advice);
  return { ...action, roadmap, shortSession };
}

function defaultState() {
  return {
    level: 1,
    paragonLevel: 0,
    skillChecked: {},
    glyphChecked: {},
    equipmentChecked: {},
    tab: "focus",
    hideDone: false,
    g9: false,
    ignoredSkills: {},
    talionFocusTitle: "",
    talionObjectiveChecked: {},
    difficulty: "Pénitence",
    itemPower: {},
    glyphLevels: {},
    resistances: {},
    pitLevel: 20,
    pitDeaths: 0,
    pitResult: "idle",
    pitHistory: [],
    adventure: { lilith: false, exp1: false, exp2: false, season: false, t1: false, glyph15: false },
    sessionMode: "short",
  };
}

function load() {
  try { return { ...defaultState(), ...JSON.parse(localStorage.getItem(LS_KEY) || "{}") }; }
  catch { return defaultState(); }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LevelSlider({ label, icon, value, max, onChange }) {
  return (
    <div className="slider-wrap">
      <div className="slider-label">
        <span>{icon} {label}</span>
        <strong className="slider-val">{value}</strong>
      </div>
      <div className="slider-row">
        <button onClick={() => onChange(Math.max(0, value - 1))}>−</button>
        <input type="range" min={0} max={max} value={value} onChange={e => onChange(+e.target.value)} />
        <button onClick={() => onChange(Math.min(max, value + 1))}>+</button>
      </div>
    </div>
  );
}

function SkillRow({ entry, done, isCurrent, onToggle }) {
  const color = SECTION_COLOR[entry.section] ?? "#94a3b8";
  return (
    <div className={`sk-row${done ? " done" : ""}${isCurrent ? " current" : ""}`} onClick={() => onToggle(!done)}>
      <div className="sk-sp" style={{ color }}>{entry.skillPoint}</div>
      <div className="sk-ico">
        {entry.icon
          ? <img src={entry.icon} alt="" onError={e => e.target.style.display = "none"} />
          : <span>{SECTION_ICON[entry.section] ?? "✨"}</span>}
      </div>
      <div className="sk-body">
        <div className="sk-top">
          <span className="sk-name">{entry.name}</span>
          <span className="sk-tags">
            {entry.isNew && !entry.isUpgrade && <span className="tag new">NEW</span>}
            {entry.isUpgrade && <span className="tag up">+{entry.rank}</span>}
            {entry.isMaxed && <span className="tag max">MAX</span>}
          </span>
        </div>
        <div className="sk-meta">
          <span style={{ color }}>{SECTION_ICON[entry.section]} {entry.section}</span>
          <span className="rank-pips">
            {Array.from({ length: entry.maxRank }).map((_, i) =>
              <span key={i} className={`pip${i < entry.rank ? " on" : ""}`} />
            )}
          </span>
        </div>
      </div>
      <div className="sk-check">{done ? "✓" : ""}</div>
    </div>
  );
}

function BoardCard({ board, done, isActive, onToggle }) {
  return (
    <div className={`board-card${isActive ? " active" : ""}${done ? " done" : ""}`}>
      <div className="board-num">{board.order}</div>
      <div className="board-body">
        <strong>{board.name}</strong>
        {board.glyphName && <div className="board-glyph">🔷 {board.glyphName}</div>}
      </div>
      {isActive && <span className="tag current">EN COURS</span>}
      {board.glyphName && (
        <label className="board-check" onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={done} onChange={e => onToggle(e.target.checked)} />
          <span>Glyphe lvl 21+</span>
        </label>
      )}
    </div>
  );
}

function ParagonNodeRow({ node, isCurrent, isDone }) {
  return (
    <div className={`paragon-node-row${isCurrent ? " current" : ""}${isDone ? " done" : ""}`}>
      <div className="pn-point">{node.point}</div>
      <div className="pn-body">
        <div className="pn-top">
          <strong>{node.boardName}</strong>
          {isCurrent && <span className="tag current">PROCHAIN</span>}
          {node.kind === "start" && <span className="tag new">START</span>}
          {node.kind === "glyph-route" && <span className="tag up">GLYPHE</span>}
        </div>
        <div className="pn-meta">
          <span>🧩 Board {node.boardOrder ?? "?"}</span>
          <span>📍 x{node.x}, y{node.y}</span>
          {node.glyphName && <span>🔷 {node.glyphName}</span>}
        </div>
      </div>
      <div className="pn-check">{isDone ? "✓" : ""}</div>
    </div>
  );
}

function directionBetween(a, b) {
  if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
    return "continuer la route";
  }

  const dx = b.x - a.x;

  // Mobalytics visual board uses an inverted Y axis compared to raw JSON coordinates.
  // Raw y decreases visually downward/upward depending on board rendering; for the current Moba view,
  // inverting the delta makes the GPS match the screen path better.
  const visualDy = -(b.y - a.y);

  const horizontal = dx > 0 ? "droite" : dx < 0 ? "gauche" : "";
  const vertical = visualDy > 0 ? "haut" : visualDy < 0 ? "bas" : "";

  if (horizontal && vertical) return `${vertical}-${horizontal}`;
  return horizontal || vertical || "rester sur la route";
}

function nodeImportance(node, allNodes) {
  if (!node) return { kind: "travel", label: "Déplacement", icon: "•", why: "Point de passage pour continuer la route." };

  const sameBoard = allNodes.filter(n => n.boardSlug === node.boardSlug);
  const remainingOnBoard = sameBoard.filter(n => n.point >= node.point);
  const nextBoardChange = allNodes.find(n => n.point > node.point && n.boardSlug !== node.boardSlug);

  if (node.glyphName && remainingOnBoard.length <= 10) {
    return {
      kind: "glyph",
      label: "Route glyphe",
      icon: "🔷",
      why: `Tu avances vers le socket/glyphe ${node.glyphName}. C’est souvent le premier vrai power spike du plateau.`,
    };
  }

  if (nextBoardChange && nextBoardChange.point - node.point <= 3) {
    return {
      kind: "gate",
      label: "Sortie plateau",
      icon: "🧩",
      why: `Tu approches du prochain plateau : ${nextBoardChange.boardName}.`,
    };
  }

  if (node.point % 10 === 0) {
    return {
      kind: "milestone",
      label: "Milestone",
      icon: "⭐",
      why: "Petit cap de progression dans le chemin parangon.",
    };
  }

  return {
    kind: "travel",
    label: "Déplacement",
    icon: "•",
    why: "Point de trajet. Pas forcément un gros bonus, mais nécessaire pour atteindre le prochain objectif.",
  };
}

function nextPowerSpike(path, paragonLevel, currentBoard) {
  const future = path.slice(paragonLevel, Math.min(path.length, paragonLevel + 25));
  const glyph = future.find(n => n.glyphName && n.boardSlug === currentBoard?.slug);
  if (glyph) {
    return {
      title: `Route du glyphe ${glyph.glyphName}`,
      inPoints: Math.max(0, glyph.point - paragonLevel),
      icon: "🔷",
      detail: "Le glyphe est souvent le prochain gros gain réel du plateau.",
    };
  }

  const boardChange = future.find(n => n.boardSlug !== currentBoard?.slug);
  if (boardChange) {
    return {
      title: `Nouveau plateau : ${boardChange.boardName}`,
      inPoints: Math.max(0, boardChange.point - paragonLevel),
      icon: "🧩",
      detail: "Nouveau plateau = nouvelle étape importante de progression.",
    };
  }

  const milestone = future.find(n => n.point % 10 === 0);
  if (milestone) {
    return {
      title: `Milestone parangon ${milestone.point}`,
      inPoints: Math.max(0, milestone.point - paragonLevel),
      icon: "⭐",
      detail: "Cap intermédiaire avant le prochain objectif majeur.",
    };
  }

  return null;
}

function boardProgress(path, boardSlug, paragonLevel) {
  const boardNodes = path.filter(n => n.boardSlug === boardSlug);
  if (!boardNodes.length) return { done: 0, total: 0 };
  return {
    done: boardNodes.filter(n => n.point <= paragonLevel).length,
    total: boardNodes.length,
  };
}

function compactRoadmap(path, paragonLevel, currentBoard) {
  const future = path.slice(paragonLevel, Math.min(path.length, paragonLevel + 18));
  const items = [];
  let travelCount = 0;

  for (const node of future) {
    const imp = nodeImportance(node, path);

    if (imp.kind === "travel") {
      travelCount += 1;
      continue;
    }

    if (travelCount > 0) {
      items.push({ icon: "➡️", label: `${travelCount} point${travelCount > 1 ? "s" : ""} de trajet`, detail: "sert surtout à avancer" });
      travelCount = 0;
    }

    items.push({ icon: imp.icon, label: imp.label, detail: node.boardName, point: node.point });
  }

  if (travelCount > 0) {
    items.push({ icon: "➡️", label: `${travelCount} point${travelCount > 1 ? "s" : ""} de trajet`, detail: "avant la suite" });
  }

  if (!items.length && currentBoard) {
    items.push({ icon: "🧩", label: currentBoard.name, detail: "Continue le chemin indiqué" });
  }

  return items.slice(0, 6);
}

function ParagonBoardMap({ paragonPath, paragonLevel, currentBoard, nextNode }) {
  const path = paragonPath ?? [];
  const currentIndex = Math.max(0, Math.min(paragonLevel, path.length - 1));
  const previous = path[Math.max(0, currentIndex - 1)];
  const nextSteps = path.slice(paragonLevel, Math.min(path.length, paragonLevel + 12));
  const boardNodes = currentBoard ? path.filter(n => n.boardSlug === currentBoard.slug) : [];
  const prog = currentBoard ? boardProgress(path, currentBoard.slug, paragonLevel) : { done: 0, total: 0 };
  const nextBoardChange = nextSteps.find(n => n.boardSlug !== currentBoard?.slug);
  const spike = nextPowerSpike(path, paragonLevel, currentBoard);
  const roadmap = compactRoadmap(path, paragonLevel, currentBoard);
  const nextImp = nodeImportance(nextNode, path);

  return (
    <div className="readable-paragon v16">
      <div className="rp-hero">
        <div>
          <span className="muted small">ROUTE PARANGON INTELLIGENTE</span>
          <h3>{currentBoard?.name ?? nextNode?.boardName ?? "Plateau inconnu"}</h3>
          <p>
            Vue GPS basée sur le chemin Mobalytics importé. Directions corrigées pour mieux suivre le rendu visuel.
          </p>
        </div>
        <div className="rp-progress">
          <strong>{prog.done}/{prog.total}</strong>
          <span>points sur ce plateau</span>
        </div>
      </div>

      {spike && (
        <div className="power-spike">
          <div className="spike-icon">{spike.icon}</div>
          <div>
            <span className="muted small">PROCHAIN GROS GAIN</span>
            <h3>{spike.title}</h3>
            <p>{spike.inPoints <= 0 ? "Maintenant" : `Dans ${spike.inPoints} point${spike.inPoints > 1 ? "s" : ""}`} · {spike.detail}</p>
          </div>
        </div>
      )}

      {nextNode ? (
        <div className={`rp-next ${nextImp.kind}`}>
          <div className="rp-next-number">{nextNode.point}</div>
          <div className="rp-next-body">
            <span className="muted small">PROCHAIN POINT À POSER</span>
            <h3>{nextNode.boardName}</h3>
            <p>
              Depuis le point précédent, va vers <strong>{directionBetween(previous, nextNode)}</strong>.
              Coordonnées Mobalytics : <strong>x{nextNode.x}, y{nextNode.y}</strong>.
            </p>
            <p>{nextImp.icon} <strong>{nextImp.label}</strong> — {nextImp.why}</p>
            {nextNode.glyphName && <p>🔷 Tu es sur la route du glyphe <strong>{nextNode.glyphName}</strong>.</p>}
          </div>
          <span className="tag current">NEXT</span>
        </div>
      ) : (
        <div className="summaryBox">Tous les points du chemin importé sont couverts.</div>
      )}

      {nextBoardChange && (
        <div className="rp-warning">
          🧩 Changement de plateau bientôt : <strong>{nextBoardChange.boardName}</strong> au point {nextBoardChange.point}.
        </div>
      )}

      <div className="rp-two">
        <section className="rp-panel">
          <h3>Prochains points</h3>
          {nextSteps.map((node, index) => {
            const prev = path[node.point - 2];
            const imp = nodeImportance(node, path);
            return (
              <div key={`${node.slug}-${node.point}`} className={`rp-step ${imp.kind}${index === 0 ? " current" : ""}`}>
                <div className="rp-step-n">{node.point}</div>
                <div className="rp-step-body">
                  <strong>{imp.icon} {node.boardName}</strong>
                  <span>
                    {index === 0 ? "À poser maintenant" : `Puis aller ${directionBetween(prev, node)}`}
                    {" · "}x{node.x}, y{node.y}
                    {node.glyphName ? ` · ${node.glyphName}` : ""}
                  </span>
                  <em>{imp.label}</em>
                </div>
              </div>
            );
          })}
        </section>

        <section className="rp-panel">
          <h3>Roadmap courte</h3>
          <div className="roadmap">
            {roadmap.map((item, i) => (
              <div key={`${item.label}-${i}`} className="roadmap-item">
                <span className="roadmap-icon">{item.icon}</span>
                <div>
                  <strong>{item.label}</strong>
                  <small>{item.point ? `Point ${item.point} · ` : ""}{item.detail}</small>
                </div>
              </div>
            ))}
          </div>

          <h3 style={{ marginTop: 16 }}>Résumé plateau</h3>
          <div className="rp-mini-list">
            {boardNodes.slice(0, 40).map(node => (
              <span
                key={`${node.slug}-${node.point}`}
                className={
                  node.point <= paragonLevel
                    ? "taken"
                    : nextNode?.point === node.point
                      ? "current"
                      : nodeImportance(node, path).kind
                }
                title={`Point ${node.point} · x${node.x}, y${node.y}`}
              >
                {node.point}
              </span>
            ))}
          </div>
          <p className="muted small">
            Vert = déjà pris, violet = prochain, orange/bleu = cap utile estimé.
          </p>
        </section>
      </div>
    </div>
  );
}


function aspectHint(name = "") {
  const n = String(name).toLowerCase();
  if (n.includes("péril") || n.includes("peril")) return { source:"Codex ou loot légendaire", where:"Occultiste / Codex, sinon loot random", why:"Survie prioritaire si tu galères en Pénitence.", type:"survie", icon:"🛡" };
  if (n.includes("mastodonte") || n.includes("juggernaut")) return { source:"Codex ou loot légendaire", where:"À poser sur pièce défensive", why:"Bon filet de sécurité pour monter en difficulté.", type:"survie", icon:"🛡" };
  if (n.includes("maître") || n.includes("edgemaster")) return { source:"Aspect légendaire / Codex si dispo", where:"À poser quand ta ressource est stable", why:"Plus fort quand tu maintiens ta ressource haute.", type:"dégâts", icon:"💥" };
  if (n.includes("accélération") || n.includes("accelerating")) return { source:"Aspect légendaire / Codex si dispo", where:"À poser pour fluidifier le build", why:"Confort : utile, mais pas bloquant.", type:"fluidité", icon:"⚡" };
  if (n.includes("ressource") || n.includes("resource")) return { source:"Affixe sur équipement", where:"Regarde anneaux, amulette, arme/off-hand selon les rolls", why:"Évite les trous dans ta rotation.", type:"ressource", icon:"🔮" };
  if (n.includes("critique") || n.includes("critical") || n.includes("vulnérable") || n.includes("vulnerable")) return { source:"Affixe sur équipement", where:"À prioriser quand survie/ressource sont OK", why:"Min-max dégâts, moins urgent si tu meurs ou es à sec.", type:"dégâts", icon:"💥" };
  return { source:"Loot / Codex / équipement", where:"À vérifier au fil des drops", why:"Objectif utile, pas forcément bloquant.", type:"synergie", icon:"🔗" };
}

function bestImmediateAction({ nextSkill, nextParagonNode, visibleEquipment, level, maxLevel }) {
  const mustGear = (visibleEquipment ?? []).find(e => {
    const txt = `${e.name ?? ""} ${e.label ?? ""} ${e.title ?? ""}`.toLowerCase();
    return txt.includes("péril") || txt.includes("peril") || txt.includes("ressource") || txt.includes("resource");
  });
  if (level >= maxLevel && nextParagonNode) return { title:`Poser le point parangon ${nextParagonNode.point}`, subtitle:`${nextParagonNode.boardName} · x${nextParagonNode.x}, y${nextParagonNode.y}`, why:"Tu es niveau max : ta vraie progression vient maintenant surtout du parangon, des glyphes et de l’équipement.", icon:"🧩", tone:"paragon" };
  if (mustGear) { const name = mustGear.name ?? mustGear.label ?? mustGear.title; const hint = aspectHint(name); return { title:`Chercher / poser : ${name}`, subtitle:hint.source, why:hint.why, icon:hint.icon, tone:hint.type }; }
  if (nextSkill) return {
    title:`Vérifier le skill : ${nextSkill.name ?? nextSkill.skill ?? "prochain skill"}`,
    subtitle:"Arbre de talents",
    why:"À valider dans ton arbre pour rester aligné avec le guide.",
    icon:"⚔️",
    tone:"skill",
    targetType:"skill",
    targetId: nextSkill.skillPoint ?? nextSkill.id ?? nextSkill.skill ?? nextSkill.name,
  };
  return { title:"Jouer normalement et comparer les loots", subtitle:"Build stable", why:"Tu as validé les gros objectifs visibles. Passe en optimisation progressive.", icon:"✅", tone:"done" };
}

function SessionFocusCard({ action, buildPct, paragonLevel, level, onValidateSkill, onSkipSkill, onResetSkills }) {
  const isSkillAction = action?.targetType === "skill";

  return (
    <section className={`session-focus ${action.tone}`}>
      <div className="sf-icon">{action.icon}</div>
      <div className="sf-main">
        <span className="muted small">🎯 ACTION IMMÉDIATE — V18.1</span>
        <h2>{action.title}</h2>
        <p className="sf-sub">{action.subtitle}</p>
        <p>{action.why}</p>

        {isSkillAction && (
          <div className="skill-action-row focus-actions">
            <button className="skill-btn validate" onClick={onValidateSkill}>
              ✓ appris
            </button>
            <button className="skill-btn skip" onClick={onSkipSkill}>
              ⏭ ignorer
            </button>
            <button className="skill-btn reset" onClick={onResetSkills}>
              ↩ reset talents
            </button>
          </div>
        )}
      </div>
      <div className="sf-stats">
        <strong>{buildPct}%</strong><span>build</span>
        <strong>{level}</strong><span>niveau</span>
        <strong>{paragonLevel}</strong><span>parangon</span>
      </div>
    </section>
  );
}

function AspectSourceCard({ item, checked, onCheck }) {
  const name = item.name ?? item.label ?? item.title ?? String(item);
  const hint = aspectHint(name);
  return (
    <article className={`source-card ${checked ? "done" : ""}`}>
      <div className="source-icon">{hint.icon}</div>
      <div className="source-body">
        <div className="source-top"><strong>{name}</strong><span className="tag">{hint.type}</span></div>
        <p>{hint.why}</p>
        <div className="source-meta"><span>📍 {hint.source}</span><span>➡️ {hint.where}</span></div>
      </div>
      <label className="source-check"><input type="checkbox" checked={checked} onChange={e => onCheck(e.target.checked)} /><span>validé</span></label>
    </article>
  );
}

function NextBox({ label, color, children }) {
  return (
    <div className="next-box" style={{ "--nc": color }}>
      <div className="next-label">{label}</div>
      <div className="next-content">{children}</div>
    </div>
  );
}



function talionFocusPresets(tabs = []) {
  const find = (...patterns) => {
    const found = tabs.find(t => patterns.some(p => p.test(t.title ?? "")));
    return found?.title ?? "";
  };

  return [
    { id: "skills", icon: "🌳", label: "Arbre", hint: "Skills + barre", title: find(/arbre/i, /compétence/i, /talent/i) },
    { id: "paragon", icon: "🧩", label: "Parangon", hint: "Plateaux + glyphes", title: find(/parangon/i) },
    { id: "gear", icon: "🎽", label: "Stuff", hint: "Uniques/aspects", title: find(/équipement/i, /equipement/i, /stuff/i) },
    { id: "charms", icon: "🧿", label: "Charmes", hint: "Sceaux/runes", title: find(/charme/i, /talisman/i) },
    { id: "merc", icon: "⚔️", label: "Mercs", hint: "Mercenaires", title: find(/mercenaire/i) },
    { id: "filter", icon: "🧹", label: "Filtre", hint: "Loot filter", title: find(/filtre/i, /butin/i) },
  ].filter(p => p.title);
}


function QuickProgressControls({ state, set, maxLevel = 70, compact = false }) {
  const diff = state.difficulty || "Pénitence";
  return (
    <section className={`quick-controls ${compact ? "compact" : ""}`}>
      <div className="qc-block">
        <span>Niveau</span>
        <div><button onClick={() => set({ level: clamp(state.level - 1, 1, maxLevel) })}>−</button><strong>{state.level}</strong><button onClick={() => set({ level: clamp(state.level + 1, 1, maxLevel) })}>+</button></div>
      </div>
      <div className="qc-block primary">
        <span>Parangon</span>
        <div><button onClick={() => set({ paragonLevel: clamp(state.paragonLevel - 1, 0, 300) })}>−</button><strong>{state.paragonLevel}</strong><button onClick={() => set({ paragonLevel: clamp(state.paragonLevel + 1, 0, 300) })}>+</button></div>
      </div>
      <div className="qc-block difficulty">
        <span>Difficulté</span>
        <div><button onClick={() => set({ difficulty: changeDifficulty(diff, -1) })}>−</button><strong>{diff}</strong><button onClick={() => set({ difficulty: changeDifficulty(diff, 1) })}>+</button></div>
      </div>
    </section>
  );
}

function ProgressionAssistantPanel({ state, set, advice, readiness, avgPower }) {
  return (
    <section className={`panel progression-assistant ${advice.tone}`}>
      <div className="pa-main">
        <span className="tag current">COACH V32</span>
        <h3>{advice.title}</h3>
        <p>{advice.detail}</p>
        {advice.missing.length > 0 && (
          <div className="pa-missing">
            <strong>À améliorer avant de push :</strong>
            {advice.missing.map(m => <span key={m}>→ {m}</span>)}
          </div>
        )}
      </div>
      <div className="pa-score">
        <strong>{readiness}%</strong>
        <span>readiness</span>
        <small>ilvl moy. {avgPower || "—"}</small>
      </div>
      <QuickProgressControls state={state} set={set} compact />
    </section>
  );
}

function GearPowerPanel({ state, set, avgPower }) {
  const itemPower = state.itemPower ?? {};
  function update(slot, value) {
    const clean = value === "" ? "" : clamp(Number(value) || 0, 0, 999);
    set({ itemPower: { ...itemPower, [slot]: clean } });
  }
  function fillAll() {
    const val = prompt("Item power à appliquer à toutes les pièces ?", avgPower || 750);
    if (val === null) return;
    const n = clamp(Number(val) || 0, 0, 999);
    const next = {};
    GEAR_SLOTS.forEach(s => { next[s.id] = n; });
    set({ itemPower: next });
  }
  return (
    <section className="panel gear-power-panel">
      <div className="gear-power-head">
        <div>
          <h3>🎽 Item power réel</h3>
          <p className="muted small">Renseigne vite fait tes pièces : le coach utilise la moyenne pour estimer si tu peux monter.</p>
        </div>
        <div className="avg-power"><strong>{avgPower || "—"}</strong><span>moyenne</span></div>
      </div>
      <div className="gear-power-grid">
        {GEAR_SLOTS.map(slot => (
          <label key={slot.id}>
            <span>{slot.label}</span>
            <input inputMode="numeric" value={itemPower[slot.id] ?? ""} onChange={e => update(slot.id, e.target.value)} placeholder="750" />
          </label>
        ))}
      </div>
      <div className="gear-power-actions">
        <button onClick={fillAll}>remplir tout</button>
        <button onClick={() => set({ itemPower: {} })}>reset ilvl</button>
      </div>
    </section>
  );
}

function PitTracker({ state, set, advice }) {
  const history = state.pitHistory ?? [];
  function saveResult(result) {
    const entry = {
      pitLevel: state.pitLevel,
      deaths: state.pitDeaths,
      result,
      at: new Date().toISOString(),
    };
    set({ pitResult: result, pitHistory: [entry, ...history].slice(0, 8) });
  }
  return (
    <section className="panel pit-tracker">
      <div className="pit-head">
        <div>
          <h3>🕳️ Tracker Fosse / test difficulté</h3>
          <p className="muted small">Tu tentes, tu comptes les morts, l'app ajuste son conseil.</p>
        </div>
        <span className={`pit-verdict ${advice.tone}`}>{advice.tone === "push" ? "push possible" : advice.tone === "wait" ? "attends un peu" : "à surveiller"}</span>
      </div>
      <div className="pit-controls">
        <div><span>Fosse</span><button onClick={() => set({ pitLevel: clamp(state.pitLevel - 1, 1, 200) })}>−</button><strong>{state.pitLevel}</strong><button onClick={() => set({ pitLevel: clamp(state.pitLevel + 1, 1, 200) })}>+</button></div>
        <div><span>Morts</span><button onClick={() => set({ pitDeaths: clamp(state.pitDeaths - 1, 0, 99) })}>−</button><strong>{state.pitDeaths}</strong><button onClick={() => set({ pitDeaths: clamp(state.pitDeaths + 1, 0, 99) })}>+</button></div>
      </div>
      <div className="pit-actions">
        <button className="success" onClick={() => saveResult("success")}>✓ réussi</button>
        <button className="failed" onClick={() => saveResult("failed")}>✕ trop dur</button>
        <button onClick={() => set({ pitDeaths: 0, pitResult: "idle" })}>reset tentative</button>
      </div>
      {history.length > 0 && (
        <div className="pit-history">
          {history.slice(0, 4).map((h, i) => (
            <span key={`${h.at}-${i}`}>Fosse {h.pitLevel} · {h.deaths} morts · {h.result === "success" ? "OK" : "KO"}</span>
          ))}
        </div>
      )}
    </section>
  );
}

function TopProgressHud({ state, set, advice, readiness, avgPower, maxLevel = 70 }) {
  const itemPower = state.itemPower ?? {};
  const glyphLevels = state.glyphLevels ?? {};
  const resistances = state.resistances ?? {};
  const glyphAverage = avgGlyphLevel(glyphLevels);
  const glyphPlan = glyphProgress(glyphLevels);
  const resStats = resistanceStats(resistances);
  const glyphAction = glyphActionPlan(glyphPlan, resStats, state);
  const diff = state.difficulty || "Pénitence";

  function updateGlyph(id, value) {
    const clean = value === "" ? "" : clamp(Number(value) || 0, 0, 100);
    set({ glyphLevels: { ...glyphLevels, [id]: clean } });
  }

  function bumpGlyph(id, delta) {
    const current = Number(glyphLevels[id] ?? 0) || 0;
    set({ glyphLevels: { ...glyphLevels, [id]: clamp(current + delta, 0, 100) } });
  }

  function setGlyphTarget(id, target) {
    const current = Number(glyphLevels[id] ?? 0) || 0;
    set({ glyphLevels: { ...glyphLevels, [id]: Math.max(current, target) } });
  }

  function updateResistance(id, value) {
    const clean = value === "" ? "" : clamp(Number(value) || 0, 0, 9999);
    set({ resistances: { ...resistances, [id]: clean } });
  }

  function updateSlot(slot, value) {
    const clean = value === "" ? "" : clamp(Number(value) || 0, 0, 999);
    set({ itemPower: { ...itemPower, [slot]: clean } });
  }

  function fillAll() {
    const val = prompt("Item power à appliquer à toutes les pièces ?", avgPower || 750);
    if (val === null) return;
    const n = clamp(Number(val) || 0, 0, 999);
    const next = {};
    GEAR_SLOTS.forEach(slot => { next[slot.id] = n; });
    set({ itemPower: next });
  }

  return (
    <section className={`top-progress-hud ${advice?.tone ?? "steady"}`}>
      <div className="tph-main">
        <span className="tag current">COACH V32</span>
        <h3>{advice?.title ?? "Assistant progression"}</h3>
        <p>{advice?.detail ?? "Renseigne ton stuff, ta difficulté et tes essais : l'app ajuste le conseil."}</p>
      </div>

      <div className="tph-score">
        <strong>{advice?.confidence ?? readiness}%</strong>
        <span>confiance push</span>
        <small>ready {readiness}% · ilvl {avgPower || "—"}</small>
      </div>

      <div className="confidence-grid">
        {(advice?.strengths ?? []).length > 0 && (
          <div className="confidence-box good">
            <strong>Points forts</strong>
            {(advice.strengths ?? []).map(s => <span key={s}>✓ {s}</span>)}
          </div>
        )}
        {(advice?.missing ?? []).length > 0 && (
          <div className="confidence-box warn">
            <strong>À sécuriser</strong>
            {(advice.missing ?? []).map(m => <span key={m}>→ {m}</span>)}
          </div>
        )}
      </div>

      <div className="tph-controls">
        <div className="tph-stepper">
          <span>Niveau</span>
          <button onClick={() => set({ level: clamp(state.level - 1, 1, maxLevel) })}>−</button>
          <strong>{state.level}</strong>
          <button onClick={() => set({ level: clamp(state.level + 1, 1, maxLevel) })}>+</button>
        </div>
        <div className="tph-stepper important">
          <span>Parangon</span>
          <button onClick={() => set({ paragonLevel: clamp(state.paragonLevel - 1, 0, 300) })}>−</button>
          <strong>{state.paragonLevel}</strong>
          <button onClick={() => set({ paragonLevel: clamp(state.paragonLevel + 1, 0, 300) })}>+</button>
        </div>
        <div className="tph-stepper difficulty">
          <span>Difficulté</span>
          <button onClick={() => set({ difficulty: changeDifficulty(diff, -1) })}>−</button>
          <strong>{diff}</strong>
          <button onClick={() => set({ difficulty: changeDifficulty(diff, 1) })}>+</button>
        </div>
        <div className="tph-stepper pit">
          <span>Morts fosse</span>
          <button onClick={() => set({ pitDeaths: clamp(state.pitDeaths - 1, 0, 99) })}>−</button>
          <strong>{state.pitDeaths}</strong>
          <button onClick={() => set({ pitDeaths: clamp(state.pitDeaths + 1, 0, 99) })}>+</button>
        </div>
      </div>

      <details className="tph-gear" open>
        <summary>🎽 Item power par pièce <strong>{avgPower || "—"}</strong></summary>
        <div className="tph-gear-grid">
          {GEAR_SLOTS.map(slot => (
            <label key={slot.id}>
              <span>{slot.label}</span>
              <input inputMode="numeric" value={itemPower[slot.id] ?? ""} onChange={e => updateSlot(slot.id, e.target.value)} placeholder="750" />
            </label>
          ))}
        </div>
        <div className="tph-gear-actions">
          <button onClick={fillAll}>remplir tout</button>
          <button onClick={() => set({ itemPower: {} })}>reset ilvl</button>
          <button className="success" onClick={() => set({ pitResult: "success", pitHistory: [{ pitLevel: state.pitLevel, deaths: state.pitDeaths, result: "success", at: new Date().toISOString() }, ...(state.pitHistory ?? [])].slice(0, 8) })}>fosse OK</button>
          <button className="failed" onClick={() => set({ pitResult: "failed", pitHistory: [{ pitLevel: state.pitLevel, deaths: state.pitDeaths, result: "failed", at: new Date().toISOString() }, ...(state.pitHistory ?? [])].slice(0, 8) })}>trop dur</button>
        </div>
      </details>

      <details className="tph-gear tph-glyphs" open>
        <summary>🔷 Glyphes <strong>{glyphAverage || "—"}</strong></summary>

        <div className={`glyph-plan-card ${glyphPlan.tone}`}>
          <div>
            <span className="muted small">PLAN GLYPHES</span>
            <strong>{glyphPlan.title}</strong>
            <p>{glyphPlan.detail}</p>
          </div>
          <div className="glyph-plan-score">
            <strong>{glyphPlan.ready15}/4</strong>
            <span>lvl 15+</span>
          </div>
        </div>

        <div className="glyph-route-grid">
          {glyphPlan.entries.map(g => (
            <article key={g.id} className={`glyph-route-card ${g.level >= 15 ? "done" : g.id === glyphPlan.priority?.id ? "priority" : ""}`}>
              <div className="glyph-route-head">
                <strong>{g.label}</strong>
                <span>{g.level || "—"}</span>
              </div>
              <input inputMode="numeric" value={glyphLevels[g.id] ?? ""} onChange={e => updateGlyph(g.id, e.target.value)} placeholder="0" />
              <div className="glyph-route-actions">
                <button onClick={() => bumpGlyph(g.id, 1)}>+1</button>
                <button onClick={() => bumpGlyph(g.id, 5)}>+5</button>
                <button onClick={() => setGlyphTarget(g.id, 15)}>15</button>
              </div>
              <small>{g.level >= 15 ? "Palier 15 OK" : `Encore ${g.to15} niveau${g.to15 > 1 ? "x" : ""} jusqu’à 15`}</small>
            </article>
          ))}
        </div>
        <div className={`glyph-action-plan ${glyphAction.tone}`}>
          <div className="glyph-action-head">
            <span>🧭 {glyphAction.cta}</span>
            <strong>{glyphAction.title}</strong>
            <p>{glyphAction.subtitle}</p>
          </div>
          <ol>
            {glyphAction.steps.map(step => <li key={step}>{step}</li>)}
          </ol>
          {glyphAction.warning && <p className="glyph-warning">⚠️ {glyphAction.warning}</p>}
        </div>
      </details>

      <details className="tph-gear tph-resists" open>
        <summary>🛡️ Résistances D4 <strong>{resStats.filled ? `${resStats.lowest}/70 score · faible: ${RESISTANCE_FIELDS.find(r => r.id === resStats.weakest?.id)?.label ?? "?"}` : "—"}</strong></summary>
        <div className="tph-mini-grid">
          {RESISTANCE_FIELDS.map(r => (
            <label key={r.id}>
              <span>{r.label}<em>{resStats.entries?.find(e => e.id === r.id)?.score ? ` ${resStats.entries.find(e => e.id === r.id).score}/70` : ""}</em></span>
              <input inputMode="numeric" value={resistances[r.id] ?? ""} onChange={e => updateResistance(r.id, e.target.value)} placeholder="ex: 1377" />
            </label>
          ))}
        </div>
        <p className="muted small">Saisis les valeurs brutes affichées dans Diablo 4, ex : Feu 1377, Foudre 443. Le coach les convertit en score de confort et repère la plus faible.</p>
      </details>

      <div className="push-test-card">
        <strong>{advice?.confidence >= 68 ? "🧪 Test conseillé" : advice?.confidence >= 52 ? "🧪 Test prudent" : "🛑 Pas de push forcé"}</strong>
        <span>{advice?.confidence >= 68
          ? `Tente ${advice.nextDifficulty ?? "la difficulté supérieure"} ou une Fosse courte. Si tu fais 0–2 morts, continue.`
          : advice?.confidence >= 52
            ? "Tu peux tester une petite Fosse, mais arrête si les morts montent vite."
            : "Farm encore un peu : parangon, glyphes, résistances ou aspects défensifs."}</span>
      </div>
    </section>
  );
}


function AdventureDirectorPanel({ state, set, plan, compact = false }) {
  const adventure = state.adventure ?? {};
  const mode = state.sessionMode ?? "short";

  function toggle(id, checked) {
    set({ adventure: { ...adventure, [id]: checked } });
  }

  return (
    <section className={`adventure-director ${plan?.tone ?? "steady"}${compact ? " compact" : ""}`}>
      <div className="adventure-main">
        <span className="tag current">NEXT BEST ACTION</span>
        <h2><span>{plan?.icon ?? "🧭"}</span> {plan?.title ?? "Choisis ta prochaine action"}</h2>
        <p className="adventure-sub">{plan?.subtitle}</p>
        <p>{plan?.why}</p>
        <ol>
          {(plan?.steps ?? []).map(step => <li key={step}>{step}</li>)}
        </ol>
      </div>

      <div className="session-switch">
        <span>Durée session</span>
        <button className={mode === "short" ? "on" : ""} onClick={() => set({ sessionMode: "short" })}>⚡ courte</button>
        <button className={mode === "long" ? "on" : ""} onClick={() => set({ sessionMode: "long" })}>📜 longue</button>
      </div>

      <div className="adventure-roadmap">
        {(plan?.roadmap ?? ADVENTURE_STEPS).map(step => (
          <label key={step.id} className={step.done ? "done" : ""}>
            <input type="checkbox" checked={!!step.done} onChange={e => toggle(step.id, e.target.checked)} />
            <span>
              <strong>{step.label}</strong>
              <small>{step.hint}</small>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

function TalionSessionFocus({ build, state, set }) {
  const tabs = build?.talion?.guideTabs ?? [];
  const presets = talionFocusPresets(tabs);
  const checks = state.talionObjectiveChecked ?? {};

  const objectives = [
    { id: "tree", icon: "🌳", title: "Arbre de compétences", detail: "Ouvre l’arbre Talion en grand et vérifie ta barre + tes gros passifs.", focus: presets.find(p => p.id === "skills")?.title },
    { id: "para", icon: "🧩", title: "Parangon / glyphes", detail: "Suis les plateaux en image HD. C’est le cœur du second écran.", focus: presets.find(p => p.id === "paragon")?.title },
    { id: "gear", icon: "🎽", title: "Équipement clé", detail: "Compare uniques, aspects et stats importantes avant de recycler trop vite.", focus: presets.find(p => p.id === "gear")?.title },
    { id: "extras", icon: "🧿", title: "Charmes + mercenaires", detail: "À vérifier quand le build commence à tourner correctement.", focus: presets.find(p => p.id === "charms")?.title || presets.find(p => p.id === "merc")?.title },
  ];

  function openFocus(title) {
    set({ g9: true, talionFocusTitle: title || presets[0]?.title || "" });
  }

  function toggle(id, checked) {
    set({ talionObjectiveChecked: { ...checks, [id]: checked } });
  }

  return (
    <section className="panel talion-session-focus">
      <div className="talion-session-head">
        <div>
          <span className="tag current">FOCUS MODE V23</span>
          <h3>Session Talion — quoi regarder maintenant ?</h3>
          <p className="muted small">Objectif : moins scroller, plus jouer. Tu choisis le bloc utile, G9 l’ouvre directement.</p>
        </div>
        <button className="talion-big-g9" onClick={() => openFocus(presets.find(p => p.id === "paragon")?.title)}>
          🖥️ G9 Parangon
        </button>
      </div>

      <div className="talion-focus-buttons">
        {presets.map(p => (
          <button key={p.id} onClick={() => openFocus(p.title)}>
            <span>{p.icon}</span>
            <strong>{p.label}</strong>
            <small>{p.hint}</small>
          </button>
        ))}
      </div>

      <div className="talion-objectives">
        {objectives.map(o => (
          <article key={o.id} className={checks[o.id] ? "done" : ""}>
            <label>
              <input type="checkbox" checked={!!checks[o.id]} onChange={e => toggle(o.id, e.target.checked)} />
              <span className="obj-icon">{o.icon}</span>
              <span>
                <strong>{o.title}</strong>
                <small>{o.detail}</small>
              </span>
            </label>
            <button onClick={() => openFocus(o.focus)}>focus</button>
          </article>
        ))}
      </div>
    </section>
  );
}

function G9Mode({
  state,
  set,
  immediateAction,
  buildPct,
  nextSkill,
  nextParagonNode,
  currentBoard,
  build,
  onValidateSkill,
  onSkipSkill,
  onResetSkills,
  adventurePlan,
  advice,
  readiness,
  avgPower,
}) {
  const talionTabs = build?.talion?.guideTabs ?? [];
  const defaultTalionTitle = talionTabs.find(t => /parangon/i.test(t.title ?? ""))?.title
    ?? talionTabs.find(t => /compétence|talent|arbre/i.test(t.title ?? ""))?.title
    ?? talionTabs[0]?.title
    ?? "";
  const [activeTalionTitle, setActiveTalionTitle] = useState(state.talionFocusTitle || defaultTalionTitle);
  const [selectedImage, setSelectedImage] = useState(null);
  const presets = talionFocusPresets(talionTabs);

  useEffect(() => {
    const wanted = state.talionFocusTitle || defaultTalionTitle;
    if (wanted && wanted !== activeTalionTitle) {
      setActiveTalionTitle(wanted);
      setSelectedImage(null);
    }
  }, [state.talionFocusTitle, defaultTalionTitle]);

  const activeTalionTab = talionTabs.find(t => t.title === activeTalionTitle) ?? talionTabs[0];
  const talionImages = extractImagesFromHtml(activeTalionTab?.html ?? "");
  const glyphLevels = state.glyphLevels ?? {};
  const resistances = state.resistances ?? {};
  const glyphAverage = avgGlyphLevel(glyphLevels);
  const glyphPlan = glyphProgress(glyphLevels);
  const resStats = resistanceStats(resistances);
  const glyphAction = glyphActionPlan(glyphPlan, resStats, state);

  function updateGlyph(id, value) {
    const clean = value === "" ? "" : clamp(Number(value) || 0, 0, 100);
    set({ glyphLevels: { ...glyphLevels, [id]: clean } });
  }

  function bumpGlyph(id, delta) {
    const current = Number(glyphLevels[id] ?? 0) || 0;
    set({ glyphLevels: { ...glyphLevels, [id]: clamp(current + delta, 0, 100) } });
  }

  function setGlyphTarget(id, target) {
    const current = Number(glyphLevels[id] ?? 0) || 0;
    set({ glyphLevels: { ...glyphLevels, [id]: Math.max(current, target) } });
  }

  function updateResistance(id, value) {
    const clean = value === "" ? "" : clamp(Number(value) || 0, 0, 9999);
    set({ resistances: { ...resistances, [id]: clean } });
  }

  function savePitResult(result) {
    set({
      pitResult: result,
      pitHistory: [
        { pitLevel: state.pitLevel, deaths: state.pitDeaths, result, at: new Date().toISOString() },
        ...(state.pitHistory ?? []),
      ].slice(0, 8),
    });
  }

  return (
    <div className={`g9-shell ${build?.talion ? "g9-talion-shell" : ""}`}>
      <header className="g9-header">
        <div>
          <h1>D4 Companion <small>G9</small></h1>
          <p>{build?.talion ? "Mode Talion second écran" : "Vue compacte second écran"}</p>
        </div>
        <button className="g9-exit" onClick={() => set({ g9: false })}>Vue complète</button>
      </header>

      <QuickProgressControls state={state} set={set} maxLevel={build?.maxLevel ?? 70} compact />

      {adventurePlan && <AdventureDirectorPanel state={state} set={set} plan={adventurePlan} compact />}

      {advice && (
        <section className={`g9-coach ${advice.tone}`}>
          <div>
            <span className="muted small">COACH DIFFICULTÉ</span>
            <h2>{advice.title}</h2>
            <p>{advice.detail}</p>
          </div>
          <div className="g9-readiness"><strong>{readiness}%</strong><span>ready</span><small>ilvl {avgPower || "—"}</small></div>
        </section>
      )}

      <details className="g9-gear-quick">
        <summary>🎽 ilvl par pièce · moyenne {avgPower || "—"}</summary>
        <div className="g9-gear-quick-grid">
          {GEAR_SLOTS.map(slot => (
            <label key={slot.id}>
              <span>{slot.label}</span>
              <input
                inputMode="numeric"
                value={(state.itemPower ?? {})[slot.id] ?? ""}
                placeholder="750"
                onChange={e => set({ itemPower: { ...(state.itemPower ?? {}), [slot.id]: e.target.value === "" ? "" : clamp(Number(e.target.value) || 0, 0, 999) } })}
              />
            </label>
          ))}
        </div>
      </details>

      <section className={`g9-confidence-panel ${advice?.tone ?? "steady"}`}>
        <div className="g9-confidence-main">
          <div>
            <span className="muted small">CONFIANCE PUSH</span>
            <h2>{advice?.confidence ?? readiness}%</h2>
            <p>{advice?.confidence >= 68 ? "Test conseillé" : advice?.confidence >= 52 ? "Test prudent" : "Pas de push forcé"}</p>
          </div>
          <div>
            <span className="muted small">GLYPHES</span>
            <h2>{glyphAverage || "—"}</h2>
            <p>{glyphAverage >= 15 ? "palier 15 OK" : "vise 15"}</p>
          </div>
          <div>
            <span className="muted small">RÉSIST. MIN</span>
            <h2>{resStats.filled ? `${resStats.lowest}%` : "—"}</h2>
            <p>{resStats.lowest >= 60 ? "rassurant" : "à sécuriser"}</p>
          </div>
          <div>
            <span className="muted small">FOSSE</span>
            <h2>{state.pitLevel}</h2>
            <p>{state.pitDeaths} mort{state.pitDeaths > 1 ? "s" : ""}</p>
          </div>
        </div>

        <div className="g9-confidence-lists">
          <div>
            <strong>Points forts</strong>
            {(advice?.strengths?.length ? advice.strengths : ["ilvl renseigné", "guide Talion chargé"]).slice(0, 3).map(s => (
              <span key={s}>✓ {s}</span>
            ))}
          </div>
          <div>
            <strong>À sécuriser</strong>
            {(advice?.missing?.length ? advice.missing : ["renseigne glyphes/résistances", "fais un test Fosse court"]).slice(0, 3).map(m => (
              <span key={m}>→ {m}</span>
            ))}
          </div>
        </div>

        <div className="g9-fast-inputs">
          <details open>
            <summary>🔷 Glyphes · {glyphPlan.ready15}/4 au palier 15</summary>
            <div className={`g9-glyph-plan ${glyphPlan.tone}`}>
              <strong>{glyphPlan.title}</strong>
              <span>{glyphPlan.detail}</span>
            </div>
            <div className={`g9-glyph-action-plan ${glyphAction.tone}`}>
              <strong>🧭 {glyphAction.cta}</strong>
              <span>{glyphAction.subtitle}</span>
              <ul>
                {glyphAction.steps.slice(0, 3).map(step => <li key={step}>{step}</li>)}
              </ul>
              {glyphAction.warning && <em>⚠️ {glyphAction.warning}</em>}
            </div>
            <div className="g9-mini-input-grid g9-glyph-grid">
              {glyphPlan.entries.map(g => (
                <label key={g.id} className={g.id === glyphPlan.priority?.id ? "priority" : g.level >= 15 ? "done" : ""}>
                  <span>{g.label}<em>{g.level >= 15 ? " OK" : g.level > 0 ? ` +${g.to15}→15` : " à renseigner"}</em></span>
                  <input inputMode="numeric" value={glyphLevels[g.id] ?? ""} onChange={e => updateGlyph(g.id, e.target.value)} placeholder="0" />
                  <div className="g9-glyph-actions">
                    <button onClick={() => bumpGlyph(g.id, 1)}>+1</button>
                    <button onClick={() => bumpGlyph(g.id, 5)}>+5</button>
                    <button onClick={() => setGlyphTarget(g.id, 15)}>15</button>
                  </div>
                </label>
              ))}
            </div>
          </details>

          <details open>
            <summary>🛡️ Résistances D4 {resStats.filled ? `· ${resStats.lowest}/70` : ""}</summary>
            <div className="g9-mini-input-grid resists">
              {RESISTANCE_FIELDS.map(r => (
                <label key={r.id}>
                  <span>{r.label}<em>{resStats.entries?.find(e => e.id === r.id)?.score ? ` ${resStats.entries.find(e => e.id === r.id).score}/70` : ""}</em></span>
                  <input inputMode="numeric" value={resistances[r.id] ?? ""} onChange={e => updateResistance(r.id, e.target.value)} placeholder="ex: 1377" />
                </label>
              ))}
            </div>
          </details>

          <details>
            <summary>🧪 Test Fosse</summary>
            <div className="g9-pit-controls">
              <div>
                <span>Fosse</span>
                <button onClick={() => set({ pitLevel: clamp(state.pitLevel - 1, 1, 200) })}>−</button>
                <strong>{state.pitLevel}</strong>
                <button onClick={() => set({ pitLevel: clamp(state.pitLevel + 1, 1, 200) })}>+</button>
              </div>
              <div>
                <span>Morts</span>
                <button onClick={() => set({ pitDeaths: clamp(state.pitDeaths - 1, 0, 99) })}>−</button>
                <strong>{state.pitDeaths}</strong>
                <button onClick={() => set({ pitDeaths: clamp(state.pitDeaths + 1, 0, 99) })}>+</button>
              </div>
              <button className="ok" onClick={() => savePitResult("success")}>fosse OK</button>
              <button className="bad" onClick={() => savePitResult("failed")}>trop dur</button>
            </div>
          </details>
        </div>
      </section>

      <SessionFocusCard
        action={immediateAction}
        buildPct={buildPct}
        paragonLevel={state.paragonLevel}
        level={state.level}
        onValidateSkill={onValidateSkill}
        onSkipSkill={onSkipSkill}
        onResetSkills={onResetSkills}
      />

      {build?.talion && (
        <section className="g9-talion-panel">
          <div className="g9-talion-head">
            <div>
              <span className="tag current">TALION</span>
              <h2>{build.buildName}</h2>
              <p>Navigation rapide guide / images. Clique l’image pour zoomer.</p>
            </div>
            <button className="g9-blue" onClick={() => set({ g9: false, tab: "talion" })}>Guide complet</button>
          </div>

          <DiabloTranslatorPanel compact />

          {presets.length > 0 && (
            <div className="g9-focus-rail">
              {presets.map(p => (
                <button
                  key={p.id}
                  className={activeTalionTab?.title === p.title ? "on" : ""}
                  onClick={() => { setActiveTalionTitle(p.title); set({ talionFocusTitle: p.title }); setSelectedImage(null); }}
                >
                  <span>{p.icon}</span>
                  <strong>{p.label}</strong>
                  <small>{p.hint}</small>
                </button>
              ))}
            </div>
          )}

          <div className="g9-talion-tabs">
            {talionTabs.map(t => (
              <button
                key={t.title}
                className={activeTalionTab?.title === t.title ? "on" : ""}
                onClick={() => { setActiveTalionTitle(t.title); set({ talionFocusTitle: t.title }); setSelectedImage(null); }}
              >
                {t.title}
              </button>
            ))}
          </div>

          {activeTalionTab && (
            <div className="g9-talion-current">
              <h3>{activeTalionTab.title}</h3>
              {talionImages[0] ? (
                <SmartTalionImage
                  image={talionImages[0]}
                  title={activeTalionTab?.title ?? ""}
                  onOpen={() => setSelectedImage(talionImages[0])}
                />
              ) : (
                <p className="muted">Pas d’image détectée sur cet onglet.</p>
              )}

              {talionImages.length > 1 && (
                <div className="g9-image-strip">
                  {talionImages.slice(0, 8).map((img, i) => (
                    <button key={`${img.src}-${i}`} onClick={() => setSelectedImage(img)}>
                      Image {i + 1}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <section className="g9-grid">
        <div className="g9-card primary">
          <span className="muted small">NEXT PARAGON</span>
          {nextParagonNode ? (
            <>
              <h2>Point {nextParagonNode.point}</h2>
              <p>{nextParagonNode.boardName}</p>
              <strong>x{nextParagonNode.x}, y{nextParagonNode.y}</strong>
              {nextParagonNode.glyphName && <em>🔷 {nextParagonNode.glyphName}</em>}
            </>
          ) : (
            <>
              <h2>{build?.talion ? "Voir image parangon" : "Parangon OK"}</h2>
              <p>{build?.talion ? "Talion fournit surtout le chemin en image HD." : "Chemin couvert ou non débloqué."}</p>
            </>
          )}
        </div>

        <div className="g9-card">
          <span className="muted small">BOARD</span>
          <h2>{currentBoard?.name ?? "Talion"}</h2>
          <p>{currentBoard?.glyphName ? `Glyphe : ${currentBoard.glyphName}` : "Guide visuel actif"}</p>
        </div>

        <div className="g9-card">
          <span className="muted small">SKILL</span>
          {nextSkill ? (
            <>
              <h2>{nextSkill.name ?? nextSkill.skill ?? `Point ${nextSkill.skillPoint}`}</h2>
              <p>À vérifier dans ton arbre</p>
            </>
          ) : (
            <>
              <h2>{build?.talion ? "Arbre Talion" : "Cap talents"}</h2>
              <p>{build?.talion ? "Utilise l’onglet Arbre / Talents ci-dessus." : "Post-70 : focus parangon/stuff"}</p>
            </>
          )}
        </div>

        <div className="g9-card">
          <span className="muted small">PROGRESSION</span>
          <h2>{buildPct}%</h2>
          <p>{build?.buildName ?? build?.title ?? "Build chargé"}</p>
        </div>
      </section>

      <section className="g9-help">
        <strong>Routine rapide</strong>
        <p>{build?.talion ? "Passe entre Arbre / Parangons / Équipement, ouvre l’image en grand, joue, puis reviens checker le prochain bloc." : "Regarde l’action immédiate → joue → coche ce qui est vraiment équipé/validé → l’objectif change."}</p>
      </section>

      {selectedImage && (
        <TalionImageViewer
          images={talionImages}
          image={selectedImage}
          onClose={() => setSelectedImage(null)}
          onSelect={setSelectedImage}
        />
      )}
    </div>
  );
}



function extractImagesFromHtml(html = "") {
  const out = [];
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("img").forEach((img, index) => {
      const src = img.getAttribute("src");
      if (!src) return;
      out.push({
        src,
        alt: img.getAttribute("alt") || `Image Talion ${index + 1}`,
      });
    });
  } catch {
    // ignore malformed HTML; the raw guide can still render below
  }
  return out;
}



const DIABLO_TRANSLATIONS = {
  // Talismans / charms / occult terms seen in Talion, Mobalytics and Game8-style guides.
  // Important: several expansion terms are translated by community/client builds differently.
  // The app therefore keeps EN + a practical FR approximation to help search in-game.
  "beru of the nameless": { fr: "Beru de l’Anonyme", altFr: "Beru des Sans-Noms", type: "Charme / rune", family: "The Nameless", note: "Cherche surtout “Beru” dans le jeu FR ; le suffixe peut varier selon la traduction." },
  "mlor of the nameless": { fr: "Mlor de l’Anonyme", altFr: "Mlor des Sans-Noms", type: "Charme / rune", family: "The Nameless", note: "Souvent couplé à Beru of the Nameless dans les guides EN." },
  "giga of the nameless": { fr: "Giga de l’Anonyme", altFr: "Giga des Sans-Noms", type: "Charme / rune", family: "The Nameless", note: "Approximation FR : vérifie le tooltip exact en jeu." },
  "qax of the nameless": { fr: "Qax de l’Anonyme", altFr: "Qax des Sans-Noms", type: "Charme / rune", family: "The Nameless", note: "Approximation FR : garde le préfixe Qax comme repère principal." },
  "xal of the nameless": { fr: "Xal de l’Anonyme", altFr: "Xal des Sans-Noms", type: "Charme / rune", family: "The Nameless", note: "Approximation FR : cherche Xal." },
  "nagu of the nameless": { fr: "Nagu de l’Anonyme", altFr: "Nagu des Sans-Noms", type: "Charme / rune", family: "The Nameless", note: "Approximation FR : cherche Nagu." },
  "fey of the nameless": { fr: "Fey de l’Anonyme", altFr: "Fey des Sans-Noms", type: "Charme / rune", family: "The Nameless", note: "Approximation FR : cherche Fey." },
  "yax of the nameless": { fr: "Yax de l’Anonyme", altFr: "Yax des Sans-Noms", type: "Charme / rune", family: "The Nameless", note: "Approximation FR : cherche Yax." },
  "tyr of the nameless": { fr: "Tyr de l’Anonyme", altFr: "Tyr des Sans-Noms", type: "Charme / rune", family: "The Nameless", note: "Approximation FR : cherche Tyr." },
  "beru of horazon's chains": { fr: "Beru des chaînes d’Horazon", type: "Charme / rune", family: "Horazon", note: "Nom FR à confirmer en jeu." },
  "beru of abaddon's flesh": { fr: "Beru de la chair d’Abaddon", type: "Charme / rune", family: "Abaddon", note: "Nom FR à confirmer en jeu." },
  "ritual": { fr: "Rituel", type: "Mécanique", family: "Charmes / pouvoirs" },
  "rituals": { fr: "Rituels", type: "Mécanique", family: "Charmes / pouvoirs" },
  "sigil": { fr: "Sceau", type: "Mécanique", family: "Donjons / pouvoirs" },
  "sigils": { fr: "Sceaux", type: "Mécanique", family: "Donjons / pouvoirs" },
  "talisman": { fr: "Talisman", type: "Objet / système", family: "Charmes" },
  "talismans": { fr: "Talismans", type: "Objet / système", family: "Charmes" },
  "charm": { fr: "Charme", type: "Objet / système", family: "Charmes" },
  "charms": { fr: "Charmes", type: "Objet / système", family: "Charmes" },
  "inner power": { fr: "Puissance intérieure", type: "Mécanique", family: "Progression", note: "Traduction pratique : vérifie le libellé exact si ton client utilise un autre terme." },
  "occult gem": { fr: "Gemme occulte", type: "Objet / système", family: "Occulte" },
  "occult gems": { fr: "Gemmes occultes", type: "Objet / système", family: "Occulte" },
  "entropy": { fr: "Entropie", type: "Glyphe", family: "Parangon" },
  "reinforcement": { fr: "Renforcement", type: "Glyphe", family: "Parangon" },
  "headhunter": { fr: "Chasse aux têtes", type: "Glyphe", family: "Parangon" },
  "chasse aux têtes": { fr: "Chasse aux têtes", en: "Headhunter", type: "Glyphe", family: "Parangon" },
};

function normalizeVocabularyKey(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "'")
    .trim();
}

function guessDiabloTranslation(value = "") {
  const clean = String(value).trim();
  const nameless = clean.match(/^(.+?)\s+of\s+the\s+Nameless$/i);
  if (nameless) {
    const base = nameless[1].trim();
    return {
      en: clean,
      fr: `${base} de l’Anonyme`,
      altFr: `${base} des Sans-Noms`,
      type: "Charme / rune",
      family: "The Nameless",
      guessed: true,
      note: "Traduction générée automatiquement : cherche surtout le préfixe dans ton jeu, puis confirme le suffixe exact."
    };
  }

  const horazon = clean.match(/^(.+?)\s+of\s+Horazon['’]s\s+Chains$/i);
  if (horazon) {
    const base = horazon[1].trim();
    return { en: clean, fr: `${base} des chaînes d’Horazon`, type: "Charme / rune", family: "Horazon", guessed: true, note: "Traduction générée automatiquement." };
  }

  const abaddon = clean.match(/^(.+?)\s+of\s+Abaddon['’]s\s+Flesh$/i);
  if (abaddon) {
    const base = abaddon[1].trim();
    return { en: clean, fr: `${base} de la chair d’Abaddon`, type: "Charme / rune", family: "Abaddon", guessed: true, note: "Traduction générée automatiquement." };
  }

  return null;
}

function translateDiabloTerm(value = "") {
  const key = normalizeVocabularyKey(value);
  const direct = DIABLO_TRANSLATIONS[key];
  if (direct) return { en: value, ...direct };

  const fuzzyKey = Object.keys(DIABLO_TRANSLATIONS).find(k => key.includes(normalizeVocabularyKey(k)) || normalizeVocabularyKey(k).includes(key));
  if (fuzzyKey) return { en: value, ...DIABLO_TRANSLATIONS[fuzzyKey] };

  const guessed = guessDiabloTranslation(value);
  if (guessed) return guessed;

  return { en: value, fr: "Nom FR à renseigner", type: "Inconnu", family: "Guide EN", note: "Copie le nom FR depuis le tooltip du jeu, puis on pourra l’ajouter au glossaire." };
}

function extractDiabloTermsFromText(text = "") {
  const source = String(text);
  const found = new Map();

  Object.keys(DIABLO_TRANSLATIONS)
    .sort((a, b) => b.length - a.length)
    .forEach(term => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${escaped}\\b`, "i");
      if (re.test(source)) {
        found.set(term, translateDiabloTerm(term));
      }
    });

  const patterned = source.match(/\b[A-Z][A-Za-z]+\s+of\s+(?:the\s+Nameless|Horazon['’]s\s+Chains|Abaddon['’]s\s+Flesh)\b/g) ?? [];
  patterned.forEach(term => found.set(normalizeVocabularyKey(term), translateDiabloTerm(term)));

  return Array.from(found.values()).slice(0, 16);
}

function CharmVocabularyPanel() {
  const entries = [
    "Beru of the Nameless",
    "Mlor of the Nameless",
    "Beru of Abaddon's Flesh",
    "Beru of Horazon's Chains",
  ].map(translateDiabloTerm);

  return (
    <div className="diablo-vocab-panel">
      <div className="diablo-vocab-head">
        <span>📘 Glossaire EN → FR</span>
        <strong>Charmes / runes détectés</strong>
      </div>
      <div className="diablo-vocab-grid">
        {entries.map((entry) => (
          <article key={entry.en}>
            <small>VO guide</small>
            <strong>{entry.en}</strong>
            <small>Dans ton jeu FR</small>
            <em>{entry.fr}</em>
            <span>{entry.type}{entry.family ? ` · ${entry.family}` : ""}</span>
          </article>
        ))}
      </div>
      <p>
        Si un nom FR ne correspond pas exactement à ton client, remplace-le mentalement pour l’instant : le but est de relier le nom anglais du guide au libellé que tu cherches en jeu.
      </p>
    </div>
  );
}


function DiabloTranslatorPanel({ compact = false }) {
  const [query, setQuery] = useState("Beru of the Nameless\nMlor of the Nameless\nGiga of the Nameless\nInner Power\nSigil");
  const matches = extractDiabloTermsFromText(query);
  const manual = query
    .split(/[,;\n]+/)
    .map(x => x.trim())
    .filter(Boolean)
    .filter(x => !matches.some(m => normalizeVocabularyKey(m.en) === normalizeVocabularyKey(x)))
    .slice(0, 6)
    .map(translateDiabloTerm);
  const results = [...matches, ...manual].slice(0, compact ? 6 : 12);

  return (
    <section className={`diablo-translation-lab ${compact ? "compact" : ""}`}>
      <div className="translation-head">
        <div>
          <span className="tag current">TRADUCTEUR DIABLO EN ⇄ FR</span>
          <h3>Colle un nom anglais, l’app te donne le repère FR</h3>
          {!compact && <p className="muted small">Parfait pour Game8 / Mobalytics / Maxroll : tu gardes le nom EN du guide et un équivalent FR à chercher en jeu.</p>}
        </div>
      </div>

      {!compact && (
        <textarea
          className="translation-input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Ex: Beru of the Nameless, Inner Power, Sigil..."
        />
      )}

      <div className="translation-results">
        {results.map((entry, index) => (
          <article key={`${entry.en}-${index}`} className={entry.guessed ? "guessed" : ""}>
            <small>Guide EN</small>
            <strong>{entry.en}</strong>
            <small>À chercher en jeu FR</small>
            <em>{entry.fr}</em>
            {entry.altFr && <b>alias possible : {entry.altFr}</b>}
            <span>{entry.type}{entry.family ? ` · ${entry.family}` : ""}{entry.guessed ? " · généré" : ""}</span>
            {entry.note && !compact && <p>{entry.note}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}

function getSmartTalionMarkers(title = "", imageAlt = "") {
  const text = `${title} ${imageAlt}`.toLowerCase();

  if (/charme|talisman|sceau|rune/.test(text)) {
    return [
      {
        id: "charm-top-left",
        x: 33,
        y: 39,
        label: "Mlor of the Nameless",
        fr: translateDiabloTerm("Mlor of the Nameless").fr,
        kind: "Charme / rune",
        priority: "À vérifier",
        body: "Guide EN : Mlor of the Nameless. Cherche son nom FR équivalent dans ton jeu puis compare l’icône.",
        gameSteps: [
          "Ouvre l’écran Charmes / Runes dans Diablo.",
          "Cherche le nom FR indiqué ci-dessous ou l’icône identique.",
          "Équipe-le dans l’emplacement haut gauche si disponible.",
        ],
      },
      {
        id: "charm-top",
        x: 50,
        y: 30,
        label: "Beru of the Nameless",
        fr: translateDiabloTerm("Beru of the Nameless").fr,
        kind: "Charme / rune",
        priority: "Important",
        body: "Guide EN : Beru of the Nameless. C’est probablement un des charmes clés de ce setup ; cherche le nom FR dans ton jeu.",
        gameSteps: [
          "Ouvre Charmes / Runes.",
          "Cherche Beru of the Nameless ou son équivalent FR.",
          "Équipe-le sur le slot haut si disponible.",
        ],
      },
      {
        id: "charm-top-right",
        x: 67,
        y: 39,
        label: "Beru of Abaddon's Flesh",
        fr: translateDiabloTerm("Beru of Abaddon's Flesh").fr,
        kind: "Charme / rune",
        priority: "À vérifier",
        body: "Guide EN : Beru of Abaddon's Flesh. Le nom exact FR peut varier : vérifie dans ton tooltip en jeu.",
        gameSteps: [
          "Compare le symbole rouge sur l’image.",
          "Repère le même nom ou le même set dans le jeu.",
          "Équipe-le dans l’emplacement haut droit.",
        ],
      },
      {
        id: "charm-bottom-left",
        x: 34,
        y: 66,
        label: "Beru of Horazon's Chains",
        fr: translateDiabloTerm("Beru of Horazon's Chains").fr,
        kind: "Charme / rune",
        priority: "Secondaire",
        body: "Guide EN : Beru of Horazon's Chains. À reproduire après les emplacements prioritaires si tu n’as pas tout.",
        gameSteps: [
          "Cherche le nom FR ou l’icône correspondante dans Diablo.",
          "Si tu ne l’as pas, garde ce slot comme objectif loot.",
        ],
      },
      {
        id: "charm-bottom-right",
        x: 66,
        y: 66,
        label: "Rune / charme final",
        fr: "Nom FR à confirmer",
        kind: "Charme / rune",
        priority: "Secondaire",
        body: "Dernier slot du schéma. Utilise surtout le pictogramme pour retrouver la correspondance exacte dans ton jeu.",
        gameSteps: [
          "Compare l’icône.",
          "Équipe l’équivalent dans le jeu.",
        ],
      },
    ];
  }

  if (/parangon|paragon/.test(text)) {
    return [
      {
        id: "paragon-glyph",
        x: 50,
        y: 50,
        label: "Zone glyphe / noyau du plateau",
        kind: "Parangon",
        priority: "Prioritaire",
        body: "Utilise cette image comme carte. Le nom du glyphe est affiché dans le panneau Talion ou dans le bloc coach quand il est connu.",
        gameSteps: [
          "Ouvre le plateau correspondant dans Diablo.",
          "Suis le chemin rouge autour de la zone centrale.",
          "Monte le glyphe prioritaire vers le niveau 15.",
        ],
      },
    ];
  }

  if (/équipement|equipement|stuff/.test(text)) {
    return [
      {
        id: "gear-table",
        x: 50,
        y: 50,
        label: "Tableau équipement",
        kind: "Stuff",
        priority: "À comparer",
        body: "Compare surtout les noms d’uniques/aspects et les affixes importants. L’item power seul ne suffit pas.",
        gameSteps: [
          "Ouvre ton inventaire.",
          "Compare chaque slot avec le tableau Talion.",
          "Ne remplace pas uniquement sur l’ilvl : vérifie aspect et stats.",
        ],
      },
    ];
  }

  return [];
}

function SmartTalionImage({ image, title, onOpen }) {
  const [activeMarker, setActiveMarker] = useState(null);
  const [helpVisible, setHelpVisible] = useState(true);
  const markers = getSmartTalionMarkers(title, image?.alt);
  const active = activeMarker ?? markers[0] ?? null;

  if (!image) return null;

  return (
    <div className="smart-talion-block">
      <div className="smart-talion-toolbar">
        <div>
          <strong>Image Talion intelligente</strong>
          <span>{markers.length ? `${markers.length} repère${markers.length > 1 ? "s" : ""} détecté${markers.length > 1 ? "s" : ""}` : "aucun repère automatique"}</span>
        </div>
        <div className="smart-talion-actions">
          {markers.length > 0 && (
            <button onClick={() => setHelpVisible(v => !v)}>
              {helpVisible ? "masquer aide" : "afficher aide"}
            </button>
          )}
          <button onClick={onOpen}>🔍 ouvrir en grand</button>
        </div>
      </div>

      <div className="smart-image-stage">
        <img src={image.src} alt={image.alt} draggable={false} />
        {helpVisible && markers.map(marker => (
          <button
            key={marker.id}
            className={`smart-marker ${active?.id === marker.id ? "on" : ""}`}
            style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
            onClick={(e) => { e.stopPropagation(); setActiveMarker(marker); }}
            title={marker.label}
          >
            ?
          </button>
        ))}
      </div>

      {helpVisible && active && (
        <aside className={`smart-tooltip-panel ${String(active.priority).toLowerCase().replaceAll(" ", "-")}`}>
          <div className="smart-tooltip-head">
            <span className="tag current">{active.kind}</span>
            <strong>{active.label}</strong>
            {active.fr && <span className="fr-chip">FR : {active.fr}</span>}
            <em>{active.priority}</em>
          </div>
          <p>{active.body}</p>
          <div className="smart-steps">
            <strong>Dans Diablo :</strong>
            <ol>
              {active.gameSteps.map((step, index) => <li key={index}>{step}</li>)}
            </ol>
          </div>
          {/charme|rune/i.test(active.kind) && (
            <p className="smart-note">
              Astuce : les guides EN et le client FR ne parlent pas toujours pareil. Utilise la ligne “FR” comme piste, puis confirme avec l’icône en jeu.
            </p>
          )}
        </aside>
      )}

      {helpVisible && /charme|talisman|sceau|rune/i.test(`${title} ${image?.alt ?? ""}`) && <CharmVocabularyPanel />}
    </div>
  );
}

function TalionImageViewer({ images, image, onClose, onSelect }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState(null);

  if (!image) return null;

  const index = Math.max(0, images.findIndex(i => i.src === image.src));
  const canPrev = images.length > 1;

  function selectAt(nextIndex) {
    const normalized = (nextIndex + images.length) % images.length;
    onSelect(images[normalized]);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  function onWheel(e) {
    e.preventDefault();
    setZoom(z => {
      const next = e.deltaY < 0 ? z + 0.18 : z - 0.18;
      return Math.min(5, Math.max(0.55, next));
    });
  }

  function reset() {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  return (
    <div className="talion-viewer" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="talion-viewer-toolbar" onClick={e => e.stopPropagation()}>
        <strong>{image.alt}</strong>
        <span className="muted small">{index + 1}/{images.length} · zoom {Math.round(zoom * 100)}%</span>
        {canPrev && <button onClick={() => selectAt(index - 1)}>← précédente</button>}
        {canPrev && <button onClick={() => selectAt(index + 1)}>suivante →</button>}
        <button onClick={reset}>reset</button>
        <a href={image.src} target="_blank" rel="noreferrer">ouvrir seule</a>
        <button className="danger" onClick={onClose}>fermer</button>
      </div>

      <div
        className="talion-viewer-stage"
        onClick={e => e.stopPropagation()}
        onWheel={onWheel}
        onMouseDown={e => setDrag({ x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y })}
        onMouseMove={e => {
          if (!drag) return;
          setOffset({ x: drag.ox + e.clientX - drag.x, y: drag.oy + e.clientY - drag.y });
        }}
        onMouseUp={() => setDrag(null)}
        onMouseLeave={() => setDrag(null)}
      >
        <img
          src={image.src}
          alt={image.alt}
          draggable={false}
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
        />
      </div>
    </div>
  );
}

function TalionGuide({ build }) {
  const tabs = build.talion?.guideTabs ?? [];
  const [active, setActive] = useState(tabs[0]?.title ?? "");
  const [selectedImage, setSelectedImage] = useState(null);
  const current = tabs.find(t => t.title === active) ?? tabs[0];
  const currentImages = extractImagesFromHtml(current?.html ?? "");

  if (!build.talion) return null;

  function onGuideClick(e) {
    const img = e.target?.closest?.("img");
    if (!img) return;
    const src = img.getAttribute("src");
    if (!src) return;
    setSelectedImage({ src, alt: img.getAttribute("alt") || current?.title || "Image Talion" });
  }

  return (
    <main>
      <section className="talion-banner">
        <div>
          <span className="tag current">TALION GUIDE MODE</span>
          <h3>{build.talion.className || build.buildName}</h3>
          <p>{build.talion.note}</p>
          {build.talion.videoUrl && <a href={build.talion.videoUrl} target="_blank" rel="noreferrer">▶ Vidéo du build</a>}
        </div>
      </section>

      <DiabloTranslatorPanel />

      <nav className="talion-subtabs">
        {tabs.map(t => (
          <button key={t.title} className={current?.title === t.title ? "on" : ""} onClick={() => setActive(t.title)}>
            {t.title}
          </button>
        ))}
      </nav>

      {current && (
        <section className="talion-guide panel">
          <div className="talion-guide-head">
            <div>
              <h3>{current.title}</h3>
              <p className="muted small">Clique une image pour zoomer. Molette = zoom, clic-glissé = déplacer.</p>
            </div>
            {currentImages[0] && (
              <button className="talion-open-first" onClick={() => setSelectedImage(currentImages[0])}>
                🔍 ouvrir 1ère image en grand
              </button>
            )}
          </div>
          {currentImages[0] && (
            <SmartTalionImage
              image={currentImages[0]}
              title={current.title}
              onOpen={() => setSelectedImage(currentImages[0])}
            />
          )}
          <details className="talion-raw-details">
            <summary>Voir le guide brut Talion</summary>
            <div className="talion-html" onClick={onGuideClick} dangerouslySetInnerHTML={{ __html: current.html }} />
          </details>
        </section>
      )}

      <TalionImageViewer
        images={currentImages}
        image={selectedImage}
        onClose={() => setSelectedImage(null)}
        onSelect={setSelectedImage}
      />

      {build.talion.lootFilter && (
        <section className="panel talion-loot-filter">
          <h3>Filtre de butin Talion</h3>
          <textarea readOnly value={build.talion.lootFilter} onFocus={e => e.target.select()} />
          <p className="muted small">Clique dans la zone puis Ctrl+A / Ctrl+C si besoin.</p>
        </section>
      )}
    </main>
  );
}


function ImportBar({ compact = false, onImported }) {
  const [url, setUrl] = useState("https://www.talion.tv/diablo-4/builds/demoniste-apocalypse");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function doImport() {
    const trimmed = url.trim();
    if (!trimmed) {
      setMsg("Colle une URL Talion d'abord.");
      return;
    }

    if (!trimmed.includes("talion.tv")) {
      setMsg("Pour cette version, l'import direct supporte Talion uniquement.");
      return;
    }

    setBusy(true);
    setMsg("Import Talion en cours…");
    try {
      const res = await fetch(`/api/import-talion?url=${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      setMsg(`OK : ${data.buildName}`);
      await onImported?.();
    } catch (e) {
      setMsg(`Erreur import : ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`import-bar${compact ? " compact" : ""}`}>
      <div className="import-title">
        <strong>📥 Import URL</strong>
        <span className="muted small">Talion direct depuis api.talion.tv</span>
      </div>
      <div className="import-row">
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") doImport(); }}
          placeholder="https://www.talion.tv/diablo-4/builds/demoniste-apocalypse"
        />
        <button className="import-btn" disabled={busy} onClick={doImport}>
          {busy ? "Import…" : "Importer"}
        </button>
      </div>
      {msg && <p className={`import-msg${msg.startsWith("Erreur") ? " error" : ""}`}>{msg}</p>}
    </section>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

function App() {
  const [state, setState] = useState(load);
  const [build, setBuild] = useState(null);
  const [loading, setLoading] = useState(true);
  const [noBuild, setNoBuild] = useState(false);

  useEffect(() => { localStorage.setItem(LS_KEY, JSON.stringify(state)); }, [state]);

  const refreshBuild = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/build");
      const data = await res.json();
      if (data.error === "no_build") {
        setNoBuild(true);
        setBuild(null);
        return;
      }
      if (data.error) throw new Error(data.error);
      setBuild(data);
      setNoBuild(false);
      setState(s => ({
        ...s,
        tab: data.talion ? "talion" : s.tab,
        skillChecked: {},
        glyphChecked: {},
        equipmentChecked: {},
        ignoredSkills: {},
      }));
    } catch {
      setNoBuild(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshBuild(); }, [refreshBuild]);

  const set = useCallback(patch => setState(s => ({ ...s, ...patch })), []);

  if (loading) return (
    <div className="splash">
      <div className="spinner" />
      <p>Chargement…</p>
    </div>
  );

  if (noBuild) return (
    <div className="splash">
      <h1>D4 Companion</h1>
      <p>Aucun build importé.</p>
      <div className="howto">
        <p>1. Lance le serveur : <code>npm start</code></p>
        <p>2. Colle directement une URL Talion ci-dessous.</p>
        <ImportBar onImported={refreshBuild} />
        <p className="hint">Mobalytics reste disponible via le bookmarklet dans <code>bookmarklet.js</code>.</p>
      </div>
    </div>
  );

  const skillPath = build.skillPath ?? [];
  const boards    = build.boards ?? [];
  const paragonPath = build.paragonPath ?? [];
  const paragonUnlocked = state.level >= (build.paragonUnlockLevel ?? 70);
  const spEarned  = levelToSP(state.level, build.maxLevel ?? 70);
  const curBoardIdx = Math.min(paragonLevelToBoard(state.paragonLevel), Math.max(boards.length - 1, 0));

  const doneSkills = skillPath.filter(e => state.skillChecked[e.skillPoint]).length;
  const doneGlyphs = boards.filter(b => state.glyphChecked[b.glyph]).length;
  const doneParagonNodes = Math.min(state.paragonLevel, paragonPath.length);
  const pct = skillPath.length ? Math.round((doneSkills / skillPath.length) * 100) : 0;

  // At max level, the user no longer gains skill points by leveling.
  const nextSkill = state.level >= (build.maxLevel ?? 70)
    ? skillPath.find(e => !state.skillChecked[e.skillPoint] && !state.ignoredSkills?.[e.skillPoint])
    : skillPath.find(e => !state.skillChecked[e.skillPoint] && !state.ignoredSkills?.[e.skillPoint] && e.skillPoint <= spEarned + 1);

  // Mobalytics stores paragon nodes in path order.
  // paragonLevel = already spent/earned paragon points, so the next node is at this index.
  const nextParagonNode = paragonUnlocked ? paragonPath[state.paragonLevel] : null;
  const currentBoard = nextParagonNode
    ? boards.find(b => b.slug === nextParagonNode.boardSlug) ?? boards[curBoardIdx]
    : boards[curBoardIdx];

  const visibleEquipment = (build.equipment ?? []).filter(e => !state.equipmentChecked?.[e.id ?? e.slug ?? e.name]);
  const buildPct = Math.round((
    doneSkills +
    doneGlyphs +
    Object.values(state.equipmentChecked ?? {}).filter(Boolean).length
  ) / Math.max(1, skillPath.length + boards.length + (build.equipment?.length ?? 0)) * 100);

  const avgPower = avgItemPower(state.itemPower);
  const glyphAverage = avgGlyphLevel(state.glyphLevels);
  const resStats = resistanceStats(state.resistances);
  const gearCheckedCount = Object.values(state.equipmentChecked ?? {}).filter(Boolean).length;
  const readiness = readinessScore({
    level: state.level,
    paragonLevel: state.paragonLevel,
    avgPower,
    difficulty: state.difficulty,
    doneGlyphs,
    boardsCount: boards.length,
    gearCheckedCount,
    gearCount: build.equipment?.length ?? 0,
    pitDeaths: state.pitDeaths,
    pitResult: state.pitResult,
    avgGlyph: glyphAverage,
    resistAverage: resStats.average,
    resistLowest: resStats.lowest,
    resistFilled: resStats.filled,
  });
  const advice = progressionAdvice({
    difficulty: state.difficulty || "Pénitence",
    readiness,
    avgPower,
    paragonLevel: state.paragonLevel,
    doneGlyphs,
    boardsCount: boards.length,
    pitDeaths: state.pitDeaths,
    pitResult: state.pitResult,
    pitLevel: state.pitLevel,
    avgGlyph: glyphAverage,
    resistAverage: resStats.average,
    resistLowest: resStats.lowest,
    resistFilled: resStats.filled,
  });
  const adventurePlan = nextBestAction({
    state,
    advice,
    glyphPlan: glyphProgress(state.glyphLevels),
    resStats,
    avgPower,
  });

  const immediateAction = bestImmediateAction({
    nextSkill,
    nextParagonNode,
    visibleEquipment,
    level: state.level,
    maxLevel: build.maxLevel ?? 70,
  });

  function validateCurrentSkill() {
    if (!nextSkill) return;
    set({
      skillChecked: {
        ...state.skillChecked,
        [nextSkill.skillPoint]: true,
      },
    });
  }

  function skipCurrentSkill() {
    if (!nextSkill) return;
    set({
      ignoredSkills: {
        ...(state.ignoredSkills ?? {}),
        [nextSkill.skillPoint]: true,
      },
    });
  }

  function resetSkillValidation() {
    set({
      skillChecked: {},
      ignoredSkills: {},
    });
  }

  if (state.g9) {
    return (
      <G9Mode
        state={state}
        set={set}
        immediateAction={immediateAction}
        buildPct={buildPct}
        nextSkill={nextSkill}
        nextParagonNode={nextParagonNode}
        currentBoard={currentBoard}
        build={build}
        onValidateSkill={validateCurrentSkill}
        onSkipSkill={skipCurrentSkill}
        onResetSkills={resetSkillValidation}
        advice={advice}
        readiness={readiness}
        avgPower={avgPower}
        adventurePlan={adventurePlan}
      />
    );
  }

  const visibleSkills = skillPath.filter(e =>
    !(state.hideDone && state.skillChecked[e.skillPoint])
  );

  return (
    <div className={`app ${state.tab === "talion" ? "app-wide" : ""}`}>

      {/* Header */}
      <header className="hdr">
        <div className="hdr-left">
          <span className="hdr-logo">D4</span>
          <div>
            <h1>{build.buildName}</h1>
            <p className="hdr-sub">
              <span className={`provider-badge ${build.provider ?? "mobalytics"}`}>{build.provider === "talion" ? "Talion" : "Mobalytics"}</span>
              par {build.author} · {build.totalSkillPoints} skill pts · {build.totalParagonNodes} nœuds paragon
            </p>
          </div>
        </div>
        <div className="hdr-ring">
          <svg viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="16" fill="none" stroke="#1e2433" strokeWidth="4"/>
            <circle cx="20" cy="20" r="16" fill="none" stroke="#e85d3a" strokeWidth="4"
              strokeDasharray={`${pct} 100`} strokeLinecap="round"
              transform="rotate(-90 20 20)"
              style={{transition:"stroke-dasharray .4s"}}
            />
          </svg>
          <span>{pct}%</span>
        </div>
      </header>

      <ImportBar compact onImported={refreshBuild} />

      <TopProgressHud
        state={state}
        set={set}
        advice={advice}
        readiness={readiness}
        avgPower={avgPower}
        maxLevel={build.maxLevel ?? 70}
      />

      {/* Level controls */}
      <section className="levels">
        <LevelSlider label="Niveau perso" icon="🧙" value={state.level} max={build.maxLevel ?? 70} onChange={v => set({ level: v })} />
        <LevelSlider label="Niveau paragon" icon="🧩" value={state.paragonLevel} max={300} onChange={v => set({ paragonLevel: v })} />
        <div className="level-info">
          <span>⚡ {state.level >= (build.maxLevel ?? 70) ? "cap talents atteint" : `${spEarned} skill points débloqués`}</span>
          <span>🧩 Parangon : {doneParagonNodes}/{paragonPath.length} nœuds</span>
          <span>🗺 Plateau : {currentBoard?.name ?? "—"}</span>
          <span>🔥 Difficulté : {state.difficulty || "Pénitence"}</span>
          <span>🎽 ilvl moy. : {avgPower || "—"}</span>
          <span>✅ {doneSkills}/{skillPath.length} skills · {doneGlyphs}/{boards.length} glyphes</span>
        </div>
      </section>

      {/* Next actions */}
      <section className="nexts">
        <NextBox label="⚔️ PROCHAIN SKILL" color="#e85d3a">
          {nextSkill ? (
            <div className="next-skill">
              {nextSkill.icon && <img src={nextSkill.icon} alt="" onError={e => e.target.style.display="none"} />}
              <div>
                <strong>{nextSkill.name}</strong>
                <span className="muted"> · SP {nextSkill.skillPoint}</span>
                {nextSkill.isNew && <span className="tag new">NEW</span>}
                {nextSkill.isUpgrade && <span className="tag up">rank {nextSkill.rank}/{nextSkill.maxRank}</span>}
                <div style={{color: SECTION_COLOR[nextSkill.section], fontSize:"0.8em", marginTop:2}}>
                  {SECTION_ICON[nextSkill.section]} {nextSkill.section}
                </div>
              </div>
            </div>
          ) : <span className="muted">Tous les skills pris ✓</span>}
        </NextBox>

        <NextBox label="🧩 PROCHAIN PARAGON" color="#c084fc">
          {nextParagonNode ? (
            <div className="next-paragon">
              <strong>Nœud {nextParagonNode.point}</strong>
              <span className="muted"> · {nextParagonNode.boardName}</span>
              <div style={{fontSize:"0.8em",marginTop:2,color:"#94a3b8"}}>
                📍 x{nextParagonNode.x}, y{nextParagonNode.y}
                {nextParagonNode.glyphName ? ` · 🔷 route ${nextParagonNode.glyphName}` : ""}
              </div>
            </div>
          ) : (
            <span className="muted">
              {paragonUnlocked ? "Tous les nœuds du path sont couverts ✓" : `Paragon débloqué au niveau ${build.paragonUnlockLevel ?? 70}`}
            </span>
          )}
        </NextBox>
      </section>

      {/* Tabs */}
      <nav className="tabs">
        {[["focus","🎯 Focus"],["skills","⚔️ Skills"],["paragon","🧩 Paragon"],["gear","🎽 Équipement"],["talismans","🧿 Talismans"],["merc","⚔️ Mercenaire"], ...(build.talion ? [["talion","📜 Guide Talion"]] : [])].map(([id, lbl]) => (
          <button key={id} className={`tab${state.tab===id?" on":""}`} onClick={() => set({ tab: id })}>{lbl}</button>
        ))}
        <button className="tab g9-toggle" onClick={() => set({ g9: true })}>🖥️ Mode G9</button>
        <button className={`tab filter${state.hideDone?" on":""}`} onClick={() => set({ hideDone: !state.hideDone })}>
          {state.hideDone ? "👁 Tout voir" : "✓ Cacher faits"}
        </button>
        <button className="tab reset" onClick={() => { if(confirm("Reset ?")) set({ skillChecked:{}, glyphChecked:{}, equipmentChecked:{}, ignoredSkills:{} }); }}>🔄</button>
      </nav>

      {/* Focus */}
      {state.tab === "focus" && (
        <main>
          <AdventureDirectorPanel state={state} set={set} plan={adventurePlan} />

          <SessionFocusCard
            action={immediateAction}
            buildPct={buildPct}
            paragonLevel={state.paragonLevel}
            level={state.level}
            onValidateSkill={validateCurrentSkill}
            onSkipSkill={skipCurrentSkill}
            onResetSkills={resetSkillValidation}
          />

          <ProgressionAssistantPanel
            state={state}
            set={set}
            advice={advice}
            readiness={readiness}
            avgPower={avgPower}
          />

          <section className="coach-columns">
            <GearPowerPanel state={state} set={set} avgPower={avgPower} />
            <PitTracker state={state} set={set} advice={advice} />
          </section>

          {build.talion && (
            <>
              <TalionSessionFocus build={build} state={state} set={set} />
              <section className="panel talion-focus-note">
                <h3>📜 Build Talion détecté</h3>
                <p>Talion fournit surtout le build sous forme de guide HTML et images intégrées. Utilise le <strong>Focus Mode</strong> ci-dessus pour ouvrir directement Arbre / Parangon / Stuff dans le mode G9.</p>
              </section>
            </>
          )}

          <section className="focus-grid">
            <div className="panel">
              <h3>Sources / obtention à surveiller</h3>
              {(visibleEquipment ?? []).slice(0, 10).map(item => {
                const key = item.id ?? item.slug ?? item.name;
                return (
                  <AspectSourceCard key={key} item={item}
                    checked={!!state.equipmentChecked?.[key]}
                    onCheck={v => set({ equipmentChecked: { ...(state.equipmentChecked ?? {}), [key]: v } })}
                  />
                );
              })}
            </div>

            <div className="panel">
              <h3>Lecture noob friendly</h3>
              <div className="coach-note">
                <strong>Priorité réelle post-70</strong>
                <p>Ton niveau perso ne monte plus : la progression vient surtout du parangon, des glyphes, des aspects et du stuff.</p>
              </div>
              <div className="coach-note">
                <strong>Ne chase pas tout</strong>
                <p>Survie + ressource d’abord. Les gros dégâts sont excellents, mais seulement si le build tient debout.</p>
              </div>
              <div className="coach-note">
                <strong>Routine simple</strong>
                <p>Joue 30 min, coche ce que tu as vraiment équipé, puis laisse l’action immédiate changer toute seule.</p>
              </div>
            </div>
          </section>
        </main>
      )}

      {/* Skills */}
      {state.tab === "skills" && (
        <main>
          <div className="legend">
            {Object.entries(SECTION_COLOR).map(([s,c]) => (
              <span key={s} className="leg-item"><span className="leg-dot" style={{background:c}}/>{s}</span>
            ))}
          </div>
          <div className="sk-list">
            {visibleSkills.map(e => (
              <SkillRow key={e.skillPoint} entry={e}
                done={!!state.skillChecked[e.skillPoint]}
                isCurrent={nextSkill?.skillPoint === e.skillPoint}
                onToggle={v => set({ skillChecked: { ...state.skillChecked, [e.skillPoint]: v } })}
              />
            ))}
            {visibleSkills.length === 0 && <div className="empty">Tous les skills cochés 🎉</div>}
          </div>
        </main>
      )}

      {/* Paragon */}
      {state.tab === "paragon" && (
        <main>
          {state.level < (build.paragonUnlockLevel ?? 70) && (
            <div className="warn">🔒 Paragon débloqué au niveau {build.paragonUnlockLevel ?? 70} (tu es niveau {state.level})</div>
          )}

          {nextParagonNode && (
            <div className="paragon-focus">
              <div>
                <span className="muted small">PROCHAIN POINT PARAGON</span>
                <h3>Nœud {nextParagonNode.point} · {nextParagonNode.boardName}</h3>
                <p>📍 Coordonnées Mobalytics : x{nextParagonNode.x}, y{nextParagonNode.y}</p>
                <p>🧩 Plateau : {currentBoard?.name ?? nextParagonNode.boardName}</p>
                {nextParagonNode.glyphName && <p>🔷 Route du glyphe : {nextParagonNode.glyphName}</p>}
              </div>
              <span className="tag current">PARAGON {state.paragonLevel}</span>
            </div>
          )}

          <div className="boards-grid">
            {boards.map((b, i) => (
              <BoardCard key={b.slug} board={b}
                isActive={currentBoard?.slug === b.slug && state.level >= (build.paragonUnlockLevel ?? 70)}
                done={!!state.glyphChecked[b.glyph]}
                onToggle={v => set({ glyphChecked: { ...state.glyphChecked, [b.glyph]: v } })}
              />
            ))}
          </div>

          <ParagonBoardMap
            paragonPath={paragonPath}
            paragonLevel={state.paragonLevel}
            currentBoard={currentBoard}
            nextNode={nextParagonNode}
          />

          <div className="paragon-path compact">
            <h3>Prochains points à poser</h3>
            {(paragonPath ?? []).slice(
              state.paragonLevel,
              Math.min(paragonPath.length, state.paragonLevel + 10)
            ).map(node => (
              <ParagonNodeRow key={`${node.slug}-${node.point}`} node={node}
                isCurrent={nextParagonNode?.point === node.point}
                isDone={node.point <= state.paragonLevel}
              />
            ))}
          </div>

          {build.paragonPriority?.length > 0 && (
            <div className="glyph-order">
              <h3>Ordre de montée des glyphes</h3>
              {build.paragonPriority.map(g => (
                <div key={g.slug} className={`glyph-row${state.glyphChecked[g.slug]?" done":""}`}>
                  <span className="glyph-n">{g.order}</span>
                  <span className="glyph-name">🔷 {g.name}</span>
                  <span className="glyph-board muted">{g.board}</span>
                  <input type="checkbox" checked={!!state.glyphChecked[g.slug]}
                    onChange={e => set({ glyphChecked: { ...state.glyphChecked, [g.slug]: e.target.checked } })}
                    onClick={e => e.stopPropagation()} />
                </div>
              ))}
            </div>
          )}
          <p className="muted small" style={{padding:"0 16px"}}>{paragonPath.length || build.totalParagonNodes} nœuds paragon au total · affichage centré autour de ton niveau parangon</p>
        </main>
      )}

      {/* Gear */}
      {state.tab === "gear" && (
        <main>
          <div className="gear-list">
            {(build.equipment ?? []).map(item => (
              <div key={item.slug} className="gear-row">
                <span className="gear-n">{item.order}</span>
                <div className="gear-ico">
                  {item.icon
                    ? <img src={item.icon} alt="" onError={e => e.target.style.display="none"} />
                    : <span>🎽</span>}
                </div>
                <div className="gear-body">
                  <strong>{item.name}</strong>
                  <span className="muted"> ({item.type})</span>
                  {item.modifiers?.length > 0 && (
                    <div className="gear-mods">
                      {item.modifiers.map((m,i) => (
                        <span key={i} className={`mod ${m.type}`}>{m.name}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </main>
      )}

      {/* Talismans */}
      {state.tab === "talismans" && (
        <main>
          <div className="talisman-section">
            <h3>Sceau de saison</h3>
            <div className="talisman-grid">
              {(build.talismans ?? []).filter(t => t.category === "Sceau").map(t => (
                <div key={t.slug} className="talisman-card seal">
                  <div className="talisman-ico">
                    {t.icon ? <img src={t.icon} alt="" onError={e => e.target.style.display="none"} /> : <span>🔑</span>}
                  </div>
                  <div className="talisman-body">
                    <strong>{t.name}</strong>
                    <span className="muted">{t.category}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="talisman-section">
            <h3>Charmes</h3>
            <div className="talisman-grid">
              {(build.talismans ?? []).filter(t => t.category === "Charme").map((t, i) => (
                <div key={t.slug} className="talisman-card charm">
                  <div className="talisman-order">{i + 1}</div>
                  <div className="talisman-ico">
                    {t.icon ? <img src={t.icon} alt="" onError={e => e.target.style.display="none"} /> : <span>🧿</span>}
                  </div>
                  <div className="talisman-body">
                    <strong>{t.name}</strong>
                    <span className="muted talisman-type">{t.type}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      )}

      {/* Mercenary */}
      {state.tab === "merc" && build.mercenary && (
        <main>
          <div className="merc-section">
            <div className="merc-cards">
              <div className="merc-card primary">
                <div className="merc-role">⚔️ Mercenaire principal</div>
                <strong className="merc-name">{build.mercenary.primary.name}</strong>
                {build.mercenary.skill && (
                  <div className="merc-skill">🎯 Skill : <span>{build.mercenary.skill}</span></div>
                )}
                {build.mercenary.opportunity && (
                  <div className="merc-skill muted">💡 Opportunité : <span>{build.mercenary.opportunity}</span></div>
                )}
              </div>
              <div className="merc-card reinforcement">
                <div className="merc-role">🛡️ Renfort</div>
                <strong className="merc-name">{build.mercenary.reinforcement.name}</strong>
              </div>
            </div>

            <h3>Arbre de compétences</h3>
            <div className="merc-skills">
              {(build.mercenary.skillTree ?? []).map((s, i) => (
                <div key={i} className="merc-skill-row">
                  <span className="merc-skill-n">{i + 1}</span>
                  <span className="merc-skill-action">{s.action === "ACTIVATE" ? "✅" : "○"}</span>
                  <span className="merc-skill-name">{s.name}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="equip-full-section">
            <h3>🎽 Équipement complet</h3>
            <div className="equip-full-grid">
              {(build.equipFull ?? []).map(item => (
                <div key={item.slot} className={`equip-card ${item.isAspect ? "aspect" : ""} ${item.isUnique ? "unique" : ""}`}
                  style={{"--item-color": item.color || (item.isAspect ? "#d98c3c" : item.isUnique ? "#cda1d8" : "#8899aa")}}>
                  <div className="equip-slot">{item.slotLabel}</div>
                  <div className="equip-card-body">
                    <div className="equip-card-ico">
                      {item.icon ? <img src={item.icon} alt="" onError={e => e.target.style.display="none"} /> : <span>🎽</span>}
                    </div>
                    <div>
                      <div className="equip-card-name" style={{color: item.color || "inherit"}}>{item.name}</div>
                      <div className="equip-card-type muted">{item.isAspect ? "Aspect" : item.isUnique ? "Unique" : item.type}</div>
                      <div className="equip-card-stats">
                        {item.gearStats.map((s, si) => (
                          <span key={si} className={`stat-tag ${s.isGreater ? "greater" : ""} ${s.isMasterwork ? "masterwork" : ""}`}>
                            {s.isGreater ? ">" : ""}{s.name}{s.isMasterwork ? " ★" : ""}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      )}

      {/* Talion guide */}
      {state.tab === "talion" && build.talion && (
        <TalionGuide build={build} />
      )}

      {/* Footer */}
      <footer className="footer">
        <span className="muted small">Importé le {new Date(build.importedAt).toLocaleDateString("fr-FR")} depuis {build.sourceUrl ? <a href={build.sourceUrl} target="_blank" rel="noreferrer">{build.provider === "talion" ? "Talion" : "Mobalytics"}</a> : (build.provider === "talion" ? "Talion local" : "fichier local")}</span>
        <span className="muted small">D4 Companion v32-adventure-director</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
