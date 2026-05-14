/**
 * Paragon Path Builder
 * Extracts and builds the ordered paragon node path from a Mobalytics build JSON
 */

/**
 * Extract coordinates from paragon node slug
 * Example: "warlock-starting-board-x11-y14" -> { x: 11, y: 14, board: "starting-board" }
 */
function parseNodeSlug(slug) {
  const xMatch = slug.match(/x(-?\d+)/);
  const yMatch = slug.match(/y(-?\d+)/);
  
  if (!xMatch || !yMatch) {
    return null;
  }

  const x = parseInt(xMatch[1]);
  const y = parseInt(yMatch[1]);
  
  // Extract board type (e.g., "starting-board", "greater-hex", etc.)
  const boardMatch = slug.match(/warlock-([a-z-]+)-x/);
  const board = boardMatch ? boardMatch[1] : 'unknown';

  return { x, y, board, slug };
}

/**
 * Find adjacent nodes
 */
function getAdjacentNodes(node, allNodes) {
  return allNodes.filter(n => {
    const dx = Math.abs(n.x - node.x);
    const dy = Math.abs(n.y - node.y);
    
    // Adjacent means difference of 1 in one direction (or diagonally)
    return (dx <= 1 && dy <= 1) && !(dx === 0 && dy === 0);
  });
}

/**
 * Build ordered paragon path starting from the bottom
 */
export function buildParagonPath(buildData) {
  if (!buildData?.paragon?.nodes) {
    return {
      error: 'No paragon data found',
      paragonPath: [],
      totalNodes: 0
    };
  }

  const nodeData = buildData.paragon.nodes;
  
  // Parse all nodes
  const parsedNodes = nodeData
    .map(n => parseNodeSlug(n.slug))
    .filter(n => n !== null);

  if (parsedNodes.length === 0) {
    return {
      error: 'Could not parse paragon nodes',
      paragonPath: [],
      totalNodes: 0
    };
  }

  // Find starting node (lowest Y, then leftmost X)
  const startNode = parsedNodes.reduce((lowest, node) => {
    if (node.y > lowest.y || (node.y === lowest.y && node.x < lowest.x)) {
      return node;
    }
    return lowest;
  });

  // Build path using BFS (Breadth-First Search) from bottom to top
  const path = [];
  const visited = new Set();
  const queue = [startNode];

  while (queue.length > 0) {
    const current = queue.shift();
    const key = `${current.x},${current.y}`;

    if (visited.has(key)) continue;

    visited.add(key);
    path.push(current);

    // Find adjacent unvisited nodes
    const adjacent = getAdjacentNodes(current, parsedNodes)
      .filter(n => !visited.has(`${n.x},${n.y}`))
      .sort((a, b) => {
        // Prioritize upward movement (lower Y values = going up)
        if (a.y !== b.y) return a.y - b.y;
        return a.x - b.x;
      });

    queue.push(...adjacent);
  }

  return {
    paragonPath: path.map(p => ({
      slug: p.slug,
      x: p.x,
      y: p.y,
      board: p.board
    })),
    totalNodes: path.length,
    startNode: {
      slug: startNode.slug,
      x: startNode.x,
      y: startNode.y
    },
    error: null
  };
}

/**
 * Get paragon node info by coordinates
 */
export function getParagonNodeAt(buildData, x, y) {
  const result = buildParagonPath(buildData);
  return result.paragonPath.find(n => n.x === x && n.y === y);
}

/**
 * Get paragon nodes by board type
 */
export function getParagonNodesByBoard(buildData, boardType) {
  const result = buildParagonPath(buildData);
  return result.paragonPath.filter(n => n.board === boardType);
}

/**
 * Get paragon board info
 */
export function getParagonBoardInfo(buildData) {
  if (!buildData?.paragon?.boards) {
    return null;
  }

  return buildData.paragon.boards.map(board => ({
    slug: board.board?.slug,
    position: { x: board.x, y: board.y },
    rotation: board.rotation,
    glyph: board.glyph?.slug,
    glyphLevel: board.glyphLevel
  }));
}
