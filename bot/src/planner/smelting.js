'use strict';

/**
 * Smelting recipe table (~15 common overworld recipes).
 * minecraft-data does not include furnace recipes, so this table defines them.
 */
const SMELTING = Object.freeze({
  iron_ingot: { input: 'raw_iron', perItem: 1 },
  gold_ingot: { input: 'raw_gold', perItem: 1 },
  copper_ingot: { input: 'raw_copper', perItem: 1 },
  glass: { input: 'sand', perItem: 1 },
  stone: { input: 'cobblestone', perItem: 1 },
  smooth_stone: { input: 'stone', perItem: 1 },
  charcoal: { input: 'oak_log', perItem: 1 },
  cooked_beef: { input: 'raw_beef', perItem: 1 },
  cooked_porkchop: { input: 'raw_porkchop', perItem: 1 },
  cooked_chicken: { input: 'raw_chicken', perItem: 1 },
  cooked_mutton: { input: 'raw_mutton', perItem: 1 },
  baked_potato: { input: 'potato', perItem: 1 },
  terracotta: { input: 'clay', perItem: 1 },
  brick: { input: 'clay_ball', perItem: 1 },
  green_dye: { input: 'cactus', perItem: 1 },
});

module.exports = { SMELTING };
