'use strict';
const mcData = require('minecraft-data')('1.20.4');
const { SMELTING } = require('./smelting');

const UNSUPPORTED = new Set(['bread', 'wheat', 'blaze_rod', 'blaze_powder', 'ender_eye', 'ender_pearl', 'nether_star', 'elytra', 'shulker_box', 'totem_of_undying', 'saddle']);
const MOB_DROPS = Object.freeze({
  raw_beef: ['cow'], raw_porkchop: ['pig'], raw_chicken: ['chicken'], raw_mutton: ['sheep'],
  string: ['spider'], spider_eye: ['spider'], bone: ['skeleton'], gunpowder: ['creeper'], rotten_flesh: ['zombie'],
});
const MANUFACTURED = new Set([
  'iron_block', 'gold_block', 'diamond_block', 'copper_block', 'emerald_block', 'lapis_block',
  'redstone_block', 'netherite_block', 'raw_iron_block', 'raw_gold_block', 'raw_copper_block', 'coal_block',
]);

// Reverse index: item drop -> block names
const BLOCK_DROPS = {};
for (const b of mcData.blocksArray) {
  if (b.drops && Array.isArray(b.drops) && !MANUFACTURED.has(b.name)) {
    for (const d of b.drops) {
      const dropName = mcData.items[d]?.name || mcData.blocks[d]?.name;
      if (dropName && !MANUFACTURED.has(dropName)) {
        if (!BLOCK_DROPS[dropName]) BLOCK_DROPS[dropName] = [];
        if (!BLOCK_DROPS[dropName].includes(b.name)) BLOCK_DROPS[dropName].push(b.name);
      }
    }
  }
}

function getCheapestHarvestTool(blockName) {
  const b = mcData.blocksByName[blockName];
  if (!b || !b.harvestTools || Object.keys(b.harvestTools).length === 0) return null;
  const tiers = ['wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite'];
  for (const tier of tiers) {
    for (const id of Object.keys(b.harvestTools)) {
      const it = mcData.items[id];
      if (it && it.name.startsWith(tier + '_')) return it.name;
    }
  }
  const firstId = Object.keys(b.harvestTools)[0];
  return mcData.items[firstId]?.name || null;
}

function resolveGroup(name) {
  if (name === 'group:logs') return 'oak_log';
  if (name === 'group:planks') return 'oak_planks';
  if (name === 'group:food') return 'cooked_beef';
  return name;
}

function getHave(inv, name) {
  if (!inv) return 0;
  if (name === 'group:logs') {
    return Object.entries(inv).reduce((sum, [k, v]) => (/(log|wood|stem)$/.test(k) ? sum + v : sum), 0);
  }
  if (name === 'group:planks') {
    return Object.entries(inv).reduce((sum, [k, v]) => (/planks$/.test(k) ? sum + v : sum), 0);
  }
  return inv[name] || 0;
}

function parseRecipe(r) {
  const ingredients = {};
  let width = 1;
  let height = 1;
  if (r.inShape) {
    height = r.inShape.length;
    width = Math.max(...r.inShape.map((row) => row.length));
    for (const row of r.inShape) {
      for (const id of row) {
        if (id !== null && id !== undefined) {
          const n = mcData.items[id]?.name || mcData.blocks[id]?.name;
          if (n) ingredients[n] = (ingredients[n] || 0) + 1;
        }
      }
    }
  } else if (r.ingredients) {
    for (const id of r.ingredients) {
      if (id !== null && id !== undefined) {
        const n = mcData.items[id]?.name || mcData.blocks[id]?.name;
        if (n) ingredients[n] = (ingredients[n] || 0) + 1;
      }
    }
    width = r.ingredients.length > 4 ? 3 : 2;
  }
  return { ingredients, needsTable: width > 2 || height > 2, resultCount: r.result?.count || 1 };
}

/**
 * Plans how to obtain target item in quantity n.
 * @param {string} target - item name or group
 * @param {number} n - count needed
 * @param {object} inv - current inventory
 * @param {number} depth - recursion depth
 * @param {Set} seen - recursion visited set
 * @returns {Array|object} steps list or { fail: reason }
 */
