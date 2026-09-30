'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { countItem, equipShield, setShield } = require('../state/world');
const memory = require('../memory');

const FORTRESS_BLOCKS = Object.freeze([
  'nether_bricks',
  'nether_brick_fence',
  'nether_brick_stairs',
  'nether_wart',
  'red_nether_bricks',
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBestWeapon(bot) {
  if (!bot.inventory?.items) return null;
  const items = bot.inventory.items();
  const sword = items.find((it) => it.name.endsWith('_sword'));
  if (sword) return sword;
  return items.find((it) => it.name.endsWith('_axe')) || null;
}

const findFortress = {
  name: 'find_fortress',
  describe: 'locate a Nether fortress by detecting nether bricks and navigating inside',
  timeoutMs: 120_000,

  isAvailable(bot, ctx, args = {}) {
    if (!bot) return { ok: false, reason: 'no_bot' };
    const dim = bot?.game?.dimension || bot?.dimension;
    if (dim && dim !== 'minecraft:the_nether' && dim !== 'the_nether' && !args.ignoreDimension) {
      return { ok: false, reason: 'not_in_nether', message: 'Must be in the Nether to locate a fortress' };
    }
    return { ok: true };
  },

  async run(bot, ctx, token, args = {}) {
    token.throwIfCancelled();
    const mcData = require('minecraft-data')(bot?.version || '1.20.4');

    const fortressBlockIds = FORTRESS_BLOCKS
      .map((name) => mcData.blocksByName[name]?.id)
      .filter((id) => typeof id === 'number');

    // 0. Check if already remembered in memory
    const remembered = memory.get().fortress;
    if (remembered && bot.pathfinder?.goto) {
      try {
        await bot.pathfinder.goto(new goals.GoalNear(remembered.x, remembered.y, remembered.z, 3));
        return { ok: true, message: 'returned to known nether fortress', position: new Vec3(remembered.x, remembered.y, remembered.z) };
      } catch (_) {}
    }

    // 1. Check if already near fortress blocks
    if (bot.findBlocks) {
      const pos = bot.entity?.position;
      const point = typeof pos?.floored === 'function' ? pos.floored() : pos;
      const found = bot.findBlocks({ matching: fortressBlockIds, maxDistance: 64, count: 8, point });

      if (found.length > 0) {
        const target = found[0];
        memory.set('fortress', target);
        if (bot.pathfinder?.goto) {
          try {
            await bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 2));
          } catch (_) {}
        }
        return { ok: true, message: 'reached nether fortress', position: new Vec3(target.x, target.y, target.z) };
      }
    }

    // 2. Explore along cardinal directions in the Nether
    const directions = [
      new Vec3(30, 0, 0),
      new Vec3(0, 0, 30),
      new Vec3(-30, 0, 0),
      new Vec3(0, 0, -30),
    ];

    for (const d of directions) {
      token.throwIfCancelled();
      const current = bot.entity?.position || new Vec3(0, 64, 0);
      const targetPos = current.plus(d);

      if (bot.pathfinder?.goto) {
        try {
          await bot.pathfinder.goto(new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 3));
        } catch (_) {}
      }

      if (bot.findBlocks) {
        const found = bot.findBlocks({ matching: fortressBlockIds, maxDistance: 48, count: 1 });
        if (found.length > 0) {
          memory.set('fortress', found[0]);
          if (bot.pathfinder?.goto) {
            try {
              await bot.pathfinder.goto(new goals.GoalNear(found[0].x, found[0].y, found[0].z, 2));
            } catch (_) {}
          }
          return { ok: true, message: 'discovered nether fortress', position: found[0] };
        }
      }
    }

    return { ok: true, message: 'scouted for fortress' };
  },
};

