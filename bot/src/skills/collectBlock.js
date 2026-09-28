'use strict';
const { isProtected } = require('../safety/protect');
const { countItem, countItemsMatching, bestToolTier } = require('../state/world');

function countTarget(bot, dropName, blockNames) {
  if (dropName === 'logs' || dropName === 'log') {
    return countItemsMatching(bot, /_log$/);
  }
  if (dropName && dropName !== 'logs') {
    const c = countItem(bot, dropName);
    if (c > 0) return c;
  }
  if (Array.isArray(blockNames)) {
    return blockNames.reduce((sum, n) => sum + countItem(bot, n), 0);
  }
  return 0;
}

const JUNK = /^(gravel|sand|granite|diorite|andesite|tuff|calcite|netherrack|rotten_flesh|wheat_seeds|poisonous_potato|flint)$/;

const freeSlotCount = (bot) => (typeof bot?.inventory?.emptySlotCount === 'function'
  ? bot.inventory.emptySlotCount()
  : 36 - (bot?.inventory?.items ? bot.inventory.items().length : 0));

async function tossJunk(bot) {
  for (const it of bot.inventory?.items?.() || []) {
    if (JUNK.test(it.name) && bot.toss) { try { await bot.toss(it.type, null, it.count); } catch (_) {} }
  }
}

module.exports = {
  name: 'collect_block',
  describe: 'collect natural blocks from the world',
  timeoutMs: 90_000,

  isAvailable(bot, ctx, args = {}) {
    if (freeSlotCount(bot) <= 2) return { ok: false, reason: 'inventory_full' };
    if (args.needsTool && bestToolTier(bot, args.needsTool) === 'none') {
      return { ok: false, reason: 'no_tool' };
    }
    return { ok: true };
  },

  async run(bot, ctx, token, args = {}) {
    token.throwIfCancelled();

    // Inventory check: toss junk first, only give up if still <= 2 free slots
    if (freeSlotCount(bot) <= 2) await tossJunk(bot);
    if (freeSlotCount(bot) <= 2) {
      return { ok: false, reason: 'inventory_full' };
    }

    // Tool check
    if (args.needsTool) {
      const tier = bestToolTier(bot, args.needsTool);
      if (tier === 'none') {
        return { ok: false, reason: 'no_tool' };
      }
      if (bot.inventory?.items && bot.equip) {
        const toolItem = bot.inventory.items().find((it) => it.name.endsWith(`_${args.needsTool}`));
        if (toolItem) {
          try { await bot.equip(toolItem, 'hand'); } catch (_) {}
        }
      }
    }

    const count = args.count || 1;
    const blockNames = Array.isArray(args.blockNames) ? args.blockNames : [args.blockNames].filter(Boolean);
    const dropName = args.dropName || blockNames[0] || 'item';
    const mcData = require('minecraft-data')(bot?.version || '1.20.4');

    const blockIds = blockNames
      .map((n) => mcData.blocksByName[n]?.id)
      .filter((id) => typeof id === 'number');

    if (blockIds.length === 0) {
      return { ok: false, reason: 'no_target' };
    }

    const pos = bot.entity?.position;
    const point = typeof pos?.floored === 'function' ? pos.floored() : pos;
    const foundPositions = bot.findBlocks
      ? bot.findBlocks({ matching: blockIds, maxDistance: 64, count: Math.max(count * 4, 32), point })
      : [];

    const safePositions = foundPositions.filter((p) => {
      const b = bot.blockAt ? bot.blockAt(p) : { position: p };
      return !isProtected(b, ctx);
    });

    if (safePositions.length === 0) {
      return { ok: false, reason: 'no_target' };
    }

    if (bot.pathfinder?.setMovements) {
      const { safeMovements } = require('../safety/movements');
      bot.pathfinder.setMovements(safeMovements(bot, mcData));
    }

    safePositions.sort((a, b) => {
      const distA = Math.hypot(a.x - point.x, a.z - point.z) + Math.abs(a.y - point.y) * 2.5;
      const distB = Math.hypot(b.x - point.x, b.z - point.z) + Math.abs(b.y - point.y) * 2.5;
      return distA - distB;
    });

    const accessible = safePositions.filter((p) => Math.abs(p.y - point.y) <= 16);
    const candidates = accessible.length > 0 ? accessible : safePositions;
    const targetPositions = candidates.slice(0, count);
    const targetBlocks = targetPositions.map((p) => (bot.blockAt ? bot.blockAt(p) : { position: p })).filter(Boolean);

    if (targetBlocks.length === 0) {
      return { ok: false, reason: 'no_target' };
    }

    const countBefore = countTarget(bot, dropName, blockNames);

    token.throwIfCancelled();
    if (bot.collectBlock?.collect) {
      try {
        await bot.collectBlock.collect(targetBlocks, { ignoreNoPath: false });
      } catch (err) {
        if (token.cancelled) throw err;
        const msg = String(err?.message || '');
        if (/no path/i.test(msg) || err?.name === 'NoPath') {
          return { ok: false, reason: 'no_path', message: 'no reachable path to target block' };
        }
      }
    }
    token.throwIfCancelled();

    const countAfter = countTarget(bot, dropName, blockNames);
    if (countAfter > countBefore) {
      const diff = countAfter - countBefore;
      return { ok: true, message: `collected ${diff} ${dropName}`, collectedCount: diff };
    }

    return { ok: false, reason: 'collection_failed', message: 'no items collected' };
  },
};
