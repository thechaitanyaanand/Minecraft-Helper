'use strict';
const fs = require('fs');
const path = require('path');
const { resolveGroup } = require('./obtain');

const BLUEPRINTS_DIR = path.join(__dirname, '..', '..', 'blueprints');

function loadBlueprint(id) {
  const filename = id.endsWith('.json') ? id : `${id}.json`;
  const fullPath = path.join(BLUEPRINTS_DIR, filename);
  if (!fs.existsSync(fullPath)) throw new Error(`Blueprint not found: ${id}`);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function listBlueprints() {
  if (!fs.existsSync(BLUEPRINTS_DIR)) return [];
  return fs.readdirSync(BLUEPRINTS_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
}

function calculateMaterials(blueprint) {
  const materials = {};
  for (const layer of blueprint.layers) {
    for (const row of layer) {
      for (const ch of row) {
        const itemType = blueprint.key[ch];
        if (itemType && itemType !== 'air' && itemType !== '.') {
          const resolved = resolveGroup(itemType);
          materials[resolved] = (materials[resolved] || 0) + 1;
        }
      }
    }
  }
  return materials;
}

function generatePlacements(blueprint, origin = { x: 0, y: 0, z: 0 }) {
  const placements = [];
  const doorPlacements = [];

  for (let y = 0; y < blueprint.layers.length; y++) {
    const layer = blueprint.layers[y];
    for (let z = 0; z < layer.length; z++) {
      const row = layer[z];
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        const blockName = blueprint.key[ch];
        if (blockName && blockName !== 'air' && blockName !== '.') {
          const item = {
            x: origin.x + x,
            y: origin.y + y,
            z: origin.z + z,
            blockName: resolveGroup(blockName),
          };
          if (blockName.includes('door')) {
            doorPlacements.push(item);
          } else {
            placements.push(item);
          }
        }
      }
    }
  }

  // Door placed last
  return placements.concat(doorPlacements);
}

module.exports = {
  loadBlueprint,
  listBlueprints,
  calculateMaterials,
  generatePlacements,
};