const huntBlaze = {
  name: 'hunt_blaze',
  describe: 'defeat blazes in nether fortress with shield protection and gather blaze rods',
  timeoutMs: 90_000,

  isAvailable(bot, ctx, args = {}) {
    if ((bot?.health ?? 20) <= 8) return { ok: false, reason: 'low_health' };
    const dim = bot?.game?.dimension || bot?.dimension;
    if (dim && dim !== 'minecraft:the_nether' && dim !== 'the_nether' && !args.ignoreDimension) {
      return { ok: false, reason: 'not_in_nether', message: 'Must be in the Nether to hunt blazes' };
    }
    return { ok: true };
  },

  async run(bot, ctx, token, args = {}) {
    token.throwIfCancelled();

    const targetCount = args.count || 6;
    const initialRods = countItem(bot, 'blaze_rod');
    const weapon = findBestWeapon(bot);
    const hasShieldUp = await equipShield(bot);

    if (weapon && bot.equip) {
      try { await bot.equip(weapon, 'hand'); } catch (_) {}
    }

    let attempts = 0;
    const maxAttempts = 20;

    try {
      while (countItem(bot, 'blaze_rod') - initialRods < targetCount && attempts < maxAttempts && !token.cancelled) {
        token.throwIfCancelled();
        attempts++;

        if ((bot?.health ?? 20) <= 8) {
          return { ok: false, reason: 'low_health', message: 'Health too low to continue fighting blazes' };
        }

        // Find nearest blaze entity
        let blaze = bot.nearestEntity ? bot.nearestEntity((e) => e && e.name === 'blaze' && e.isValid) : null;

        // If no blaze directly visible, look for blaze spawner
        if (!blaze && bot.findBlock) {
          const mcData = require('minecraft-data')(bot?.version || '1.20.4');
          const spawner = bot.findBlock({ matching: mcData.blocksByName.spawner?.id, maxDistance: 32 });
          if (spawner && bot.pathfinder?.goto) {
            try {
              await bot.pathfinder.goto(new goals.GoalNear(spawner.position.x, spawner.position.y, spawner.position.z, 3));
            } catch (_) {}
            await sleep(1000);
            blaze = bot.nearestEntity ? bot.nearestEntity((e) => e && e.name === 'blaze' && e.isValid) : null;
          }
        }

        if (!blaze) {
          // If no blaze found, wait briefly or break
          if (attempts > 3 && countItem(bot, 'blaze_rod') > initialRods) break;
          await sleep(500);
          continue;
        }

        const eyePos = blaze.position.offset(0, 1.2, 0);
        const dist = bot.entity?.position ? bot.entity.position.distanceTo(blaze.position) : 5;

        // Approach blaze
        if (dist > 3 && bot.pathfinder?.goto) {
          try {
            await bot.pathfinder.goto(new goals.GoalFollow(blaze, 2));
          } catch (_) {}
        }

        // Blaze attack sequence:
        // Raise shield to absorb fireball burst
        if (hasShieldUp && dist <= 12) {
          if (bot.lookAt) { try { await bot.lookAt(eyePos, true); } catch (_) {} }
          setShield(bot, true);
          await sleep(600); // Block fireballs
        }

        // Lower shield and strike
        setShield(bot, false);
        if (weapon && bot.equip) {
          try { await bot.equip(weapon, 'hand'); } catch (_) {}
        }

        if (bot.lookAt) {
          try { await bot.lookAt(eyePos); } catch (_) {}
        }

        if (bot.attack && blaze.isValid) {
          bot.attack(blaze);
          await sleep(600);
        }

        // Collect nearby dropped blaze rods
        if (bot.nearestEntity) {
          const drop = bot.nearestEntity((e) => e?.name === 'item' && e.position?.distanceTo(bot.entity.position) <= 8);
          if (drop && bot.pathfinder?.goto) {
            try {
              await bot.pathfinder.goto(new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 1));
            } catch (_) {}
          }
        }
      }
    } finally {
      setShield(bot, false);
      if (bot.pathfinder?.stop) {
        try {
          bot.pathfinder.stop();
          bot.pathfinder.setGoal(null);
        } catch (_) {}
      }
    }

    const finalRods = countItem(bot, 'blaze_rod');
    const gained = finalRods - initialRods;

    return {
      ok: true,
      message: `collected ${gained} blaze rods (total ${finalRods})`,
      collectedCount: gained,
      totalCount: finalRods,
    };
  },
};

module.exports = {
  findFortress,
  huntBlaze,
};
