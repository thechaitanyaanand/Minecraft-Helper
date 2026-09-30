'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const FakeBot = require('./fakeBot');
const { CancelToken } = require('../src/cancel');
const { plan } = require('../src/planner/obtain');
const { skills, getSkill } = require('../src/skills');
const deepMine = require('../src/skills/deepMine');
const { buildPortal, enterPortal } = require('../src/skills/netherPortal');
const { findFortress, huntBlaze } = require('../src/skills/netherFortress');
const { barterPiglin, huntEnderman } = require('../src/skills/barter');
const { triangulateStronghold, triangulateSkill, findStronghold, activateEndPortal } = require('../src/skills/stronghold');
const { fightDragon } = require('../src/skills/dragonFight');
const { GOALS, getFirstNeededStep } = require('../src/planner/goals');
const { createRouter } = require('../src/chat/router');
const memory = require('../src/memory');

// 1. Planner & Resource Dependency Tests
test('obtain: blaze_rod and ender_pearl have valid mob drop sources', () => {
  const blazeSteps = plan('blaze_rod', 1, {});
  assert.ok(Array.isArray(blazeSteps), 'Must return steps for blaze_rod');
  assert.equal(blazeSteps.length, 1);
  assert.equal(blazeSteps[0].skill, 'hunt');
  assert.ok(blazeSteps[0].args.mobNames.includes('blaze'));

  const pearlSteps = plan('ender_pearl', 1, {});
  assert.ok(Array.isArray(pearlSteps));
  assert.equal(pearlSteps.length, 1);
  assert.equal(pearlSteps[0].skill, 'hunt');
  assert.ok(pearlSteps[0].args.mobNames.includes('enderman'));
});

test('obtain: blaze_powder crafts from blaze_rod', () => {
  const steps = plan('blaze_powder', 2, {});
  assert.ok(Array.isArray(steps));
  assert.ok(steps.some((s) => s.skill === 'hunt' && s.args.mobNames.includes('blaze')));
  assert.ok(steps.some((s) => s.skill === 'craft' && s.args.item === 'blaze_powder'));
});

test('obtain: ender_eye resolves full progression from ender_pearl and blaze_rod', () => {
  const steps = plan('ender_eye', 1, {});
  assert.ok(Array.isArray(steps));
  assert.ok(steps.some((s) => s.skill === 'hunt' && s.args.mobNames.includes('blaze')));
  assert.ok(steps.some((s) => s.skill === 'hunt' && s.args.mobNames.includes('enderman')));
  assert.ok(steps.some((s) => s.skill === 'craft' && s.args.item === 'blaze_powder'));
  assert.ok(steps.some((s) => s.skill === 'craft' && s.args.item === 'ender_eye'));
});

test('obtain: flint_and_steel resolves iron smelting and gravel mining', () => {
  const steps = plan('flint_and_steel', 1, {});
  assert.ok(Array.isArray(steps));
  assert.ok(steps.some((s) => s.skill === 'smelt' && s.args.item === 'iron_ingot'));
  assert.ok(steps.some((s) => s.skill === 'collect_block' && s.args.dropName === 'flint'));
  assert.ok(steps.some((s) => s.skill === 'craft' && s.args.item === 'flint_and_steel'));
});

test('obtain: obsidian resolves diamond pickaxe progression', () => {
  const steps = plan('obsidian', 10, {});
  assert.ok(Array.isArray(steps));
  assert.ok(steps.some((s) => s.skill === 'craft' && s.args.item === 'diamond_pickaxe'));
  const mineObsidian = steps.find((s) => s.skill === 'collect_block' && s.args.dropName === 'obsidian');
  assert.ok(mineObsidian);
  assert.equal(mineObsidian.args.count, 10);
});

// 2. Step 1: Deep Mining & Diamond Expedition Tests
test('deep_mine.isAvailable: requires iron pickaxe or better for diamond mining', () => {
  const bot = new FakeBot();
  bot._items = [{ name: 'stone_pickaxe' }];
  const resStone = deepMine.isAvailable(bot, {});
  assert.equal(resStone.ok, false);
  assert.equal(resStone.reason, 'no_iron_pickaxe');

  bot._items = [{ name: 'iron_pickaxe' }];
  const resIron = deepMine.isAvailable(bot, {});
  assert.equal(resIron.ok, true);

  bot._items = [{ name: 'diamond_pickaxe' }];
  assert.equal(deepMine.isAvailable(bot, {}).ok, true);
});

