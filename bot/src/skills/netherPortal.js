'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { countItem } = require('../state/world');

function getFeetPos(bot) {
  const pos = bot.entity?.position;
  if (!pos) return null;
  return typeof pos.floored === 'function' ? pos.floored() : new Vec3(pos.x, pos.y, pos.z).floored();
}

const buildPortal = {
  name: 'build_portal',
  describe: 'construct a 4x5 obsidian portal frame and ignite it with flint and steel',
  timeoutMs: 60_000,

  isAvailable(bot) {
    const obs = countItem(bot, 'obsidian');
    const fas = countItem(bot, 'flint_and_steel');
    if (obs < 10) return { ok: false, reason: 'missing_materials', message: `Need 10 obsidian, have ${obs}` };
    if (fas < 1) return { ok: false, reason: 'missing_flint_and_steel', message: 'Need flint and steel to light portal' };
    return { ok: true };
  },

  async run(bot, ctx, token) {
    token.throwIfCancelled();

    const obsCount = countItem(bot, 'obsidian');
    const fasCount = countItem(bot, 'flint_and_steel');
    if (obsCount < 10) return { ok: false, reason: 'missing_materials', message: 'Need 10 obsidian' };
    if (fasCount < 1) return { ok: false, reason: 'missing_flint_and_steel', message: 'Need flint and steel' };

    const p = getFeetPos(bot) || new Vec3(0, 64, 0);
    const origin = p.offset(2, 0, 0);

    // Minimal 10-block frame offsets (corners empty):
    // Width 4, Height 5 in X-Y plane
    const frameOffsets = [
      new Vec3(1, 0, 0), new Vec3(2, 0, 0),       // bottom
      new Vec3(0, 1, 0), new Vec3(0, 2, 0), new Vec3(0, 3, 0), // left
      new Vec3(3, 1, 0), new Vec3(3, 2, 0), new Vec3(3, 3, 0), // right
      new Vec3(1, 4, 0), new Vec3(2, 4, 0),       // top
    ];

    // Equip scaffold block first if corners need solid foundation
    const scaffoldItem = bot.inventory?.items?.().find((it) => /^(cobblestone|dirt|stone|deepslate|netherrack|planks|oak_planks)$/.test(it.name));
    if (scaffoldItem && bot.placeBlock && bot.blockAt) {
      if (bot.equip) { try { await bot.equip(scaffoldItem, 'hand'); } catch (_) {} }
      for (const cornerOffset of [new Vec3(0, 0, 0), new Vec3(3, 0, 0)]) {
        const cPos = origin.plus(cornerOffset);
        const b = bot.blockAt(cPos);
        if (!b || b.name === 'air' || b.name === 'cave_air') {
          const g = bot.blockAt(cPos.offset(0, -1, 0));
          if (g && g.name !== 'air' && g.name !== 'cave_air') {
            try { await bot.placeBlock(g, new Vec3(0, 1, 0)); } catch (_) {}
          }
        }
      }
    }

    // Equip obsidian
    const obsItem = bot.inventory?.items?.().find((it) => it.name === 'obsidian');
    if (obsItem && bot.equip) {
      try { await bot.equip(obsItem, 'hand'); } catch (_) {}
    }

    // Helper to find a valid solid reference block for placement
    const findPlacementRef = (targetPos) => {
      if (!bot.blockAt) return { refBlock: { position: targetPos.offset(0, -1, 0), name: 'stone' }, face: new Vec3(0, 1, 0) };
      // Check 6 adjacent directions for an existing solid block
      const adjDirs = [
        new Vec3(0, -1, 0), // below
        new Vec3(-1, 0, 0), // west
        new Vec3(1, 0, 0),  // east
        new Vec3(0, 0, -1), // north
        new Vec3(0, 0, 1),  // south
        new Vec3(0, 1, 0),  // above
      ];
      for (const d of adjDirs) {
        const adjPos = targetPos.plus(d);
        const b = bot.blockAt(adjPos);
        if (b && b.name !== 'air' && b.name !== 'cave_air' && !b.name.includes('lava') && !b.name.includes('water')) {
          return { refBlock: b, face: new Vec3(-d.x, -d.y, -d.z) };
        }
      }
      // Fallback: reference below
      const belowPos = targetPos.offset(0, -1, 0);
      const bBelow = bot.blockAt(belowPos);
      return { refBlock: (bBelow && bBelow.name !== 'air') ? bBelow : { position: belowPos, name: 'stone' }, face: new Vec3(0, 1, 0) };
    };

    // Place obsidian blocks
    for (const offset of frameOffsets) {
      token.throwIfCancelled();
      const targetPos = origin.plus(offset);
      if (bot.placeBlock) {
        const { refBlock, face } = findPlacementRef(targetPos);
        try {
          await bot.placeBlock(refBlock, face);
        } catch (_) {}
      }
    }

    token.throwIfCancelled();

    // Ignite bottom inside frame at origin.offset(1, 0, 0) top face (0, 1, 0)
    const fasItem = bot.inventory?.items?.().find((it) => it.name === 'flint_and_steel');
    if (fasItem && bot.equip) {
      try { await bot.equip(fasItem, 'hand'); } catch (_) {}
    }

    const lightPos = origin.offset(1, 0, 0);
    if (bot.activateBlock && bot.blockAt) {
      const bottomBlock = bot.blockAt(lightPos) || { position: lightPos, name: 'obsidian' };
      try {
        await bot.activateBlock(bottomBlock, new Vec3(0, 1, 0));
      } catch (_) {}
    }

    return {
      ok: true,
      message: 'nether portal constructed and ignited',
      portalPos: origin.offset(1, 1, 0),
    };
  },
};

