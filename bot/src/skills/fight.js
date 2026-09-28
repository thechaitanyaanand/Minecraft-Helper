'use strict';
const { goals } = require('mineflayer-pathfinder');
const { HOSTILE_MOBS, RANGED_MOBS, hasShield, hasBow, equipShield, setShield } = require('../state/world');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findFightTarget(bot, maxDist = 4, mobNames = null) {
  if (!bot.nearestEntity || !bot.entity?.position) return null;
  const filterNames = mobNames ? new Set(mobNames) : null;
  const creeperOk = hasShield(bot); // a raised shield blocks the blast, so creepers become fair game
  return bot.nearestEntity((e) => (
    e && e.name &&
    (filterNames ? filterNames.has(e.name) : (HOSTILE_MOBS.has(e.name) && (creeperOk || e.name !== 'creeper'))) &&
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

// Full-draw arrow flies ~3 blocks/tick under 0.05/tick² gravity: it drops ~0.003·d² blocks over d blocks.
// ponytail: no lead for moving targets; add velocity lead if shots at strafing skeletons miss a lot.
async function shootArrow(bot, target, dist) {
  const bow = bot.inventory?.items?.().find((it) => it.name === 'bow');
  if (!bow || !bot.activateItem) return;
  await bot.equip(bow, 'hand');
  const aim = () => bot.lookAt?.(target.position.offset(0, (target.height || 1.8) * 0.7 + 0.003 * dist * dist, 0), true);
  await aim();
  bot.activateItem();
  await sleep(1100); // full draw is 1s
  if (target.isValid) await aim();
  bot.deactivateItem?.();
}

module.exports = {
  name: 'fight',
  describe: 'attack hostile monster with weapon',
  timeoutMs: 20_000,

  isAvailable(bot, ctx, args = {}) {
    if ((bot?.health ?? 20) <= 10) return { ok: false, reason: 'low_health' };
    if (args.targetEntity?.isValid) return { ok: true };
    const dist = args.mobNames ? 16 : 4;
    let target = findFightTarget(bot, dist, args.mobNames);
    if (!target && hasBow(bot)) target = findFightTarget(bot, 16, [...RANGED_MOBS]);
    if (!target) return { ok: false, reason: 'no_target' };
    return { ok: true };
  },

  async run(bot, ctx, token, args = {}) {
    token.throwIfCancelled();

    let target = args.targetEntity?.isValid ? args.targetEntity : null;
    if (!target) target = findFightTarget(bot, args.maxDist || 16, args.mobNames);
    if (!target) target = findFightTarget(bot, 4);
    if (!target) return { ok: false, reason: 'no_target', message: 'No fightable hostile nearby' };

    const weapon = findBestWeapon(bot);
    const hasShieldUp = await equipShield(bot);
    const ranged = RANGED_MOBS.has(target.name) && hasBow(bot);
    let meleeReady = false, following = false;

    const targetName = target.name;
    let lastAttack = 0;

    try {
      while (target.isValid && !token.cancelled) {
        token.throwIfCancelled();

        if ((bot?.health ?? 20) <= 8) {
          return { ok: false, reason: 'low_health', message: 'Health too low to continue fighting' };
        }

        const dist = bot.entity?.position && target.position
          ? bot.entity.position.distanceTo(target.position)
          : 999;

        // Skeletons out-range a sword: stand still and shoot until they close in.
        if (ranged && dist > 6) {
          setShield(bot, false);
          if (following) { try { bot.pathfinder?.setGoal?.(null); } catch (_) {} following = false; }
          meleeReady = false;
          try { await shootArrow(bot, target, dist); } catch (_) {}
          continue;
        }

        if (!meleeReady) {
          meleeReady = true;
          if (weapon && bot.equip) { try { await bot.equip(weapon, 'hand'); } catch (_) {} }
        }
        if (!following && bot.pathfinder?.setGoal) {
          following = true;
          try { bot.pathfinder.setGoal(new goals.GoalFollow(target, 1), true); } catch (_) {}
        }

        const eye = target.position.offset(0, target.height ? target.height * 0.8 : 1.6, 0);
        const now = Date.now();
        if (dist <= 4 && (now - lastAttack >= 600)) {
          lastAttack = now;
          if (bot.lookAt) {
            try { await bot.lookAt(eye); } catch (_) {}
          }
          // Can't swing with the shield raised: drop it, hit, raise it again for the cooldown.
          setShield(bot, false);
          if (bot.attack) bot.attack(target);
        } else if (hasShieldUp && dist <= 6) {
          // A shield only blocks what it faces (creeper blasts included).
          if (bot.lookAt) { try { await bot.lookAt(eye, true); } catch (_) {} }
          setShield(bot, true);
        }

        await sleep(100);
      }
    } finally {
      setShield(bot, false);
      if (bot.pathfinder?.stop) {
        try {
          bot.pathfinder.stop();
          bot.pathfinder.setGoal(null);
        } catch (_) {}
      }
    }

    token.throwIfCancelled();
    return { ok: true, message: `defeated ${targetName}`, target: targetName };
  },
};
