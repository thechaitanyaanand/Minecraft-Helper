'use strict';
const log = require('../log');
const {
  timeOfDayLabel,
  bestToolTier,
  logBlockIds,
  hostilesNear,
  ownerEntity,
  FOOD_MOBS,
} = require('./world');

function sanitizeMessage(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/§[0-9a-fk-or]/gi, '')
    .replace(/§./g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function checkInWater(bot) {
  if (!bot?.entity) return false;
  if (bot.entity.isInWater || bot.entity.inWater) return true;
  if (!bot.entity.position || !bot.blockAt) return false;
  const b = bot.blockAt(bot.entity.position);
  return b?.name === 'water' || b?.name === 'flowing_water';
}

function getInventoryMap(bot) {
  const inv = {};
  if (bot?.inventory?.items) {
    for (const it of bot.inventory.items()) {
      if (it?.name && typeof it.count === 'number') {
        inv[it.name] = (inv[it.name] || 0) + it.count;
      }
    }
  }
  const sortedNames = Object.keys(inv).sort().slice(0, 15);
  const out = {};
  for (const name of sortedNames) {
    out[name] = inv[name];
  }
  return out;
}

function getNearby(bot, ownerName, mcData) {
  const pos = bot?.entity?.position;

  // Trees within 32
  let treesWithin32 = 0;
  if (bot?.findBlocks && pos && mcData) {
    try {
      const logIds = logBlockIds(mcData);
      const point = typeof pos.floored === 'function' ? pos.floored() : pos;
      const found = bot.findBlocks({ matching: logIds, maxDistance: 32, count: 64, point });
      treesWithin32 = Array.isArray(found) ? found.length : 0;
    } catch (_) {}
  }

  // Stone within 16
  let stoneWithin16 = false;
  if (bot?.findBlock && pos && mcData?.blocksByName) {
    try {
      const stoneIds = [mcData.blocksByName.stone?.id, mcData.blocksByName.cobblestone?.id].filter(
        (id) => typeof id === 'number'
      );
      stoneWithin16 = bot.findBlock({ matching: stoneIds, maxDistance: 16 }) !== null;
    } catch (_) {}
  }

  // Passive food mobs within 24
  const foodMobNames = new Set();
  if (bot?.entities && pos) {
    for (const e of Object.values(bot.entities)) {
      if (!e || e === bot.entity || !e.position) continue;
      if (FOOD_MOBS.has(e.name) && typeof pos.distanceTo === 'function') {
        if (pos.distanceTo(e.position) <= 24) {
          foodMobNames.add(e.name);
        }
      }
    }
  }
  const passiveFoodMobs = Array.from(foodMobNames).sort();

  // Hostile mobs (nearest 3 within 16)
  const hostileMobs = hostilesNear(bot, 16).slice(0, 3);

  // Owner distance
  let ownerDistance = null;
  const owner = ownerEntity(bot, ownerName);
  if (owner?.position && pos && typeof pos.distanceTo === 'function') {
    ownerDistance = Math.round(pos.distanceTo(owner.position));
  }

  return {
    trees_within_32: treesWithin32,
    stone_within_16: stoneWithin16,
    passive_food_mobs: passiveFoodMobs,
    hostile_mobs: hostileMobs,
    owner_distance: ownerDistance,
  };
}

/**
 * Builds the compact, stable state JSON object (§9.2).
 * @param {object} bot - Mineflayer bot instance or stub
 * @param {object} ctx - { ownerName, currentGoal, currentStep, lastStepResult, autopilot }
 * @param {object} opts - { purpose, playerMessage }
 * @returns {object} Normalized state object with exact key order
 */
function buildState(bot, ctx = {}, opts = {}) {
  const purpose = opts.purpose || 'intent';
  const ownerName = ctx.ownerName || 'owner';
  let mcData = null;
  try {
    mcData = require('minecraft-data')(bot?.version || '1.20.4');
  } catch (_) {}

  // Enforce literal, fixed key order
  const state = {};
  state.purpose = purpose;
  if (purpose === 'intent') {
    state.player_message = sanitizeMessage(opts.playerMessage);
  }

  state.time_of_day = timeOfDayLabel(bot?.time?.timeOfDay ?? 6000);
  state.health = Math.round(bot?.health ?? 20);
  state.food = Math.round(bot?.food ?? 20);
  state.y_level = Math.round(bot?.entity?.position?.y ?? 64);
  state.in_water = checkInWater(bot);
  state.inventory = getInventoryMap(bot);

  state.tools = {
    pickaxe: bestToolTier(bot, 'pickaxe'),
    axe: bestToolTier(bot, 'axe'),
    sword: bestToolTier(bot, 'sword'),
  };

  state.nearby = getNearby(bot, ownerName, mcData);

  state.current_goal = ctx.currentGoal || 'none';
  state.current_step = ctx.currentStep || 'none';
  state.last_step_result = ctx.lastStepResult || 'none';
  state.autopilot = Boolean(ctx.autopilot);

  const jsonStr = JSON.stringify(state);
  if (jsonStr.length > 1500) {
    log.warn(`[buildState] State size (${jsonStr.length} chars) exceeds 1500 chars limit`);
  }

  return state;
}

module.exports = { buildState };
