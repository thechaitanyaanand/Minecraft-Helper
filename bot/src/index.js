'use strict';
const mineflayer = require('mineflayer');
const { pathfinder, goals } = require('mineflayer-pathfinder');
const collectBlock = require('mineflayer-collectblock').plugin;
const config = require('./config');
const log = require('./log');
const { CancelToken } = require('./cancel');
const { createSay } = require('./chat/say');
const { createRouter } = require('./chat/router');
const templates = require('./chat/templates');
const { safeMovements } = require('./safety/movements');
const { startWeb, publish } = require('./web');
const { buildLiveState } = require('./liveState');
const { createDecider } = require('./decision');
const { createSystemOneClient } = require('./decision/systemone');
const questions = require('./decision/questions');
const { buildState } = require('./state/buildState');
const { timeOfDayLabel, checkNames } = require('./state/world');

let bot = null;
let currentCancelToken = new CancelToken();
let currentActivity = 'idle';
let say = () => {};
let lastDecision = null;
let pendingQuestion = null;
const decider = createDecider(config);
const getOwner = () => bot?.players[config.ownerName]?.entity;
const makeCtx = () => ({ ownerName: config.ownerName, currentGoal: 'none', currentStep: 'none', lastStepResult: 'none', autopilot: false });

function handleCommand(cmd, rest) {
  log.info(`[Command] ${cmd} ${rest}`);
  publish('event', { kind: 'command', text: `!${cmd}${rest ? ' ' + rest : ''}` });

  switch (cmd) {
    case 'help': return say(templates.help());
    case 'why': return say(templates.whyLast(lastDecision));
    case 'status': {
      const st = buildState(bot, makeCtx(), { purpose: 'status' });
      console.log('[State]', JSON.stringify(st));
      return say(templates.status({
        health: Math.round(bot?.health || 20), food: Math.round(bot?.food || 20),
        timeOfDay: timeOfDayLabel(bot?.time?.timeOfDay ?? 6000),
        activity: currentActivity, backend: decider.status().backend,
      }));
    }
    case 'stop':
      currentCancelToken.cancel('user requested stop');
      currentCancelToken = new CancelToken();
      if (pendingQuestion?.timeout) clearTimeout(pendingQuestion.timeout);
      pendingQuestion = null;
      bot?.pathfinder?.stop();
      bot?.pathfinder?.setGoal(null);
      bot?.collectBlock?.cancelTask?.();
      bot?.stopDigging?.();
      bot?.clearControlStates();
      currentActivity = 'idle';
      return say('Stopped all actions.');
    case 'come': {
      const owner = getOwner();
      if (!owner) return say("I can't see you — come closer (within ~100 blocks).");
      currentActivity = 'coming to owner';
      say('Coming to you!');
      return bot.pathfinder.setGoal(new goals.GoalNear(owner.position.x, owner.position.y, owner.position.z, 2));
    }
    case 'follow': {
      const owner = getOwner();
      if (!owner) return say("I can't see you — come closer (within ~100 blocks).");
      currentActivity = 'following owner';
      say('Following you! Type !stop to stop me.');
      return bot.pathfinder.setGoal(new goals.GoalFollow(owner, 2), true);
    }
    case 'auto': return say('Autopilot requested. Full planner available in Phase 5!');
    case 'give': return say('Give items requested. Inventory transfer available in Phase 4!');
    case 'yes':
    case 'no':
      if (pendingQuestion?.type === 'confirm') {
        const choice = pendingQuestion.choice;
        clearTimeout(pendingQuestion.timeout);
        pendingQuestion = null;
        return cmd === 'yes' ? say(templates.announceGoal(choice)) : say('Okay, what would you like me to do?');
      }
      return say('No confirmation was pending.');
    case '1':
    case '2':
    case '3':
      if (pendingQuestion?.type === 'pick') {
        const choice = pendingQuestion.options[parseInt(cmd, 10) - 1]?.replace(/\s+/g, '_');
        clearTimeout(pendingQuestion.timeout);
        pendingQuestion = null;
        if (choice) return say(templates.announceGoal(choice));
      }
      return say(`Received: ${cmd}`);
    default: return say(`Unknown command !${cmd}. Type !help for available commands.`);
  }
}

