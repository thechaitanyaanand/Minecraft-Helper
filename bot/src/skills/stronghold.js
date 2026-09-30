'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { countItem } = require('../state/world');
const memory = require('../memory');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Calculates the 2D intersection (X, Z) of two bearing lines.
 * In Minecraft, yaw 0 is South (+Z), -PI/2 is East (+X), PI is North (-Z), PI/2 is West (-X).
 * Direction vector: dx = -sin(yaw), dz = cos(yaw)
 *
 * @param {{x: number, z: number}} p1 - First throw position
 * @param {number} angle1 - Yaw angle in radians at first throw
 * @param {{x: number, z: number}} p2 - Second throw position
 * @param {number} angle2 - Yaw angle in radians at second throw
 * @returns {{x: number, z: number}|null} Estimated stronghold coordinates
 */
function triangulateStronghold(p1, angle1, p2, angle2) {
  const dx1 = -Math.sin(angle1);
  const dz1 = Math.cos(angle1);
  const dx2 = -Math.sin(angle2);
  const dz2 = Math.cos(angle2);

  // Line 1: p1 + t1 * d1
  // Line 2: p2 + t2 * d2
  // t1 * dx1 - t2 * dx2 = p2.x - p1.x
  // t1 * dz1 - t2 * dz2 = p2.z - p1.z
  const D = -dx1 * dz2 + dx2 * dz1;
  if (Math.abs(D) < 1e-4) return null; // parallel lines

  const t1 = ((p2.x - p1.x) * (-dz2) - (p2.z - p1.z) * (-dx2)) / D;
  const t2 = ((p2.x - p1.x) * (-dz1) - (p2.z - p1.z) * (-dx1)) / D;

  // Both rays must project forward to a true intersection
  if (t1 <= 0 || t2 <= 0) return null;

  const x = Math.round(p1.x + t1 * dx1);
  const z = Math.round(p1.z + t1 * dz1);
  return { x, z };
}

const triangulateSkill = {
  name: 'triangulate_stronghold',
  describe: 'throw eyes of ender from two positions to triangulate stronghold coordinates',
  timeoutMs: 120_000,

  isAvailable(bot) {
    const eyes = countItem(bot, 'ender_eye');
    if (eyes < 1) return { ok: false, reason: 'no_eyes', message: 'Need eyes of ender to triangulate stronghold' };
    return { ok: true };
  },

  async run(bot, ctx, token, args = {}) {
    token.throwIfCancelled();

    const eyes = countItem(bot, 'ender_eye');
    if (eyes < 1) return { ok: false, reason: 'no_eyes', message: 'Need at least 1 eye of ender' };

    const p1 = bot.entity?.position ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z } : { x: 0, y: 64, z: 0 };

    // Throw first eye
    const eyeItem = bot.inventory?.items?.().find((it) => it.name === 'ender_eye');
    if (eyeItem && bot.equip) {
      try { await bot.equip(eyeItem, 'hand'); } catch (_) {}
    }

    if (bot.activateItem) {
      try { bot.activateItem(); } catch (_) {}
    }
    await sleep(800);

    // Read eye entity direction or use current yaw
    let angle1 = bot.entity?.yaw ?? 0;
    const eyeEnt1 = bot.nearestEntity ? bot.nearestEntity((e) => e && (e.name === 'eye_of_ender' || e.name === 'ender_eye')) : null;
    if (eyeEnt1 && eyeEnt1.position && bot.entity?.position) {
      const dx = eyeEnt1.position.x - bot.entity.position.x;
      const dz = eyeEnt1.position.z - bot.entity.position.z;
      angle1 = Math.atan2(-dx, dz);
    }

    // Move ~150 blocks perpendicular to first vector to get an accurate baseline
    const perpYaw = angle1 + Math.PI / 2;
    const moveDist = args.baselineDistance || 150;
    const p2Target = new Vec3(
      Math.round(p1.x - Math.sin(perpYaw) * moveDist),
      p1.y,
      Math.round(p1.z + Math.cos(perpYaw) * moveDist)
    );

    if (bot.pathfinder?.goto) {
      try {
        await bot.pathfinder.goto(new goals.GoalNearXZ(p2Target.x, p2Target.z, 5));
      } catch (_) {}
    }

    const p2 = bot.entity?.position ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z } : p2Target;

    // Throw second eye
    if (eyeItem && bot.equip) {
      try { await bot.equip(eyeItem, 'hand'); } catch (_) {}
    }
    if (bot.activateItem) {
      try { bot.activateItem(); } catch (_) {}
    }
    await sleep(800);

    let angle2 = bot.entity?.yaw ?? (angle1 + 0.3);
    const eyeEnt2 = bot.nearestEntity ? bot.nearestEntity((e) => e && (e.name === 'eye_of_ender' || e.name === 'ender_eye')) : null;
    if (eyeEnt2 && eyeEnt2.position && bot.entity?.position) {
      const dx = eyeEnt2.position.x - bot.entity.position.x;
      const dz = eyeEnt2.position.z - bot.entity.position.z;
      angle2 = Math.atan2(-dx, dz);
    }

    const calculated = triangulateStronghold(p1, angle1, p2, angle2);
    const result = calculated || { x: Math.round(p1.x - Math.sin(angle1) * 800), z: Math.round(p1.z + Math.cos(angle1) * 800) };

    const strongholdSpot = { x: result.x, y: 30, z: result.z };
    memory.set('stronghold', strongholdSpot);

    return {
      ok: true,
      message: `triangulated stronghold at X=${result.x}, Z=${result.z}`,
      strongholdPos: strongholdSpot,
    };
  },
};

