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
const { FOOD_MOBS } = require('../state/world');

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