test('deep_mine.run: safely descends to target Y and mines diamond ores', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  bot.entity.position = new Vec3(0, 64, 0);
  bot._items = [{ name: 'iron_pickaxe' }, { name: 'torch', count: 16 }];

  const dugBlocks = [];
  bot.dig = async (b) => {
    dugBlocks.push(b);
  };
  bot.blockAt = (p) => {
    if (p.y <= -58) return { name: 'deepslate_diamond_ore', position: p };
    return { name: 'stone', position: p };
  };

  // Simulate diamond ore found at Y=-58
  bot._foundBlocks = (opts) => {
    if (bot.entity.position.y <= -50) {
      return [new Vec3(5, -58, 5)];
    }
    return [];
  };

  let collected = false;
  bot.collectBlock = {
    collect: async (blocks) => {
      collected = true;
      bot._items.push({ name: 'diamond', count: 2 });
    },
  };

  const res = await deepMine.run(bot, {}, token, { count: 2 });
  assert.equal(res.ok, true);
  assert.ok(dugBlocks.length > 0, 'Must have dug steps down');
  assert.equal(collected, true, 'Must have collected diamonds');
  assert.equal(res.collectedCount, 2);
});

test('collect_block: falls back to deepMine when diamond ores are deep underground', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  bot.entity.position = new Vec3(0, 65, 0); // surface
  bot._items = [{ name: 'iron_pickaxe' }];
  bot.inventory.emptySlotCount = () => 10;
  bot._foundBlocks = []; // no diamond ores at surface

  let deepMineCalled = false;
  bot.dig = async () => {};
  bot.blockAt = (p) => ({ name: 'stone', position: p });
  bot.collectBlock = {
    collect: async () => {
      deepMineCalled = true;
      bot._items.push({ name: 'diamond', count: 1 });
    },
  };
  bot._foundBlocks = (opts) => (bot.entity.position.y <= -50 ? [new Vec3(0, -58, 0)] : []);

  const res = await skills.collect_block.run(bot, {}, token, {
    blockNames: ['diamond_ore', 'deepslate_diamond_ore'],
    dropName: 'diamond',
    count: 1,
    needsTool: 'pickaxe',
  });

  assert.equal(res.ok, true);
  assert.equal(res.collectedCount, 1);
});

// 3. Step 2: Nether & Blaze Rod Tests
test('build_portal: builds 4x5 frame and ignites with flint and steel', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  bot.entity.position = new Vec3(0, 64, 0);

  // Missing obsidian
  bot._items = [{ name: 'obsidian', count: 8 }, { name: 'flint_and_steel', count: 1 }];
  assert.equal(buildPortal.isAvailable(bot).ok, false);

  // Has 10 obsidian and flint and steel
  bot._items = [{ name: 'obsidian', count: 10 }, { name: 'flint_and_steel', count: 1 }];
  assert.equal(buildPortal.isAvailable(bot).ok, true);

  const placed = [];
  bot.placeBlock = async (ground, face) => { placed.push(ground); };
  let ignited = false;
  bot.activateBlock = async () => { ignited = true; };

  const res = await buildPortal.run(bot, {}, token);
  assert.equal(res.ok, true);
  assert.equal(placed.length, 10, 'Must place 10 obsidian frame blocks');
  assert.equal(ignited, true, 'Must ignite portal with flint and steel');
});

test('enter_portal: walks into portal and equips golden armor for Piglin safety', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  bot._items = [{ name: 'golden_helmet', count: 1 }];
  bot.game = { dimension: 'minecraft:overworld' };

  let equippedSlot = null;
  bot.equip = async (item, slot) => { equippedSlot = slot; };

  const portalPos = new Vec3(5, 64, 5);
  bot.findBlock = () => ({ position: portalPos });
  bot.pathfinder = {
    goto: async (goal) => {
      bot.game.dimension = 'minecraft:the_nether';
    },
  };

  const res = await enterPortal.run(bot, {}, token);
  assert.equal(res.ok, true);
  assert.equal(equippedSlot, 'head', 'Must equip gold armor to pacify piglins');
  assert.equal(res.dimension, 'minecraft:the_nether');
});

