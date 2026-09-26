'use strict';
const { goals } = require('mineflayer-pathfinder');

const PLANK_TYPES = Object.freeze([
  'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
  'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks',
]);

module.exports = {
  name: 'craft',
  describe: 'craft items using inventory or a crafting table',
  timeoutMs: 25_000,

  async run(bot, ctx, token, args = {}) {
    token.throwIfCancelled();
    const mcData = require('minecraft-data')(bot?.version || '1.20.4');
    let itemName = args.item || 'oak_planks';
    const count = args.count || 1;

    // For generic 'planks', find the log type the bot owns and pick that plank type
    if (itemName === 'planks') {
      let foundPlank = null;
      for (const pName of PLANK_TYPES) {
        const it = mcData.itemsByName[pName];
        if (it && bot.recipesFor && bot.recipesFor(it.id, null, 1, null).length > 0) {
          foundPlank = pName;
          break;
        }
      }
      if (!foundPlank) {
        return { ok: false, reason: 'no_recipe_or_missing_items' };
      }
      itemName = foundPlank;
    }

    const item = mcData.itemsByName[itemName];
    if (!item) {
      return { ok: false, reason: 'unknown_item', message: `Unknown item: ${itemName}` };
    }

    // Check if 2x2 craft (no table required)
    const is2x2 = itemName.endsWith('_planks') || itemName === 'stick' || itemName === 'crafting_table';
    let table = null;

    if (!is2x2) {
      // Tools and 3x3 items require a crafting table within reach (<= 4 blocks)
      const tableId = mcData.blocksByName.crafting_table?.id;
      if (typeof tableId === 'number' && bot.findBlock) {
        table = bot.findBlock({ matching: tableId, maxDistance: 4 });

        if (!table) {
          // Check if table exists within 32 blocks and walk to it
          const distantTable = bot.findBlock({ matching: tableId, maxDistance: 32 });
          if (!distantTable) {
            return { ok: false, reason: 'no_table' };
          }
          if (bot.pathfinder?.goto) {
            token.throwIfCancelled();
            const p = distantTable.position;
            await bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 2));
            token.throwIfCancelled();
          }
          table = bot.findBlock({ matching: tableId, maxDistance: 4 });
          if (!table) {
            return { ok: false, reason: 'no_table' };
          }
        }
      } else {
        return { ok: false, reason: 'no_table' };
      }
    }

    const recipes = bot.recipesFor ? bot.recipesFor(item.id, null, 1, table || null) : [];
    if (!recipes || recipes.length === 0) {
      return { ok: false, reason: 'no_recipe_or_missing_items' };
    }

    const recipe = recipes[0];
    const yieldPerRun = recipe.result?.count || 1;
    const runs = Math.ceil(count / yieldPerRun);

    token.throwIfCancelled();
    if (bot.craft) {
      await bot.craft(recipe, runs, table || undefined);
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
