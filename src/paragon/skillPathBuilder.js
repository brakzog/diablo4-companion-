/**
 * Skill Path Builder
 * Extracts and builds the ordered skill path from a Mobalytics build JSON
 */

export function buildSkillPath(buildData) {
  if (!buildData?.skillTree?.skills) {
    return {
      error: 'No skill tree data found',
      skillPath: []
    };
  }

  const skills = buildData.skillTree.skills;
  const skillPath = [];

  // Extract skills with their levels (index represents the level)
  skills.forEach((skillItem, index) => {
    const skillSlug = skillItem.skill?.slug;
    const level = index + 1; // Levels start at 1

    if (skillSlug) {
      skillPath.push({
        slug: skillSlug,
        level: level,
        actionType: skillItem.actionType || 'ACTIVATE'
      });
    }
  });

  return {
    skillPath: skillPath,
    totalLevels: skillPath.length,
    uniqueSkills: [...new Set(skillPath.map(s => s.slug))],
    error: null
  };
}

/**
 * Get skill by level
 */
export function getSkillAtLevel(buildData, level) {
  const skillPath = buildSkillPath(buildData);
  return skillPath.skillPath.find(s => s.level === level);
}

/**
 * Get skills from level X to Y
 */
export function getSkillsInRange(buildData, startLevel, endLevel) {
  const skillPath = buildSkillPath(buildData);
  return skillPath.skillPath.filter(
    s => s.level >= startLevel && s.level <= endLevel
  );
}
