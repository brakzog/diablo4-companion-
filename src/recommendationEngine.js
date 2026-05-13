/**
 * Moteur de recommandation intelligent pour talents et paragon
 * Analyse le build actuel et suggère la prochaine étape optimale
 */

/**
 * Détermine le score de priorité d'une compétence
 * Basé sur son type et sa position dans le chemin
 */
function getSkillPriority(skill, index, totalSkills) {
  const basePriority = {
    core: 0,         // Mécanique centrale - prioritaire
    damage: 1,       // Dégâts - très important
    synergy: 2,      // Synergies - important
    mobility: 3,     // Mobilité - confort/fluidité
    comfort: 4,      // Confort général
    optional: 5      // Optionnel
  };

  const typePriority = basePriority[skill.type] ?? 9;
  
  // Les premières compétences sont plus critiques
  const progressionBonus = (totalSkills - index) * 0.5;
  
  return typePriority - progressionBonus;
}

/**
 * Détermine le score de priorité d'un nœud paragon
 */
function getParagonPriority(paragon, index, totalParagon) {
  const basePriority = {
    board: 0,        // Plateau de base - très important
    glyph: 1,        // Glyphes - important pour scalabilité
    rare: 2,         // Nœuds rares - bons stats
    epic: 3,         // Nœuds épiques - optionnels
    socket: 4        // Sockets - end-game
  };

  const typePriority = basePriority[paragon.type] ?? 9;
  
  // Les premières étapes du paragon sont critiques
  const progressionBonus = (totalParagon - index) * 0.3;
  
  return typePriority - progressionBonus;
}

/**
 * Recommande le prochain talent à prendre
 * Prend en compte : type, position, niveau du personnage
 */
export function recommendNextSkill(state) {
  const skillPath = state.build.skillPath || [];
  if (!skillPath.length) return null;

  // Trouver le premier talent non complété
  const incompleteSkills = skillPath
    .map((skill, index) => ({
      skill,
      index,
      done: !!state.skillState[`skill:${index}`],
      priority: getSkillPriority(skill, index, skillPath.length)
    }))
    .filter(item => !item.done)
    .sort((a, b) => a.priority - b.priority);

  if (!incompleteSkills.length) return null;

  const nextSkill = incompleteSkills[0];
  
  return {
    index: nextSkill.index,
    item: nextSkill.skill,
    priority: nextSkill.priority,
    reason: getSkillReason(nextSkill.skill, nextSkill.index + 1, skillPath.length),
    urgency: nextSkill.priority < 2 ? 'CRITICAL' : nextSkill.priority < 4 ? 'HIGH' : 'MEDIUM'
  };
}

/**
 * Recommande le prochain nœud paragon à prendre
 */
export function recommendNextParagon(state) {
  const paragonPath = state.build.paragonPath || [];
  if (!paragonPath.length) return null;

  const incompleteParagon = paragonPath
    .map((paragon, index) => ({
      paragon,
      index,
      done: !!state.paragonState[`paragon:${index}`],
      priority: getParagonPriority(paragon, index, paragonPath.length)
    }))
    .filter(item => !item.done)
    .sort((a, b) => a.priority - b.priority);

  if (!incompleteParagon.length) return null;

  const nextParagon = incompleteParagon[0];
  
  return {
    index: nextParagon.index,
    item: nextParagon.paragon,
    priority: nextParagon.priority,
    reason: getParagonReason(nextParagon.paragon, nextParagon.index + 1, paragonPath.length),
    urgency: nextParagon.priority < 1 ? 'CRITICAL' : nextParagon.priority < 2.5 ? 'HIGH' : 'MEDIUM'
  };
}

/**
 * Génère une explication claire pour le prochain talent
 */
