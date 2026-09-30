'use strict';
const { bestToolTier, countItem, countItemsMatching, hasShield, equipShield } = require('../state/world');
const log = require('../log');

const KIT_TOOLS = Object.freeze([
  { kind: 'pickaxe', defaultItem: 'wooden_pickaxe', count: 1 },
  { kind: 'axe', defaultItem: 'wooden_axe', count: 1 },
  { kind: 'sword', defaultItem: 'wooden_sword', count: 1 },
  { kind: 'shovel', defaultItem: 'wooden_shovel', count: 1 },
]);

// [equip slot, inventory slot index, starter item, matches any tier of that piece]
const KIT_ARMOR = Object.freeze([
  ['head', 5, 'leather_helmet', /_helmet$/],
  ['torso', 6, 'leather_chestplate', /_chestplate$/],
  ['legs', 7, 'leather_leggings', /_leggings$/],
  ['feet', 8, 'leather_boots', /_boots$/],
]);

// Puts on the shield and fills any empty armor slot. Better pieces are equipped when the planner crafts them.
async function equipGear(bot) {
  await equipShield(bot);
  for (const [slot, idx, , re] of KIT_ARMOR) {
    if (bot?.inventory?.slots?.[idx]) continue;
    const piece = bot?.inventory?.items?.().find((it) => re.test(it.name));
    if (piece && bot.equip) { try { await bot.equip(piece, slot); } catch (_) {} }
  }
}

function getMissingKit(bot) {
  const missing = [];
  for (const t of KIT_TOOLS) {
    if (bestToolTier(bot, t.kind) === 'none') {
      missing.push({ item: t.defaultItem, count: t.count, kind: t.kind });
    }
  }
  if (!hasShield(bot)) missing.push({ item: 'shield', count: 1, kind: 'shield' });
  // _bedPlaced: the bed is out in the world while we sleep, not lost.
  if (!bot._bedPlaced && countItemsMatching(bot, /_bed$/) === 0) missing.push({ item: 'white_bed', count: 1, kind: 'bed' });
  if (countItem(bot, 'bow') === 0) missing.push({ item: 'bow', count: 1, kind: 'bow' });
  if (countItem(bot, 'arrow') < 16) missing.push({ item: 'arrow', count: 32, kind: 'arrow' });
  if (countItem(bot, 'crafting_table') < 1) missing.push({ item: 'crafting_table', count: 64, kind: 'crafting_table' });
  for (const [, idx, item, re] of KIT_ARMOR) {
    if (!bot.inventory?.slots?.[idx] && countItemsMatching(bot, re) === 0) missing.push({ item, count: 1, kind: 'armor' });
  }
  const foodCount = countItemsMatching(bot, /(cooked_|bread|apple|carrot|baked_potato)/);
  if (foodCount < 4) {
    missing.push({ item: 'bread', count: 16, kind: 'food' });
  }
  return missing;
}

function replenishKit(bot, config = {}, options = {}) {
  if (config.autoKit === false && !options.force) {
    return { ok: false, reason: 'disabled', replenished: [] };
  }
  const now = Date.now();
  if (!options.force && bot?._lastReplenish && now - bot._lastReplenish < 3000) {
    return { ok: true, replenished: [], skipped: 'cooldown' };
  }
  if (!bot || typeof bot.chat !== 'function') {
    return { ok: false, reason: 'no_bot', replenished: [] };
  }
  const missing = getMissingKit(bot);
  if (missing.length === 0) {
    return { ok: true, replenished: [] };
  }
  if (bot) bot._lastReplenish = now;
  const username = bot.username || 'Butler';
  for (const entry of missing) {
    try {
      bot.chat(`/give ${username} ${entry.item} ${entry.count}`);
      log.info(`[Kit] Replenished ${entry.item} x${entry.count} for ${username}`);
    } catch (err) {
      log.warn(`[Kit] Failed to replenish ${entry.item}:`, err.message);
    }
  }
  // /give lands a moment later; put the new gear on once it's there.
  const t = setTimeout(() => equipGear(bot).catch(() => {}), 1500);
  t.unref?.();
  return { ok: true, replenished: missing };
}

function startAutoReplenish(bot, config = {}, intervalMs = 20_000) {
  if (config.autoKit === false) {
    return { stop: () => {}, replenishNow: () => ({ ok: false, reason: 'disabled' }) };
  }
  replenishKit(bot, config);
  const timer = setInterval(() => {
    replenishKit(bot, config);
    equipGear(bot).catch(() => {});
  }, intervalMs);
  return {
    stop: () => clearInterval(timer),
    replenishNow: () => replenishKit(bot, config, { force: true }),
  };
}

module.exports = {
  KIT_TOOLS,
  KIT_ARMOR,
  equipGear,
  getMissingKit,
  replenishKit,
  startAutoReplenish,
};
