'use strict';
const { countItem, countItemsMatching, bestToolTier, timeOfDayLabel, ownerEntity } = require('../state/world');
const { FOOD_PRIORITY } = require('../skills/eat');

function countLogs(bot) {
  return countItemsMatching(bot, /(_log|_wood|_stem)$/);
}

function countPlanks(bot) {
  return countItemsMatching(bot, /_planks$/);
}

function planksPotential(bot) {
  let count = countPlanks(bot) + 4 * countLogs(bot);
  count += Math.floor(countItem(bot, 'stick') / 2);
  if (countItem(bot, 'crafting_table') > 0 || tableNearby(bot)) count += 4;
  if (bestToolTier(bot, 'pickaxe') !== 'none') count += 12;
  return count;
}

function hasItem(bot, name) {
  return countItem(bot, name) > 0;
}

function tableNearby(bot) {
  if (!bot?.findBlock) return false;
  const mcData = require('minecraft-data')(bot?.version || '1.20.4');
  const tableId = mcData.blocksByName?.crafting_table?.id;
  if (typeof tableId !== 'number') return false;
  return Boolean(bot.findBlock({ matching: tableId, maxDistance: 4 }));
}

function countFood(bot) {
  if (!bot?.inventory?.items) return 0;
  const foodSet = new Set([
    ...FOOD_PRIORITY, 'raw_beef', 'raw_porkchop', 'raw_chicken', 'raw_mutton',
  ]);
  return bot.inventory.items().reduce((sum, it) => (foodSet.has(it.name) ? sum + it.count : sum), 0);
}

function hasEdibleFood(bot) {
  if (!bot?.inventory?.items) return false;
  const items = bot.inventory.items();
  return items.some((it) => FOOD_PRIORITY.includes(it.name));
}

function isNearOwner(bot, ctx, maxDist = 3) {
  const owner = ownerEntity(bot, ctx?.ownerName);
  if (!owner?.position || !bot?.entity?.position) return false;
  return bot.entity.position.distanceTo(owner.position) <= maxDist;
}

function hasAnyItems(bot) {
  return Boolean(bot?.inventory?.items && bot.inventory.items().length > 0);
}

const GOALS = {
  get_wood: {
    describe: 'collect wood logs from trees',
    done: (b) => countLogs(b) >= 8,
    steps: [
      { skill: 'collect_logs', args: { count: 8 }, need: (b) => countLogs(b) < 8 },
    ],
  },

  make_tools: {
    describe: 'craft a pickaxe, then stone tools',
    done: (b) => hasItem(b, 'stone_pickaxe'),
    steps: [
      { skill: 'collect_logs', args: { count: 3 }, need: (b) => !hasItem(b, 'stone_pickaxe') && planksPotential(b) < 12 && countLogs(b) < 3 },
      { skill: 'craft_planks', need: (b) => !hasItem(b, 'stone_pickaxe') && countPlanks(b) < 8 && countLogs(b) > 0 },
      { skill: 'craft_sticks', need: (b) => !hasItem(b, 'stone_pickaxe') && countItem(b, 'stick') < (bestToolTier(b, 'pickaxe') === 'none' ? 4 : 2) },
      { skill: 'place_crafting_table', need: (b) => !hasItem(b, 'stone_pickaxe') && !tableNearby(b) },
      { skill: 'craft_tool', args: { item: 'wooden_pickaxe' }, need: (b) => bestToolTier(b, 'pickaxe') === 'none' },
      { skill: 'mine_stone', args: { count: 6 }, need: (b) => !hasItem(b, 'stone_pickaxe') && countItem(b, 'cobblestone') < 6 },
      { skill: 'place_crafting_table', need: (b) => !hasItem(b, 'stone_pickaxe') && !tableNearby(b) },
      { skill: 'craft_tool', args: { item: 'stone_pickaxe' }, need: (b) => !hasItem(b, 'stone_pickaxe') },
    ],
  },

  get_food: {
    describe: 'hunt for food and eat',
    done: (b) => countFood(b) >= 4,
    steps: [
      { skill: 'eat', need: (b) => (b.food ?? 20) < 14 && countFood(b) >= 2 && hasEdibleFood(b) },
      { skill: 'hunt_food', need: (b) => countFood(b) < 4 },
    ],
  },

  survive_night: {
    describe: 'emergency shelter for night',
    done: (b) => timeOfDayLabel(b.time?.timeOfDay) === 'day',
    steps: [
      { skill: 'dig_in', need: (b) => ['dusk', 'night'].includes(timeOfDayLabel(b.time?.timeOfDay)) },
    ],
  },

  follow_me: {
    describe: 'follow the player around',
    done: () => false,
    steps: [
      { skill: 'follow_owner', need: () => true },
    ],
  },

  come_here: {
    describe: 'walk to where the player is',
    done: (b, ctx) => isNearOwner(b, ctx, 3),
    steps: [
      { skill: 'come_to_owner', need: (b, ctx) => !isNearOwner(b, ctx, 3) },
    ],
  },

  give_items: {
    describe: 'give items to the player',
    done: (b) => !hasAnyItems(b),
    steps: [
      { skill: 'give_to_owner', need: (b) => hasAnyItems(b) },
    ],
  },
};

/**
 * Returns the first step in the goal whose need(bot, ctx) is true.
 * @param {object} goal - Goal definition
 * @param {object} bot - Mineflayer bot
 * @param {object} ctx - Execution context
 * @returns {object|null} First needed step or null if all satisfied
 */
function getFirstNeededStep(goal, bot, ctx) {
  if (!goal?.steps) return null;
  if (typeof goal.done === 'function' && goal.done(bot, ctx)) return null;
  for (const step of goal.steps) {
    if (typeof step.need === 'function' && step.need(bot, ctx)) {
      return step;
    }
  }
  return null;
}

module.exports = {
  GOALS,
  getFirstNeededStep,
  countLogs,
  countPlanks,
  planksPotential,
  hasItem,
  tableNearby,
  countFood,
  hasEdibleFood,
  isNearOwner,
  hasAnyItems,
};
