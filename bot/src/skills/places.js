'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const memory = require('../memory');
const { travel } = require('./travel');
const { travelToOwner } = require('./owner');

const invMap = (bot) => {
  const inv = {};
  for (const it of bot?.inventory?.items?.() || []) inv[it.name] = (inv[it.name] || 0) + it.count;
  return inv;
};

const goTo = {
  name: 'go_to',
  describe: 'walk to a remembered place',
  timeoutMs: 120_000,
  isAvailable(bot, ctx, args = {}) {
    return args.pos || memory.get()[args.place] ? { ok: true } : { ok: false, reason: 'no_target' };
  },
  async run(bot, ctx, token, args = {}) {
    const p = args.pos || memory.get()[args.place];
    if (!p) return { ok: false, reason: 'no_target', message: `I don't know where ${args.place} is` };
    token.throwIfCancelled();
    const trip = await travel(bot, () => p, token, 2);
    if (!trip.ok) return trip;
    return { ok: true, message: `reached ${args.place || 'the spot'}` };
  },
};

// Inventory before the first pickup at this death spot, so a re-run after an interrupt still knows what it gathered.
let baseline = null;

const recoverItems = {
  name: 'recover_items',
  describe: "pick up the owner's dropped items where they died and bring them back",
  timeoutMs: 180_000,
  isAvailable() {
    return memory.get().deathSpot ? { ok: true } : { ok: false, reason: 'no_target' };
  },
  async run(bot, ctx, token) {
    const spot = memory.get().deathSpot;
    if (!spot) return { ok: false, reason: 'no_target', message: 'No death spot remembered' };
    const key = JSON.stringify(spot);
    if (baseline?.key !== key) baseline = { key, inv: invMap(bot) };

    token.throwIfCancelled();
    const trip = await travel(bot, () => spot, token, 2);
    if (!trip.ok) return trip; // spot and baseline stay, so a retry picks up where this left off
    // Dropped items are picked up on contact: walk onto each one near the spot.
    const center = new Vec3(spot.x, spot.y, spot.z), tried = new Set(); // unreachable drops aren't retried
    for (let i = 0; i < 40; i++) {
      token.throwIfCancelled();
      const drop = bot.nearestEntity?.((e) => e?.name === 'item' && !tried.has(e.id) && e.position?.distanceTo(center) <= 12);
      if (!drop) break;
      tried.add(drop.id);
      try { await bot.pathfinder?.goto?.(new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 1)); } catch (_) {}
      await new Promise((r) => setTimeout(r, 300));
    }

    const after = invMap(bot), gained = {};
    for (const [name, n] of Object.entries(after)) if (n > (baseline.inv[name] || 0)) gained[name] = n - (baseline.inv[name] || 0);
    memory.set('deathSpot', null);
    baseline = null;
    if (!Object.keys(gained).length) return { ok: true, message: 'nothing left there — it may have despawned' };

    const back = await travelToOwner(bot, ctx, token);
    if (!back.ok) return { ok: true, message: 'got your stuff! Come find me and say "give"' };
    const owner = bot.players?.[ctx?.ownerName]?.entity;
    if (owner) try { await bot.lookAt?.(owner.position.offset(0, 1.6, 0)); } catch (_) {}
    for (const [name, n] of Object.entries(gained)) {
      token.throwIfCancelled();
      const it = bot.inventory.items().find((x) => x.name === name);
      if (it && bot.toss) { try { await bot.toss(it.type, null, n); } catch (_) {} }
    }
    return { ok: true, message: `brought back your stuff (${Object.keys(gained).length} kinds of items)` };
  },
};

module.exports = { goTo, recoverItems };