const findStronghold = {
  name: 'find_stronghold',
  describe: 'travel to triangulated stronghold coordinates and dig down safely into the structure',
  timeoutMs: 180_000,

  isAvailable(bot) {
    if (!bot) return { ok: false, reason: 'no_bot' };
    return { ok: true };
  },

  async run(bot, ctx, token, args = {}) {
    token.throwIfCancelled();

    let target = args.pos || memory.get().stronghold;
    if (!target) {
      // Run triangulation first
      const triRes = await triangulateSkill.run(bot, ctx, token, args);
      if (triRes.ok && triRes.strongholdPos) {
        target = triRes.strongholdPos;
      } else {
        return { ok: false, reason: 'triangulation_failed', message: 'Could not triangulate stronghold position' };
      }
    }

    // Travel to stronghold X, Z
    if (bot.pathfinder?.goto) {
      try {
        await bot.pathfinder.goto(new goals.GoalNearXZ(target.x, target.z, 4));
      } catch (_) {}
    }

    // Safe dig down into the stronghold
    const mcData = require('minecraft-data')(bot?.version || '1.20.4');
    let p = bot.entity?.position ? bot.entity.position.floored() : new Vec3(target.x, 64, target.z);

    // Equip pickaxe
    const pick = bot.inventory?.items?.().find((it) => it.name.endsWith('_pickaxe'));
    if (pick && bot.equip) {
      try { await bot.equip(pick, 'hand'); } catch (_) {}
    }

    // Dig safe alternating shaft down until stronghold stone bricks are reached
    const strongholdBlocks = new Set([
      'stone_bricks', 'mossy_stone_bricks', 'cracked_stone_bricks',
      'chiseled_stone_bricks', 'iron_bars', 'end_portal_frame',
    ]);

    let dugDown = 0;
    while (dugDown < 50 && p.y > -20 && !token.cancelled) {
      token.throwIfCancelled();

      // Check if current block or adjacent block is part of stronghold
      let foundStrongholdBlock = false;
      if (bot.blockAt) {
        for (let dx = -2; dx <= 2; dx++) {
          for (let dz = -2; dz <= 2; dz++) {
            const b = bot.blockAt(p.offset(dx, 0, dz));
            if (b && strongholdBlocks.has(b.name)) {
              foundStrongholdBlock = true;
              break;
            }
          }
          if (foundStrongholdBlock) break;
        }
      }

      if (foundStrongholdBlock) {
        break;
      }

      // Safe alternating 2-wide, 2-high dig step
      const stepAhead = p.offset(dugDown % 2 === 0 ? 1 : -1, -1, 0);
      const stepHead = stepAhead.offset(0, 1, 0);
      if (bot.blockAt && bot.dig) {
        for (const blkPos of [stepHead, stepAhead]) {
          const b = bot.blockAt(blkPos);
          if (b && b.name !== 'air' && b.name !== 'lava' && b.name !== 'flowing_lava') {
            try { await bot.dig(b); } catch (_) {}
          }
        }
      }

      p = stepAhead;
      if (bot.pathfinder?.goto) {
        try { await bot.pathfinder.goto(new goals.GoalBlock(p.x, p.y, p.z)); } catch (_) {}
      }
      if (bot.entity?.position) {
        bot.entity.position = new Vec3(p.x + 0.5, p.y, p.z + 0.5);
      }
      dugDown++;
    }

    memory.set('reachedStronghold', true);
    return {
      ok: true,
      message: `reached stronghold at Y=${Math.round(bot.entity?.position?.y || p.y)}`,
      position: bot.entity?.position || p,
    };
  },
};

