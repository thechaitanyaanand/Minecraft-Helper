'use strict';
const { bestToolTier, countItemsMatching } = require('../state/world');
const log = require('../log');

const KIT_TOOLS = Object.freeze([
  { kind: 'pickaxe', defaultItem: 'wooden_pickaxe', count: 1 },
  { kind: 'axe', defaultItem: 'wooden_axe', count: 1 },
  { kind: 'sword', defaultItem: 'wooden_sword', count: 1 },
  { kind: 'shovel', defaultItem: 'wooden_shovel', count: 1 },
]);

function getMissingKit(bot) {
  const missing = [];
  for (const t of KIT_TOOLS) {
    if (bestToolTier(bot, t.kind) === 'none') {
      missing.push({ item: t.defaultItem, count: t.count, kind: t.kind });
    }
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
  if (!bot || typeof bot.chat !== 'function') {
    return { ok: false, reason: 'no_bot', replenished: [] };
  }
  const missing = getMissingKit(bot);
  if (missing.length === 0) {
    return { ok: true, replenished: [] };
  }
  const username = bot.username || 'Helper';
  for (const entry of missing) {
    try {
      bot.chat(`/give ${username} ${entry.item} ${entry.count}`);
      log.info(`[Kit] Replenished ${entry.item} x${entry.count} for ${username}`);
    } catch (err) {
      log.warn(`[Kit] Failed to replenish ${entry.item}:`, err.message);
    }
  }
  return { ok: true, replenished: missing };
}

function startAutoReplenish(bot, config = {}, intervalMs = 20_000) {
  if (config.autoKit === false) {
    return { stop: () => {}, replenishNow: () => ({ ok: false, reason: 'disabled' }) };
  }
  replenishKit(bot, config);
  const timer = setInterval(() => {
    replenishKit(bot, config);
  }, intervalMs);
  return {
    stop: () => clearInterval(timer),
    replenishNow: () => replenishKit(bot, config, { force: true }),
  };
}

module.exports = {
  KIT_TOOLS,
  getMissingKit,
  replenishKit,
  startAutoReplenish,
};
