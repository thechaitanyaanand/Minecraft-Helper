'use strict';
const { goals } = require('mineflayer-pathfinder');

// pathfinder.goto() rejects with "Took to long to decide path to goal!" once planning passes thinkTimeout (5 s),
// which long or twisty trips hit even though a usable partial route exists. So travel in hops: plan HOP blocks
// toward the target (quick to plan), walk it, repeat. The target is re-read every hop, so a moving owner is followed.
const HOP = 32, MAX_HOPS = 40, MAX_FAILS = 3;

/**
 * @param {() => ({x,y,z}|null)} getTarget - current target position (re-read each hop)
 * @param {number} range - how close counts as arrived (horizontal blocks)
 * @returns {Promise<{ok: boolean, reason?: string, message?: string}>}
 */
async function travel(bot, getTarget, token, range = 2) {
  let fails = 0, lastError = '';
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    token?.throwIfCancelled?.();
    const t = getTarget(), p = bot.entity?.position;
    if (!t || !p) return { ok: false, reason: 'no_target' };
    const dx = t.x - p.x, dz = t.z - p.z, dist = Math.hypot(dx, dz);
    if (dist <= range + 1 && Math.abs(t.y - p.y) < 4) return { ok: true };

    // Each failure plans a shorter hop; a failing last leg settles for standing near the target at any height
    // (the exact spot can be unreachable: the owner mid-jump, in a boat, up a pillar).
    const step = HOP / 2 ** fails;
    const last = dist <= step;
    const goal = last
      ? (fails ? new goals.GoalNearXZ(t.x, t.z, range + 1) : new goals.GoalNear(t.x, t.y, t.z, range))
      : new goals.GoalNearXZ(p.x + (dx / dist) * step, p.z + (dz / dist) * step, 3);
    try {
      await bot.pathfinder.goto(goal);
      if (last) return { ok: true }; // goto resolves only once the goal is reached
      const now = bot.entity?.position, stalled = now && Math.hypot(now.x - p.x, now.z - p.z) < 1;
      if (!stalled) fails = 0;
      else if (++fails >= MAX_FAILS) return { ok: false, reason: 'no_path', message: 'not making progress' };
    } catch (err) {
      token?.throwIfCancelled?.(); // a cancel stops the pathfinder, which rejects goto: report the cancel instead
      lastError = err.message;
      if (++fails >= MAX_FAILS) return { ok: false, reason: 'no_path', message: lastError };
    }
  }
  return { ok: false, reason: 'no_path', message: lastError || 'too far' };
}

module.exports = { travel };
