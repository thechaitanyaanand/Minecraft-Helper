'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const craftSkill = require('./craft');

const CANDIDATE_OFFSETS = [
  new Vec3(2, 0, 0),
  new Vec3(-2, 0, 0),
  new Vec3(0, 0, 2),
  new Vec3(0, 0, -2),
  new Vec3(1, 0, 1),
  new Vec3(1, 0, -1),
  new Vec3(-1, 0, 1),
  new Vec3(-1, 0, -1),
];

function isAir(b) {
  return !b || b.name === 'air' || b.name === 'cave_air';
}

function isSolid(b) {
  if (!b) return false;
  if (b.boundingBox === 'block') return true;
  if (b.boundingBox && b.boundingBox !== 'empty') return true;
  return !isAir(b) && b.name !== 'water' && b.name !== 'lava' && b.name !== 'flowing_water';
}

function findPlacementSpot(bot) {
  if (!bot.entity?.position || !bot.blockAt) return null;
  const pos = bot.entity.position;
  const feet = typeof pos.floored === 'function' ? pos.floored() : new Vec3(pos.x || 0, pos.y || 0, pos.z || 0).floored();

  for (const offset of CANDIDATE_OFFSETS) {
    const spot = feet.plus(offset);
    const ground = bot.blockAt(spot.offset(0, -1, 0));
    const target = bot.blockAt(spot);
    const above = bot.blockAt(spot.offset(0, 1, 0));

    if (isSolid(ground) && isAir(target) && isAir(above)) {
      return { spot, ground };
    }
  }

  return null;
}

module.exports = {
  name: 'place_block',
  describe: 'place a block from inventory into the world',
  timeoutMs: 20_000,

  async run(bot, ctx, token, args = {}) {
    token.throwIfCancelled();
    const blockName = args.name || 'crafting_table';

    // Check if item is in inventory; craft crafting_table if missing
    let item = bot.inventory?.items ? bot.inventory.items().find((it) => it.name === blockName) : null;
    if (!item && blockName === 'crafting_table') {
      await craftSkill.run(bot, ctx, token, { item: 'crafting_table', count: 1 });
      item = bot.inventory?.items ? bot.inventory.items().find((it) => it.name === blockName) : null;
    }

    if (!item) {
      return { ok: false, reason: 'no_item', message: `Missing item to place: ${blockName}` };
    }

    token.throwIfCancelled();

    // Try finding placement spot
    let candidate = findPlacementSpot(bot);

    if (!candidate) {
      // Retry once by moving 3 blocks away
      if (bot.pathfinder?.goto && bot.entity?.position) {
        token.throwIfCancelled();
        const p = bot.entity.position;
        try {
          await bot.pathfinder.goto(new goals.GoalNear(p.x + 3, p.y, p.z, 1));
        } catch (_) {}
        token.throwIfCancelled();
        candidate = findPlacementSpot(bot);
      }
    }

    if (!candidate) {
      return { ok: false, reason: 'no_space', message: 'No suitable solid space to place block' };
    }

    token.throwIfCancelled();
    if (bot.equip) {
      await bot.equip(item, 'hand');
    }

    token.throwIfCancelled();
    if (bot.placeBlock) {
      await bot.placeBlock(candidate.ground, new Vec3(0, 1, 0));
    }

    return {
      ok: true,
      message: `placed ${blockName} at ${candidate.spot}`,
      position: candidate.spot,
    };
  },
};
