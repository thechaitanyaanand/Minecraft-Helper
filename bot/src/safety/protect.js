'use strict';

/**
 * Checks if a block name represents player-crafted/building material (§10.3).
 * @param {string} name - Block name
 * @returns {boolean}
 */
function isProtectedBlockName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.endsWith('_planks') || name.endsWith('_door') || name.endsWith('_bed')) return true;
  if (name.startsWith('glass') || name.includes('stained_glass') || name.includes('glass_pane')) return true;
  if (['chest', 'trapped_chest', 'ender_chest', 'barrel', 'furnace', 'blast_furnace', 'smoker', 'crafting_table'].includes(name)) return true;
  if (name.includes('torch')) return true;
  if (name.endsWith('_wool') || name.endsWith('_carpet')) return true;
  if (name.includes('bricks') || name.endsWith('_stairs') || name.endsWith('_slab')) return true;
  if (name.includes('fence')) return true;
  return false;
}

/**
 * Never break player builds (§10.3).
 * @param {object} block - Mineflayer Block object
 * @param {object} [ctx] - { protectedPositions, placedByOwner }
 * @returns {boolean}
 */
function isProtected(block, ctx = {}) {
  if (!block) return false;
  const name = block.name;

  if (isProtectedBlockName(name)) {
    return true;
  }

  const pos = block.position;
  if (!pos) return false;

  // Protected positions radius (8 blocks of chest or bed)
  if (ctx.protectedPositions && Array.isArray(ctx.protectedPositions)) {
    for (const p of ctx.protectedPositions) {
      if (!p) continue;
      const dist = typeof pos.distanceTo === 'function'
        ? pos.distanceTo(p)
        : Math.hypot(pos.x - p.x, pos.y - p.y, pos.z - p.z);
      if (dist <= 8) {
        return true;
      }
    }
  }

  // Marked as placed by owner
  if (ctx.placedByOwner) {
    const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
    if (typeof ctx.placedByOwner.has === 'function' && ctx.placedByOwner.has(key)) {
      return true;
    }
  }

  return false;
}

module.exports = { isProtected, isProtectedBlockName };
