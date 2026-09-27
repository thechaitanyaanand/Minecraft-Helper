'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { ownerEntity, bestToolTier } = require('../state/world');

const SCAFFOLD_NAMES = new Set(['dirt', 'grass_block', 'cobblestone', 'stone', 'cobbled_deepslate', 'oak_planks', 'sand', 'gravel']);

function countScaffolding(bot) {
  if (!bot.inventory?.items) return 0;
  return bot.inventory.items().reduce((sum, it) => (SCAFFOLD_NAMES.has(it.name) ? sum + it.count : sum), 0);
}

async function clearCeilingIfUnderground(bot, ownerPos) {
  const botPos = bot.entity?.position;
  if (!botPos || !ownerPos || !bot.blockAt || !bot.dig || ownerPos.y <= botPos.y + 1) return;
  const feet = typeof botPos.floored === 'function' ? botPos.floored() : new Vec3(botPos.x, botPos.y, botPos.z).floored();
  const hasPick = bestToolTier(bot, 'pickaxe') !== 'none';
  for (let dy = 2; dy <= 3; dy++) {
    const ceil = bot.blockAt(feet.offset(0, dy, 0));
    if (ceil && ceil.name !== 'air' && (ceil.boundingBox === 'block' || ceil.boundingBox !== 'empty')) {
      const isStone = ['stone', 'cobblestone', 'deepslate', 'andesite', 'diorite', 'granite', 'tuff'].includes(ceil.name);
      if (isStone && !hasPick) continue;
      const tool = bot.pathfinder?.bestHarvestTool?.(ceil);
      if (tool && bot.equip) { try { await bot.equip(tool, 'hand'); } catch (_) {} }
      try { await bot.dig(ceil); } catch (_) {}
    }
  }
}

async function gatherScaffoldIfTrapped(bot, neededCount = 3) {
  const botPos = bot.entity?.position;
  if (!botPos || !bot.blockAt || !bot.dig) return;
  const feet = typeof botPos.floored === 'function' ? botPos.floored() : new Vec3(botPos.x, botPos.y, botPos.z).floored();
  const hasPick = bestToolTier(bot, 'pickaxe') !== 'none';
  const offsets = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];

  let collected = countScaffolding(bot);
  for (const off of offsets) {
    if (collected >= neededCount) break;
    const b = bot.blockAt(feet.plus(off));
    if (!b || b.name === 'air' || (b.boundingBox !== 'block' && b.boundingBox !== 'empty')) continue;
    const isSoft = ['dirt', 'grass_block', 'sand', 'gravel'].includes(b.name);
    const isStone = ['stone', 'cobblestone', 'deepslate'].includes(b.name);
    if (isSoft || (isStone && hasPick)) {
      const tool = bot.pathfinder?.bestHarvestTool?.(b);
      if (tool && bot.equip) { try { await bot.equip(tool, 'hand'); } catch (_) {} }
      try { await bot.dig(b); collected++; await new Promise((r) => setTimeout(r, 150)); } catch (_) {}
    }
  }
}

const comeToOwner = {
  name: 'come_to_owner',
  describe: 'walk to the owner',
  timeoutMs: 60_000,
  isAvailable(bot, ctx) {
    return ownerEntity(bot, ctx?.ownerName) ? { ok: true } : { ok: false, reason: 'owner_not_found' };
  },
  async run(bot, ctx, token) {
    token.throwIfCancelled();
    const owner = ownerEntity(bot, ctx?.ownerName);
    if (!owner) return { ok: false, reason: 'owner_not_found', message: 'Owner is not visible nearby' };

    token.throwIfCancelled();
    if (bot.pathfinder?.goto) {
      await bot.pathfinder.goto(new goals.GoalNear(owner.position.x, owner.position.y, owner.position.z, 2));
    }
    token.throwIfCancelled();
    return { ok: true, message: 'reached owner' };
  },
};

const followOwner = {
  name: 'follow_owner',
  describe: 'follow the owner until cancelled',
  timeoutMs: 0,
  isAvailable(bot, ctx) {
    return ownerEntity(bot, ctx?.ownerName) ? { ok: true } : { ok: false, reason: 'owner_not_found' };
  },
  async run(bot, ctx, token) {
    token.throwIfCancelled();
    const owner = ownerEntity(bot, ctx?.ownerName);
    if (!owner) return { ok: false, reason: 'owner_not_found', message: 'Owner is not visible nearby' };

    token.throwIfCancelled();
    if (bot.pathfinder?.setGoal) {
      bot.pathfinder.setGoal(new goals.GoalFollow(owner, 2), true);
    }

    return new Promise((resolve) => {
      const onCancel = () => {
        try {
          if (bot.pathfinder?.stop) bot.pathfinder.stop();
          if (bot.pathfinder?.setGoal) bot.pathfinder.setGoal(null);
        } catch (_) {}
        resolve({ ok: true, message: 'stopped following' });
      };

      if (token.cancelled) {
        onCancel();
      } else {
        token.onCancel(onCancel);
      }
    });
  },
};

const giveToOwner = {
  name: 'give_to_owner',
  describe: 'walk to owner and toss inventory items',
  timeoutMs: 30_000,
  isAvailable(bot, ctx) {
    if (!ownerEntity(bot, ctx?.ownerName)) return { ok: false, reason: 'owner_not_found' };
    const items = bot.inventory?.items ? bot.inventory.items() : [];
    return items.length > 0 ? { ok: true } : { ok: false, reason: 'no_items' };
  },
  async run(bot, ctx, token, args = {}) {
    token.throwIfCancelled();
    const owner = ownerEntity(bot, ctx?.ownerName);
    if (!owner) return { ok: false, reason: 'owner_not_found', message: 'Owner is not visible nearby' };

    token.throwIfCancelled();
    if (bot.pathfinder?.goto) await bot.pathfinder.goto(new goals.GoalNear(owner.position.x, owner.position.y, owner.position.z, 2));
    token.throwIfCancelled();

    if (bot.lookAt && owner.position) {
      try { await bot.lookAt(owner.position.offset(0, owner.height ? owner.height * 0.8 : 1.6, 0)); } catch (_) {}
    }

    token.throwIfCancelled();
    const items = bot.inventory?.items ? [...bot.inventory.items()] : [];
    let tossedCount = 0;

    if (args.item) {
      const targetItems = items.filter((it) => it.name === args.item);
      let countNeeded = args.count || 999;
      for (const it of targetItems) {
        if (countNeeded <= 0) break;
        const toToss = Math.min(it.count, countNeeded);
        token.throwIfCancelled();
        if (bot.toss) { await bot.toss(it.type, null, toToss); tossedCount += toToss; countNeeded -= toToss; }
      }
    } else {
      for (const it of items) {
        token.throwIfCancelled();
        if (bot.toss) { await bot.toss(it.type, null, it.count); tossedCount += it.count; }
      }
    }
    return { ok: true, message: `tossed ${tossedCount} items to owner`, tossedCount };
  },
};

module.exports = {
  comeToOwner,
  followOwner,
  giveToOwner,
  clearCeilingIfUnderground,
  gatherScaffoldIfTrapped,
  countScaffolding,
};
