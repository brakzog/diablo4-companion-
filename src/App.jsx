
import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const LS_KEY = "d4-lite-companion-v12-state";

const defaultSkillPath = [
  { level: "70", name: "Dread Claws", type: "core", why: "Mécanique principale du build : vérifie que tu as bien la base du setup." },
  { level: "70+", name: "Command Fallen", type: "core", why: "Élément central de la rotation / synergie du build." },
  { level: "70+", name: "Nether Step", type: "mobility", why: "Mobilité et confort : utile pour fluidifier les combats." },
  { level: "70+", name: "Profane Sentinel", type: "synergy", why: "Synergie importante à comparer avec la variante choisie." }
];

const defaultParagonPath = [
  { step: 1, name: "Plateau de départ", type: "board", why: "Commence par sécuriser les premiers nœuds utiles et le chemin vers le socket." },
  { step: 2, name: "Premier glyphe utile", type: "glyph", why: "Place le glyphe conseillé par le guide et commence à le monter." },
  { step: 3, name: "Nœuds rares proches", type: "rare", why: "Prends les rares qui apportent survie/ressource avant le min-max." }
];

const defaultGoals = [
  { id:"goal:aspect-du-peril", type:"gear", name:"Aspect du péril", action:"Trouver puis équiper : Aspect du péril", why:"Aide à stabiliser le build. Prioritaire si tu galères en Pénitence.", priority:"CORE", kind:"survie", icon:"🛡" },
  { id:"goal:maximum-ressource", type:"gear", name:"Maximum ressource", action:"Trouver puis équiper : Maximum ressource", why:"Évite de tomber à court de ressource pendant les combats.", priority:"CORE", kind:"fluidité", icon:"⚡" }
];

const defaultState = {
  level: 70,
  mode: "Transition endgame",
  build: {
    title: "Aucun build importé",
    description: "Importe une URL Mobalytics / Maxroll / D4Builds.",
    goals: defaultGoals,
    skillPath: defaultSkillPath,
    paragonPath: defaultParagonPath,
    parserNote: "Fallback local."
  },
  goalState: {},
  skillState: {},
  paragonState: {},
  hideDone: true,
  g9: false
};

function loadState() {
  try {
    return { ...defaultState, ...JSON.parse(localStorage.getItem(LS_KEY) || "{}") };
  } catch {
    return defaultState;
  }
}

