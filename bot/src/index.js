'use strict';
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const collectBlock = require('mineflayer-collectblock').plugin;
const config = require('./config');
const log = require('./log');
const { CancelToken } = require('./cancel');
const templates = require('./chat/templates');
const questions = require('./decision/questions');
const { buildState } = require('./state/buildState');
const { createSay } = require('./chat/say'), { createRouter } = require('./chat/router'), { handleDebugSkill } = require('./chat/debug');
const { safeMovements } = require('./safety/movements'), { startWeb, publish } = require('./web'), { buildLiveState } = require('./liveState');
const { createDecider } = require('./decision'), { createSystemOneClient } = require('./decision/systemone');
const { timeOfDayLabel, checkNames } = require('./state/world'), { createPlanner } = require('./planner/loop');
const { parseDirectTarget, parseAmount } = require('./planner/shortlist'), { createObserver } = require('./buddy/observe'), { createBuddy } = require('./buddy');

let bot = null, say = () => {}, lastDecision = null, pendingQuestion = null;
let planner = null, observer = null, buddy = null;
const decider = createDecider(config);

const setPending = (type, data) => {
  if (pendingQuestion?.timeout) clearTimeout(pendingQuestion.timeout);
  pendingQuestion = { type, ...data, timeout: setTimeout(() => { pendingQuestion = null; }, 30000) };
};

const makeCtx = () => {
  const pl = planner?.getState?.() || {};
  return { ownerName: config.ownerName, currentGoal: pl.currentGoal || 'none', currentStep: pl.currentStep || 'none', lastStepResult: 'none', autopilot: pl.mode === 'autopilot', owner: observer?.getOwnerState?.() };
};

function handleCommand(cmd, rest) {
  log.info(`[Command] ${cmd} ${rest}`);
  publish('event', { kind: 'command', text: `!${cmd}${rest ? ' ' + rest : ''}` });

  switch (cmd) {
    case 'help': return say(templates.help());
    case 'why': return say(templates.whyLast(lastDecision));
    case 'status': {
      const pl = planner?.getState?.() || { mode: 'idle' };
      return say(templates.status({ health: Math.round(bot?.health || 20), food: Math.round(bot?.food || 20), timeOfDay: timeOfDayLabel(bot?.time?.timeOfDay ?? 6000), activity: pl.mode === 'idle' ? 'idle' : `${pl.mode}: ${pl.currentGoal} (${pl.currentStep})`, backend: decider.status().backend }));
    }
    case 'buddy': {
      const on = buddy?.toggle();
      return say(`Buddy mode is now ${on ? 'active' : 'off'}.`);
    }
    case 'stop':
      planner?.stop();
      if (pendingQuestion?.timeout) clearTimeout(pendingQuestion.timeout);
      pendingQuestion = null;
      return say('Stopped all actions.');
    case 'come':
    case 'follow':
    case 'give': return planner?.startGoal(cmd === 'give' ? 'give_items' : (cmd === 'come' ? 'come_here' : 'follow_me'));
    case 'auto': return planner?.startAutopilot();
    case 'skill': return handleDebugSkill(rest, bot, makeCtx(), new CancelToken(), say);
    case 'yes':
    case 'no': {
      const c = pendingQuestion?.type === 'confirm' ? pendingQuestion.choice : null;
      if (!c) return say('No confirmation was pending.');
      const top3 = pendingQuestion.top3;
      clearTimeout(pendingQuestion.timeout);
      pendingQuestion = null;
      if (cmd === 'yes') return planner?.startGoal(c);
      const opts = top3?.length ? top3 : ['get_wood', 'make_tools', 'get_food'];
      setPending('pick', { options: opts });
      return say(templates.pickOne(opts));
    }
    case '1':
    case '2':
    case '3': {
      const c = pendingQuestion?.type === 'pick' ? pendingQuestion.options[parseInt(cmd, 10) - 1]?.replace(/\s+/g, '_') : null;
      if (c) { clearTimeout(pendingQuestion.timeout); pendingQuestion = null; return planner?.startGoal(c); }
      return say(`Received: ${cmd}`);
    }
    default: return say(`Unknown command !${cmd}. Type !help for available commands.`);
  }
}

