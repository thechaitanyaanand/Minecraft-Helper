'use strict';

const HOSTILE_MOBS = new Set([
  'zombie', 'husk', 'drowned', 'skeleton', 'stray', 'creeper',
  'spider', 'cave_spider', 'witch', 'slime', 'phantom',
  'zombie_villager', 'pillager', 'enderman',
]);

const FOOD_MOBS = new Set([
  'cow', 'pig', 'chicken', 'sheep', 'rabbit', 'mooshroom',
]);

const TOOL_TIERS = Object.freeze([
  'none', 'wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite',
]);

const CHECKED_NAMES = Object.freeze([
  'lava', 'fire', 'magma_block', 'sweet_berry_bush', 'powder_snow', 'cactus',
  'chest', 'barrel', 'furnace', 'crafting_table', 'white_bed', 'red_bed', 'oak_door',
  'stone', 'cobblestone', 'dirt', 'grass_block',
  'oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
  'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'golden_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe',
  'wooden_axe', 'stone_axe', 'iron_axe', 'golden_axe', 'diamond_axe', 'netherite_axe',
  'wooden_sword', 'stone_sword', 'iron_sword', 'golden_sword', 'diamond_sword', 'netherite_sword',
  'stick', 'oak_planks',
]);

function timeOfDayLabel(t) {
  const time = typeof t === 'number' && Number.isFinite(t) ? t : 0;
  if (time < 12000) return 'day';
  if (time < 13000) return 'dusk';
  if (time < 23000) return 'night';
  return 'dawn';
}

function countItem(bot, name) {
  if (!bot?.inventory?.items) return 0;
  return bot.inventory.items().reduce((acc, it) => (it.name === name ? acc + it.count : acc), 0);
}

function countItemsMatching(bot, regex) {
  if (!bot?.inventory?.items) return 0;
  return bot.inventory.items().reduce((acc, it) => (regex.test(it.name) ? acc + it.count : acc), 0);
}

function bestToolTier(bot, kind) {
  if (!bot?.inventory?.items) return 'none';
  let bestIdx = 0;
  for (const it of bot.inventory.items()) {
    if (it.name && it.name.endsWith(`_${kind}`)) {
      const tier = it.name.slice(0, it.name.indexOf(`_${kind}`));
      const idx = TOOL_TIERS.indexOf(tier);
      if (idx > bestIdx) bestIdx = idx;
    }
  }
  return TOOL_TIERS[bestIdx];
}

function logBlockIds(mcData) {
  if (!mcData?.blocksByName) return [];
  const ids = [];
  for (const [name, b] of Object.entries(mcData.blocksByName)) {
    if (name.endsWith('_log') && !name.startsWith('stripped_')) {
      ids.push(b.id);
    }
  }
  return ids;
}

function hostilesNear(bot, radius = 16) {
  if (!bot?.entity?.position || !bot?.entities) return [];
  const pos = bot.entity.position;
  const out = [];

  for (const e of Object.values(bot.entities)) {
    if (!e || e === bot.entity || !e.position) continue;
    if (!HOSTILE_MOBS.has(e.name)) continue;

    const d = pos.distanceTo(e.position);
    if (d > radius) continue;
    if (e.name === 'enderman' && d > 4) continue;

    out.push({ type: e.name, distance: Math.round(d) });
  }

  out.sort((a, b) => a.distance - b.distance);
  return out;
}

function ownerEntity(bot, ownerName) {
  if (!bot || !ownerName) return null;
  return bot.players?.[ownerName]?.entity || null;
}

function checkNames(mcData, extraNames = []) {
  if (!mcData) throw new Error('checkNames: mcData is required');
  const allNames = [...CHECKED_NAMES, ...extraNames];
  const missing = [];
  for (const name of allNames) {
    const isBlock = Boolean(mcData.blocksByName?.[name]);
    const isItem = Boolean(mcData.itemsByName?.[name]);
    if (!isBlock && !isItem) {
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing minecraft-data block/item names: ${missing.join(', ')}`);
  }
}

module.exports = {
  HOSTILE_MOBS,
  FOOD_MOBS,
  TOOL_TIERS,
  CHECKED_NAMES,
  timeOfDayLabel,
  countItem,
  countItemsMatching,
  bestToolTier,
  logBlockIds,
  hostilesNear,
  ownerEntity,
  checkNames,
};
