'use strict';
const { getSkill } = require('../skills');
const { runSkill } = require('../skills/runSkill');
const templates = require('./templates');
const log = require('../log');

/**
 * Handles the !skill <name> [json-args] debug command.
 * @param {string} rest - "<name> [json-args]"
 * @param {object} bot - Mineflayer bot
 * @param {object} ctx - Execution context
 * @param {CancelToken} token - Current cancel token
 * @param {function} say - Bot chat function
 */
async function handleDebugSkill(rest, bot, ctx, token, say) {
  if (process.env.DEBUG !== 'true') {
    return say('Debug commands are disabled (set DEBUG=true in .env).');
  }

  const trimmed = (rest || '').trim();
  if (!trimmed) {
    return say('Usage: !skill <name> [json-args]');
  }

  const spaceIdx = trimmed.indexOf(' ');
  const skillName = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const argsStr = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

  let args = {};
  if (argsStr) {
    try {
      args = JSON.parse(argsStr);
    } catch (err) {
      return say(`Invalid JSON arguments for !skill: ${err.message}`);
    }
  }

  const skill = getSkill(skillName);
  if (!skill) {
    return say(`Unknown skill "${skillName}".`);
  }

  log.info(`[Debug] Running skill "${skillName}" with args:`, args);
  say(templates.stepStart(skillName, args));

  const result = await runSkill(skill, bot, ctx, token, args);
  if (result.ok) {
    say(templates.stepDone(skillName, result.message));
  } else {
    say(templates.stepFailed(skillName, result.reason || result.message));
  }

  return result;
}

module.exports = { handleDebugSkill };
