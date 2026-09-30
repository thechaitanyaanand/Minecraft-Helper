'use strict';
const collectBlock = require('./collectBlock');
const craft = require('./craft');
const placeBlock = require('./placeBlock');
const hunt = require('./hunt');
const eat = require('./eat');
const flee = require('./flee');
const fight = require('./fight');
const digIn = require('./digIn');
const { comeToOwner, followOwner, giveToOwner } = require('./owner');
const explore = require('./explore');
const smelt = require('./smelt');
const buildBlueprint = require('./buildBlueprint');
const { goTo, recoverItems } = require('./places');
const sleep = require('./sleep');
const deepMine = require('./deepMine');
const { buildPortal, enterPortal } = require('./netherPortal');
const { findFortress, huntBlaze } = require('./netherFortress');
const { barterPiglin, huntEnderman } = require('./barter');
const { triangulateSkill, findStronghold, activateEndPortal } = require('./stronghold');
const { fightDragon } = require('./dragonFight');
const { FOOD_MOBS, timeOfDayLabel } = require('../state/world');

const ALL_LOG_NAMES = Object.freeze([
  'oak_log', 'spruce_log', 'birch_log', 'jungle_log',
  'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
]);

const skills = {
  collect_block: collectBlock,
  craft,
  place_block: placeBlock,
  hunt,
  eat,
  flee,
  fight,
  dig_in: digIn,
  digIn,
  come_to_owner: comeToOwner,
  follow_owner: followOwner,
  give_to_owner: giveToOwner,
  explore,
  smelt,
  build_blueprint: buildBlueprint,
  go_to: goTo,
  recover_items: recoverItems,
  sleep_with_owner: sleep,
  deep_mine: deepMine,
  build_portal: buildPortal,
  enter_portal: enterPortal,
  find_fortress: findFortress,
  hunt_blaze: huntBlaze,
  barter_piglin: barterPiglin,
  hunt_enderman: huntEnderman,
  triangulate_stronghold: triangulateSkill,
  find_stronghold: findStronghold,
  activate_end_portal: activateEndPortal,
  fight_dragon: fightDragon,
};

const aliases = {
  collect_logs: {
    name: 'collect_logs',
    describe: 'chop nearby trees to collect logs',
    timeoutMs: 90_000,
    isAvailable: (bot, ctx, args) => collectBlock.isAvailable(bot, ctx, { blockNames: ALL_LOG_NAMES, ...args }),
    run: (bot, ctx, token, args = {}) => collectBlock.run(bot, ctx, token, {
      blockNames: ALL_LOG_NAMES,
      count: args.count || 4,
      dropName: 'logs',
      ...args,
    }),
  },
  mine_stone: {
    name: 'mine_stone',
    describe: 'mine stone blocks with a pickaxe',
    timeoutMs: 90_000,
    isAvailable: (bot, ctx, args) => collectBlock.isAvailable(bot, ctx, { blockNames: ['stone'], needsTool: 'pickaxe', ...args }),
    run: (bot, ctx, token, args = {}) => collectBlock.run(bot, ctx, token, {
      blockNames: ['stone'],
      count: args.count || 3,
      dropName: 'cobblestone',
      needsTool: 'pickaxe',
      ...args,
    }),
  },
  craft_planks: {
    name: 'craft_planks',
    describe: 'craft wooden planks from logs',
    timeoutMs: 15_000,
    run: (bot, ctx, token, args = {}) => craft.run(bot, ctx, token, {
      item: 'planks',
      count: args.count || 4,
      ...args,
    }),
  },
  craft_sticks: {
    name: 'craft_sticks',
    describe: 'craft wooden sticks from planks',
    timeoutMs: 15_000,
    run: (bot, ctx, token, args = {}) => craft.run(bot, ctx, token, {
      item: 'stick',
      count: args.count || 4,
      ...args,
    }),
  },
  craft_tool: {
    name: 'craft_tool',
    describe: 'craft a tool at a crafting table',
    timeoutMs: 25_000,
    run: (bot, ctx, token, args = {}) => craft.run(bot, ctx, token, {
      item: args.item || 'wooden_pickaxe',
      count: args.count || 1,
      ...args,
    }),
  },
  place_crafting_table: {
    name: 'place_crafting_table',
    describe: 'place a crafting table near the bot',
    timeoutMs: 20_000,
    run: (bot, ctx, token, args = {}) => placeBlock.run(bot, ctx, token, {
      name: 'crafting_table',
      ...args,
    }),
  },
  wait_for_day: {
    name: 'wait_for_day',
    describe: 'stay put in the shelter until morning',
    timeoutMs: 0,
    run: async (bot, ctx, token) => {
      while (timeOfDayLabel(bot.time?.timeOfDay) !== 'day') {
        token.throwIfCancelled();
        await new Promise((r) => setTimeout(r, 2000));
      }
      return { ok: true, message: 'morning' };
    },
  },
  hunt_food: {
    name: 'hunt_food',
    describe: 'hunt nearby food mobs for meat',
    timeoutMs: 60_000,
    isAvailable: (bot, ctx, args) => hunt.isAvailable(bot, ctx, { mobNames: Array.from(FOOD_MOBS), ...args }),
    run: (bot, ctx, token, args = {}) => hunt.run(bot, ctx, token, {
      mobNames: Array.from(FOOD_MOBS),
      ...args,
    }),
  },
  mine_diamonds: {
    name: 'mine_diamonds',
    describe: 'descend safely to Y=-58 and mine diamonds',
    timeoutMs: 120_000,
    isAvailable: (bot, ctx, args) => deepMine.isAvailable(bot, ctx, args),
    run: (bot, ctx, token, args = {}) => deepMine.run(bot, ctx, token, {
      count: args.count || 3,
      ...args,
    }),
  },
  build_nether_portal: {
    name: 'build_nether_portal',
    describe: 'build a 4x5 obsidian portal and light it',
    timeoutMs: 60_000,
    isAvailable: (bot, ctx, args) => buildPortal.isAvailable(bot, ctx, args),
    run: (bot, ctx, token, args = {}) => buildPortal.run(bot, ctx, token, args),
  },
  craft_eyes: {
    name: 'craft_eyes',
    describe: 'craft blaze powder and eyes of ender',
    timeoutMs: 30_000,
    run: async (bot, ctx, token, args = {}) => {
      const { countItem } = require('../state/world');
      const neededEyes = args.count || 12;
      const currentEyes = countItem(bot, 'ender_eye');
      const missingEyes = Math.max(0, neededEyes - currentEyes);
      const currentPowder = countItem(bot, 'blaze_powder');
      if (currentPowder < missingEyes && countItem(bot, 'blaze_rod') > 0) {
        const rodsToCraft = Math.ceil((missingEyes - currentPowder) / 2);
        try {
          await craft.run(bot, ctx, token, { item: 'blaze_powder', runs: rodsToCraft });
        } catch (_) {}
      }
      return craft.run(bot, ctx, token, {
        item: 'ender_eye',
        count: missingEyes || 1,
        ...args,
      });
    },
  },
  defeat_dragon: {
    name: 'defeat_dragon',
    describe: 'enter the End and defeat the Ender Dragon',
    timeoutMs: 300_000,
    isAvailable: (bot, ctx, args) => fightDragon.isAvailable(bot, ctx, args),
    run: (bot, ctx, token, args = {}) => fightDragon.run(bot, ctx, token, args),
  },
};

function getSkill(name) {
  return aliases[name] || skills[name] || null;
}

module.exports = {
  skills,
  aliases,
  getSkill,
  ALL_LOG_NAMES,
};
