'use strict';
const mcData = require('minecraft-data')('1.20.4');
const { SMELTING } = require('./smelting');
const { FOOD_MOBS } = require('../state/world');

const UNSUPPORTED = new Set(['bread', 'wheat', 'blaze_rod', 'blaze_powder', 'ender_eye', 'ender_pearl', 'nether_star', 'elytra', 'shulker_box', 'totem_of_undying', 'saddle']);
const MOB_DROPS = Object.freeze({
  beef: ['cow', 'mooshroom'], porkchop: ['pig'], chicken: ['chicken'], mutton: ['sheep'], rabbit: ['rabbit'],
  leather: ['cow', 'mooshroom'], white_wool: ['sheep'], feather: ['chicken'], string: ['spider'], spider_eye: ['spider'],
  bone: ['skeleton'], gunpowder: ['creeper'], rotten_flesh: ['zombie'],
});
const FOOD_ITEMS = new Set(['cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton', 'cooked_rabbit', 'bread', 'apple', 'carrot', 'baked_potato', 'beef', 'porkchop', 'chicken', 'mutton', 'rabbit']);
const LOG_BLOCKS = mcData.blocksArray.map((b) => b.name).filter((n) => n.endsWith('_log') && !n.startsWith('stripped_'));
const MANUFACTURED = new Set(['iron_block', 'gold_block', 'diamond_block', 'copper_block', 'emerald_block', 'lapis_block', 'redstone_block', 'netherite_block', 'raw_iron_block', 'raw_gold_block', 'raw_copper_block', 'coal_block']);

const BLOCK_DROPS = {};
for (const b of mcData.blocksArray) {
  if (b.drops && Array.isArray(b.drops) && !MANUFACTURED.has(b.name)) {
    for (const d of b.drops) {
      const drop = mcData.items[d]?.name || mcData.blocks[d]?.name;
      if (drop && !MANUFACTURED.has(drop)) {
        if (!BLOCK_DROPS[drop]) BLOCK_DROPS[drop] = [];
        if (!BLOCK_DROPS[drop].includes(b.name)) BLOCK_DROPS[drop].push(b.name);
      }
    }
  }
}

// What you get from breaking a block (stone -> cobblestone, iron_ore -> raw_iron).
function dropOf(blockName) {
  if (BLOCK_DROPS[blockName]?.includes(blockName)) return blockName;
  return Object.keys(BLOCK_DROPS).find((d) => BLOCK_DROPS[d].includes(blockName)) || blockName;
}

function getCheapestHarvestTool(blockName) {
  const b = mcData.blocksByName[blockName];
  if (!b?.harvestTools || !Object.keys(b.harvestTools).length) return null;
  for (const tier of ['wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite']) {
    for (const id of Object.keys(b.harvestTools)) {
      if (mcData.items[id]?.name.startsWith(tier + '_')) return mcData.items[id].name;
    }
  }
  return mcData.items[Object.keys(b.harvestTools)[0]]?.name || null;
}

function resolveGroup(name) {
  if (name === 'group:logs') return 'oak_log';
  if (name === 'group:planks') return 'oak_planks';
  if (name === 'group:food') return 'cooked_beef';
  return name;
}

function getHave(inv, name) {
  if (!inv) return 0;
  if (name === 'group:logs' || /(log|wood|stem)$/.test(name)) return Object.entries(inv).reduce((sum, [k, v]) => (/(log|wood|stem)$/.test(k) ? sum + v : sum), 0);
  if (name === 'group:planks' || /planks$/.test(name)) return Object.entries(inv).reduce((sum, [k, v]) => (/planks$/.test(k) ? sum + v : sum), 0);
  if (name === 'group:food') return Object.entries(inv).reduce((sum, [k, v]) => (FOOD_ITEMS.has(k) ? sum + v : sum), 0);
  return inv[name] || 0;
}

function deductFromInv(inv, name, count) {
  if (!inv) return;
  const isLogs = name === 'group:logs' || /(log|wood|stem)$/.test(name);
  const isPlanks = name === 'group:planks' || /planks$/.test(name);
  if (isLogs || isPlanks) {
    let rem = count, re = isLogs ? /(log|wood|stem)$/ : /planks$/;
    for (const [k, v] of Object.entries(inv)) {
      if (re.test(k)) { const take = Math.min(v, rem); inv[k] -= take; rem -= take; if (rem <= 0) break; }
    }
  } else { inv[name] = Math.max(0, (inv[name] || 0) - count); }
}

function parseRecipe(r) {
  const ingredients = {};
  let width = 1, height = 1;
  const add = (id) => { if (id != null) { const n = mcData.items[id]?.name || mcData.blocks[id]?.name; if (n) ingredients[n] = (ingredients[n] || 0) + 1; } };
  if (r.inShape) {
    height = r.inShape.length; width = Math.max(...r.inShape.map((row) => row.length));
    for (const row of r.inShape) for (const id of row) add(id);
  } else if (r.ingredients) {
    for (const id of r.ingredients) add(id);
    width = r.ingredients.length > 4 ? 3 : 2;
  }
  return { ingredients, needsTable: width > 2 || height > 2, resultCount: r.result?.count || 1 };
}

