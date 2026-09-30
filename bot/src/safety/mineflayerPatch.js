'use strict';
const fs = require('fs');
const path = require('path');

/**
 * On Paper 1.20+ servers, slot 0 is only sent when the crafting result slot changes
 * (recipe completes or result is taken). Mineflayer's inventory plugin erroneously waits
 * on slots 1..9 for updateSlot:0, hanging for 20s. This patch ensures waitForWindowUpdate
 * only waits on slot === 0.
 */
function ensureMineflayerPatched() {
  try {
    const invPath = path.join(__dirname, '..', '..', 'node_modules', 'mineflayer', 'lib', 'plugins', 'inventory.js');
    if (!fs.existsSync(invPath)) return;
    let code = fs.readFileSync(invPath, 'utf8');
    let modified = false;
    if (code.includes('if (slot >= 0 && slot <= 4)')) {
      code = code.replace('if (slot >= 0 && slot <= 4)', 'if (slot === 0)');
      modified = true;
    }
    if (code.includes('if (slot >= 0 && slot <= 9)')) {
      code = code.replace('if (slot >= 0 && slot <= 9)', 'if (slot === 0)');
      modified = true;
    }
    if (modified) {
      fs.writeFileSync(invPath, code, 'utf8');
    }
  } catch (_) {}
}

ensureMineflayerPatched();

module.exports = { ensureMineflayerPatched };
