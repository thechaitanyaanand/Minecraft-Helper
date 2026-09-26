'use strict';
const { goals } = require('mineflayer-pathfinder');
const { FOOD_MOBS } = require('../state/world');

function findBestWeapon(bot) {
  if (!bot.inventory?.items) return null;
  const items = bot.inventory.items();
  const sword = items.find((it) => it.name.endsWith('_sword'));
  if (sword) return sword;
  return items.find((it) => it.name.endsWith('_axe')) || null;
}

module.exports = {
  name: 'hunt',
  describe: 'hunt nearby food mobs for meat',
  timeoutMs: 60_000,

  isAvailable(bot, ctx, args = {}) {
    const radius = args.radius || 48;
    const allowed = args.mobNames ? new Set(args.mobNames) : FOOD_MOBS;
    const target = bot.nearestEntity?.((e) => (
      e && e.name && allowed.has(e.name) &&
      e.position && bot.entity?.position &&
      bot.entity.position.distanceTo(e.position) <= radius
    ));
    if (!target) return { ok: false, reason: 'no_target' };
    return { ok: true };
  },

  async run(bot, ctx, token, args = {}) {
    token.throwIfCancelled();
    const radius = args.radius || 48;
    const allowed = args.mobNames ? new Set(args.mobNames) : FOOD_MOBS;

    const target = bot.nearestEntity?.((e) => (
      e && e.name && allowed.has(e.name) &&
      e.position && bot.entity?.position &&
      bot.entity.position.distanceTo(e.position) <= radius
    ));

    if (!target) {
      return { ok: false, reason: 'no_target' };
    }

    const weapon = findBestWeapon(bot);
    if (weapon && bot.equip) {
      try { await bot.equip(weapon, 'hand'); } catch (_) {}
    }

    const targetName = target.name;
    token.throwIfCancelled();

    // Approach and attack loop
    if (bot.pathfinder?.setGoal) {
      bot.pathfinder.setGoal(new goals.GoalFollow(target, 1), true);
    }

    let lastAttack = 0;
    while (target.isValid && !token.cancelled) {
      const now = Date.now();
      const dist = bot.entity?.position && target.position
        ? bot.entity.position.distanceTo(target.position)
        : 999;

      if (dist < 3 && (now - lastAttack >= 600)) {
        lastAttack = now;
        if (bot.attack) {
          bot.attack(target);
        }
      }

      await new Promise((r) => setTimeout(r, 100));
      token.throwIfCancelled();
    }

    if (bot.pathfinder?.stop) {
      bot.pathfinder.stop();
      bot.pathfinder.setGoal(null);
    }

    token.throwIfCancelled();

    // Collect drops within 8 blocks
    if (bot.entities && bot.pathfinder?.goto) {
      const drops = Object.values(bot.entities).filter((e) => (
        e && e.name === 'item' && e.position && bot.entity?.position &&
        bot.entity.position.distanceTo(e.position) <= 8
      ));

      for (const drop of drops) {
        token.throwIfCancelled();
        try {
          const p = drop.position;
          await bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 0.5));
        } catch (_) {}
      }
    }

    return { ok: true, message: `hunted ${targetName}`, target: targetName };
  },
};
