'use strict';
const { Vec3 } = require('vec3');

const HOSTILE_MOBS = new Set([
  'zombie', 'husk', 'drowned', 'skeleton', 'stray', 'creeper',
  'spider', 'cave_spider', 'witch', 'slime', 'phantom',
  'zombie_villager', 'pillager', 'enderman',
  'blaze', 'ghast', 'magma_cube', 'piglin_brute', 'silverfish', 'ender_dragon',
]);

// Mobs that shoot from range: worth answering with a bow instead of chasing.
const RANGED_MOBS = new Set(['skeleton', 'stray', 'pillager', 'blaze', 'ghast']);

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
  'cooked_beef', 'cooked_porkchop', 'bread', 'cooked_chicken', 'cooked_mutton',
  'baked_potato', 'apple', 'carrot', 'beef', 'porkchop', 'mutton', 'chicken', 'rabbit',
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
  return bot.inventory.items().reduce((acc, it) => (it.name === name ? acc + (typeof it.count === 'number' ? it.count : 1) : acc), 0);
}

function countItemsMatching(bot, regex) {
  if (!bot?.inventory?.items) return 0;
  return bot.inventory.items().reduce((acc, it) => (regex.test(it.name) ? acc + (typeof it.count === 'number' ? it.count : 1) : acc), 0);
}

// items() skips the off-hand slot (45), where an equipped shield lives.
const hasShield = (bot) => bot?.inventory?.slots?.[45]?.name === 'shield' || countItem(bot, 'shield') > 0;
const hasBow = (bot) => countItem(bot, 'bow') > 0 && countItem(bot, 'arrow') > 0;

// Moves a shield into the off-hand if it's sitting in the inventory. Returns true when one is ready.
async function equipShield(bot) {
  if (bot?.inventory?.slots?.[45]?.name === 'shield') return true;
  const shield = bot?.inventory?.items?.().find((it) => it.name === 'shield');
  if (!shield || !bot.equip) return false;
  try { await bot.equip(shield, 'off-hand'); return true; } catch (_) { return false; }
}

// Raise/lower the off-hand shield (a raised shield blocks melee, arrows and frontal explosions).
function setShield(bot, up) {
  if (!!bot._shieldUp === up) return;
  bot._shieldUp = up;
  try { up ? bot.activateItem?.(true) : bot.deactivateItem?.(); } catch (_) {}
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
    if ((name.endsWith('_log') || name.endsWith('_wood') || name.endsWith('_stem')) && !name.startsWith('stripped_')) {
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

function isOwnerKnown(bot, ownerName) {
  if (!bot || !ownerName) return false;
  return Boolean(bot.players?.[ownerName] || ownerEntity(bot, ownerName) || bot._lastOwnerPos);
}

let pendingQuery = null;

function queryOwnerPos(bot, ownerName, timeoutMs = 1200) {
  if (!bot || !ownerName || typeof bot.chat !== 'function') return Promise.resolve(null);
  if (pendingQuery) return pendingQuery;

  pendingQuery = new Promise((resolve) => {
    let timer = null;
    const onMessage = (jsonMsg) => {
      const str = typeof jsonMsg === 'string' ? jsonMsg : (jsonMsg?.toString?.() || '');
      if (str.includes(ownerName) && str.includes('has the following entity data:')) {
        const m = str.match(/has the following entity data:\s*\[\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)[a-zA-Z]?,?\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)[a-zA-Z]?,?\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)[a-zA-Z]?\s*\]/i);
        if (m) {
          cleanup();
          const pos = new Vec3(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
          bot._lastOwnerPos = pos;
          bot._lastOwnerPosTime = Date.now();
          resolve(pos);
        }
      } else if (str.includes('No entity was found') || str.includes('Player not found')) {
        cleanup();
        resolve(null);
      }
    };

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (bot.removeListener) bot.removeListener('message', onMessage);
    };

    timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);

    if (bot.on) bot.on('message', onMessage);
    try {
      bot.chat(`/data get entity ${ownerName} Pos`);
    } catch (_) {
      cleanup();
      resolve(null);
    }
  }).finally(() => {
    pendingQuery = null;
  });

  return pendingQuery;
}

async function resolveOwnerPos(bot, ownerName) {
  if (!bot || !ownerName) return null;
  const ent = ownerEntity(bot, ownerName);
  if (ent?.position) {
    const p = ent.position.clone ? ent.position.clone() : new Vec3(ent.position.x, ent.position.y, ent.position.z);
    bot._lastOwnerPos = p;
    bot._lastOwnerPosTime = Date.now();
    return p;
  }

  if (bot._lastOwnerPos && (Date.now() - (bot._lastOwnerPosTime || 0)) < 1500) {
    return bot._lastOwnerPos;
  }

  if (bot.players?.[ownerName] && typeof bot.chat === 'function') {
    const queried = await queryOwnerPos(bot, ownerName);
    if (queried) return queried;
  }

  return bot._lastOwnerPos || null;
}

function parseCoords(text) {
  if (!text || typeof text !== 'string') return null;
  const labeled = text.match(/(?:x\s*[:=]\s*(-?\d+(?:\.\d+)?)[,\s]+y\s*[:=]\s*(-?\d+(?:\.\d+)?)[,\s]+z\s*[:=]\s*(-?\d+(?:\.\d+)?))/i);
  if (labeled) {
    return new Vec3(parseFloat(labeled[1]), parseFloat(labeled[2]), parseFloat(labeled[3]));
  }
  const m = text.match(/(?:^|[^\d.-])(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)(?:[^\d.-]|$)/);
  if (m) {
    const x = parseFloat(m[1]), y = parseFloat(m[2]), z = parseFloat(m[3]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      return new Vec3(x, y, z);
    }
  }
  return null;
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
  RANGED_MOBS,
  FOOD_MOBS,
  TOOL_TIERS,
  CHECKED_NAMES,
  timeOfDayLabel,
  countItem,
  countItemsMatching,
  bestToolTier,
  hasShield,
  hasBow,
  equipShield,
  setShield,
  logBlockIds,
  hostilesNear,
  ownerEntity,
  isOwnerKnown,
  queryOwnerPos,
  resolveOwnerPos,
  parseCoords,
  checkNames,
};

