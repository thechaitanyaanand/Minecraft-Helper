'use strict';

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

    // Creeper <= 4 blocks -> instant flee
    if (type === 'creeper' && dist <= 4) {
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

  // Hostile <= 5 blocks, health > 10, not a creeper -> fight
  if (isLegal('fight') && hostileDist <= 5 && (state?.health ?? 20) > 10 && hostileType !== 'creeper') {
    return 'fight';
  }

  // Hostile <= 10 blocks -> flee
  if (isLegal('flee') && hostileDist <= 10) {
    return 'flee';
  }

  // Dig in if night/dusk or >= 3 hostiles within 16
  const isNight = state?.time_of_day === 'night' || state?.time_of_day === 'dusk';
  const hostileCount = hostiles.filter((h) => (h.distance ?? 999) <= 16).length;
  if (isLegal('dig_in') && (isNight || hostileCount >= 3)) {
    return 'dig_in';
  }

  // Eat food if food < 14
  if (isLegal('eat_food') && (state?.food ?? 20) < 14) {
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
  const logCount = state?.inventory?.logs || 0;
  if (logCount < 8 && isAvailable('get_wood')) {
    return 'get_wood';
  }

  // 5. Default
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

  if (food < 14 && (state?.inventory?.has_food || state?.has_food)) legal.push('eat_food');
  if (hostileDist <= 10) legal.push('flee');
  if (hostileDist <= 5 && health > 10 && hostileType !== 'creeper') legal.push('fight');
  const isNight = state?.time_of_day === 'night' || state?.time_of_day === 'dusk';
  if (isNight || hostiles.filter((h) => (h.distance ?? 999) <= 16).length >= 3) legal.push('dig_in');
  if (food < 10 && !(state?.inventory?.has_food || state?.has_food)) legal.push('get_food');

  return legal;
}

module.exports = {
  safetyOverride,
  interrupt,
  nextGoal,
  getLegalInterrupts,
};