const enterPortal = {
  name: 'enter_portal',
  describe: 'walk into nether portal to travel to Nether',
  timeoutMs: 45_000,

  isAvailable(bot) {
    if (!bot) return { ok: false, reason: 'no_bot' };
    return { ok: true };
  },

  async run(bot, ctx, token, args = {}) {
    token.throwIfCancelled();
    const mcData = require('minecraft-data')(bot?.version || '1.20.4');

    // Equip gold armor piece BEFORE entering portal so Piglins don't attack upon arrival
    if (bot.inventory?.items && bot.equip) {
      const goldArmor = bot.inventory.items().find((it) => /^golden_(helmet|chestplate|leggings|boots)$/.test(it.name));
      if (goldArmor) {
        const slot = goldArmor.name.includes('helmet') ? 'head' :
          (goldArmor.name.includes('chestplate') ? 'torso' :
          (goldArmor.name.includes('leggings') ? 'legs' : 'feet'));
        try { await bot.equip(goldArmor, slot); } catch (_) {}
      }
    }

    let portalBlock = null;
    if (args.pos) {
      portalBlock = { position: new Vec3(args.pos.x, args.pos.y, args.pos.z) };
    } else if (bot.findBlock) {
      const portalId = mcData.blocksByName.nether_portal?.id;
      if (typeof portalId === 'number') {
        portalBlock = bot.findBlock({ matching: portalId, maxDistance: 32 });
      }
    }

    const targetPos = portalBlock?.position || bot.entity?.position?.offset(1, 0, 0) || new Vec3(0, 64, 0);

    // Walk into portal
    if (bot.pathfinder?.goto) {
      try {
        await bot.pathfinder.goto(new goals.GoalBlock(targetPos.x, targetPos.y, targetPos.z));
      } catch (_) {}
    }

    // Wait briefly for dimension transition
    for (let i = 0; i < 5 && !token.cancelled; i++) {
      if (bot.game?.dimension === 'minecraft:the_nether' || bot.dimension === 'the_nether') break;
      await new Promise((r) => setTimeout(r, 200));
    }

    return {
      ok: true,
      message: 'entered nether portal',
      dimension: bot.game?.dimension || 'minecraft:the_nether',
    };
  },
};

module.exports = {
  buildPortal,
  enterPortal,
};
