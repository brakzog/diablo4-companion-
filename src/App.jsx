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
  return { level: 1, paragonLevel: 0, skillChecked: {}, glyphChecked: {}, tab: "skills", hideDone: false };
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

function NextBox({ label, color, children }) {
  return (
    <div className="next-box" style={{ "--nc": color }}>
      <div className="next-label">{label}</div>
      <div className="next-content">{children}</div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

function App() {
  const [state, setState] = useState(load);
  const [build, setBuild] = useState(null);
  const [loading, setLoading] = useState(true);
  const [noBuild, setNoBuild] = useState(false);

  useEffect(() => { localStorage.setItem(LS_KEY, JSON.stringify(state)); }, [state]);

  useEffect(() => {
    fetch("/api/build")
      .then(r => r.json())
      .then(data => {
        if (data.error === "no_build") { setNoBuild(true); setLoading(false); return; }
        if (data.error) throw new Error(data.error);
        setBuild(data); setLoading(false);
      })
      .catch(() => { setNoBuild(true); setLoading(false); });
  }, []);

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
        <p>2. Va sur une page de build <a href="https://mobalytics.gg/diablo-4/builds" target="_blank" rel="noreferrer">Mobalytics</a></p>
        <p>3. Clique le favori <strong>D4 Companion</strong></p>
        <p className="hint">Le bookmarklet se trouve dans <code>bookmarklet.js</code> — colle la ligne BOOKMARKLET: comme URL d'un favori.</p>
      </div>
    </div>
  );

  const skillPath = build.skillPath ?? [];
  const boards    = build.boards ?? [];
  const spEarned  = levelToSP(state.level, build.maxLevel ?? 70);
  const curBoardIdx = Math.min(paragonLevelToBoard(state.paragonLevel), boards.length - 1);

  const doneSkills = skillPath.filter(e => state.skillChecked[e.skillPoint]).length;
  const doneGlyphs = boards.filter(b => state.glyphChecked[b.glyph]).length;
  const pct = skillPath.length ? Math.round((doneSkills / skillPath.length) * 100) : 0;

  // Next undone skill that's within earned SPs
  const nextSkill = skillPath.find(e => !state.skillChecked[e.skillPoint] && e.skillPoint <= spEarned + 1);
  const currentBoard = boards[curBoardIdx];

  const visibleSkills = skillPath.filter(e =>
    !(state.hideDone && state.skillChecked[e.skillPoint])
  );

  return (
    <div className="app">

      {/* Header */}
      <header className="hdr">
        <div className="hdr-left">
          <span className="hdr-logo">D4</span>
          <div>
            <h1>{build.buildName}</h1>
            <p className="hdr-sub">par {build.author} · {build.totalSkillPoints} skill pts · {build.totalParagonNodes} nœuds paragon</p>
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

      {/* Level controls */}
      <section className="levels">
        <LevelSlider label="Niveau perso" icon="🧙" value={state.level} max={build.maxLevel ?? 70} onChange={v => set({ level: v })} />
        <LevelSlider label="Niveau paragon" icon="🧩" value={state.paragonLevel} max={300} onChange={v => set({ paragonLevel: v })} />
        <div className="level-info">
          <span>⚡ {spEarned} skill points débloqués</span>
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

        <NextBox label="🔷 PROCHAIN GLYPHE" color="#c084fc">
          {currentBoard ? (
            <div>
              <strong>{currentBoard.glyphName}</strong>
              <span className="muted"> sur {currentBoard.name}</span>
              <div style={{fontSize:"0.8em",marginTop:2,color:"#94a3b8"}}>
                {state.glyphChecked[currentBoard.glyph] ? "✓ Monté" : "À monter au niveau 21+"}
              </div>
            </div>
          ) : <span className="muted">`Paragon non débloqué (lvl ${build.paragonUnlockLevel ?? 70})`</span>}
        </NextBox>
      </section>

      {/* Tabs */}
      <nav className="tabs">
        {[["skills","⚔️ Skills"],["paragon","🧩 Paragon"],["gear","🎽 Équipement"],["talismans","🧿 Talismans"],["merc","⚔️ Mercenaire"]].map(([id, lbl]) => (
          <button key={id} className={`tab${state.tab===id?" on":""}`} onClick={() => set({ tab: id })}>{lbl}</button>
        ))}
        <button className={`tab filter${state.hideDone?" on":""}`} onClick={() => set({ hideDone: !state.hideDone })}>
          {state.hideDone ? "👁 Tout voir" : "✓ Cacher faits"}
        </button>
        <button className="tab reset" onClick={() => { if(confirm("Reset ?")) set({ skillChecked:{}, glyphChecked:{} }); }}>🔄</button>
      </nav>

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
            <div className="warn">🔒 🔒 Paragon débloqué au niveau {build.paragonUnlockLevel ?? 70} (tu es niveau {state.level})</div>
          )}
          <div className="boards-grid">
            {boards.map((b, i) => (
              <BoardCard key={b.slug} board={b}
                isActive={i === curBoardIdx && state.level >= 50}
                done={!!state.glyphChecked[b.glyph]}
                onToggle={v => set({ glyphChecked: { ...state.glyphChecked, [b.glyph]: v } })}
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
          <p className="muted small">{build.totalParagonNodes} nœuds paragon au total</p>
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

      {/* Footer */}
      <footer className="footer">
        <span className="muted small">Importé le {new Date(build.importedAt).toLocaleDateString("fr-FR")} depuis {build.sourceUrl ? <a href={build.sourceUrl} target="_blank" rel="noreferrer">Mobalytics</a> : "fichier local"}</span>
        <span className="muted small">D4 Companion v13</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