async function handleIntentText(text) {
  log.info(`[IntentText] "${text}"`);
  publish('event', { kind: 'intent', text });

  const state = buildState(bot, makeCtx(), { purpose: 'intent', playerMessage: text });
  const res = await decider.decide(state, questions.intent(), { purpose: 'intent' });
  const ans = res.answers?.intent;
  if (!ans) return;

  const { choice, confidence: conf, probabilities: probs = {} } = ans;
  const topProbs = Object.fromEntries(Object.entries(probs).sort(([, a], [, b]) => b - a).slice(0, 3));
  lastDecision = { purpose: 'intent', chosen: choice, confidence: conf, topProbs, backend: res.backend, fallback: res.fallback };

  const setPending = (type, data) => {
    if (pendingQuestion?.timeout) clearTimeout(pendingQuestion.timeout);
    pendingQuestion = { type, ...data, timeout: setTimeout(() => { pendingQuestion = null; }, 30000) };
  };

  if (choice === 'unclear' && conf >= 0.5) return say("I didn't get that. Try \"helper get wood\" or type !help.");
  if (conf >= config.decision.confAct) return say(templates.announceGoal(choice, res.answers.wants_to_learn?.p > 0.6));
  if (conf >= config.decision.confAsk) {
    setPending('confirm', { choice });
    return say(templates.didYouMean(choice.replace(/_/g, ' ')));
  }
  const top3 = Object.entries(probs).filter(([k]) => k !== 'unclear').sort(([, a], [, b]) => b - a).slice(0, 3).map(([k]) => k.replace(/_/g, ' '));
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
  bot = mineflayer.createBot({ host: config.mc.host, port: config.mc.port, username: config.mc.username, auth: 'offline', version: config.mc.version });
  bot.loadPlugin(pathfinder);
  bot.loadPlugin(collectBlock);
  say = createSay(bot);

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
    publish('event', { kind: 'spawn', text: `Joined world at ${bot.entity.position.floored()}` });
    welcomeOwner();
  });

  bot.on('death', () => publish('event', { kind: 'death', text: 'Helper died, respawning' }));
  bot.on('playerJoined', (p) => { if (p.username === config.ownerName) welcomeOwner(); });
  bot.on('chat', (u, m) => { publish('chat', { username: u, message: m, self: u === bot.username }); router(u, m); });
  bot.on('goal_reached', () => { if (currentActivity === 'coming to owner') { currentActivity = 'idle'; say('I have arrived!'); } });
  bot.on('kicked', (r) => { log.error('Kicked:', r); publish('event', { kind: 'kicked', text: String(r) }); });
  bot.on('error', (e) => log.error('Bot error:', e.message));
  bot.on('end', (r) => {
    log.warn('Disconnected:', r, '- reconnecting in 10s');
    publish('event', { kind: 'disconnect', text: `Disconnected (${r})` });
    setTimeout(start, 10_000);
  });
}
process.on('unhandledRejection', (e) => log.error('Unhandled rejection:', e));

function startLiveView() {
  startWeb(config.webPort);
  log.info(`Live view: http://127.0.0.1:${config.webPort}`);
  log.onDecision = (entry) => publish('decision', entry);
  let last = '', tick = 0;
  setInterval(() => {
    const withMap = tick++ % 4 === 0;
    let state;
    try {
      state = buildLiveState(bot, { activity: currentActivity, backend: decider.status().backend, owner: config.ownerName, withMap });
    } catch (err) {
      log.warn('Live view snapshot failed:', err.message);
      return;
    }
    const key = JSON.stringify({ ...state, map: undefined });
    if (withMap || key !== last) { last = key; publish('snapshot', state); }
  }, 500);
}

if (require.main === module) {
  startLiveView();
  start();
}
module.exports = { start };