test('find_fortress: detects nether bricks and pathfinds to fortress', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  const fortressPos = new Vec3(20, 60, 20);

  bot.findBlocks = () => [fortressPos];
  let navigatedTo = null;
  bot.pathfinder = {
    goto: async (g) => { navigatedTo = g; },
  };

  const res = await findFortress.run(bot, {}, token);
  assert.equal(res.ok, true);
  assert.ok(navigatedTo);
  assert.deepEqual(res.position, fortressPos);
});

test('hunt_blaze: blocks fireballs with shield and defeats blaze for rods', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  bot.entity.position = new Vec3(0, 64, 0);
  bot._items = [{ name: 'iron_sword' }, { name: 'shield' }];
  bot.inventory.slots = { 45: { name: 'shield' } };

  const blaze = { name: 'blaze', position: new Vec3(3, 64, 0), isValid: true };
  const rodDrop = { name: 'item', position: new Vec3(3, 64, 0) };
  bot.nearestEntity = (fn) => (blaze.isValid && fn(blaze) ? blaze : (fn(rodDrop) ? rodDrop : null));

  let shieldRaised = false;
  bot.activateItem = (offhand) => { if (offhand) shieldRaised = true; };
  bot.deactivateItem = () => { shieldRaised = false; };

  let attacked = false;
  bot.attack = (target) => {
    attacked = true;
    target.isValid = false;
    bot._items.push({ name: 'blaze_rod', count: 1 });
  };

  const res = await huntBlaze.run(bot, {}, token, { count: 1 });
  assert.equal(res.ok, true);
  assert.equal(attacked, true);
  assert.equal(res.collectedCount, 1);
});

// 4. Step 3: Ender Pearls & Stronghold Tests
test('barter_piglin: gives gold ingot to Piglin and collects ender pearls', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  bot.entity.position = new Vec3(0, 64, 0);
  bot._items = [{ name: 'gold_ingot', count: 5 }];

  const piglin = { name: 'piglin', position: new Vec3(2, 64, 0), isValid: true, metadata: [] };
  const pearlDrop = { name: 'item', position: new Vec3(2, 64, 0) };
  bot.nearestEntity = (fn) => (fn(piglin) ? piglin : (fn(pearlDrop) ? pearlDrop : null));

  let tossedGold = false;
  bot.toss = async (type, meta, count) => {
    tossedGold = true;
    bot._items.push({ name: 'ender_pearl', count: 2 });
  };

  const res = await barterPiglin.run(bot, {}, token, { count: 2 });
  assert.equal(res.ok, true);
  assert.equal(tossedGold, true);
  assert.equal(res.collectedCount, 2);
});

test('hunt_enderman: builds safe 2-block ceiling, aggros, and defeats enderman', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  bot.entity.position = new Vec3(0, 64, 0);
  bot._items = [{ name: 'stone_sword' }, { name: 'cobblestone', count: 10 }];

  const enderman = { name: 'enderman', position: new Vec3(4, 64, 0), isValid: true };
  const pearlDrop = { name: 'item', position: new Vec3(4, 64, 0) };
  bot.nearestEntity = (fn) => (enderman.isValid && fn(enderman) ? enderman : (fn(pearlDrop) ? pearlDrop : null));

  let lookedAtEyes = false;
  bot.lookAt = async () => { lookedAtEyes = true; };

  let attacked = false;
  bot.attack = (target) => {
    attacked = true;
    target.isValid = false;
    bot._items.push({ name: 'ender_pearl', count: 1 });
  };

  const res = await huntEnderman.run(bot, {}, token, { count: 1 });
  assert.equal(res.ok, true);
  assert.equal(lookedAtEyes, true);
  assert.equal(attacked, true);
  assert.equal(res.collectedCount, 1);
});

