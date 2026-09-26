'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');

module.exports = {
  name: 'explore',
  describe: 'walk 30-50 blocks in a random direction to explore terrain',
  timeoutMs: 40_000,

  isAvailable() {
    return { ok: true };
  },

  async run(bot, ctx, token, args = {}) {
    token.throwIfCancelled();
    const pos = bot.entity?.position;
    if (!pos) return { ok: false, reason: 'no_position' };

    const startPos = typeof pos.clone === 'function' ? pos.clone() : new Vec3(pos.x, pos.y, pos.z);
    const distance = args.distance || (30 + Math.random() * 20);
    const angle = args.angle !== undefined ? args.angle : Math.random() * 2 * Math.PI;

    const targetX = startPos.x + Math.cos(angle) * distance;
    const targetZ = startPos.z + Math.sin(angle) * distance;

    token.throwIfCancelled();
    if (bot.pathfinder?.setGoal) {
      bot.pathfinder.setGoal(new goals.GoalXZ(targetX, targetZ));
    }

    let startedMoving = false;
    let ticks = 0;
    while (!token.cancelled) {
      const curPos = bot.entity?.position;
      const moved = curPos ? curPos.distanceTo(startPos) : 0;
      if (moved >= Math.min(25, distance - 5)) {
        break;
      }
      const isMoving = typeof bot.pathfinder?.isMoving === 'function' ? bot.pathfinder.isMoving() : false;
      if (isMoving) startedMoving = true;
      if (startedMoving && !isMoving) {
        break;
      }
      if (++ticks > 15 && !startedMoving) {
        break;
      }
      await new Promise((r) => setTimeout(r, 400));
      token.throwIfCancelled();
    }

    if (bot.pathfinder?.stop) {
      bot.pathfinder.stop();
      bot.pathfinder.setGoal(null);
    }

    const finalPos = bot.entity?.position || startPos;
    const finalDist = Math.round(finalPos.distanceTo(startPos));

    return {
      ok: true,
      message: `explored ${finalDist} blocks`,
      distanceMoved: finalDist,
    };
  },
};
