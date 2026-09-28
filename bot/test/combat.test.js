'use strict';
const os = require('os');
const path = require('path');
process.env.MEMORY_FILE = path.join(os.tmpdir(), `helper-memory-test-${process.pid}.json`);

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const FakeBot = require('./fakeBot');
const { CancelToken } = require('../src/cancel');
const { safetyOverride, interrupt, getLegalInterrupts } = require('../src/planner/heuristics');
const eat = require('../src/skills/eat');
const memory = require('../src/memory');
const { createObserver } = require('../src/buddy/observe');
const { createBuddy } = require('../src/buddy/index');
const { recoverItems } = require('../src/skills/places');

const creeperAt = (distance) => ({ nearby: { hostile_mobs: [{ type: 'creeper', distance }] } });

test('combat: creepers are fought behind a shield, fled from without one', () => {
  assert.equal(safetyOverride({ ...creeperAt(3), health: 20 }), 'flee');
  assert.equal(safetyOverride({ ...creeperAt(3), health: 20, tools: { shield: true } }), null);
  assert.equal(safetyOverride({ ...creeperAt(3), health: 8, tools: { shield: true } }), 'flee', 'too hurt to tank a blast');
  const shielded = { ...creeperAt(3), health: 20, tools: { shield: true } };
  assert.equal(interrupt(shielded, getLegalInterrupts(shielded)), 'fight');
});

test('combat: skeletons are engaged at range only with a bow', () => {
  const far = { health: 20, nearby: { hostile_mobs: [{ type: 'skeleton', distance: 12 }] } };
  assert.ok(!getLegalInterrupts(far).includes('fight'));
  const withBow = { ...far, tools: { bow: true } };
  assert.equal(interrupt(withBow, getLegalInterrupts(withBow)), 'fight');
});

test('combat: hurt bot eats to top up food so it heals', () => {
  const hurt = { health: 12, food: 18, inventory: { bread: 4 }, nearby: { hostile_mobs: [] } };
  assert.equal(interrupt(hurt, getLegalInterrupts(hurt)), 'eat_food');
  assert.ok(!getLegalInterrupts({ ...hurt, health: 20 }).includes('eat_food'));

  const bot = new FakeBot();
  bot._items = [{ name: 'bread', count: 4 }];
  bot.food = 18; bot.health = 12;
  assert.equal(eat.isAvailable(bot).ok, true);
  bot.health = 20;
  assert.equal(eat.isAvailable(bot).reason, 'not_hungry');
});

test('observer: guesses the mob that hurt the owner and remembers where they died', () => {
  memory._reset();
  const bot = new FakeBot();
  const owner = { username: 'Alice', position: new Vec3(0, 64, 0) };
  bot.players.Alice = { entity: owner };
  const zombie = { id: 1, name: 'zombie', position: new Vec3(2, 64, 0), isValid: true };
  const skeleton = { id: 2, name: 'skeleton', position: new Vec3(10, 64, 0), isValid: true };
  bot.entities = { 1: zombie, 2: skeleton };
  let deathPos = null;
  const obs = createObserver(bot, 'Alice', { onOwnerDeath: (p) => { deathPos = p; } });

  bot.emit('entityHurt', owner);
  assert.equal(obs.getLastAttacker(), zombie, 'melee mob in reach beats a distant shooter');
  zombie.position = new Vec3(8, 64, 0);
  bot.emit('entityHurt', owner);
  assert.equal(obs.getLastAttacker(), skeleton);

  obs.recordMove(0); // seeds a tracked position
  bot.emit('messagestr', 'Alice was slain by Zombie');
  assert.ok(deathPos);
  assert.deepEqual(memory.get().deathSpot, { x: 0, y: 0, z: 0 });
  bot.emit('messagestr', '<Bob> Alice died lol'); // player chat, not a death
  obs.stopTracking();
});

test('deathMatchers: all vanilla death templates match with the owner as victim, none as killer', () => {
  const { deathMatchers, DEATH_TEMPLATES } = require('../src/buddy/observe');
  const res = deathMatchers('Alice');
  assert.ok(DEATH_TEMPLATES.length >= 90);
  for (const t of DEATH_TEMPLATES) {
    let i = 0;
    const fill = (victim, other) => t.replace(/%(\d\$)?s/g, (m) => ((m === '%1$s' || (m === '%s' && i++ === 0)) ? victim : other));
    assert.ok(res.some((re) => re.test(fill('Alice', 'Zombie'))), `missed: ${fill('Alice', 'Zombie')}`);
    i = 0;
    const kill = fill('Bob', 'Alice');
    assert.ok(!res.some((re) => re.test(kill)), `Alice as the killer counted as her death: ${kill}`);
  }
});

