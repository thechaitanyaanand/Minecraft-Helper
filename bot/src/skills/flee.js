'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { HOSTILE_MOBS, hostilesNear } = require('../state/world');

function findNearestHostile(bot, radius = 12) {
  if (!bot.nearestEntity || !bot.entity?.position) return null;
  return bot.nearestEntity((e) => (
    e && e.name && HOSTILE_MOBS.has(e.name) &&
    e.position && bot.entity.position.distanceTo(e.position) <= radius
  ));
}

module.exports = {
  name: 'flee',
  describe: 'run away from nearest hostile mob',
  timeoutMs: 20_000,

  isAvailable(bot) {
    const near = hostilesNear(bot, 10);
    if (near.length === 0) return { ok: false, reason: 'no_hostiles' };
    return { ok: true };
  },

  async run(bot, ctx, token) {
    token.throwIfCancelled();

    let hostile = findNearestHostile(bot, 12);
    if (!hostile) {
      return { ok: true, message: 'no hostiles nearby' };
    }

    const setFleeGoal = () => {
      const pos = bot.entity.position;
      let dir = pos.minus(hostile.position);
      dir.y = 0;
      if (dir.norm() < 0.001) dir = new Vec3(1, 0, 0);
      const away = pos.plus(dir.normalize().scaled(16));
      if (bot.pathfinder?.setGoal) {
        bot.pathfinder.setGoal(new goals.GoalNear(away.x, away.y, away.z, 3));
      }
    };

    setFleeGoal();

    let lastAim = Date.now();
    while (!token.cancelled) {
      token.throwIfCancelled();
      if (!hostile.isValid) {
        hostile = findNearestHostile(bot, 12);
        if (!hostile) break;
      }

      const dist = bot.entity?.position && hostile.position
        ? bot.entity.position.distanceTo(hostile.position)
        : 999;

      if (dist >= 16) {
        break; // Successfully escaped
      }

      if (Date.now() - lastAim >= 2000) {
        lastAim = Date.now();
        setFleeGoal();
      }

      await new Promise((r) => setTimeout(r, 200));
    }

    if (bot.pathfinder?.stop) {
      bot.pathfinder.stop();
      bot.pathfinder.setGoal(null);
    }

    return { ok: true, message: 'escaped hostile' };
  },
};
