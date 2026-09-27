'use strict';
const { Vec3 } = require('vec3');
const { loadBlueprint, generatePlacements } = require('../planner/blueprint');

module.exports = {
  name: 'build_blueprint',
  describe: 'construct a building from a blueprint file',
  timeoutMs: 90_000,

  async run(bot, ctx, token, args = {}) {
    token.throwIfCancelled();
    const id = args.id || 'hut_5x5';
    let bp;
    try {
      bp = loadBlueprint(id);
    } catch (err) {
      return { ok: false, reason: 'blueprint_not_found', message: err.message };
    }

    const pos = bot.entity?.position;
    const feet = typeof pos?.floored === 'function' ? pos.floored() : new Vec3(pos?.x || 0, pos?.y || 64, pos?.z || 0).floored();
    const origin = args.origin || feet.offset(2, 0, 2);
    const placements = generatePlacements(bp, origin);

    for (const p of placements) {
      token.throwIfCancelled();
      const targetPos = new Vec3(p.x, p.y, p.z);
      const current = bot.blockAt ? bot.blockAt(targetPos) : null;
      if (current && current.name === p.blockName) continue;

      const item = bot.inventory?.items?.().find((it) => it.name === p.blockName || (p.blockName.endsWith('_planks') && it.name.endsWith('_planks')));
      if (!item) continue;

      if (bot.entity?.position && targetPos.distanceTo(bot.entity.position) > 4) {
        if (bot.pathfinder?.goto) {
          const { goals } = require('mineflayer-pathfinder');
          try { await bot.pathfinder.goto(new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 3)); } catch (_) {}
        }
      }

      if (bot.equip) {
        try { await bot.equip(item, 'hand'); } catch (_) {}
      }

      // Find an adjacent solid block to place against
      const neighbors = [
        { offset: new Vec3(0, -1, 0), face: new Vec3(0, 1, 0) },
        { offset: new Vec3(0, 1, 0), face: new Vec3(0, -1, 0) },
        { offset: new Vec3(1, 0, 0), face: new Vec3(-1, 0, 0) },
        { offset: new Vec3(-1, 0, 0), face: new Vec3(1, 0, 0) },
        { offset: new Vec3(0, 0, 1), face: new Vec3(0, 0, -1) },
        { offset: new Vec3(0, 0, -1), face: new Vec3(0, 0, 1) },
      ];

      for (const n of neighbors) {
        const refPos = targetPos.plus(n.offset);
        const refBlock = bot.blockAt ? bot.blockAt(refPos) : null;
        if (refBlock && refBlock.name !== 'air' && refBlock.name !== 'cave_air' && refBlock.name !== 'water') {
          try {
            token.throwIfCancelled();
            if (bot.placeBlock) await bot.placeBlock(refBlock, n.face);
            break;
          } catch (_) {}
        }
      }
    }

    return { ok: true, message: `Completed blueprint ${id}` };
  },
};