test('observer: recognises every kind of vanilla death message, counts each death once', async () => {
  memory._reset();
  const bot = new FakeBot();
  const owner = { username: 'Alice', position: new Vec3(0, 64, 0) };
  bot.players.Alice = { entity: owner };
  const deaths = [];
  const obs = createObserver(bot, 'Alice', { onOwnerDeath: () => deaths.push(Date.now()) });
  const st = () => obs.getOwnerState().recent.died;

  bot.emit('messagestr', 'Alice was blown up by Creeper');
  assert.equal(st(), 1, 'creeper deaths were missed by the old word list');
  bot.emit('entityDead', owner);
  assert.equal(st(), 1, 'the entity death for the same death is not double counted');

  // Not deaths: other players, chat that mentions dying, a name that only starts with ours.
  for (const m of ['Bob was blown up by Creeper', '<Alice> I hit the ground too hard lol', 'Alicex fell from a high place']) bot.emit('messagestr', m);
  assert.equal(st(), 1);
  assert.equal(deaths.length, 1);
  obs.stopTracking();
});

test('memory: chests are deduped and removed, beds set home once', () => {
  memory._reset();
  memory.set('home', null);
  const bot = new FakeBot();
  bot.players.Alice = { entity: { username: 'Alice', position: new Vec3(0, 64, 0) } };
  const obs = createObserver(bot, 'Alice');
  const at = (x) => new Vec3(x, 64, 0);
  bot.emit('blockUpdate', { name: 'air', position: at(1) }, { name: 'chest', position: at(1) });
  bot.emit('blockUpdate', { name: 'air', position: at(1) }, { name: 'chest', position: at(1) });
  bot.emit('blockUpdate', { name: 'air', position: at(2) }, { name: 'red_bed', position: at(2) });
  bot.emit('blockUpdate', { name: 'air', position: at(3) }, { name: 'blue_bed', position: at(3) });
  assert.equal(memory.get().chests.length, 1);
  assert.deepEqual(memory.get().home, { x: 2, y: 64, z: 0 });
  bot.emit('blockUpdate', { name: 'chest', position: at(1) }, { name: 'air', position: at(1) });
  assert.equal(memory.get().chests.length, 0);
  obs.stopTracking();
});

test('buddy: hands arrows to an owner holding a bow, only what it can spare', () => {
  const bot = new FakeBot();
  const buddy = createBuddy(bot, {}, { ownerName: 'Alice' }, () => {}, null, { getOwnerState: () => ({}) });
  assert.equal(buddy.giftFor({ held: 'bow' }, { arrow: 40 }, false)?.item, 'arrow');
  assert.equal(buddy.giftFor({ held: 'bow' }, { arrow: 20 }, false), undefined, 'keeps its own 16');
  assert.equal(buddy.giftFor({ held: 'stone_sword' }, { arrow: 40, torch: 32 }, false), undefined);
  assert.equal(buddy.giftFor({}, { torch: 32 }, true)?.item, 'torch');
});

test('recover_items: picks up drops at the death spot and tosses only those to the owner', async () => {
  memory._reset();
  memory.set('deathSpot', { x: 20, y: 64, z: 0 });
  const bot = new FakeBot();
  bot._items = [{ name: 'wooden_sword', count: 1, type: 1 }];
  const owner = { position: new Vec3(0, 64, 0) };
  bot.players.Alice = { entity: owner };
  const drop = { id: 9, name: 'item', position: new Vec3(21, 64, 0) };
  bot.nearestEntity = (fn) => (fn(drop) ? drop : null);
  bot.pathfinder.goto = async (goal) => {
    if (goal.x === 21) bot._items.push({ name: 'diamond', count: 3, type: 2 }, { name: 'wooden_sword', count: 1, type: 1 });
  };
  const tossed = [];
  bot.toss = async (type, meta, count) => { tossed.push([type, count]); };

  const res = await recoverItems.run(bot, { ownerName: 'Alice' }, new CancelToken());
  assert.equal(res.ok, true);
  assert.deepEqual(tossed.sort(), [[1, 1], [2, 3]], 'the second sword was picked up, the first was ours');
  assert.equal(memory.get().deathSpot, null);
});
