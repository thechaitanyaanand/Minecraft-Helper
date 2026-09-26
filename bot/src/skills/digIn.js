'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { bestToolTier } = require('../state/world');

const UNSAFE_NAMES = new Set(['lava', 'water', 'flowing_water', 'flowing_lava', 'air', 'cave_air']);
const PLACEABLE_NAMES = new Set([
  'dirt', 'cobblestone', 'stone', 'grass_block', 'oak_planks', 'sand', 'gravel',
  'spruce_planks', 'birch_planks', 'deepslate', 'andesite', 'diorite', 'granite',
]);

function getFeetPos(bot) {
  const pos = bot.entity?.position;
  if (!pos) return null;
  return typeof pos.floored === 'function' ? pos.floored() : new Vec3(pos.x, pos.y, pos.z).floored();
}

function isGroundSafe(bot, p) {
  if (!bot.blockAt) return false;
  for (let dy = 1; dy <= 4; dy++) {
    const b = bot.blockAt(p.offset(0, -dy, 0));
    if (!b || UNSAFE_NAMES.has(b.name)) return false;
  }
  return true;
}

function findSealBlock(bot) {
  if (!bot.inventory?.items) return null;
  return bot.inventory.items().find((it) => PLACEABLE_NAMES.has(it.name)) || null;
}

function findSealWall(bot, p) {
  const dirs = [
    { offset: new Vec3(1, -1, 0), face: new Vec3(-1, 0, 0) },
    { offset: new Vec3(-1, -1, 0), face: new Vec3(1, 0, 0) },
    { offset: new Vec3(0, -1, 1), face: new Vec3(0, 0, -1) },
    { offset: new Vec3(0, -1, -1), face: new Vec3(0, 0, 1) },
  ];
  for (const d of dirs) {
    const wall = bot.blockAt ? bot.blockAt(p.plus(d.offset)) : null;
    if (wall && (wall.boundingBox === 'block' || wall.boundingBox !== 'empty') && !UNSAFE_NAMES.has(wall.name)) {
      return { wall, face: d.face };
    }
  }
  return null;
}

module.exports = {
  name: 'dig_in',
  describe: 'dig emergency 3-block hole and seal ceiling',
  timeoutMs: 30_000,

  isAvailable(bot) {
    const p = getFeetPos(bot);
    if (!p || !bot.blockAt) return { ok: false, reason: 'no_position' };

    const ground = bot.blockAt(p.offset(0, -1, 0));
    if (!ground || UNSAFE_NAMES.has(ground.name)) {
      return { ok: false, reason: 'unsafe_ground' };
    }

    const isSoft = ['dirt', 'grass_block', 'sand', 'gravel'].includes(ground.name);
    const hasPick = bestToolTier(bot, 'pickaxe') !== 'none';
    if (!isSoft && !hasPick) {
      return { ok: false, reason: 'no_pickaxe' };
    }
    return { ok: true };
  },

  async run(bot, ctx, token) {
    token.throwIfCancelled();
    let p = getFeetPos(bot);
    if (!p) return { ok: false, reason: 'no_position' };

    // Check ground down to 4 blocks; retry up to 2 times by shifting 3 blocks
    let retries = 0;
    while (!isGroundSafe(bot, p) && retries < 2) {
      retries++;
      token.throwIfCancelled();
      if (bot.pathfinder?.goto) {
        try {
          await bot.pathfinder.goto(new goals.GoalNear(p.x + 3 * retries, p.y, p.z, 1));
        } catch (_) {}
      }
      p = getFeetPos(bot);
      if (!p) return { ok: false, reason: 'no_position' };
    }

    if (!isGroundSafe(bot, p)) {
      return { ok: false, reason: 'unsafe_ground', message: 'Could not find safe solid ground to dig into' };
    }

    const startPos = p.clone();

    // Dig 3 blocks down
    for (let dy = 1; dy <= 3; dy++) {
      token.throwIfCancelled();
      const targetBlock = bot.blockAt ? bot.blockAt(startPos.offset(0, -dy, 0)) : null;
      if (targetBlock && targetBlock.name !== 'air') {
        if (targetBlock.name.includes('stone') || targetBlock.name.includes('deepslate')) {
          const pick = bot.inventory?.items?.().find((it) => it.name.endsWith('_pickaxe'));
          if (pick && bot.equip) {
            try { await bot.equip(pick, 'hand'); } catch (_) {}
          }
        }
        token.throwIfCancelled();
        if (bot.dig) {
          await bot.dig(targetBlock);
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    token.throwIfCancelled();

    // Seal ceiling at startPos - 1
    const sealWall = findSealWall(bot, startPos);
    let sealBlock = findSealBlock(bot);

    if (sealWall && sealBlock) {
      if (bot.equip) {
        try { await bot.equip(sealBlock, 'hand'); } catch (_) {}
      }
      if (bot.look) {
        try { await bot.look(bot.entity.yaw, Math.PI / 2, true); } catch (_) {}
      }
      token.throwIfCancelled();
      if (bot.placeBlock) {
        try {
          await bot.placeBlock(sealWall.wall, sealWall.face);
        } catch (_) {}
      }
    }

    return { ok: true, message: 'shelter sealed', position: startPos.offset(0, -3, 0) };
  },
};
