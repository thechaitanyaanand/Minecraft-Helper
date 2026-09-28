'use strict';
const { FOOD_PRIORITY } = require('../skills/eat');
const { RANGED_MOBS } = require('../state/world');

// buildState's inventory is a name->count map; older callers pass has_food/logs directly.
const hasFood = (state) => Boolean(state?.inventory?.has_food || state?.has_food ||
  Object.keys(state?.inventory || {}).some((k) => FOOD_PRIORITY.includes(k)));
const logCount = (state) => state?.inventory?.logs ??
  Object.entries(state?.inventory || {}).reduce((n, [k, v]) => (/(_log|_wood|_stem)$/.test(k) ? n + v : n), 0);

// Worth fighting: melee range normally; creepers only behind a shield; skeletons from afar with a bow.
function canFight(state, h) {
  if (!h || (state?.health ?? 20) <= 10) return false;
  const dist = h.distance ?? 999, type = h.type || h.name || '';
  if (type === 'creeper') return Boolean(state?.tools?.shield) && dist <= 5;
  if (RANGED_MOBS.has(type) && state?.tools?.bow) return dist <= 16;
  return dist <= 5;
}

// Eat when hungry, or top up to full when hurt: a full food bar with saturation regenerates health fast.
const wantsToEat = (state) => (state?.food ?? 20) < 14 || ((state?.health ?? 20) <= 14 && (state?.food ?? 20) < 20);

/**
 * Hard safety overrides that run before any model call (§11.3).
 * The model cannot veto these.
 * @param {object} state - Game state snapshot
 * @returns {string|null} Action to take ('flee') or null if safe
 */
function safetyOverride(state) {
  if (!state) return null;

  // In lava or burning
  if (state.in_lava || state.on_fire) {
    return 'flee';
  }

  const hostiles = Array.isArray(state.nearby?.hostile_mobs)
    ? state.nearby.hostile_mobs
    : (Array.isArray(state.hostiles_near) ? state.hostiles_near : []);

  for (const h of hostiles) {
    const dist = typeof h.distance === 'number' ? h.distance : 999;
    const type = h.type || h.name || '';

    // Creeper <= 4 blocks -> instant flee, unless we can block the blast and fight it
    if (type === 'creeper' && dist <= 4 && !canFight(state, h)) {
      return 'flee';
    }

    // Health <= 4 with any hostile <= 8 blocks -> instant flee
    if ((state.health ?? 20) <= 4 && dist <= 8) {
      return 'flee';
    }
  }

  return null;
}

/**
 * Heuristic pick for interrupt question (§11.3).
 * @param {object} state - Game state snapshot
 * @param {object|string[]} [criteriaOrOptions] - Allowed options
 * @returns {string} Chosen interrupt option
 */
function interrupt(state, criteriaOrOptions) {
  const allowed = Array.isArray(criteriaOrOptions)
    ? criteriaOrOptions
    : (criteriaOrOptions && typeof criteriaOrOptions === 'object' ? Object.keys(criteriaOrOptions) : null);

  const isLegal = (opt) => !allowed || allowed.includes(opt);

  // Safety override takes precedence
  const override = safetyOverride(state);
  if (override && isLegal(override)) {
    return override;
  }

  const hostiles = Array.isArray(state?.nearby?.hostile_mobs)
    ? state.nearby.hostile_mobs
    : (Array.isArray(state?.hostiles_near) ? state.hostiles_near : []);

  const nearestHostile = hostiles.length > 0 ? hostiles[0] : null;
  const hostileDist = nearestHostile ? (nearestHostile.distance ?? 999) : 999;
  const hostileType = nearestHostile ? (nearestHostile.type || nearestHostile.name || '') : '';

  if (isLegal('fight') && canFight(state, nearestHostile)) {
    return 'fight';
  }

  // Flee from a creeper we can't block, or from anything when too hurt to fight. A healthy bot keeps working and fights at <= 5.
  if (isLegal('flee') && hostileDist <= 10 && ((hostileType === 'creeper' && !canFight(state, nearestHostile)) || (state?.health ?? 20) <= 10)) {
    return 'flee';
  }

  // Dig in if >= 3 hostiles within 16
  const hostileCount = hostiles.filter((h) => (h.distance ?? 999) <= 16).length;
  if (isLegal('dig_in') && hostileCount >= 3) {
    return 'dig_in';
  }

  // Eat when hungry or to heal up
  if (isLegal('eat_food') && wantsToEat(state)) {
    return 'eat_food';
  }

  // Hunt food if hunger is critical (< 10)
  if (isLegal('get_food') && (state?.food ?? 20) < 10) {
    return 'get_food';
  }

  return isLegal('continue_task') ? 'continue_task' : (allowed?.[0] || 'continue_task');
}