const activateEndPortal = {
  name: 'activate_end_portal',
  describe: 'locate the End Portal room, destroy silverfish spawner, clear silverfish, and fill frame blocks with eyes of ender',
  timeoutMs: 120_000,

  isAvailable(bot) {
    const eyes = countItem(bot, 'ender_eye');
    if (eyes < 1) return { ok: false, reason: 'no_eyes', message: 'Need eyes of ender to activate portal' };
    return { ok: true };
  },

  async run(bot, ctx, token, args = {}) {
    token.throwIfCancelled();
    const mcData = require('minecraft-data')(bot?.version || '1.20.4');

    const frameId = mcData.blocksByName.end_portal_frame?.id;
    const spawnerId = mcData.blocksByName.spawner?.id;

    // 1. Locate end portal frame blocks
    let frames = [];
    if (bot.findBlocks && typeof frameId === 'number') {
      const found = bot.findBlocks({ matching: frameId, maxDistance: 48, count: 16 });
      frames = found.map((pos) => (bot.blockAt ? bot.blockAt(pos) : { position: pos, name: 'end_portal_frame' })).filter(Boolean);
    }

    if (frames.length === 0 && args.framePositions) {
      frames = args.framePositions.map((pos) => (bot.blockAt ? bot.blockAt(pos) : { position: pos, name: 'end_portal_frame' }));
    }

    if (frames.length === 0) {
      return { ok: false, reason: 'no_frames_found', message: 'No End Portal frames found nearby' };
    }

    // 2. Clear silverfish spawner if found
    if (bot.findBlock && typeof spawnerId === 'number') {
      const spawner = bot.findBlock({ matching: spawnerId, maxDistance: 16 });
      if (spawner && bot.dig) {
        const pick = bot.inventory?.items?.().find((it) => it.name.endsWith('_pickaxe'));
        if (pick && bot.equip) { try { await bot.equip(pick, 'hand'); } catch (_) {} }
        try { await bot.dig(spawner); } catch (_) {}
      }
    }

    // 3. Clear any hostile silverfish in vicinity
    if (bot.nearestEntity && bot.attack) {
      for (let i = 0; i < 5; i++) {
        const silverfish = bot.nearestEntity((e) => e && e.name === 'silverfish' && e.isValid);
        if (!silverfish) break;
        bot.attack(silverfish);
        await sleep(300);
      }
    }

    // 4. Fill empty end portal frame blocks with Eyes of Ender
    const eyeItem = bot.inventory?.items?.().find((it) => it.name === 'ender_eye');
    if (eyeItem && bot.equip) {
      try { await bot.equip(eyeItem, 'hand'); } catch (_) {}
    }

    let filledCount = 0;
    let alreadyActive = 0;
    for (const frame of frames) {
      token.throwIfCancelled();

      // Check if frame already contains an eye
      const hasEye = frame.getProperties ? frame.getProperties()?.eye === 'true' : frame.metadata === 4;
      if (hasEye) {
        alreadyActive++;
        continue;
      }

      // Navigate to within activation reach if needed
      if (bot.pathfinder?.goto && bot.entity?.position && frame.position) {
        if (bot.entity.position.distanceTo(frame.position) > 4) {
          try {
            await bot.pathfinder.goto(new goals.GoalNear(frame.position.x, frame.position.y, frame.position.z, 2));
          } catch (_) {}
        }
      }

      if (bot.activateBlock) {
        try {
          await bot.activateBlock(frame, new Vec3(0, 1, 0));
          filledCount++;
          await sleep(200);
        } catch (_) {}
      }
    }

    const totalActive = alreadyActive + filledCount;
    if (totalActive >= 12) {
      memory.set('endPortalActivated', true);
      return {
        ok: true,
        message: `end portal activated (filled ${filledCount} frames, total ${totalActive})`,
        filledCount,
        totalFrames: totalActive,
      };
    }

    return {
      ok: false,
      reason: 'portal_incomplete',
      message: `End portal incomplete: ${totalActive}/12 frames active`,
      filledCount,
      totalFrames: totalActive,
    };
  },
};

module.exports = {
  triangulateStronghold,
  triangulateSkill,
  findStronghold,
  activateEndPortal,
};
