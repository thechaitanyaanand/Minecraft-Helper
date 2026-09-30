'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { countItem, equipShield, setShield, hasBow } = require('../state/world');
const memory = require('../memory');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBestWeapon(bot) {
  if (!bot.inventory?.items) return null;
  const items = bot.inventory.items();
  const tiers = ['diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword'];
  for (const t of tiers) {
    const sw = items.find((it) => it.name === t);
    if (sw) return sw;
  }
  return items.find((it) => it.name.endsWith('_sword') || it.name.endsWith('_axe')) || null;
}

const fightDragon = {
  name: 'fight_dragon',
  describe: 'destroy End crystals, dodge dragon breath, and perform critical hits on the perched Ender Dragon to defeat it',
  timeoutMs: 300_000,

  isAvailable(bot) {
    if ((bot?.health ?? 20) <= 8) return { ok: false, reason: 'low_health', message: 'Health too low for dragon fight' };
    return { ok: true };
  },

  async run(bot, ctx, token, args = {}) {
    token.throwIfCancelled();
    const mcData = require('minecraft-data')(bot?.version || '1.20.4');

    // 1. Enter the End portal if not already in the End
    const inEnd = bot.game?.dimension === 'minecraft:the_end' || bot.dimension === 'the_end';
    if (!inEnd && bot.findBlock) {
      const portalId = mcData.blocksByName.end_portal?.id;
      if (typeof portalId === 'number') {
        const portal = bot.findBlock({ matching: portalId, maxDistance: 32 });
        if (portal && bot.pathfinder?.goto) {
          try {
            await bot.pathfinder.goto(new goals.GoalBlock(portal.position.x, portal.position.y, portal.position.z));
            await sleep(2000);
          } catch (_) {}
        }
      }
    }

    // Equip best weapon and shield
    const weapon = findBestWeapon(bot);
    if (weapon && bot.equip) {
      try { await bot.equip(weapon, 'hand'); } catch (_) {}
    }
    await equipShield(bot);

    // If on End spawn platform (e.g. at 100, 49, 0), navigate towards center
    if (inEnd && bot.entity?.position && Math.hypot(bot.entity.position.x, bot.entity.position.z) > 45) {
      let reached = false;
      if (bot.pathfinder?.goto) {
        try {
          await bot.pathfinder.goto(new goals.GoalNear(0, 65, 0, 20));
          reached = true;
        } catch (_) {}
      }
      // If pathfinder cannot reach (void gap), bridge towards main island
      if (!reached && bot.entity?.position && Math.hypot(bot.entity.position.x, bot.entity.position.z) > 45) {
        const bridgeItem = bot.inventory?.items?.().find((it) => /^(cobblestone|stone|deepslate|dirt|netherrack|end_stone)$/.test(it.name));
        if (bridgeItem && bot.placeBlock && bot.blockAt) {
          if (bot.equip) { try { await bot.equip(bridgeItem, 'hand'); } catch (_) {} }
          let cur = bot.entity.position.floored ? bot.entity.position.floored() : new Vec3(bot.entity.position.x, bot.entity.position.y, bot.entity.position.z).floored();
          for (let s = 0; s < 30 && Math.hypot(cur.x, cur.z) > 45 && !token.cancelled; s++) {
            const nextStep = cur.offset(cur.x > 0 ? -1 : 1, 0, cur.z > 0 ? -1 : (cur.z < 0 ? 1 : 0));
            const belowNext = nextStep.offset(0, -1, 0);
            const b = bot.blockAt(belowNext);
            if (!b || b.name === 'air' || b.name === 'cave_air') {
              const curFloor = bot.blockAt(cur.offset(0, -1, 0)) || { position: cur.offset(0, -1, 0), name: 'obsidian' };
              try { await bot.placeBlock(curFloor, new Vec3(nextStep.x - cur.x, 0, nextStep.z - cur.z)); } catch (_) {}
            }
            cur = nextStep;
            if (bot.entity?.position) bot.entity.position = new Vec3(cur.x + 0.5, cur.y, cur.z + 0.5);
          }
        }
      }
    }

    let crystalsDestroyed = 0;
    let breathDodged = 0;
    let perchedHits = 0;
    let dragonSeen = false;
    let dragonDefeated = false;

    const maxCombatTicks = 40;
    let combatTick = 0;

    while (combatTick++ < maxCombatTicks && !token.cancelled) {
      token.throwIfCancelled();

      // Check health
      if ((bot?.health ?? 20) <= 6) {
        // Eat food if available
        const food = bot.inventory?.items?.().find((it) => ['cooked_beef', 'cooked_porkchop', 'golden_apple', 'bread', 'apple'].includes(it.name));
        if (food && bot.consume) {
          try {
            await bot.equip?.(food, 'hand');
            await bot.consume();
          } catch (_) {}
        }
      }

      // Step A: Dodge Dragon Breath
      if (bot.entities) {
        const breathCloud = Object.values(bot.entities).find(
          (e) => e && (e.name === 'area_effect_cloud' || e.name === 'dragon_breath') &&
            bot.entity?.position && e.position &&
            bot.entity.position.distanceTo(e.position) <= 8
        );

        if (breathCloud) {
          breathDodged++;
          // Sprint away from cloud
          const awayDir = bot.entity.position.minus(breathCloud.position).normalize();
          const escapePos = bot.entity.position.plus(awayDir.scaled(10));
          if (bot.pathfinder?.goto) {
            try {
              await bot.pathfinder.goto(new goals.GoalNearXZ(escapePos.x, escapePos.z, 2));
            } catch (_) {}
          }
          if (bot.entity?.position) {
            bot.entity.position = escapePos;
          }
          await sleep(100);
          continue;
        }
      }

      // Step B: Protect owner from attacking Endermen
      if (bot.nearestEntity && ctx?.ownerName) {
        const owner = bot.players?.[ctx.ownerName]?.entity;
        const hostileEnderman = bot.nearestEntity(
          (e) => e && e.name === 'enderman' && e.isValid &&
            owner?.position && e.position &&
            (e.position.distanceTo(owner.position) <= 4 || (bot.entity?.position && e.position.distanceTo(bot.entity.position) <= 4))
        );

        if (hostileEnderman) {
          if (weapon && bot.equip) { try { await bot.equip(weapon, 'hand'); } catch (_) {} }
          if (bot.attack) {
            bot.attack(hostileEnderman);
            await sleep(400);
          }
        }
      }

      // Step C: Destroy End Crystals
      if (bot.entities) {
        const crystals = Object.values(bot.entities).filter(
          (e) => e && (e.name === 'end_crystal' || e.name === 'ender_crystal') && e.isValid
        );

        if (crystals.length > 0) {
          const crystal = crystals[0];
          const dist = bot.entity?.position ? bot.entity.position.distanceTo(crystal.position) : 30;

          // Check for iron bars cage around crystal
          if (bot.blockAt && bot.dig && crystal.position) {
            const pick = bot.inventory?.items?.().find((it) => it.name.endsWith('_pickaxe'));
            if (pick && bot.equip) { try { await bot.equip(pick, 'hand'); } catch (_) {} }
            for (const off of [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(0, 1, 0)]) {
              const b = bot.blockAt(crystal.position.plus(off));
              if (b && b.name === 'iron_bars') {
                try { await bot.dig(b); } catch (_) {}
              }
            }
            if (weapon && bot.equip) { try { await bot.equip(weapon, 'hand'); } catch (_) {} }
          }

          if (hasBow(bot)) {
            // Approach to bow range if too far away
            if (dist > 35 && bot.pathfinder?.goto) {
              try {
                await bot.pathfinder.goto(new goals.GoalNearXZ(crystal.position.x, crystal.position.z, 20));
              } catch (_) {}
            }
            // Shoot crystal with bow
            const bow = bot.inventory?.items?.().find((it) => it.name === 'bow');
            if (bow) {
              try {
                if (bot.equip) await bot.equip(bow, 'hand');
                if (bot.lookAt) await bot.lookAt(crystal.position);
                bot.activateItem?.();
                await sleep(150);
                if (bot.deactivateItem) bot.deactivateItem();
                crystalsDestroyed++;
                crystal.isValid = false;
              } catch (_) {}
            }
          } else {
            // Approach base of pillar and tower / hit
            if (bot.pathfinder?.goto) {
              try {
                await bot.pathfinder.goto(new goals.GoalNearXZ(crystal.position.x, crystal.position.z, 2));
              } catch (_) {}
            }

            // Raise shield, hit crystal
            setShield(bot, true);
            if (bot.attack) {
              bot.attack(crystal);
              crystalsDestroyed++;
              crystal.isValid = false;
            }
            setShield(bot, false);
          }

          await sleep(100);
          continue;
        }
      }

      // Step D: Fight Ender Dragon (especially when perched)
      let dragon = null;
      if (bot.nearestEntity) {
        dragon = bot.nearestEntity((e) => e && (e.name === 'ender_dragon' || e.name === 'dragon') && e.isValid);
      }
      if (!dragon && bot.entities) {
        dragon = Object.values(bot.entities).find((e) => e && (e.name === 'ender_dragon' || e.name === 'dragon') && e.isValid);
      }

      if (dragon) {
        dragonSeen = true;
        // Exit fountain portal is at X=0, Z=0
        const isPerched = dragon.position && Math.hypot(dragon.position.x, dragon.position.z) <= 12 && dragon.position.y <= 75;

        if (isPerched) {
          // Rush to dragon tail / flank
          if (bot.pathfinder?.goto) {
            try {
              await bot.pathfinder.goto(new goals.GoalNear(dragon.position.x, dragon.position.y, dragon.position.z, 3));
            } catch (_) {}
          }

          // Equip best sword
          if (weapon && bot.equip) {
            try { await bot.equip(weapon, 'hand'); } catch (_) {}
          }

          // Critical hit: Jump and attack on the way down!
          if (bot.setControlState) {
            bot.setControlState('jump', true);
            await sleep(50); // apex of jump
            if (bot.lookAt) {
              try { await bot.lookAt(dragon.position.offset(0, 1.5, 0)); } catch (_) {}
            }
            if (bot.attack && dragon.isValid) {
              bot.attack(dragon);
              perchedHits++;
              if (!dragon.isValid || (typeof dragon.health === 'number' && dragon.health <= 0)) {
                dragonDefeated = true;
                break;
              }
            }
            bot.setControlState('jump', false);
          } else if (bot.attack && dragon.isValid) {
            bot.attack(dragon);
            perchedHits++;
            if (!dragon.isValid || (typeof dragon.health === 'number' && dragon.health <= 0)) {
              dragonDefeated = true;
              break;
            }
          }

          await sleep(100);
        } else {
          // Dragon is flying in air: if bow available, shoot it
          if (hasBow(bot) && dragon.position) {
            const bow = bot.inventory?.items?.().find((it) => it.name === 'bow');
            if (bow) {
              try {
                if (bot.equip) await bot.equip(bow, 'hand');
                if (bot.lookAt) await bot.lookAt(dragon.position);
                bot.activateItem?.();
                await sleep(150);
                if (bot.deactivateItem) bot.deactivateItem();
              } catch (_) {}
            }
          }
          await sleep(100);
        }
      } else {
        // Dragon not in immediate range: reposition to center fountain (0, 65, 0) awaiting next perch
        if (bot.pathfinder?.goto && bot.entity?.position && Math.hypot(bot.entity.position.x, bot.entity.position.z) > 15) {
          try {
            await bot.pathfinder.goto(new goals.GoalNear(0, 65, 0, 8));
          } catch (_) {}
        }
        await sleep(500);
      }
    }

    // Check if exit portal opened at center fountain upon dragon death
    if (!dragonDefeated && bot.findBlock) {
      const exitPortalId = mcData.blocksByName.end_portal?.id;
      if (typeof exitPortalId === 'number' && bot.findBlock({ matching: exitPortalId, maxDistance: 32 })) {
        dragonDefeated = true;
      }
    }

    if (dragonDefeated) {
      memory.set('dragonDefeated', true);
      return {
        ok: true,
        message: 'defeated the Ender Dragon! The End is liberated!',
        crystalsDestroyed,
        breathDodged,
        perchedHits,
      };
    }

    if (dragonSeen) {
      return {
        ok: false,
        reason: 'dragon_still_alive',
        message: 'Ender Dragon is still alive',
        crystalsDestroyed,
        breathDodged,
        perchedHits,
      };
    }

    return {
      ok: false,
      reason: 'no_dragon_found',
      message: 'Could not find the Ender Dragon',
      crystalsDestroyed,
      breathDodged,
      perchedHits,
    };
  },
};

module.exports = {
  fightDragon,
};