/**
 * Heuristic baseline goal order for autopilot (§11.4).
 * night -> survive_night; food<10 -> get_food; no pickaxe -> make_tools; logs<8 -> get_wood; else get_food
 * @param {object} state - Game state snapshot
 * @param {object|string[]} [criteriaOrOptions] - Allowed goal IDs
 * @returns {string} Chosen next goal
 */
function nextGoal(state, criteriaOrOptions) {
  const allowed = Array.isArray(criteriaOrOptions)
    ? criteriaOrOptions
    : (criteriaOrOptions && typeof criteriaOrOptions === 'object' ? Object.keys(criteriaOrOptions) : null);

  const isAvailable = (g) => !allowed || allowed.includes(g);

  // 1. Night or dusk -> survive_night
  if ((state?.time_of_day === 'night' || state?.time_of_day === 'dusk') && isAvailable('survive_night')) {
    return 'survive_night';
  }

  // 2. Starving (< 10) -> get_food
  if ((state?.food ?? 20) < 10 && isAvailable('get_food')) {
    return 'get_food';
  }

  // 3. No pickaxe -> make_tools
  const hasPickaxe = state?.tools?.pickaxe && state.tools.pickaxe !== 'none';
  if (!hasPickaxe && isAvailable('make_tools')) {
    return 'make_tools';
  }

  // 4. Logs < 8 -> get_wood
  if (logCount(state) < 8 && isAvailable('get_wood')) {
    return 'get_wood';
  }

  // 5. Basics covered -> work toward better gear
  if (isAvailable('progress')) return 'progress';

  // 6. Default
  if (isAvailable('get_food')) return 'get_food';
  if (isAvailable('get_wood')) return 'get_wood';
  return allowed?.[0] || 'get_wood';
}

function getLegalInterrupts(state) {
  const legal = ['continue_task'];
  const food = state?.food ?? 20;
  const health = state?.health ?? 20;
  const hostiles = Array.isArray(state?.nearby?.hostile_mobs)
    ? state.nearby.hostile_mobs
    : (Array.isArray(state?.hostiles_near) ? state.hostiles_near : []);
  const nearestHostile = hostiles[0];
  const hostileDist = nearestHostile ? (nearestHostile.distance ?? 999) : 999;
  const hostileType = nearestHostile ? (nearestHostile.type || nearestHostile.name || '') : '';

  if (wantsToEat(state) && hasFood(state)) legal.push('eat_food');
  // Only offer running away when fighting isn't a sure thing: otherwise the model sometimes picks "run" over "fight"
  // for a lone zombie, and a buddy that flees from zombies is no buddy.
  const outnumbered = hostiles.filter((h) => (h.distance ?? 999) <= 10).length >= 3;
  if (canFight(state, nearestHostile)) legal.push('fight');
  if (hostileDist <= 10 && (!legal.includes('fight') || outnumbered)) legal.push('flee');
  // Night alone is not a reason to abandon a task (autopilot has its own survive_night goal); being swarmed is.
  if (hostiles.filter((h) => (h.distance ?? 999) <= 16).length >= 3) legal.push('dig_in');
  if (food < 10 && !hasFood(state)) legal.push('get_food');

  return legal;
}

module.exports = {
  safetyOverride,
  canFight,
  interrupt,
  nextGoal,
  getLegalInterrupts,
};