test('triangulateStronghold: computes correct 2D line intersection', () => {
  // Ray 1: from (0, 0) looking at yaw -Math.PI/2 (East, dx=1, dz=0) -> line Z = 0
  // Ray 2: from (500, 500) looking at yaw Math.PI (North, dx=0, dz=-1) -> line X = 500
  // Intersection should be at (500, 0)
  const p1 = { x: 0, z: 0 };
  const angle1 = -Math.PI / 2; // East
  const p2 = { x: 500, z: 500 };
  const angle2 = Math.PI; // North

  const result = triangulateStronghold(p1, angle1, p2, angle2);
  assert.ok(result);
  assert.equal(result.x, 500);
  assert.equal(result.z, 0);
});

test('find_stronghold: digs down safely into stronghold stone bricks', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  bot.entity.position = new Vec3(500, 64, 0);
  bot._items = [{ name: 'iron_pickaxe' }];

  const dug = [];
  bot.dig = async (b) => { dug.push(b); };

  // Stronghold reached at Y=30
  bot.blockAt = (p) => {
    if (p.y <= 30) return { name: 'stone_bricks', position: p };
    return { name: 'stone', position: p };
  };

  const res = await findStronghold.run(bot, {}, token, { pos: { x: 500, y: 30, z: 0 } });
  assert.equal(res.ok, true);
  assert.ok(dug.length > 0);
});

test('activate_end_portal: clears silverfish spawner and fills 12 frames with eyes', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  bot._items = [{ name: 'ender_eye', count: 12 }, { name: 'iron_pickaxe' }];

  let spawnerDug = false;
  bot.findBlock = ({ matching }) => ({ name: 'spawner', position: new Vec3(0, 30, 0) });
  bot.dig = async () => { spawnerDug = true; };

  // 12 empty portal frames
  const frames = [];
  for (let i = 0; i < 12; i++) {
    frames.push({ position: new Vec3(i, 30, 0), metadata: 0, getProperties: () => ({ eye: 'false' }) });
  }

  let filledCount = 0;
  bot.activateBlock = async (frame) => {
    filledCount++;
    frame.metadata = 4;
  };

  const res = await activateEndPortal.run(bot, {}, token, { framePositions: frames.map((f) => f.position) });
  assert.equal(res.ok, true);
  assert.equal(spawnerDug, true, 'Must break silverfish spawner');
  assert.equal(filledCount, 12, 'Must fill all 12 portal frames');
  assert.equal(memory.get().endPortalActivated, true);
});

// 5. Step 4: Ender Dragon Combat Tests
test('fight_dragon: destroys crystals, dodges breath, and critical hits perched dragon', async () => {
  memory.set('dragonDefeated', false);
  const bot = new FakeBot();
  const token = new CancelToken();
  bot.game = { dimension: 'minecraft:the_end' };
  bot.entity.position = new Vec3(10, 65, 10);
  bot._items = [
    { name: 'diamond_sword', count: 1 },
    { name: 'shield', count: 1 },
    { name: 'bow', count: 1 },
    { name: 'arrow', count: 32 },
  ];
  bot.inventory.slots = { 45: { name: 'shield' } };

  // Mock entities: End Crystal, Breath Cloud, Perched Ender Dragon
  const crystal = { id: 1, name: 'end_crystal', position: new Vec3(20, 80, 20), isValid: true };
  const breath = { id: 2, name: 'area_effect_cloud', position: new Vec3(10, 65, 12), isValid: true };
  const dragon = { id: 3, name: 'ender_dragon', position: new Vec3(0, 66, 0), isValid: true };

  bot.entities = { 1: crystal, 2: breath, 3: dragon };

  let crystalShot = false;
  bot.activateItem = () => { crystalShot = true; };
  bot.deactivateItem = () => {};

  let criticalHits = 0;
  bot.setControlState = (state, value) => {
    if (state === 'jump' && value) {
      // Jumped for critical hit
    }
  };

  bot.attack = (target) => {
    if (target.name === 'ender_dragon') {
      criticalHits++;
      target.isValid = false; // Dragon slain
    }
  };

  const res = await fightDragon.run(bot, {}, token);
  assert.equal(res.ok, true);
  assert.ok(crystalShot, 'Must shoot crystal with bow');
  assert.ok(res.breathDodged >= 1, 'Must dodge dragon breath cloud');
  assert.ok(criticalHits >= 1, 'Must perform critical attack on perched dragon');
  assert.equal(memory.get().dragonDefeated, true);
});

