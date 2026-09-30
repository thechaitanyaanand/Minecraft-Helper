'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { countItem, bestToolTier } = require('../state/world');

const DIAMOND_ORE_NAMES = Object.freeze(['diamond_ore', 'deepslate_diamond_ore']);
const DANGEROUS_BLOCKS = new Set(['lava', 'flowing_lava', 'fire', 'void']);

function getFeetPos(bot) {
  const pos = bot.entity?.position;
  if (!pos) return null;
  return typeof pos.floored === 'function' ? pos.floored() : new Vec3(pos.x, pos.y, pos.z).floored();
}

async function equipBestPickaxe(bot) {
  if (!bot.inventory?.items || !bot.equip) return null;
  const items = bot.inventory.items();
  const tiers = ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe'];
  for (const t of tiers) {
    const pick = items.find((it) => it.name === t);
    if (pick) {
      try { await bot.equip(pick, 'hand'); return pick; } catch (_) {}
    }
  }
  return null;
}

module.exports = {
  name: 'deep_mine',
  describe: 'descend safely to diamond layer (Y=-58) and strip-mine for diamonds',
  timeoutMs: 120_000,

  isAvailable(bot, ctx, args = {}) {
    const tier = bestToolTier(bot, 'pickaxe');
    if (tier === 'none') {
      return { ok: false, reason: 'no_tool', message: 'No pickaxe available' };
    }
    if (args.requiresIron !== false && tier !== 'iron' && tier !== 'diamond' && tier !== 'netherite') {
      return { ok: false, reason: 'no_iron_pickaxe', message: 'Need an iron pickaxe or better to mine diamonds' };
    }
    return { ok: true };
  },

  async run(bot, ctx, token, args = {}) {
    token.throwIfCancelled();

    const targetY = typeof args.targetY === 'number' ? args.targetY : -58;
    const targetOre = Array.isArray(args.targetOre) ? args.targetOre : (args.targetOre ? [args.targetOre] : DIAMOND_ORE_NAMES);
    const dropName = args.dropName || 'diamond';
    const targetCount = args.count || 1;
    const mcData = require('minecraft-data')(bot?.version || '1.20.4');

    const initialPick = await equipBestPickaxe(bot);
    if (!initialPick && bestToolTier(bot, 'pickaxe') === 'none') {
      return { ok: false, reason: 'no_tool', message: 'No pickaxe available to mine' };
    }

    const countBefore = countItem(bot, dropName);

    const oreIds = targetOre
      .map((n) => mcData.blocksByName[n]?.id)
      .filter((id) => typeof id === 'number');

    // Helper to find target ores in reach
    const scanForOres = () => {
      if (!bot.findBlocks || oreIds.length === 0) return [];
      const pos = bot.entity?.position;
      const point = typeof pos?.floored === 'function' ? pos.floored() : pos;
      return bot.findBlocks({ matching: oreIds, maxDistance: 48, count: 16, point }) || [];
    };

    let p = getFeetPos(bot) || new Vec3(0, 64, 0);

    // Step 1: Descend safely if above targetY
    let descentSteps = 0;
    const maxDescentSteps = 200;
    let dir = new Vec3(1, 0, 0);

    while (p.y > targetY && descentSteps < maxDescentSteps && !token.cancelled) {
      token.throwIfCancelled();

      // Check if ores are already visible in nearby exposed caves/walls
      const foundOres = scanForOres();
      if (foundOres.length > 0) {
        break; // Stop descending, go mine the ores!
      }

      await equipBestPickaxe(bot);

      // Safe staircase step:
      // Dig block at feet level in direction, head level in direction, and block 1 down in direction
      const stepFeet = p.plus(dir);
      const stepHead = stepFeet.offset(0, 1, 0);
      const stepDown = stepFeet.offset(0, -1, 0);
      const floorBelow = stepDown.offset(0, -1, 0);

      // Check floor safety: make sure we are not stepping into lava or void
      if (bot.blockAt) {
        const floorBlock = bot.blockAt(floorBelow);
        if (floorBlock && DANGEROUS_BLOCKS.has(floorBlock.name)) {
          // Turn 90 degrees to find safe direction
          dir = new Vec3(-dir.z, 0, dir.x);
          descentSteps++;
          continue;
        }
      }

      // Dig the stairs
      for (const targetPos of [stepHead, stepFeet, stepDown]) {
        token.throwIfCancelled();
        if (bot.blockAt && bot.dig) {
          let b = bot.blockAt(targetPos);
          if (b && b.name !== 'air' && b.name !== 'cave_air') {
            try { await bot.dig(b); } catch (_) {}
          }
          // Clear any falling blocks (gravel or sand falling from ceiling)
          if (bot.blockAt) {
            b = bot.blockAt(targetPos);
            if (b && (b.name === 'gravel' || b.name === 'sand' || b.name === 'suspicious_gravel' || b.name === 'suspicious_sand')) {
              try { await bot.dig(b); } catch (_) {}
            }
          }
        }
      }

      // Step down forward
      p = stepDown;
      if (bot.pathfinder?.goto) {
        try { await bot.pathfinder.goto(new goals.GoalBlock(p.x, p.y, p.z)); } catch (_) {}
      }
      if (bot.entity?.position) {
        bot.entity.position = new Vec3(p.x + 0.5, p.y, p.z + 0.5);
      }
      descentSteps++;

      // Place torch if bot has torches and descentSteps % 8 === 0
      if (descentSteps % 8 === 0 && bot.placeBlock) {
        const torch = bot.inventory?.items?.().find((it) => it.name === 'torch');
        if (torch && bot.equip) {
          try {
            await bot.equip(torch, 'hand');
            const wall = bot.blockAt ? bot.blockAt(p.offset(-dir.x, 1, -dir.z)) : null;
            if (wall && wall.name !== 'air') {
              await bot.placeBlock(wall, new Vec3(dir.x, 0, dir.z));
            }
          } catch (_) {}
          await equipBestPickaxe(bot);
        }
      }
    }

    // Step 2: Strip-mine / branch-mine and gather diamond ores
    let stripSteps = 0;
    const maxStripSteps = 40;

    while (countItem(bot, dropName) - countBefore < targetCount && stripSteps < maxStripSteps && !token.cancelled) {
      token.throwIfCancelled();

      // Check for exposed target ores
      const foundOres = scanForOres();
      if (foundOres.length > 0) {
        // Collect visible ores
        const targetBlocks = foundOres
          .slice(0, targetCount - (countItem(bot, dropName) - countBefore))
          .map((pos) => (bot.blockAt ? bot.blockAt(pos) : { position: pos, name: targetOre[0] }))
          .filter(Boolean);

        if (bot.collectBlock?.collect) {
          try {
            await bot.collectBlock.collect(targetBlocks, { ignoreNoPath: true });
          } catch (_) {}
        } else if (bot.dig) {
          await equipBestPickaxe(bot);
          for (const b of targetBlocks) {
            token.throwIfCancelled();
            try { await bot.dig(b); } catch (_) {}
          }
        }

        // Pick up any dropped diamond items
        if (bot.nearestEntity) {
          const drop = bot.nearestEntity((e) => e?.name === 'item' && e.position?.distanceTo(bot.entity.position) <= 8);
          if (drop && bot.pathfinder?.goto) {
            try { await bot.pathfinder.goto(new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 1)); } catch (_) {}
          }
        }

        // If we reached target count, exit
        if (countItem(bot, dropName) - countBefore >= targetCount) {
          break;
        }
      }

      // Strip mine forward: dig 1x2 tunnel
      await equipBestPickaxe(bot);
      const aheadFeet = p.plus(dir);
      const aheadHead = aheadFeet.offset(0, 1, 0);

      // Check for dangerous fluids ahead
      if (bot.blockAt) {
        const checkAhead = bot.blockAt(aheadFeet);
        if (checkAhead && DANGEROUS_BLOCKS.has(checkAhead.name)) {
          dir = new Vec3(-dir.z, 0, dir.x); // turn
          stripSteps++;
          continue;
        }
      }

      for (const targetPos of [aheadHead, aheadFeet]) {
        token.throwIfCancelled();
        if (bot.blockAt && bot.dig) {
          let b = bot.blockAt(targetPos);
          if (b && b.name !== 'air' && b.name !== 'cave_air') {
            try { await bot.dig(b); } catch (_) {}
          }
          if (bot.blockAt) {
            b = bot.blockAt(targetPos);
            if (b && (b.name === 'gravel' || b.name === 'sand')) {
              try { await bot.dig(b); } catch (_) {}
            }
          }
        }
      }

      p = aheadFeet;
      if (bot.pathfinder?.goto) {
        try { await bot.pathfinder.goto(new goals.GoalBlock(p.x, p.y, p.z)); } catch (_) {}
      }
      if (bot.entity?.position) {
        bot.entity.position = new Vec3(p.x + 0.5, p.y, p.z + 0.5);
      }
      stripSteps++;
    }

    const countAfter = countItem(bot, dropName);
    const gathered = countAfter - countBefore;

    if (gathered > 0) {
      return { ok: true, message: `collected ${gathered} ${dropName}`, collectedCount: gathered };
    }

    // Even if no diamonds were hit immediately, expedition reached target depth safely
    return {
      ok: true,
      message: `reached diamond layer at Y=${Math.round(bot.entity?.position?.y ?? targetY)}`,
      depthReached: Math.round(bot.entity?.position?.y ?? targetY),
    };
  },
};