function plan(target, n = 1, inv = {}, depth = 0, seen = new Set()) {
  const normTarget = resolveGroup(target);
  const have = getHave(inv, target);
  if (have >= n) return [];
  if (depth > 8 || seen.has(normTarget)) return { fail: 'too_deep' };
  if (UNSUPPORTED.has(normTarget)) return { fail: normTarget === 'bread' ? 'no_source' : 'not_yet' };

  const needed = n - have, nextSeen = new Set(seen);
  nextSeen.add(normTarget);

  // Any food will do: hunt whatever animal is around (raw meat counts, eating it is fine).
  if (target === 'group:food') {
    inv.beef = (inv.beef || 0) + needed;
    return [{ skill: 'hunt', args: { mobNames: [...FOOD_MOBS], count: needed } }];
  }

  // 1. CRAFT
  const itemInfo = mcData.itemsByName[normTarget] || mcData.blocksByName[normTarget];
  const rawRecipes = itemInfo ? mcData.recipes[itemInfo.id] : null;
  const recipes = rawRecipes?.slice?.().sort((a, b) => (Boolean(a.inShape) !== Boolean(b.inShape) ? (a.inShape ? -1 : 1) : 0));
  if (recipes?.length > 0) {
    for (const r of recipes) {
      const parsed = parseRecipe(r), runs = Math.ceil(needed / parsed.resultCount);
      let craftSteps = [], ok = true;
      const simInv = { ...inv };
      for (const [ingName, ingCount] of Object.entries(parsed.ingredients)) {
        const ingSteps = plan(ingName, ingCount * runs, simInv, depth + 1, nextSeen);
        if (ingSteps.fail) { ok = false; break; }
        craftSteps = craftSteps.concat(ingSteps);
      }
      if (ok) {
        for (const [ingName, ingCount] of Object.entries(parsed.ingredients)) deductFromInv(simInv, ingName, ingCount * runs);
        if (parsed.needsTable && !simInv.placed_crafting_table) {
          const tableSteps = plan('crafting_table', 1, simInv, depth + 1, nextSeen);
          if (!tableSteps.fail) {
            craftSteps = craftSteps.concat(tableSteps, [{ skill: 'place_block', args: { name: 'crafting_table' } }]);
            simInv.placed_crafting_table = 1;
          }
        }
        craftSteps.push({ skill: 'craft', args: { item: normTarget, runs } });
        simInv[normTarget] = (simInv[normTarget] || 0) + (parsed.resultCount * runs);
        Object.assign(inv, simInv);
        return craftSteps;
      }
    }
  }

  // 2. SMELT
  const smeltRecipe = SMELTING[normTarget];
  if (smeltRecipe) {
    let smeltSteps = [];
    const simInv = { ...inv };
    const inputSteps = plan(smeltRecipe.input, needed * smeltRecipe.perItem, simInv, depth + 1, nextSeen);
    if (!inputSteps.fail) {
      smeltSteps = smeltSteps.concat(inputSteps);
      deductFromInv(simInv, smeltRecipe.input, needed * smeltRecipe.perItem);
      if (getHave(simInv, 'coal') === 0 && getHave(simInv, 'charcoal') === 0 && getHave(simInv, 'group:planks') < Math.ceil(needed / 1.5)) {
        const fuelPlanks = Math.max(1, Math.ceil(needed / 1.5));
        const fuelSteps = plan('oak_planks', fuelPlanks, simInv, depth + 1, nextSeen);
        if (!fuelSteps.fail) { smeltSteps = smeltSteps.concat(fuelSteps); deductFromInv(simInv, 'oak_planks', fuelPlanks); }
      }
      if (!simInv.placed_furnace) {
        const furnSteps = plan('furnace', 1, simInv, depth + 1, nextSeen);
        if (!furnSteps.fail) {
          smeltSteps = smeltSteps.concat(furnSteps, [{ skill: 'place_block', args: { name: 'furnace' } }]);
          simInv.placed_furnace = 1;
        }
      }
      smeltSteps.push({ skill: 'smelt', args: { item: normTarget, count: needed } });
      simInv[normTarget] = (simInv[normTarget] || 0) + needed;
      Object.assign(inv, simInv);
      return smeltSteps;
    }
  }

  // 3. MINE
  const isGenericLog = normTarget === 'oak_log';
  const sourceBlocks = isGenericLog ? LOG_BLOCKS : BLOCK_DROPS[normTarget];
  if (sourceBlocks?.length > 0) {
    let mineSteps = [];
    const simInv = { ...inv };
    const harvestTool = getCheapestHarvestTool(sourceBlocks[0]);
    if (harvestTool && getHave(simInv, harvestTool) < 1) {
      const toolSteps = plan(harvestTool, 1, simInv, depth + 1, nextSeen);
      if (toolSteps.fail) return toolSteps;
      mineSteps = mineSteps.concat(toolSteps);
    }
    const countToMine = (normTarget === 'oak_log' || normTarget === 'group:logs') && depth > 0 && have === 0 ? Math.max(needed, 3) : needed;
    const toolType = harvestTool ? (harvestTool.includes('pickaxe') ? 'pickaxe' : (harvestTool.includes('axe') ? 'axe' : undefined)) : undefined;
    mineSteps.push({ skill: 'collect_block', args: { blockNames: sourceBlocks, count: countToMine, needsTool: toolType, dropName: isGenericLog ? 'logs' : normTarget } });
    simInv[normTarget] = (simInv[normTarget] || 0) + countToMine;
    Object.assign(inv, simInv);
    return mineSteps;
  }

  // 4. KILL
  const mobSources = MOB_DROPS[normTarget];
  if (mobSources?.length > 0) {
    inv[normTarget] = (inv[normTarget] || 0) + needed;
    return [{ skill: 'hunt', args: { mobNames: mobSources, count: needed } }];
  }

  return { fail: 'no_source' };
}

module.exports = { plan, resolveGroup, getHave, dropOf, parseRecipe, getCheapestHarvestTool, BLOCK_DROPS, MOB_DROPS, FOOD_ITEMS };