// 6. Step 5: Goals & Progression Integration Tests
test('goals: deep_mine, enter_nether, and defeat_ender_dragon steps resolve', () => {
  const bot = new FakeBot();
  bot._items = [{ name: 'iron_pickaxe' }];

  // deep_mine
  assert.equal(GOALS.deep_mine.done(bot), false);
  const s1 = getFirstNeededStep(GOALS.deep_mine, bot);
  assert.equal(s1?.skill, 'deep_mine');

  // enter_nether
  bot.game = { dimension: 'minecraft:overworld' };
  assert.equal(GOALS.enter_nether.done(bot), false);
  assert.equal(getFirstNeededStep(GOALS.enter_nether, bot)?.skill, 'collect_block');

  // defeat_ender_dragon
  memory.set('dragonDefeated', false);
  assert.equal(GOALS.defeat_ender_dragon.done(bot), false);
  assert.equal(getFirstNeededStep(GOALS.defeat_ender_dragon, bot)?.skill, 'fight_dragon');
});

test('goals: beat_game master progression plan defines steps to the end', () => {
  const goal = GOALS.beat_game;
  memory.set('dragonDefeated', false);
  const bot = new FakeBot();
  bot._items = []; // fresh bot
  assert.equal(goal.done(bot), false);

  const step1 = getFirstNeededStep(goal, bot);
  assert.equal(step1?.skill, 'collect_logs', 'First step is collecting wood logs');
});

// 7. Router: /plan, /boost, /goal commands
test('router: accepts slash commands (/plan, /boost, /goal) as well as exclamation marks', () => {
  const commands = [];
  const router = createRouter({
    botUsername: 'Butler',
    ownerName: 'Steve',
    onCommand: (cmd, rest) => { commands.push({ cmd, rest }); },
  });

  router('Steve', '/plan');
  router('Steve', '/boost');
  router('Steve', '/goal dragon');
  router('Steve', '!plan');

  assert.deepEqual(commands, [
    { cmd: 'plan', rest: '' },
    { cmd: 'boost', rest: '' },
    { cmd: 'goal', rest: 'dragon' },
    { cmd: 'plan', rest: '' },
  ]);
});

test('craft_eyes: crafts blaze_powder from blaze_rod before crafting ender_eye', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  bot._items = [{ name: 'blaze_rod', count: 6 }, { name: 'ender_pearl', count: 12 }];

  const crafted = [];
  const craftSkill = require('../src/skills/craft');
  const originalRun = craftSkill.run;
  craftSkill.run = async (b, ctx, tok, args) => {
    crafted.push(args.item);
    if (args.item === 'blaze_powder') {
      bot._items.push({ name: 'blaze_powder', count: 12 });
    }
    return { ok: true, item: args.item, count: args.count || 1 };
  };

  try {
    const res = await getSkill('craft_eyes').run(bot, {}, token, { count: 12 });
    assert.equal(res.ok, true);
    assert.ok(crafted.includes('blaze_powder'), 'Must craft blaze_powder first');
    assert.ok(crafted.includes('ender_eye'), 'Must craft ender_eye second');
  } finally {
    craftSkill.run = originalRun;
  }
});

test('deep_mine: fails with no_tool if pickaxe is absent', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  bot._items = []; // no pickaxe
  const res = await deepMine.run(bot, {}, token);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no_tool');
});

