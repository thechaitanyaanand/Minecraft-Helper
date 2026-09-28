'use strict';
const { countItem, countItemsMatching, bestToolTier, timeOfDayLabel, ownerEntity, TOOL_TIERS } = require('../state/world');
const { FOOD_PRIORITY } = require('../skills/eat');
const memory = require('../memory');

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
  const foodSet = new Set(FOOD_PRIORITY);
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

const isNearPos = (bot, p, maxDist) => Boolean(p && bot?.entity?.position?.distanceTo?.(p) <= maxDist);

const isSolidAt = (bot, pos) => bot?.blockAt?.(pos)?.boundingBox === 'block';

// Roof overhead and walls on all four sides at feet and head level (e.g. the bottom of a dig_in shaft).
function isEnclosed(bot) {
  const p = bot?.entity?.position?.floored?.();
  if (!p?.offset) return false;
  if (!isSolidAt(bot, p.offset(0, 2, 0))) return false;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (!isSolidAt(bot, p.offset(dx, 0, dz)) || !isSolidAt(bot, p.offset(dx, 1, dz))) return false;
  }
  return true;
}

// Autopilot gear progression, in order. Owning a better tier of the same thing counts.
const UPGRADES = Object.freeze([
  'stone_sword', 'stone_axe', 'iron_pickaxe', 'iron_sword', 'shield',
  'iron_chestplate', 'iron_helmet', 'iron_leggings', 'iron_boots', 'diamond_pickaxe', 'diamond_sword',
]);

function owns(bot, name) {
  const all = (bot?.inventory?.slots || bot?.inventory?.items?.() || []).filter(Boolean).map((it) => it.name);
  const m = name.match(/^([a-z]+)_(\w+)$/);
  const tier = m ? TOOL_TIERS.indexOf(m[1]) : -1;
  if (tier < 0) return all.includes(name);
  return all.some((n) => {
    const o = n.match(/^([a-z]+)_(\w+)$/);
    return o && o[2] === m[2] && TOOL_TIERS.indexOf(o[1]) >= tier;
  });
}

function nextUpgrade(bot, skip = new Set()) {
  return UPGRADES.find((n) => !skip.has(n) && !owns(bot, n)) || null;
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
      { skill: 'dig_in', need: (b) => ['dusk', 'night'].includes(timeOfDayLabel(b.time?.timeOfDay)) && !isEnclosed(b) },
      { skill: 'wait_for_day', need: (b) => timeOfDayLabel(b.time?.timeOfDay) !== 'day' },
    ],
  },

  progress: {
    describe: 'upgrade to better tools and armor',
    done: (b) => !nextUpgrade(b),
    steps: [],
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

  go_home: {
    describe: 'walk back to the remembered home',
    done: (b) => !memory.get().home || isNearPos(b, memory.get().home, 3),
    steps: [
      { skill: 'go_to', args: { place: 'home' }, need: () => true },
    ],
  },

  recover_items: {
    describe: "fetch the player's items from where they died",
    done: () => !memory.get().deathSpot,
    steps: [
      { skill: 'recover_items', need: () => true },
    ],
  },

  sleep_with_owner: {
    describe: 'sleep when the player sleeps',
    done: () => !require('../skills/sleep').isOwnerAsleep(),
    steps: [
      { skill: 'sleep_with_owner', need: (b) => require('../skills/sleep').isNight(b) },
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
  isEnclosed,
  owns,
  nextUpgrade,
  UPGRADES,
};
