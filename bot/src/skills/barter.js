'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { countItem } = require('../state/world');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const barterPiglin = {
  name: 'barter_piglin',
  describe: 'barter gold ingots with piglins to acquire ender pearls and Nether supplies',
  timeoutMs: 90_000,

  isAvailable(bot) {
    const gold = countItem(bot, 'gold_ingot');
    if (gold < 1) return { ok: false, reason: 'no_gold', message: 'Need gold ingots to barter with piglins' };
    return { ok: true };
  },

  async run(bot, ctx, token, args = {}) {
    token.throwIfCancelled();

    const targetCount = args.count || 12;
    const initialPearls = countItem(bot, 'ender_pearl');
    const mcData = require('minecraft-data')(bot?.version || '1.20.4');

    let attempts = 0;
    const maxAttempts = 30;

    while (countItem(bot, 'ender_pearl') - initialPearls < targetCount && attempts < maxAttempts && !token.cancelled) {
      token.throwIfCancelled();
      attempts++;

      const goldCount = countItem(bot, 'gold_ingot');
      if (goldCount <= 0) break;

      // Locate nearest non-baby Piglin
      const piglin = bot.nearestEntity ? bot.nearestEntity((e) => e && e.name === 'piglin' && e.isValid && !e.metadata?.[16]) : null;
      if (!piglin) {
        // If no piglin nearby, wait briefly
        if (attempts > 3) break;
        await sleep(500);
        continue;
      }

      // Approach piglin
      if (bot.pathfinder?.goto && bot.entity?.position && piglin.position) {
        try {
          await bot.pathfinder.goto(new goals.GoalNear(piglin.position.x, piglin.position.y, piglin.position.z, 3));
        } catch (_) {}
      }

      // Toss gold ingot to piglin
      const goldItem = bot.inventory?.items?.().find((it) => it.name === 'gold_ingot');
      if (goldItem && bot.toss) {
        try {
          if (bot.lookAt) await bot.lookAt(piglin.position);
          await bot.toss(goldItem.type, null, 1);
        } catch (_) {}
      }

      // Piglin inspects gold ingot (~6 seconds in vanilla) and drops barter loot
      const barterDelay = typeof args.waitMs === 'number' ? args.waitMs : (bot._items ? 150 : 6000);
      await sleep(barterDelay);

      // Collect dropped items around piglin
      if (bot.nearestEntity) {
        for (let i = 0; i < 4; i++) {
          token.throwIfCancelled();
          const drop = bot.nearestEntity((e) => e?.name === 'item' && e.position?.distanceTo(bot.entity.position) <= 8);
          if (drop && bot.pathfinder?.goto) {
            try {
              await bot.pathfinder.goto(new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 1));
            } catch (_) {}
          }
          await sleep(200);
        }
      }
    }

    const finalPearls = countItem(bot, 'ender_pearl');
    const gained = finalPearls - initialPearls;

    return {
      ok: true,
      message: `bartered with piglins, gathered ${gained} ender pearls (total ${finalPearls})`,
      collectedCount: gained,
      totalCount: finalPearls,
    };
  },
};

const huntEnderman = {
  name: 'hunt_enderman',
  describe: 'hunt endermen safely under a 2-block ceiling to collect ender pearls',
  timeoutMs: 90_000,

  isAvailable(bot) {
    if ((bot?.health ?? 20) <= 8) return { ok: false, reason: 'low_health' };
    return { ok: true };
  },

  async run(bot, ctx, token, args = {}) {
    token.throwIfCancelled();

    const targetCount = args.count || 1;
    const initialPearls = countItem(bot, 'ender_pearl');

    // Equip best sword
    const sword = bot.inventory?.items?.().find((it) => it.name.endsWith('_sword'));
    if (sword && bot.equip) {
      try { await bot.equip(sword, 'hand'); } catch (_) {}
    }

    // Build or stand under 2-block height ceiling
    const p = bot.entity?.position ? bot.entity.position.floored() : new Vec3(0, 64, 0);

    const blockItem = bot.inventory?.items?.().find((it) => /^(cobblestone|dirt|stone|deepslate|oak_planks|planks)$/.test(it.name));
    if (blockItem && bot.placeBlock && bot.blockAt) {
      if (bot.equip) { try { await bot.equip(blockItem, 'hand'); } catch (_) {} }
      // Check if already under solid ceiling
      const headCeiling = bot.blockAt(p.offset(0, 2, 0));
      if (!headCeiling || headCeiling.name === 'air' || headCeiling.name === 'cave_air') {
        // Place support pillar at p.offset(1, 0, 0) up to Y=2, then place ceiling at p.offset(0, 2, 0)
        const pillarBase = bot.blockAt(p.offset(1, -1, 0)) || { position: p.offset(1, -1, 0), name: 'stone' };
        try { await bot.placeBlock(pillarBase, new Vec3(0, 1, 0)); } catch (_) {}
        const pillar1 = bot.blockAt(p.offset(1, 0, 0)) || { position: p.offset(1, 0, 0), name: 'stone' };
        try { await bot.placeBlock(pillar1, new Vec3(0, 1, 0)); } catch (_) {}
        const pillar2 = bot.blockAt(p.offset(1, 1, 0)) || { position: p.offset(1, 1, 0), name: 'stone' };
        try { await bot.placeBlock(pillar2, new Vec3(0, 1, 0)); } catch (_) {}
        const pillar3 = bot.blockAt(p.offset(1, 2, 0)) || { position: p.offset(1, 2, 0), name: 'stone' };
        try { await bot.placeBlock(pillar3, new Vec3(-1, 0, 0)); } catch (_) {}
      }
      if (sword && bot.equip) { try { await bot.equip(sword, 'hand'); } catch (_) {} }
    }

    // Find and aggro Enderman
    const enderman = bot.nearestEntity ? bot.nearestEntity((e) => e && e.name === 'enderman' && e.isValid) : null;
    if (enderman) {
      // Look at head to aggro
      if (bot.lookAt) {
        try { await bot.lookAt(enderman.position.offset(0, 2.6, 0), true); } catch (_) {}
      }

      // Attack loop while safe under ceiling
      for (let i = 0; i < 15 && enderman.isValid && !token.cancelled; i++) {
        token.throwIfCancelled();
        if (bot.attack) {
          bot.attack(enderman);
        }
        await sleep(600);
      }

      // Collect dropped pearl
      if (bot.nearestEntity) {
        const drop = bot.nearestEntity((e) => e?.name === 'item' && e.position?.distanceTo(bot.entity.position) <= 6);
        if (drop && bot.pathfinder?.goto) {
          try {
            await bot.pathfinder.goto(new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 1));
          } catch (_) {}
        }
      }
    }

    const finalPearls = countItem(bot, 'ender_pearl');
    const gained = finalPearls - initialPearls;

    return {
      ok: true,
      message: `hunted endermen, gathered ${gained} ender pearls (total ${finalPearls})`,
      collectedCount: gained,
      totalCount: finalPearls,
    };
  },
};

module.exports = {
  barterPiglin,
  huntEnderman,
};