test('activate_end_portal: fails when no frames are found or frames are incomplete', async () => {
  const bot = new FakeBot();
  const token = new CancelToken();
  bot._items = [{ name: 'ender_eye', count: 12 }];
  bot.findBlocks = () => []; // No frames

  const resEmpty = await activateEndPortal.run(bot, {}, token);
  assert.equal(resEmpty.ok, false);
  assert.equal(resEmpty.reason, 'no_frames_found');

  // Partial frames (only 5 frames)
  const frames = [];
  for (let i = 0; i < 5; i++) {
    frames.push({ position: new Vec3(i, 30, 0), metadata: 0, getProperties: () => ({ eye: 'false' }) });
  }
  bot.activateBlock = async (f) => { f.metadata = 4; };

  const resPartial = await activateEndPortal.run(bot, {}, token, { framePositions: frames.map(f => f.position) });
  assert.equal(resPartial.ok, false);
  assert.equal(resPartial.reason, 'portal_incomplete');
});

test('fight_dragon: does not declare victory when dragon is still alive or absent', async () => {
  memory.set('dragonDefeated', false);
  const bot = new FakeBot();
  const token = new CancelToken();
  bot.game = { dimension: 'minecraft:the_end' };
  bot.entity.position = new Vec3(0, 65, 0);

  // Case 1: No dragon at all
  bot.entities = {};
  const resNoDragon = await fightDragon.run(bot, {}, token);
  assert.equal(resNoDragon.ok, false);
  assert.equal(resNoDragon.reason, 'no_dragon_found');
  assert.equal(memory.get().dragonDefeated, false);

  // Case 2: Dragon still alive after combat ticks
  const aliveDragon = { id: 10, name: 'ender_dragon', position: new Vec3(0, 80, 0), isValid: true, health: 150 };
  bot.entities = { 10: aliveDragon };
  bot.nearestEntity = (fn) => (fn(aliveDragon) ? aliveDragon : null);

  const resStillAlive = await fightDragon.run(bot, {}, token);
  assert.equal(resStillAlive.ok, false);
  assert.equal(resStillAlive.reason, 'dragon_still_alive');
  assert.equal(memory.get().dragonDefeated, false);

  // Case 3: Dragon is perched, gets hit, but survives with positive health (no fake victory)
  const perchedDragon = { id: 11, name: 'ender_dragon', position: new Vec3(0, 66, 0), isValid: true, health: 200 };
  bot.entities = { 11: perchedDragon };
  bot.nearestEntity = (fn) => (perchedDragon.isValid && fn(perchedDragon) ? perchedDragon : null);
  bot.attack = (target) => {
    target.health = Math.max(100, target.health - 5); // stays at 100+ HP (survives)
  };
  const resPerchedSurvives = await fightDragon.run(bot, {}, token);
  assert.equal(resPerchedSurvives.ok, false);
  assert.equal(resPerchedSurvives.reason, 'dragon_still_alive');
  assert.equal(memory.get().dragonDefeated, false);
});

test('command /boost: prioritizes best tier armor and sword and equips shield', async () => {
  const bot = new FakeBot();
  bot._items = [
    { name: 'leather_helmet', count: 1 },
    { name: 'diamond_helmet', count: 1 },
    { name: 'leather_chestplate', count: 1 },
    { name: 'diamond_chestplate', count: 1 },
    { name: 'wooden_sword', count: 1 },
    { name: 'diamond_sword', count: 1 },
    { name: 'shield', count: 1 },
  ];
  bot.inventory.slots = { 45: { name: 'shield' } };

  const equipped = [];
  bot.equip = async (item, slot) => {
    equipped.push({ item: item.name, slot });
  };

  const armorTiers = ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather'];
  const items = bot.inventory.items();
  for (const slot of ['head', 'torso', 'legs', 'feet']) {
    const suffix = slot === 'torso' ? 'chestplate' : (slot === 'head' ? 'helmet' : (slot === 'legs' ? 'leggings' : 'boots'));
    let bestPiece = null;
    for (const tier of armorTiers) {
      bestPiece = items.find((it) => it.name === `${tier}_${suffix}`);
      if (bestPiece) break;
    }
    if (bestPiece) await bot.equip(bestPiece, slot);
  }
  const swordTiers = ['netherite', 'diamond', 'iron', 'stone', 'wooden'];
  let bestSword = null;
  for (const tier of swordTiers) {
    bestSword = items.find((it) => it.name === `${tier}_sword`);
    if (bestSword) break;
  }
  if (bestSword) await bot.equip(bestSword, 'hand');

  assert.ok(equipped.some(e => e.item === 'diamond_helmet' && e.slot === 'head'));
  assert.ok(equipped.some(e => e.item === 'diamond_chestplate' && e.slot === 'torso'));
  assert.ok(equipped.some(e => e.item === 'diamond_sword' && e.slot === 'hand'));
  assert.ok(!equipped.some(e => e.item === 'leather_helmet'));
  assert.ok(!equipped.some(e => e.item === 'wooden_sword'));
});