async function handleIntentText(text) {
  log.info(`[IntentText] "${text}"`);
  publish('event', { kind: 'intent', text });

  if (pendingQuestion?.type === 'pick') {
    const matched = pendingQuestion.options.find(opt => {
      const clean = opt.replace(/_/g, ' ').toLowerCase();
      return text.toLowerCase().includes(clean) || clean.split(' ').every(w => text.toLowerCase().includes(w));
    });
    if (matched) {
      clearTimeout(pendingQuestion.timeout);
      pendingQuestion = null;
      return planner?.startGoal(matched.replace(/\s+/g, '_'));
    }
  }
  if (/\bstop\s+following\b/i.test(text) && /\bgive\b/i.test(text)) {
    planner?.stop();
    return planner?.startGoal('give_items');
  }

  const state = buildState(bot, makeCtx(), { purpose: 'intent', playerMessage: text });
  const res = await decider.decide(state, questions.intent(), { purpose: 'intent' });
  const ans = res.answers?.intent;
  if (!ans) return;

  const { choice, confidence: conf, probabilities: probs = {} } = ans;
  const topProbs = Object.fromEntries(Object.entries(probs).sort(([, a], [, b]) => b - a).slice(0, 3));
  lastDecision = { purpose: 'intent', chosen: choice, confidence: conf, topProbs, backend: res.backend, fallback: res.fallback };

  const top3 = Object.entries(probs).filter(([k]) => k !== 'unclear').sort(([, a], [, b]) => b - a).slice(0, 3).map(([k]) => k.replace(/_/g, ' '));
  if (choice === 'unclear' && conf >= 0.5) return say(templates.unclear());
  if (choice === 'explain') return say(templates.explain(text.toLowerCase()));
  if (choice === 'status' || choice === 'stop') return handleCommand(choice, '');
  if (choice === 'autopilot') return planner?.startAutopilot();
  if (choice === 'get_food' && /\bgive\b/i.test(text)) return planner?.startGoal('give_items');

  const mcData = bot?.version ? require('minecraft-data')(bot.version) : null;
  const target = parseDirectTarget(text, mcData);
  if (target && !['explain', 'stop', 'status', 'autopilot'].includes(choice)) {
    return planner?.startGoal(`obtain:${target}:${parseAmount(text)}`, { give: /\bgive\b/i.test(text) });
  }

  if (conf >= config.decision.confAct) return planner?.startGoal(choice, { learn: res.answers.wants_to_learn?.p > 0.6 });
  if (conf >= config.decision.confAsk) { setPending('confirm', { choice, top3 }); return say(templates.didYouMean(choice.replace(/_/g, ' '))); }
  setPending('pick', { options: top3 });
  return say(templates.pickOne(top3));
}

function warmup() {
  if (config.decision.backend === 'local') {
    createSystemOneClient({ baseUrl: config.decision.local.baseUrl, model: config.decision.local.model || undefined, timeoutMs: config.decision.timeoutMs })({ player_message: 'warmup' }, questions.intent()).catch(() => {});
  }
}

function start() {
  log.info(`Connecting to ${config.mc.host}:${config.mc.port} as ${config.mc.username}...`);
  bot = mineflayer.createBot({ host: config.mc.host, port: config.mc.port, username: config.mc.username, auth: 'offline', version: config.mc.version, respawn: true });
  bot.loadPlugin(pathfinder);
  bot.loadPlugin(collectBlock);
  say = createSay(bot);
  planner = createPlanner(bot, decider, config, say);
  observer = createObserver(bot, config.ownerName);
  buddy = createBuddy(bot, decider, config, say, planner, observer);

  const router = createRouter({
    botUsername: config.mc.username, ownerName: config.ownerName, prefixes: config.chatPrefixes,
    onCommand: handleCommand, onIntentText: handleIntentText,
    getPendingQuestion: () => Boolean(pendingQuestion),
  });

  let welcomed = false;
  const welcomeOwner = () => {
    if (!welcomed && bot.players[config.ownerName]) { welcomed = true; say(templates.welcome(config.ownerName)); }
  };

  bot.once('spawn', () => {
    log.info(`Spawned at ${bot.entity.position}`);
    const mcData = require('minecraft-data')(bot.version);
    checkNames(mcData);
    warmup();
    bot.pathfinder.setMovements(safeMovements(bot, mcData));
    bot.on('physicsTick', () => { if (bot.entity?.isInWater) bot.setControlState('jump', true); });
    publish('event', { kind: 'spawn', text: `Joined world at ${bot.entity.position.floored()}` });
    welcomeOwner();
    buddy.enable();
  });

  bot.on('death', () => { publish('event', { kind: 'death', text: 'Helper died, respawning' }); bot.respawn?.(); });
  bot.on('playerJoined', (p) => { if (p.username === config.ownerName) welcomeOwner(); });
  bot.on('chat', (u, m) => { publish('chat', { username: u, message: m, self: u === bot.username }); router(u, m); });
  bot.on('kicked', (r) => { log.error('Kicked:', r); publish('event', { kind: 'kicked', text: String(r) }); });
  bot.on('error', (e) => log.error('Bot error:', e.message));
  bot.on('end', (r) => { log.warn('Disconnected:', r); publish('event', { kind: 'disconnect', text: `Disconnected (${r})` }); setTimeout(start, 10_000); });
}
process.on('unhandledRejection', (e) => log.error('Unhandled rejection:', e));

function startLiveView() {
  startWeb(config.webPort);
  log.info(`Live view: http://127.0.0.1:${config.webPort}`);
  log.onDecision = (entry) => publish('decision', entry);
  let last = '', tick = 0;
  setInterval(() => {
    try {
      const withMap = tick++ % 4 === 0;
      const pl = planner?.getState?.() || { mode: 'idle' };
      const act = pl.mode === 'idle' ? 'idle' : `${pl.mode}: ${pl.currentGoal}`;
      const state = buildLiveState(bot, { activity: act, backend: decider.status().backend, owner: config.ownerName, withMap });
      const key = JSON.stringify({ ...state, map: undefined });
      if (withMap || key !== last) { last = key; publish('snapshot', state); }
    } catch (err) { log.warn('Live view snapshot failed:', err.message); }
  }, 500);
}

if (require.main === module) { startLiveView(); start(); }
module.exports = { start };
