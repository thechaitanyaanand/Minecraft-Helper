'use strict';
const { Movements } = require('mineflayer-pathfinder');

const SCAFFOLD_BLOCK_NAMES = Object.freeze([
  'dirt', 'grass_block', 'cobblestone', 'stone', 'cobbled_deepslate', 'deepslate',
  'diorite', 'granite', 'andesite', 'sandstone', 'netherrack',
  'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
  'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks',
  'mud', 'packed_mud', 'mud_bricks',
]);

function safeMovements(bot, mcData) {
  const m = new Movements(bot);
  m.allowParkour = false;
  m.allowSprinting = true;
  m.maxDropDown = 3;
  m.canDig = true;
  m.allow1by1towers = true;

  for (const n of ['lava', 'fire', 'magma_block', 'sweet_berry_bush', 'powder_snow', 'cactus']) {
    const b = mcData.blocksByName[n];
    if (b) m.blocksToAvoid.add(b.id);
  }

  for (const n of ['chest', 'barrel', 'furnace', 'crafting_table', 'white_bed', 'red_bed', 'oak_door']) {
    const b = mcData.blocksByName[n];
    if (b) m.blocksCantBreak.add(b.id);
  }

  for (const name of SCAFFOLD_BLOCK_NAMES) {
    const item = mcData.itemsByName?.[name];
    if (item && !m.scafoldingBlocks.includes(item.id)) {
      m.scafoldingBlocks.push(item.id);
    }
  }

  return m;
}

module.exports = { safeMovements };
