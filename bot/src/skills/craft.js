'use strict';
const { goals } = require('mineflayer-pathfinder');

const PLANK_TYPES = Object.freeze([
  'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
  'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks',
]);

async function clearPlayerCraftingGrid(bot) {
  if (!bot?.inventory?.slots) return;
  if (bot.inventory.selectedItem) {
    const emptySlot = bot.inventory.firstEmptySlotRange?.(bot.inventory.inventoryStart, bot.inventory.inventoryEnd);
    if (emptySlot !== null && emptySlot !== undefined && bot.clickWindow) {
      try { await bot.clickWindow(emptySlot, 0, 0); } catch (_) {}
    }
  }
  for (let s = 1; s <= 4; s++) {
    if (bot.inventory.slots[s] && bot.putAway) {
      try { await bot.putAway(s); } catch (_) {}
    }
  }
}

module.exports = {
  name: 'craft',
  describe: 'craft items using inventory or a crafting table',
  timeoutMs: 25_000,

  async run(bot, ctx, token, args = {}) {
    token.throwIfCancelled();
    await clearPlayerCraftingGrid(bot);
    token.throwIfCancelled();
    const mcData = require('minecraft-data')(bot?.version || '1.20.4');
    let itemName = args.item || 'oak_planks';
    const count = args.count || 1;
    // Any plank type satisfies a planks request (planner says oak, bot may only hold birch logs).
    const names = itemName.endsWith('_planks') || itemName === 'planks' ? [...new Set([itemName, ...PLANK_TYPES])].filter((n) => n !== 'planks') : [itemName];
    if (!mcData.itemsByName[names[0]]) return { ok: false, reason: 'unknown_item', message: `Unknown item: ${itemName}` };

    const findRecipe = (table) => {
      for (const n of names) {
        const r = bot.recipesFor ? bot.recipesFor(mcData.itemsByName[n].id, null, 1, table) : [];
        if (r?.length) { itemName = n; return r[0]; }
      }
      return null;
    };

    // 2x2 inventory grid first; only walk to a crafting table if the recipe needs one.
    let table = null;
    let recipe = findRecipe(null);
    if (!recipe) {
      const tableId = mcData.blocksByName.crafting_table?.id;
      table = bot.findBlock ? bot.findBlock({ matching: tableId, maxDistance: 4 }) : null;
      if (!table) {
        const distantTable = bot.findBlock ? bot.findBlock({ matching: tableId, maxDistance: 32 }) : null;
        if (!distantTable) return { ok: false, reason: 'no_table' };
        if (bot.pathfinder?.goto) {
          token.throwIfCancelled();
          const p = distantTable.position;
          await bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 2));
          token.throwIfCancelled();
        }
        table = bot.findBlock({ matching: tableId, maxDistance: 4 });
        if (!table) return { ok: false, reason: 'no_table' };
      }
      recipe = findRecipe(table);
    }
    if (!recipe) return { ok: false, reason: 'no_recipe_or_missing_items' };

    const yieldPerRun = recipe.result?.count || 1;
    const runs = args.runs || Math.ceil(count / yieldPerRun);

    token.throwIfCancelled();
    if (bot.craft) {
      try {
        await bot.craft(recipe, runs, table || undefined);
      } catch (err) {
        if (runs === 1) throw err;
        // Mixed ingredients (e.g. 1 birch + 1 spruce log): craft one run at a time with whatever fits.
        for (let i = 0; i < runs; i++) {
          token.throwIfCancelled();
          const r = findRecipe(table);
          if (!r) break;
          await bot.craft(r, 1, table || undefined);
        }
      }
    }
    token.throwIfCancelled();

    return {
      ok: true,
      message: `crafted ${runs * yieldPerRun} ${itemName}`,
      item: itemName,
      count: runs * yieldPerRun,
    };
  },
};
