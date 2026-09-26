'use strict';
const { Movements } = require('mineflayer-pathfinder');

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

  return m;
}

module.exports = { safeMovements };
