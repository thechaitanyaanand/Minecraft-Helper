'use strict';
const { HOSTILE_MOBS } = require('../state/world');

function findFightTarget(bot, maxDist = 4) {
  if (!bot.nearestEntity || !bot.entity?.position) return null;
  return bot.nearestEntity((e) => (
    e && e.name && HOSTILE_MOBS.has(e.name) &&
    e.name !== 'creeper' &&
    e.position && bot.entity.position.distanceTo(e.position) <= maxDist
  ));
}

function findBestWeapon(bot) {
  if (!bot.inventory?.items) return null;
  const items = bot.inventory.items();
  const sword = items.find((it) => it.name.endsWith('_sword'));
  if (sword) return sword;
  return items.find((it) => it.name.endsWith('_axe')) || null;
}

module.exports = {
  name: 'fight',
  describe: 'attack hostile monster with weapon',
  timeoutMs: 20_000,

  isAvailable(bot) {
    if ((bot?.health ?? 20) <= 10) {
      return { ok: false, reason: 'low_health' };
    }
    const target = findFightTarget(bot, 4);
    if (!target) {
      return { ok: false, reason: 'no_target' };
    }
    return { ok: true };
  },

  async run(bot, ctx, token) {
    token.throwIfCancelled();

    const target = findFightTarget(bot, 4);
    if (!target) {
      return { ok: false, reason: 'no_target', message: 'No fightable hostile within 4 blocks' };
    }

    const weapon = findBestWeapon(bot);
    if (weapon && bot.equip) {
      try { await bot.equip(weapon, 'hand'); } catch (_) {}
    }

    const targetName = target.name;
    let lastAttack = 0;

    while (target.isValid && !token.cancelled) {
      token.throwIfCancelled();

      if ((bot?.health ?? 20) <= 8) {
        return { ok: false, reason: 'low_health', message: 'Health too low to continue fighting' };
      }

      const now = Date.now();
      const dist = bot.entity?.position && target.position
        ? bot.entity.position.distanceTo(target.position)
        : 999;

      if (dist <= 4 && (now - lastAttack >= 600)) {
        lastAttack = now;
        if (bot.lookAt) {
          try {
            await bot.lookAt(target.position.offset(0, target.height ? target.height * 0.8 : 1.6, 0));
          } catch (_) {}
        }
        if (bot.attack) {
          bot.attack(target);
        }
      }

      await new Promise((r) => setTimeout(r, 100));
    }

    token.throwIfCancelled();
    return { ok: true, message: `defeated ${targetName}`, target: targetName };
  },
};
