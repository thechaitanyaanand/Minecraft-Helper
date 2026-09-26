'use strict';
const { CancelToken, CancelledError } = require('../cancel');
const log = require('../log');

/**
 * Runs a skill with timeout, stuck detection, and cancellation cleanup (§10.1).
 * @param {object} skill - { name, timeoutMs, run: async (bot, ctx, token, args) => result }
 * @param {object} bot - Mineflayer bot
 * @param {object} ctx - Context object
 * @param {CancelToken} parentToken - Parent cancel token
 * @param {object} [args] - Skill arguments
 * @returns {Promise<{ ok: boolean, reason?: string, message?: string, durationMs: number }>}
 */
async function runSkill(skill, bot, ctx, parentToken, args = {}) {
  const t0 = Date.now();
  const childToken = new CancelToken();

  if (parentToken) {
    if (parentToken.cancelled) {
      childToken.cancel(parentToken.reason);
    } else {
      parentToken.onCancel((reason) => childToken.cancel(reason));
    }
  }

  const cleanup = () => {
    try { bot?.pathfinder?.stop?.(); } catch (_) {}
    try { bot?.pathfinder?.setGoal?.(null); } catch (_) {}
    try { bot?.collectBlock?.cancelTask?.(); } catch (_) {}
    try { bot?.stopDigging?.(); } catch (_) {}
    try { bot?.clearControlStates?.(); } catch (_) {}
  };

  childToken.onCancel(() => cleanup());

  // Timeout timer
  const timeoutMs = skill.timeoutMs || 30_000;
  const timeoutTimer = setTimeout(() => {
    childToken.cancel('timeout');
  }, timeoutMs);

  // Stuck detector: every 3 s, check movement over 15 s while pathfinder has a goal
  let stuckTimer = null;
  let lastPos = bot?.entity?.position ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z } : null;
  let stationarySeconds = 0;

  if (bot?.pathfinder) {
    stuckTimer = setInterval(() => {
      if (childToken.cancelled) return;
      const isMoving = typeof bot.pathfinder.isMoving === 'function' ? bot.pathfinder.isMoving() : false;
      const currentPos = bot.entity?.position;

      if (isMoving && currentPos && lastPos) {
        const dx = currentPos.x - lastPos.x;
        const dy = currentPos.y - lastPos.y;
        const dz = currentPos.z - lastPos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < 0.5) {
          stationarySeconds += 3;
          if (stationarySeconds >= 15) {
            childToken.cancel('stuck');
          }
        } else {
          stationarySeconds = 0;
          lastPos = { x: currentPos.x, y: currentPos.y, z: currentPos.z };
        }
      } else {
        stationarySeconds = 0;
        if (currentPos) lastPos = { x: currentPos.x, y: currentPos.y, z: currentPos.z };
      }
    }, 3000);
  }

  try {
    childToken.throwIfCancelled();
    const result = await skill.run(bot, ctx, childToken, args);
    const durationMs = Math.max(1, Date.now() - t0);

    if (childToken.cancelled) {
      cleanup();
      return { ok: false, reason: childToken.reason, message: `cancelled: ${childToken.reason}`, durationMs };
    }

    return {
      ok: result?.ok ?? true,
      reason: result?.reason,
      message: result?.message,
      durationMs,
      ...result,
    };
  } catch (err) {
    cleanup();
    const durationMs = Math.max(1, Date.now() - t0);

    if (err instanceof CancelledError || err.name === 'CancelledError' || childToken.cancelled) {
      const reason = err.reason || childToken.reason || 'cancelled';
      return { ok: false, reason, message: `cancelled: ${reason}`, durationMs };
    }

    log.error(`[Skill:${skill?.name || 'unknown'}] Error:`, err.message);
    return { ok: false, reason: 'error', message: err.message, durationMs };
  } finally {
    clearTimeout(timeoutTimer);
    if (stuckTimer) clearInterval(stuckTimer);
  }
}

module.exports = { runSkill };