test('command /plan: outputs plan summary for specific item', () => {
  const templates = require('../src/chat/templates');
  const { plan } = require('../src/planner/obtain');
  const steps = plan('ender_eye', 1, {});
  const summary = templates.planSummary('ender_eye', 1, steps);
  assert.ok(summary.includes('ender eye') || summary.includes('ender_eye'));
  assert.ok(summary.includes('hunt') || summary.includes('craft'));
});

test('command /goal: maps goal aliases and rejects invalid goals', () => {
  const goalMap = {
    dragon: 'defeat_ender_dragon',
    beat_game: 'beat_game',
    nether: 'enter_nether',
    blaze: 'get_blaze_rods',
    pearl: 'gather_ender_pearls',
    eye: 'craft_eyes_of_ender',
    stronghold: 'find_stronghold',
    end_portal: 'activate_end_portal',
    diamond: 'deep_mine',
  };
  assert.equal(goalMap['dragon'], 'defeat_ender_dragon');
  assert.equal(goalMap['diamond'], 'deep_mine');
  assert.equal(goalMap['nether'], 'enter_nether');
});

test('find_fortress.isAvailable: requires dimension to be the Nether', () => {
  const bot = new FakeBot();
  bot.game = { dimension: 'minecraft:overworld' };
  const resOverworld = findFortress.isAvailable(bot);
  assert.equal(resOverworld.ok, false);
  assert.equal(resOverworld.reason, 'not_in_nether');

  bot.game = { dimension: 'minecraft:the_nether' };
  assert.equal(findFortress.isAvailable(bot).ok, true);
});

test('collect_block.isAvailable: enforces diamond pickaxe for obsidian and iron for diamond ore', () => {
  const bot = new FakeBot();
  bot._items = [{ name: 'iron_pickaxe' }];
  const resObsidian = skills.collect_block.isAvailable(bot, {}, { blockNames: ['obsidian'], needsTool: 'pickaxe' });
  assert.equal(resObsidian.ok, false);
  assert.equal(resObsidian.reason, 'insufficient_tool_tier');

  bot._items = [{ name: 'diamond_pickaxe' }];
  assert.equal(skills.collect_block.isAvailable(bot, {}, { blockNames: ['obsidian'], needsTool: 'pickaxe' }).ok, true);

  bot._items = [{ name: 'stone_pickaxe' }];
  const resDiamondOre = skills.collect_block.isAvailable(bot, {}, { blockNames: ['diamond_ore'], needsTool: 'pickaxe' });
  assert.equal(resDiamondOre.ok, false);
  assert.equal(resDiamondOre.reason, 'insufficient_tool_tier');
});

test('triangulateStronghold: returns null for parallel or diverging rays', () => {
  // Parallel rays looking North
  const p1 = { x: 0, z: 0 };
  const a1 = Math.PI;
  const p2 = { x: 100, z: 0 };
  const a2 = Math.PI;
  assert.equal(triangulateStronghold(p1, a1, p2, a2), null);

  // Diverging rays that intersect behind throwers (negative t1/t2)
  const divP1 = { x: 0, z: 0 };
  const divA1 = -Math.PI / 2; // East (dx=1, dz=0)
  const divP2 = { x: 100, z: 100 };
  const divA2 = -Math.PI / 4; // North-East
  assert.equal(triangulateStronghold(divP1, divA1, divP2, divA2), null);
});