function plan(target, n = 1, inv = {}, depth = 0, seen = new Set()) {
  const normTarget = resolveGroup(target);
  const have = getHave(inv, normTarget);
  if (have >= n) return [];
  if (depth > 8 || seen.has(normTarget)) return { fail: 'too_deep' };
  if (UNSUPPORTED.has(normTarget)) return { fail: normTarget === 'bread' ? 'no_source' : 'not_yet' };

  const needed = n - have;
  const nextSeen = new Set(seen);
  nextSeen.add(normTarget);
  const simInv = { ...inv };

  // 1. CRAFT
  const itemInfo = mcData.itemsByName[normTarget] || mcData.blocksByName[normTarget];
  const recipes = itemInfo ? mcData.recipes[itemInfo.id] : null;
  if (recipes && recipes.length > 0) {
    for (const r of recipes) {
      const parsed = parseRecipe(r);
      const runs = Math.ceil(needed / parsed.resultCount);
      let craftSteps = [];
      let ok = true;

      // Plan each ingredient
      for (const [ingName, ingCount] of Object.entries(parsed.ingredients)) {
        const ingSteps = plan(ingName, ingCount * runs, simInv, depth + 1, nextSeen);
        if (ingSteps.fail) { ok = false; break; }
        craftSteps = craftSteps.concat(ingSteps);
        simInv[ingName] = (simInv[ingName] || 0) + (ingCount * runs);
      }

      if (ok) {
        if (parsed.needsTable && !simInv.placed_crafting_table) {
          const tableSteps = plan('crafting_table', 1, simInv, depth + 1, nextSeen);
          if (!tableSteps.fail) {
            craftSteps = craftSteps.concat(tableSteps);
            craftSteps.push({ skill: 'place_block', args: { name: 'crafting_table' } });
            simInv.placed_crafting_table = 1;
          }
        }
        craftSteps.push({ skill: 'craft', args: { item: normTarget, runs } });
        simInv[normTarget] = (simInv[normTarget] || 0) + (parsed.resultCount * runs);
        return craftSteps;
      }
    }
  }

  // 2. SMELT
  const smeltRecipe = SMELTING[normTarget];
  if (smeltRecipe) {
    let smeltSteps = [];
    const inputSteps = plan(smeltRecipe.input, needed * smeltRecipe.perItem, simInv, depth + 1, nextSeen);
    if (!inputSteps.fail) {
      smeltSteps = smeltSteps.concat(inputSteps);
      if (!simInv.placed_furnace) {
        const furnSteps = plan('furnace', 1, simInv, depth + 1, nextSeen);
        if (!furnSteps.fail) {
          smeltSteps = smeltSteps.concat(furnSteps);
          smeltSteps.push({ skill: 'place_block', args: { name: 'furnace' } });
          simInv.placed_furnace = 1;
        }
      }
      smeltSteps.push({ skill: 'smelt', args: { item: normTarget, count: needed } });
      simInv[normTarget] = (simInv[normTarget] || 0) + needed;
      return smeltSteps;
    }
  }

  // 3. MINE
  const sourceBlocks = BLOCK_DROPS[normTarget];
  if (sourceBlocks && sourceBlocks.length > 0) {
    let mineSteps = [];
    const bestBlock = sourceBlocks[0];
    const harvestTool = getCheapestHarvestTool(bestBlock);
    if (harvestTool && getHave(simInv, harvestTool) < 1) {
      const toolSteps = plan(harvestTool, 1, simInv, depth + 1, nextSeen);
      if (toolSteps.fail) return toolSteps;
      mineSteps = mineSteps.concat(toolSteps);
      simInv[harvestTool] = (simInv[harvestTool] || 0) + 1;
    }
    mineSteps.push({ skill: 'collect_block', args: { blockNames: sourceBlocks, count: needed } });
    simInv[normTarget] = (simInv[normTarget] || 0) + needed;
    return mineSteps;
  }

  // 4. KILL
  const mobSources = MOB_DROPS[normTarget];
  if (mobSources && mobSources.length > 0) {
    simInv[normTarget] = (simInv[normTarget] || 0) + needed;
    return [{ skill: 'hunt', args: { mobNames: mobSources, count: needed } }];
  }

  return { fail: 'no_source' };
}

module.exports = { plan, resolveGroup, BLOCK_DROPS, MOB_DROPS };
