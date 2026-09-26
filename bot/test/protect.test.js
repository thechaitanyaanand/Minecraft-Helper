'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isProtected, isProtectedBlockName } = require('../src/safety/protect');

test('protect: isProtectedBlockName identifies player build blocks', () => {
  // Positive cases
  assert.equal(isProtectedBlockName('oak_planks'), true);
  assert.equal(isProtectedBlockName('birch_planks'), true);
  assert.equal(isProtectedBlockName('iron_door'), true);
  assert.equal(isProtectedBlockName('oak_door'), true);
  assert.equal(isProtectedBlockName('white_bed'), true);
  assert.equal(isProtectedBlockName('glass'), true);
  assert.equal(isProtectedBlockName('glass_pane'), true);
  assert.equal(isProtectedBlockName('white_stained_glass'), true);
  assert.equal(isProtectedBlockName('chest'), true);
  assert.equal(isProtectedBlockName('barrel'), true);
  assert.equal(isProtectedBlockName('furnace'), true);
  assert.equal(isProtectedBlockName('crafting_table'), true);
  assert.equal(isProtectedBlockName('torch'), true);
  assert.equal(isProtectedBlockName('wall_torch'), true);
  assert.equal(isProtectedBlockName('white_wool'), true);
  assert.equal(isProtectedBlockName('red_carpet'), true);
  assert.equal(isProtectedBlockName('stone_bricks'), true);
  assert.equal(isProtectedBlockName('oak_stairs'), true);
  assert.equal(isProtectedBlockName('stone_slab'), true);
  assert.equal(isProtectedBlockName('oak_fence'), true);
  assert.equal(isProtectedBlockName('oak_fence_gate'), true);

  // Negative cases (natural world blocks)
  assert.equal(isProtectedBlockName('oak_log'), false);
  assert.equal(isProtectedBlockName('stone'), false);
  assert.equal(isProtectedBlockName('dirt'), false);
  assert.equal(isProtectedBlockName('sand'), false);
  assert.equal(isProtectedBlockName('iron_ore'), false);
  assert.equal(isProtectedBlockName('oak_leaves'), false);
});

test('protect: isProtected protects natural blocks within 8 blocks of beds or chests', () => {
  const protectedBedPos = { x: 10, y: 64, z: 10 };
  const ctx = { protectedPositions: [protectedBedPos] };

  // Natural dirt block 5 blocks away (<= 8)
  const nearbyDirt = {
    name: 'dirt',
    position: { x: 13, y: 64, z: 14, distanceTo: () => 5 },
  };
  assert.equal(isProtected(nearbyDirt, ctx), true);

  // Natural dirt block 12 blocks away (> 8)
  const farDirt = {
    name: 'dirt',
    position: { x: 22, y: 64, z: 10, distanceTo: () => 12 },
  };
  assert.equal(isProtected(farDirt, ctx), false);
});

test('protect: isProtected respects placedByOwner set', () => {
  const ctx = {
    placedByOwner: new Set(['15,64,20']),
  };

  const placedDirt = {
    name: 'dirt',
    position: { x: 15, y: 64, z: 20 },
  };
  const naturalDirt = {
    name: 'dirt',
    position: { x: 16, y: 64, z: 20 },
  };

  assert.equal(isProtected(placedDirt, ctx), true);
  assert.equal(isProtected(naturalDirt, ctx), false);
});
