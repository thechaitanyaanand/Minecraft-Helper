'use strict';
const { goals } = require('mineflayer-pathfinder');
const { SMELTING } = require('../planner/smelting');

const FUEL_REGEX = /(coal|charcoal|_planks|_log|stick)/;

module.exports = {
  name: 'smelt',
  describe: 'smelt items using a furnace',
  timeoutMs: 45_000,

  isAvailable(bot, ctx, args = {}) {
    const mcData = require('minecraft-data')(bot?.version || '1.20.4');
    const furnaceId = mcData.blocksByName.furnace?.id;
    const hasFurnaceItem = bot?.inventory?.items?.().some((it) => it.name === 'furnace');
    const hasFurnaceBlock = furnaceId && bot.findBlock?.({ matching: furnaceId, maxDistance: 32 });
    return Boolean(hasFurnaceItem || hasFurnaceBlock);
  },

  async run(bot, ctx, token, args = {}) {
    token.throwIfCancelled();
    const mcData = require('minecraft-data')(bot?.version || '1.20.4');
    const targetItem = args.item || 'iron_ingot';
    const needed = args.count || 1;
    const recipe = SMELTING[targetItem];
    const inputName = recipe?.input || args.input || targetItem;

    const furnaceId = mcData.blocksByName.furnace?.id;
    if (!furnaceId) return { ok: false, reason: 'unknown_furnace_id' };

    let furnaceBlock = bot.findBlock ? bot.findBlock({ matching: furnaceId, maxDistance: 4 }) : null;
    if (!furnaceBlock && bot.findBlock) {
      const distant = bot.findBlock({ matching: furnaceId, maxDistance: 32 });
      if (distant && bot.pathfinder?.goto) {
        token.throwIfCancelled();
        await bot.pathfinder.goto(new goals.GoalNear(distant.position.x, distant.position.y, distant.position.z, 2));
        token.throwIfCancelled();
        furnaceBlock = bot.findBlock({ matching: furnaceId, maxDistance: 4 });
      }
    }

    if (!furnaceBlock) {
      return { ok: false, reason: 'no_furnace', message: 'No furnace found nearby' };
    }

    const inputItem = bot.inventory?.items?.().find((it) => it.name === inputName);
    if (!inputItem || inputItem.count < needed) {
      return { ok: false, reason: 'missing_input', message: `Need ${needed} ${inputName} to smelt` };
    }

    const fuelItem = bot.inventory?.items?.().find((it) => FUEL_REGEX.test(it.name));
    if (!fuelItem) {
      return { ok: false, reason: 'missing_fuel', message: 'No coal or wood fuel found in inventory' };
    }

    token.throwIfCancelled();
    let furnace = null;
    try {
      furnace = await bot.openFurnace(furnaceBlock);
      token.throwIfCancelled();

      const fuelCount = Math.min(fuelItem.count, Math.max(1, Math.ceil(needed / 8)));
      if (furnace.putFuel) await furnace.putFuel(fuelItem.type, null, fuelCount);
      token.throwIfCancelled();

      if (furnace.putInput) await furnace.putInput(inputItem.type, null, needed);
      token.throwIfCancelled();

      // Wait for output to be available
      const startTime = Date.now();
      while (!token.cancelled && Date.now() - startTime < 35_000) {
        const out = furnace.outputItem ? furnace.outputItem() : null;
        if (out && out.count >= needed) break;
        if (furnace.progress === 0 && (!furnace.inputItem || !furnace.inputItem())) break;
        await new Promise((r) => setTimeout(r, 1000));
      }

      token.throwIfCancelled();
      if (furnace.takeOutput && furnace.outputItem?.()) {
        await furnace.takeOutput();
      }

      return {
        ok: true,
        message: `Smelted ${needed} ${targetItem}`,
        item: targetItem,
        count: needed,
      };
    } catch (err) {
      return { ok: false, reason: err.message || 'furnace_error' };
    } finally {
      if (furnace && typeof furnace.close === 'function') {
        try { furnace.close(); } catch (_) {}
      }
    }
  },
};