function saveState(state) {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function normalize(value) {
  return String(value || "").toLowerCase().trim();
}

function rank(priority) {
  return { CORE: 0, IMPORTANT: 1, CONFORT: 2, ENDGAME: 3 }[priority] ?? 9;
}

function visibleGoals(state, goals) {
  const sorted = [...(goals || [])].sort((a, b) => rank(a.priority) - rank(b.priority));
  if (!state.hideDone) return sorted;
  return sorted.filter(g => !state.goalState[g.id]?.equipped);
}

function completion(state) {
  const goals = state.build.goals || [];
  const skillPath = state.build.skillPath || [];
  const paragonPath = state.build.paragonPath || [];
  const total = goals.length + skillPath.length + paragonPath.length;
  if (!total) return 0;

  const doneGoals = goals.filter(g => state.goalState[g.id]?.equipped).length;
  const doneSkills = skillPath.filter((_, i) => state.skillState[`skill:${i}`]).length;
  const doneParagon = paragonPath.filter((_, i) => state.paragonState[`paragon:${i}`]).length;

  return Math.round((doneGoals + doneSkills + doneParagon) / total * 100);
}

function phase(state) {
  if (state.level < 50) return "Leveling";
  if (state.level < 70) return "Midgame";
  if (state.level >= 70 && completion(state) < 45) return "Transition endgame";
  return "Early endgame";
}

function nextSkill(state) {
  const path = state.build.skillPath || [];
  const idx = path.findIndex((_, i) => !state.skillState[`skill:${i}`]);
  return idx >= 0 ? { index: idx, item: path[idx] } : null;
}

function nextParagon(state) {
  const path = state.build.paragonPath || [];
  const idx = path.findIndex((_, i) => !state.paragonState[`paragon:${i}`]);
  return idx >= 0 ? { index: idx, item: path[idx] } : null;
}

function iconForType(type) {
  if (type === "core") return "🔥";
  if (type === "mobility") return "👟";
  if (type === "damage") return "💥";
  if (type === "glyph") return "🔷";
  if (type === "board") return "🧩";
  if (type === "rare") return "🟡";
  return "🔗";
}

function Panel({ title, count, children }) {
  return <section className="card"><h2>{title} {count !== undefined && <span className="pill">{count}</span>}</h2>{children}</section>;
}

function Badge({ children, type }) {
  return <span className={`badge ${String(type || "").toLowerCase()}`}>{children}</span>;
}

function GoalCard({ goal, state, setGoal }) {
  const status = state.goalState[goal.id] || {};
  const patch = change => setGoal(goal.id, { ...status, ...change });
  return (
    <article className={"goal " + (status.equipped ? "done" : "")}>
      <div className="goalIcon">{goal.icon}</div>
      <div className="goalBody">
        <div className="goalTop">
          <strong>{goal.action}</strong>
          <div className="badges"><Badge type={goal.priority}>{goal.priority}</Badge><Badge>{goal.kind}</Badge></div>
        </div>
        <p>{goal.why}</p>
        <div className="checks">
          <label><input type="checkbox" checked={!!status.obtained} onChange={e => patch({ obtained: e.target.checked })} /> obtenu</label>
          <label><input type="checkbox" checked={!!status.equipped} onChange={e => patch({ equipped: e.target.checked, obtained: e.target.checked ? true : status.obtained })} /> équipé / validé</label>
        </div>
      </div>
    </article>
  );
}

function PathRow({ item, index, done, onToggle, mode }) {
  return (
    <article className={"pathRow " + (done ? "done" : "")}>
      <div className="pathIcon">{mode === "skill" ? iconForType(item.type) : iconForType(item.type)}</div>
      <div className="pathBody">
        <div className="goalTop">
          <strong>{mode === "skill" ? `${item.level} — ${item.name}` : `Étape ${item.step} — ${item.name}`}</strong>
          <Badge>{item.type}</Badge>
        </div>
        <p>{item.why}</p>
        <label className="pathCheck"><input type="checkbox" checked={done} onChange={e => onToggle(e.target.checked)} /> fait / pris</label>
      </div>
    </article>
  );
}

function timeline(level) {
  return [
    ["1-20", "Fondations", "générateur, core skill, survie simple", level >= 1 && level <= 20],
    ["20-35", "Ressource", "fluidité, mobilité, premières synergies", level > 20 && level <= 35],
    ["35-50", "Build leveling", "rotation et premiers aspects", level > 35 && level <= 50],
    ["50-70", "Midgame", "aspects CORE/IMPORTANT et survie", level > 50 && level < 70],
    ["70+", "Transition endgame", "parangon, glyphes, stats offensives", level >= 70]
  ];
}

function App() {
  const [state, setState] = useState(loadState);
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [tab, setTab] = useState("progression");

  useEffect(() => saveState(state), [state]);

  const pct = completion(state);
  const ns = nextSkill(state);
  const np = nextParagon(state);
  const goals = visibleGoals(state, state.build.goals || []);

  function update(partial) {
    setState(s => ({ ...s, ...partial }));
  }

  function setGoal(id, value) {
    setState(s => ({ ...s, goalState: { ...s.goalState, [id]: value } }));
  }

  function setSkill(index, value) {
    setState(s => ({ ...s, skillState: { ...s.skillState, [`skill:${index}`]: value } }));
  }

  function setParagon(index, value) {
    setState(s => ({ ...s, paragonState: { ...s.paragonState, [`paragon:${index}`]: value } }));
  }

  async function importBuild() {
    if (!url) return;
    setStatus("Import en cours...");
    try {
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Erreur import");
      setState(s => ({ ...s, build: data, goalState: {}, skillState: {}, paragonState: {} }));
      setStatus("Build importé");
    } catch (e) {
      setStatus("Erreur import : " + e.message);
    }
  }

  if (state.g9) {
    return (
      <div className="app g9">
        <header>
          <div><h1>D4 Lite <small>v12</small></h1><p>{phase(state)} · {pct}%</p></div>
          <button onClick={() => update({ g9: false })}>Vue complète</button>
        </header>
        <Panel title="NEXT SKILL POINT">
          {ns ? <PathRow item={ns.item} index={ns.index} mode="skill" done={!!state.skillState[`skill:${ns.index}`]} onToggle={v => setSkill(ns.index, v)} /> : <div className="summaryBox">Skill path terminé.</div>}
        </Panel>
        <Panel title="NEXT PARAGON">
          {np ? <PathRow item={np.item} index={np.index} mode="paragon" done={!!state.paragonState[`paragon:${np.index}`]} onToggle={v => setParagon(np.index, v)} /> : <div className="summaryBox">Paragon path terminé.</div>}
        </Panel>
        <Panel title="Objectifs build">{goals.slice(0, 4).map(g => <GoalCard key={g.id} goal={g} state={state} setGoal={setGoal} />)}</Panel>
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <div>
          <h1>D4 Lite Companion <small>v12 skill/paragon path</small></h1>
          <p>Preview centrée sur Skill Tree Path + Paragon Path. Parsing exact Mobalytics encore best-effort.</p>
        </div>
        <div className="headerActions">
          <button onClick={() => update({ g9: true })}>Mode G9</button>
          <button onClick={() => update({ hideDone: !state.hideDone })}>{state.hideDone ? "Afficher validés" : "Cacher validés"}</button>
          <button onClick={() => update({ goalState: {}, skillState: {}, paragonState: {} })}>Reset progression</button>
          <span className="saved">Sauvé localement</span>
        </div>
      </header>

      <section className="topGrid">
        <Panel title="Importer">
          <label>URL Mobalytics / Maxroll / D4Builds</label>
          <div className="row">
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://mobalytics.gg/diablo-4/builds/..." />
            <button onClick={importBuild}>Importer</button>
          </div>
          <p className="muted">{status || "Import best-effort. Si le vrai path n’est pas lisible, fallback intelligent."}</p>
        </Panel>
        <Panel title="Mon perso">
          <div className="two">
            <label>Niveau<input type="number" value={state.level} onChange={e => update({ level: Number(e.target.value) })} /></label>
            <label>Mode<select value={state.mode} onChange={e => update({ mode: e.target.value })}><option>Leveling</option><option>Midgame / Pénitence</option><option>Transition endgame</option><option>Torment / Endgame</option></select></label>
          </div>
          <div className="summaryBox">Phase actuelle : <b>{phase(state)}</b> · progression {pct}%</div>
          <div className="summaryBox">{state.build.parserNote}</div>
        </Panel>
      </section>

      <Panel title={state.build.title}>
        <p>{state.build.description}</p>
        <div className="sessionSummary">
          <b>{phase(state)}</b>
          <span>Progression globale : {pct}%</span>
          <span>Skill path : {(state.build.skillPath || []).filter((_, i) => state.skillState[`skill:${i}`]).length}/{(state.build.skillPath || []).length}</span>
          <span>Parangon : {(state.build.paragonPath || []).filter((_, i) => state.paragonState[`paragon:${i}`]).length}/{(state.build.paragonPath || []).length}</span>
        </div>
      </Panel>

      <nav>{[
        ["progression", "Progression"],
        ["skills", "Skill Tree Path"],
        ["paragon", "Paragon Path"],
        ["goals", "Objectifs build"],
        ["debug", "Debug"]
      ].map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</nav>

      {tab === "progression" && (
        <main className="threeGrid">
          <Panel title="Timeline">
            {timeline(state.level).map(([range, title, detail, active]) => <div key={range} className={"timeline " + (active ? "active" : "")}><b>{range} — {title}</b><p>{detail}</p></div>)}
          </Panel>
          <Panel title="NEXT SKILL POINT">
            {ns ? <PathRow item={ns.item} index={ns.index} mode="skill" done={!!state.skillState[`skill:${ns.index}`]} onToggle={v => setSkill(ns.index, v)} /> : <div className="summaryBox">Skill path terminé.</div>}
          </Panel>
          <Panel title="NEXT PARAGON">
            {np ? <PathRow item={np.item} index={np.index} mode="paragon" done={!!state.paragonState[`paragon:${np.index}`]} onToggle={v => setParagon(np.index, v)} /> : <div className="summaryBox">Paragon path terminé.</div>}
          </Panel>
        </main>
      )}

      {tab === "skills" && (
        <main className="twoGrid">
          <Panel title="Skill Tree Path" count={(state.build.skillPath || []).length}>
            {(state.build.skillPath || []).map((item, i) => <PathRow key={i} item={item} index={i} mode="skill" done={!!state.skillState[`skill:${i}`]} onToggle={v => setSkill(i, v)} />)}
          </Panel>
          <Panel title="Lecture">
            <div className="summaryBox">Cette vue doit remplacer le “je dois prendre quoi maintenant ?”.</div>
            <div className="summaryBox">Si le guide ne livre pas son ordre exact, l’app affiche au moins les éléments détectés et un ordre raisonnable.</div>
          </Panel>
        </main>
      )}

      {tab === "paragon" && (
        <main className="twoGrid">
          <Panel title="Paragon Path" count={(state.build.paragonPath || []).length}>
            {(state.build.paragonPath || []).map((item, i) => <PathRow key={i} item={item} index={i} mode="paragon" done={!!state.paragonState[`paragon:${i}`]} onToggle={v => setParagon(i, v)} />)}
          </Panel>
          <Panel title="Limite actuelle">
            <div className="summaryBox">V12 affiche un chemin par étapes.</div>
            <div className="summaryBox">Le vrai “node par node” demandera d’extraire plus précisément le format interne du planner Mobalytics.</div>
          </Panel>
        </main>
      )}

      {tab === "goals" && (
        <main className="threeGrid">
          <Panel title="CORE / IMPORTANT">
            {goals.filter(g => g.priority === "CORE" || g.priority === "IMPORTANT").map(g => <GoalCard key={g.id} goal={g} state={state} setGoal={setGoal} />)}
          </Panel>
          <Panel title="CONFORT">
            {goals.filter(g => g.priority === "CONFORT").map(g => <GoalCard key={g.id} goal={g} state={state} setGoal={setGoal} />)}
          </Panel>
          <Panel title="ENDGAME">
            {goals.filter(g => g.priority === "ENDGAME").map(g => <GoalCard key={g.id} goal={g} state={state} setGoal={setGoal} />)}
          </Panel>
        </main>
      )}

      {tab === "debug" && <main className="card"><h2>Debug</h2><pre>{JSON.stringify(state.build, null, 2)}</pre></main>}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