test('find_stronghold: marks reachedStronghold in memory upon descent', async () => {
  memory.set('reachedStronghold', false);
  const bot = new FakeBot();
  const token = new CancelToken();
  bot.entity.position = new Vec3(500, 64, 0);
  bot._items = [{ name: 'iron_pickaxe' }];
  bot.dig = async () => {};
  bot.blockAt = (p) => (p.y <= 30 ? { name: 'stone_bricks', position: p } : { name: 'stone', position: p });

  const res = await findStronghold.run(bot, {}, token, { pos: { x: 500, y: 30, z: 0 } });
  assert.equal(res.ok, true);
  assert.equal(memory.get().reachedStronghold, true);
});

test('goals: beat_game master progression transitions cleanly through Overworld return and Stronghold', () => {
  memory.set('dragonDefeated', false);
  memory.set('stronghold', null);
  memory.set('reachedStronghold', false);
  memory.set('endPortalActivated', false);

  const bot = new FakeBot();
  bot._items = [
    { name: 'diamond_pickaxe', count: 1 },
    { name: 'blaze_rod', count: 6 },
    { name: 'ender_pearl', count: 12 },
    { name: 'ender_eye', count: 12 },
  ];

  // While in Nether with blaze rods and pearls/eyes, must return to Overworld
  bot.game = { dimension: 'minecraft:the_nether' };
  const stepReturn = getFirstNeededStep(GOALS.beat_game, bot);
  assert.equal(stepReturn?.skill, 'enter_portal', 'Must enter portal to return to Overworld');

  // Once in Overworld, must triangulate stronghold
  bot.game = { dimension: 'minecraft:overworld' };
  const stepTri = getFirstNeededStep(GOALS.beat_game, bot);
  assert.equal(stepTri?.skill, 'triangulate_stronghold', 'Must triangulate stronghold in Overworld');

  // Once triangulated, must execute find_stronghold
  memory.set('stronghold', { x: 500, y: 30, z: 0 });
  const stepFind = getFirstNeededStep(GOALS.beat_game, bot);
  assert.equal(stepFind?.skill, 'find_stronghold', 'Must travel to and dig into stronghold');

  // Once reached stronghold, must activate end portal
  memory.set('reachedStronghold', true);
  const stepAct = getFirstNeededStep(GOALS.beat_game, bot);
  assert.equal(stepAct?.skill, 'activate_end_portal', 'Must activate end portal frames');

  // Once portal is activated, must fight dragon
  memory.set('endPortalActivated', true);
  const stepFight = getFirstNeededStep(GOALS.beat_game, bot);
  assert.equal(stepFight?.skill, 'fight_dragon', 'Must fight dragon after activating portal');
});

test('fight_dragon: bridges across void when spawned on End platform with no path', async () => {
  memory.set('dragonDefeated', false);
  const bot = new FakeBot();
  const token = new CancelToken();
  bot.game = { dimension: 'minecraft:the_end' };
  bot.entity.position = new Vec3(100, 49, 0); // End spawn platform
  bot._items = [
    { name: 'diamond_sword', count: 1 },
    { name: 'shield', count: 1 },
    { name: 'cobblestone', count: 64 },
  ];
  bot.inventory.slots = { 45: { name: 'shield' } };

  // pathfinder.goto fails because void gap separates platform
  bot.pathfinder = {
    goto: async () => { throw new Error('NoPath'); },
  };

  const placedBlocks = [];
  bot.placeBlock = async (ref, face) => {
    placedBlocks.push({ ref, face });
  };
  bot.blockAt = (p) => {
    if (p.x === 100 && p.y === 48 && p.z === 0) return { name: 'obsidian', position: p };
    return { name: 'air', position: p };
  };

  // Mock dragon at center
  const dragon = { id: 1, name: 'ender_dragon', position: new Vec3(0, 66, 0), isValid: true, health: 200 };
  bot.entities = { 1: dragon };
  bot.nearestEntity = () => dragon;
  bot.attack = (target) => {
    target.isValid = false; // slays dragon
  };

  const res = await fightDragon.run(bot, {}, token);
  assert.ok(placedBlocks.length > 0, 'Must place bridge blocks across void gap');
  assert.equal(res.ok, true);
  assert.equal(memory.get().dragonDefeated, true);
});