function getSkillReason(skill, stepNumber, totalSteps) {
  const typeExplanations = {
    core: `Talent CORE ${stepNumber}/${totalSteps} - C'est la mécanique fondamentale de ton build. Non-négociable pour la rotation.`,
    damage: `Talent dégâts ${stepNumber}/${totalSteps} - Augmente significativement ton DPS.`,
    synergy: `Talent synergie ${stepNumber}/${totalSteps} - Crée des interactions utiles avec tes autres talents.`,
    mobility: `Talent mobilité ${stepNumber}/${totalSteps} - Améliore ta fluidité de mouvement et ta survie en zone.`,
    comfort: `Talent confort ${stepNumber}/${totalSteps} - Rend le gameplay plus fluide et agréable.`,
    optional: `Talent optionnel ${stepNumber}/${totalSteps} - À considérer selon ton confort personnel.`
  };

  return typeExplanations[skill.type] || `Talent ${stepNumber}/${totalSteps} - ${skill.why}`;
}

/**
 * Génère une explication claire pour le prochain nœud paragon
 */
function getParagonReason(paragon, stepNumber, totalSteps) {
  const typeExplanations = {
    board: `Plateau ${stepNumber}/${totalSteps} - Étape fondamentale du paragon. À faire en priorité pour la base.`,
    glyph: `Glyphe ${stepNumber}/${totalSteps} - Important pour booster tes stats via la puissance glyphée.`,
    rare: `Nœuds rares ${stepNumber}/${totalSteps} - Bons stats, utiles pour combler les gaps avant d'aller endgame.`,
    epic: `Nœuds épiques ${stepNumber}/${totalSteps} - Optimisations supplémentaires quand la base est stable.`,
    socket: `Socket ${stepNumber}/${totalSteps} - End-game. À débloquer seulement quand tu contrôles bien ton build.`
  };

  return typeExplanations[paragon.type] || `Étape ${stepNumber}/${totalSteps} - ${paragon.why}`;
}

/**
 * Donne un résumé de progression du build
 */
export function getProgressionSummary(state) {
  const skillPath = state.build.skillPath || [];
  const paragonPath = state.build.paragonPath || [];
  const goals = state.build.goals || [];

  const completedSkills = skillPath.filter((_, i) => state.skillState[`skill:${i}`]).length;
  const completedParagon = paragonPath.filter((_, i) => state.paragonState[`paragon:${i}`]).length;
  const completedGoals = goals.filter(g => state.goalState[g.id]?.equipped).length;

  return {
    skillsProgress: `${completedSkills}/${skillPath.length}`,
    paragonProgress: `${completedParagon}/${paragonPath.length}`,
    goalsProgress: `${completedGoals}/${goals.length}`,
    totalPercent: Math.round(
      (completedSkills + completedParagon + completedGoals) / 
      (skillPath.length + paragonPath.length + goals.length) * 100
    ) || 0,
    isFullyOptimized: completedSkills === skillPath.length && completedParagon === paragonPath.length
  };
}

/**
 * Détermine la phase idéale basée sur la progression
 */
export function getPhaseRecommendation(state) {
  const { skillsProgress, paragonProgress } = getProgressionSummary(state);
  const [skillDone, skillTotal] = skillsProgress.split('/').map(Number);
  const [paragonDone, paragonTotal] = paragonProgress.split('/').map(Number);
  
  const skillPercent = (skillDone / skillTotal) * 100;
  const paragonPercent = (paragonDone / paragonTotal) * 100;

  if (skillPercent < 50) {
    return {
      phase: "Leveling avancé",
      focus: "Complète d'abord ta rotation de talents",
      advice: "Les talents ont plus d'impact que le paragon à ce stade"
    };
  }
  
  if (skillPercent >= 50 && skillPercent < 100) {
    return {
      phase: "Transition endgame",
      focus: "Finis les derniers talents critiques ET commence le paragon",
      advice: "Équilibre talents et paragon pour maximiser ton scaling"
    };
  }

  if (skillPercent === 100) {
    return {
      phase: "Early endgame",
      focus: "Optimise ton paragon et tes objectifs d'équipement",
      advice: "Le paragon et les aspects deviennent tes priorités principales"
    };
  }

  return {
    phase: "Phase indéfinie",
    focus: "Continue ta progression",
    advice: "Suit le guide du build pour rester sur les rails"
  };
}
