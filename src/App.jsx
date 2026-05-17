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

function defaultState() {
  return { level: 1, paragonLevel: 0, skillChecked: {}, glyphChecked: {}, equipmentChecked: {}, tab: "focus", hideDone: false, g9: false, ignoredSkills: {} };
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
}) {
  const talionTabs = build?.talion?.guideTabs ?? [];
  const defaultTalionTitle = talionTabs.find(t => /parangon/i.test(t.title ?? ""))?.title
    ?? talionTabs.find(t => /compétence|talent|arbre/i.test(t.title ?? ""))?.title
    ?? talionTabs[0]?.title
    ?? "";
  const [activeTalionTitle, setActiveTalionTitle] = useState(defaultTalionTitle);
  const [selectedImage, setSelectedImage] = useState(null);
  const activeTalionTab = talionTabs.find(t => t.title === activeTalionTitle) ?? talionTabs[0];
  const talionImages = extractImagesFromHtml(activeTalionTab?.html ?? "");

  return (
    <div className={`g9-shell ${build?.talion ? "g9-talion-shell" : ""}`}>
      <header className="g9-header">
        <div>
          <h1>D4 Companion <small>G9</small></h1>
          <p>{build?.talion ? "Mode Talion second écran" : "Vue compacte second écran"}</p>
        </div>
        <button className="g9-exit" onClick={() => set({ g9: false })}>Vue complète</button>
      </header>

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

          <div className="g9-talion-tabs">
            {talionTabs.map(t => (
              <button
                key={t.title}
                className={activeTalionTab?.title === t.title ? "on" : ""}
                onClick={() => { setActiveTalionTitle(t.title); setSelectedImage(null); }}
              >
                {t.title}
              </button>
            ))}
          </div>

          {activeTalionTab && (
            <div className="g9-talion-current">
              <h3>{activeTalionTab.title}</h3>
              {talionImages[0] ? (
                <button className="g9-image-button" onClick={() => setSelectedImage(talionImages[0])}>
                  <img src={talionImages[0].src} alt={talionImages[0].alt} />
                  <span>🔍 ouvrir en grand</span>
                </button>
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
          <div className="talion-html" onClick={onGuideClick} dangerouslySetInnerHTML={{ __html: current.html }} />
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

      {/* Level controls */}
      <section className="levels">
        <LevelSlider label="Niveau perso" icon="🧙" value={state.level} max={build.maxLevel ?? 70} onChange={v => set({ level: v })} />
        <LevelSlider label="Niveau paragon" icon="🧩" value={state.paragonLevel} max={300} onChange={v => set({ paragonLevel: v })} />
        <div className="level-info">
          <span>⚡ {state.level >= (build.maxLevel ?? 70) ? "cap talents atteint" : `${spEarned} skill points débloqués`}</span>
          <span>🧩 Parangon : {doneParagonNodes}/{paragonPath.length} nœuds</span>
          <span>🗺 Plateau : {currentBoard?.name ?? "—"}</span>
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
          <SessionFocusCard
            action={immediateAction}
            buildPct={buildPct}
            paragonLevel={state.paragonLevel}
            level={state.level}
            onValidateSkill={validateCurrentSkill}
            onSkipSkill={skipCurrentSkill}
            onResetSkills={resetSkillValidation}
          />

          {build.talion && (
            <section className="panel talion-focus-note">
              <h3>📜 Build Talion détecté</h3>
              <p>Talion fournit surtout le build sous forme de guide HTML et images intégrées. Va dans l’onglet <strong>Guide Talion</strong> pour lire l’arbre, le parangon, l’équipement, les charmes et le filtre de butin.</p>
            </section>
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
        <span className="muted small">D4 Companion v19-tal</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
