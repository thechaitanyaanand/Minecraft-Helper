'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { travelToOwner } = require('./owner');

// Sleep alongside the owner. The helper counts as a player, so the night only skips if it sleeps too.
// Uses a free bed nearby, else places the bed from its kit and picks it back up in the morning.

let ownerAsleep = false;
const setOwnerAsleep = (v) => { ownerAsleep = Boolean(v); };
const isOwnerAsleep = () => ownerAsleep;

// Same window mineflayer's bot.sleep() accepts.
const isNight = (bot) => { const t = bot?.time?.timeOfDay ?? 6000; return t >= 12541 && t <= 23458; };

const bedIds = (bot) => Object.values(bot.registry?.blocksByName || {}).filter((b) => b.name.endsWith('_bed')).map((b) => b.id);
const isAir = (b) => !b || b.boundingBox === 'empty';
const isSolid = (b) => b?.boundingBox === 'block';
const CARDINALS = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];

function freeBeds(bot) {
  const found = bot.findBlocks?.({ matching: bedIds(bot), maxDistance: 12, count: 16 }) || [];
  return found.map((p) => bot.blockAt(p)).filter((b) => b && !bot.parseBedMetadata?.(b)?.occupied);
}

// A bed's head points the way the placer faces, and placeBlock faces the block it places on. So with the foot
// d blocks out along a direction, the head lands at d+1 along it: both spots need air above solid ground.
async function placeOwnBed(bot) {
  const item = bot.inventory?.items?.().find((it) => it.name.endsWith('_bed'));
  if (!item || !bot.placeBlock) return null;
  const base = bot.entity.position.floored();
  for (const d of [1, 2]) {
    for (const dir of CARDINALS) {
      const foot = base.plus(dir.scaled(d)), head = base.plus(dir.scaled(d + 1));
      const fits = [foot, head].every((p) => isAir(bot.blockAt(p)) && isSolid(bot.blockAt(p.offset(0, -1, 0))));
      if (!fits) continue;
      try {
        await bot.equip(item, 'hand');
        await bot.placeBlock(bot.blockAt(foot.offset(0, -1, 0)), new Vec3(0, 1, 0));
      } catch (_) { /* placeBlock can time out on the block update even when it worked: check below */ }
      const placed = bot.blockAt(foot);
      if (placed?.name.endsWith('_bed')) { bot._bedPlaced = true; return placed; }
    }
  }
  return null;
}

async function pickUpBed(bot, pos) {
  try {
    const bed = bot.blockAt(pos);
    if (bed?.name.endsWith('_bed')) await bot.dig(bed);
    await new Promise((r) => setTimeout(r, 400));
    const drop = bot.nearestEntity?.((e) => e?.name === 'item' && e.position?.distanceTo(pos) <= 4);
    if (drop) await bot.pathfinder?.goto?.(new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 0.5));
  } catch (_) { /* worst case the kit hands out a new bed */ }
  bot._bedPlaced = false;
}

module.exports = {
  name: 'sleep_with_owner',
  describe: 'go to bed when the owner does',
  timeoutMs: 0, // runs until morning or until the owner gets up

  isOwnerAsleep,
  setOwnerAsleep,
  isNight,

  isAvailable(bot) {
    return isNight(bot) ? { ok: true } : { ok: false, reason: 'not_night' };
  },

  async run(bot, ctx, token) {
    if (!isNight(bot)) return { ok: false, reason: 'not_night', message: "It isn't night" };
    const trip = await travelToOwner(bot, ctx, token);
    if (!trip.ok) return trip;
    token.throwIfCancelled();

    let placedAt = null, slept = false, lastError = '';
    const tryBeds = async (beds) => {
      for (const bed of beds) {
        try {
          await bot.pathfinder?.goto?.(new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 2));
          await bot.sleep(bed);
          return true;
        } catch (err) { lastError = err.message; }
      }
      return false;
    };

    try {
      slept = await tryBeds(freeBeds(bot));
      if (!slept) {
        const own = await placeOwnBed(bot);
        if (own) { placedAt = own.position; slept = await tryBeds([own]); }
      }
      if (!slept) return { ok: false, reason: 'cant_sleep', message: lastError || 'no bed and no space for mine' };

      // Stay in bed until morning wakes us, the owner gets up, or something cancels the step.
      await new Promise((resolve) => {
        const done = () => { clearInterval(poll); bot.removeListener('wake', done); resolve(); };
        const poll = setInterval(() => { if (!ownerAsleep || !bot.isSleeping) done(); }, 500);
        bot.once('wake', done);
        token.onCancel(done);
      });
      return { ok: true, message: 'slept' };
    } finally {
      if (bot.isSleeping) { try { await bot.wake(); } catch (_) {} }
      if (placedAt) await pickUpBed(bot, placedAt);
    }
  },
};
