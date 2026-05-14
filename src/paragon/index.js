/**
 * Paragon & Skill Path Builder - Main Index
 * Combines skill and paragon path extraction into one unified interface
 */

import { buildSkillPath, getSkillAtLevel, getSkillsInRange } from './skillPathBuilder.js';
import { 
  buildParagonPath, 
  getParagonNodeAt, 
  getParagonNodesByBoard,
  getParagonBoardInfo 
} from './paragonPathBuilder.js';

/**
 * Main function: Build complete path data from Mobalytics JSON
 */
export function buildCompletePath(mobalyticsData) {
  const skillPathResult = buildSkillPath(mobalyticsData);
  const paragonPathResult = buildParagonPath(mobalyticsData);

  return {
    success: !skillPathResult.error && !paragonPathResult.error,
    skillPath: skillPathResult.skillPath,
    skillPathMetadata: {
      totalLevels: skillPathResult.totalLevels,
      uniqueSkills: skillPathResult.uniqueSkills,
      error: skillPathResult.error
    },
    paragonPath: paragonPathResult.paragonPath,
    paragonPathMetadata: {
      totalNodes: paragonPathResult.totalNodes,
      startNode: paragonPathResult.startNode,
      boards: getParagonBoardInfo(mobalyticsData),
      error: paragonPathResult.error
    },
    timestamp: new Date().toISOString()
  };
}

/**
 * Export individual functions for granular access
 */
export {
  buildSkillPath,
  getSkillAtLevel,
  getSkillsInRange,
  buildParagonPath,
  getParagonNodeAt,
  getParagonNodesByBoard,
  getParagonBoardInfo
};
