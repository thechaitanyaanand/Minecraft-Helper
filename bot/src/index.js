'use strict';
require('./safety/mineflayerPatch');
const mineflayer = require('mineflayer'), { pathfinder } = require('mineflayer-pathfinder');
const collectBlock = require('mineflayer-collectblock').plugin;
const config = require('./config'), log = require('./log'), { CancelToken } = require('./cancel');
const templates = require('./chat/templates'), questions = require('./decision/questions');
const { buildState } = require('./state/buildState'), { createSay } = require('./chat/say');
const { createRouter } = require('./chat/router'), { handleDebugSkill } = require('./chat/debug');
const { safeMovements } = require('./safety/movements'), { replenishKit, startAutoReplenish } = require('./safety/kit'), { startWeb, publish } = require('./web');
const { buildLiveState } = require('./liveState'), { createDecider } = require('./decision'), { keywordIntent } = require('./decision/mock');
const { createSystemOneClient } = require('./decision/systemone');
const { timeOfDayLabel, checkNames, parseCoords, equipShield } = require('./state/world'), { createPlanner } = require('./planner/loop');
const { parseDirectTarget, parseAmount } = require('./planner/shortlist');
const { createObserver } = require('./buddy/observe'), { createBuddy } = require('./buddy');
const { plan } = require('./planner/obtain'), { GOALS } = require('./planner/goals');
const memory = require('./memory'), { ownerEntity } = require('./state/world'), { createTalk } = require('./chat/talk');
const { Vec3 } = require('vec3');

let bot = null, say = () => {}, lastDecision = null, pendingQuestion = null;
let planner = null, observer = null, buddy = null, talk = null;
const decider = createDecider(config);

const setPending = (type, data) => {
  if (pendingQuestion?.timeout) clearTimeout(pendingQuestion.timeout);
  pendingQuestion = { type, ...data, timeout: setTimeout(() => { pendingQuestion = null; }, 30000) };
};

const makeCtx = () => {
  const pl = planner?.getState?.() || {};
  return { ownerName: config.ownerName, currentGoal: pl.currentGoal || 'none', currentStep: pl.currentStep || 'none', lastStepResult: 'none', autopilot: pl.mode === 'autopilot', owner: observer?.getOwnerState?.() };
};

async function handleCommand(cmd, rest) {
  log.info(`[Command] ${cmd} ${rest}`);
  publish('event', { kind: 'command', text: `!${cmd}${rest ? ' ' + rest : ''}` });
  switch (cmd) {
    case 'help': return say(templates.help());
    case 'why': return say(templates.whyLast(lastDecision));
    case 'status': {
      const pl = planner?.getState?.() || { mode: 'idle' };
      return say(templates.status({ health: Math.round(bot?.health || 20), food: Math.round(bot?.food || 20), timeOfDay: timeOfDayLabel(bot?.time?.timeOfDay ?? 6000), activity: pl.mode === 'idle' ? 'idle' : `${pl.mode}: ${pl.currentGoal} (${pl.currentStep})`, backend: decider.status().backend }));
    }
    case 'buddy': return say(`Buddy mode is now ${buddy?.toggle() ? 'active' : 'off'}.`);
    case 'stop':
      planner?.stop();
      if (pendingQuestion?.timeout) clearTimeout(pendingQuestion.timeout);
      pendingQuestion = null;
      return say('Stopped all actions.');
    case 'come':
    case 'follow':
    case 'give': {
      if (rest) {
        const coords = parseCoords(rest);
        if (coords) {
          bot._lastOwnerPos = coords;
          bot._lastOwnerPosTime = Date.now();
        }
      }
      return planner?.startGoal(cmd === 'give' ? 'give_items' : (cmd === 'come' ? 'come_here' : 'follow_me'));
    }
    case 'goto': {
      if (rest) {
        const coords = parseCoords(rest);
        if (coords) {
          bot._lastOwnerPos = coords;
          bot._lastOwnerPosTime = Date.now();
          return planner?.startGoal(`goto:${coords.x},${coords.y},${coords.z}`);
        }
      }
      return say('Please provide coordinates, e.g. !goto 100 64 200');
    }
    case 'auto': return planner?.startAutopilot();
    case 'kit': {
      const res = replenishKit(bot, config, { force: true });
      const list = res.replenished?.map(r => r.item).join(', ');
      return say(list ? `Restocked kit: ${list}.` : 'Kit already fully stocked.');
    }
    case 'sethome': {
      const pos = ownerEntity(bot, config.ownerName)?.position || bot?.entity?.position;
      if (!pos) return say("I can't tell where we are right now.");
      memory.set('home', pos);
      return say(`Home set at ${memory.get().home.x} ${memory.get().home.y} ${memory.get().home.z}. Say "butler go home" anytime.`);
    }
    case 'home': return memory.get().home ? planner?.startGoal('go_home') : say('No home set yet. Stand there and say "butler set home".');
    case 'stuff': return memory.get().deathSpot ? planner?.startGoal('recover_items') : say("I don't know of any stuff to fetch. I only remember where you died if I saw it happen.");
    case 'where': return say(memory.describe());
    case 'plan': {
      if (rest) {
        const clean = rest.trim().toLowerCase().replace(/\s+/g, '_');
        const inv = {};
        for (const it of bot?.inventory?.items?.() || []) inv[it.name] = (inv[it.name] || 0) + it.count;
        const steps = plan(clean, 1, inv);
        if (steps?.fail) {
          return say(`Cannot plan ${clean}: ${steps.fail}`);
        }
        if (Array.isArray(steps) && steps.length > 0) {
          return say(templates.planSummary(clean, 1, steps));
        }
        return say(`I already have what is needed for ${clean}!`);
      }
      return say('Roadmap: 1.Wood/Tools > 2.Iron Gear > 3.Diamonds (Y=-58) > 4.Nether Portal > 5.Fortress & Blazes > 6.Pearls & Eyes > 7.Stronghold > 8.Defeat Ender Dragon!');
    }
    case 'boost': {
      replenishKit(bot, config, { force: true });
      if (bot.inventory?.items && bot.equip) {
        const items = bot.inventory.items();
        const armorTiers = ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather'];
        for (const slot of ['head', 'torso', 'legs', 'feet']) {
          const suffix = slot === 'torso' ? 'chestplate' : (slot === 'head' ? 'helmet' : (slot === 'legs' ? 'leggings' : 'boots'));
          let bestPiece = null;
          for (const tier of armorTiers) {
            bestPiece = items.find((it) => it.name === `${tier}_${suffix}`);
            if (bestPiece) break;
          }
          if (bestPiece) {
            try { await bot.equip(bestPiece, slot); } catch (_) {}
          }
        }
        const swordTiers = ['netherite', 'diamond', 'iron', 'stone', 'wooden'];
        let bestSword = null;
        for (const tier of swordTiers) {
          bestSword = items.find((it) => it.name === `${tier}_sword`);
          if (bestSword) break;
        }
        if (bestSword) {
          try { await bot.equip(bestSword, 'hand'); } catch (_) {}
        }
        try { await equipShield(bot); } catch (_) {}
      }
      return say('Boosted! Restocked supplies and equipped best combat gear, armor, and shield!');
    }
    case 'goal': {
      if (!rest) {
        const pl = planner?.getState?.() || { mode: 'idle' };
        return say(`Current goal: ${pl.currentGoal || 'none'} (${pl.mode}).`);
      }
      const g = rest.trim().toLowerCase().replace(/\s+/g, '_');
      if (g === 'stop') return handleCommand('stop', '');
      if (g === 'list') {
        return say('Available goals: wood, tools, food, diamond, nether, blaze, pearl, eye, stronghold, end_portal, dragon, beat_game, auto');
      }
      const goalMap = {
        dragon: 'defeat_ender_dragon', ender_dragon: 'defeat_ender_dragon', beat_dragon: 'defeat_ender_dragon',
        defeat_dragon: 'defeat_ender_dragon', defeat_ender_dragon: 'defeat_ender_dragon',
        beat_game: 'beat_game', game: 'beat_game', win: 'beat_game',
        nether: 'enter_nether', portal: 'enter_nether', nether_portal: 'enter_nether', enter_nether: 'enter_nether',
        blaze: 'get_blaze_rods', blazes: 'get_blaze_rods', fortress: 'get_blaze_rods', blaze_rods: 'get_blaze_rods', get_blaze_rods: 'get_blaze_rods',
        pearl: 'gather_ender_pearls', pearls: 'gather_ender_pearls', ender_pearls: 'gather_ender_pearls', gather_ender_pearls: 'gather_ender_pearls',
        eye: 'craft_eyes_of_ender', eyes: 'craft_eyes_of_ender', craft_eyes_of_ender: 'craft_eyes_of_ender',
        stronghold: 'find_stronghold', find_stronghold: 'find_stronghold',
        end_portal: 'activate_end_portal', activate_end_portal: 'activate_end_portal',
        diamond: 'deep_mine', diamonds: 'deep_mine', deep_mine: 'deep_mine',
        wood: 'get_wood', get_wood: 'get_wood', tools: 'make_tools', make_tools: 'make_tools',
        food: 'get_food', get_food: 'get_food', auto: 'autopilot', autopilot: 'autopilot',
      };
      const chosen = goalMap[g] || g;
      if (!GOALS[chosen] && !chosen.startsWith('obtain:') && chosen !== 'autopilot') {
        return say(`Unknown goal "${g}". Type /goal list for available goals.`);
      }
      planner?.startGoal(chosen);
      return say(`Switched goal to: ${templates.goalLabel(chosen)}!`);
    }
    case 'skill': return handleDebugSkill(rest, bot, makeCtx(), new CancelToken(), say);
    case 'yes':
    case 'no': {
      if (pendingQuestion?.type === 'offer') {
        const { goal } = pendingQuestion;
        clearTimeout(pendingQuestion.timeout);
        pendingQuestion = null;
        return cmd === 'yes' ? planner?.startGoal(goal) : say('Okay, maybe later!');
      }
      if (pendingQuestion?.type === 'buddy_offer') {
        const { action, item } = pendingQuestion;
        clearTimeout(pendingQuestion.timeout);
        pendingQuestion = null;
        if (cmd === 'yes') {
          if (action === 'gather_same') return planner?.startGoal(`obtain:${item}:4`);
          if (action === 'bring_materials') return planner?.runSkillByName('give_to_owner', { match: (n) => n === item, count: 64 });
          if (action === 'build_shelter_near_owner') return planner?.startGoal('survive_night');
          return;
        }
        buddy?.suppress(action, 300_000);
        return say("Okay, I won't offer that for a while.");
      }
      const c = pendingQuestion?.type === 'confirm' ? pendingQuestion.choice : null;
      if (!c) return say('No confirmation was pending.');
      const top3 = pendingQuestion.top3;
      clearTimeout(pendingQuestion.timeout); pendingQuestion = null;
      if (cmd === 'yes') return planner?.startGoal(c);
      const opts = top3?.length ? top3 : ['get_wood', 'make_tools', 'get_food'];
      setPending('pick', { options: opts });
      return say(templates.pickOne(opts));
    }
    case '1': case '2': case '3': {
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
    if (matched) { clearTimeout(pendingQuestion.timeout); pendingQuestion = null; return planner?.startGoal(matched.replace(/\s+/g, '_')); }
  }
  if (/\bstop\s+following\b/i.test(text) && /\bgive\b/i.test(text)) { planner?.stop(); return planner?.startGoal('give_items'); }
  if (/\b(kit|tools|restock|replenish)\b/i.test(text) && !/\b(iron|stone|diamond)\b/i.test(text)) return handleCommand('kit', '');
  const cleanCmd = text.trim().toLowerCase();
  if (cleanCmd === 'yes' || cleanCmd === 'no') return handleCommand(cleanCmd, '');
  const coords = parseCoords(text);
  if (coords) {
    bot._lastOwnerPos = coords;
    bot._lastOwnerPosTime = Date.now();
    log.info(`[Coords] Updated owner coordinates to (${coords.x}, ${coords.y}, ${coords.z}) from chat`);
    if (/\b(follow)\b/i.test(cleanCmd)) return planner?.startGoal('follow_me');
    if (/\b(come|here|goto|go\s+to|walk)\b/i.test(cleanCmd) || !/[a-zA-Z]{3,}/.test(cleanCmd.replace(/coords?/g, ''))) {
      return planner?.startGoal('come_here');
    }
  }
  if (/^(come\s+(here|to\s+me)|come)$/.test(cleanCmd)) return planner?.startGoal('come_here'); if (/^(follow\s+me|follow)$/.test(cleanCmd)) return planner?.startGoal('follow_me');
  if (/^stop(\s+all)?$/.test(cleanCmd)) return handleCommand('stop', '');
  if (/\bset\s*(my\s+|this\s+as\s+)?(home|base)\b/i.test(text)) return handleCommand('sethome', '');
  if (/\bwhere\b.*\b(home|base|chests?|died)\b/i.test(text)) return handleCommand('where', '');
  if (/\b(go|come|head|back|let'?s\s+go)\b.*\b(home|base)\b/i.test(text)) return handleCommand('home', '');
  if (/\b(get|grab|recover|fetch|bring)\b.*\bmy\s+(stuff|items|things|loot|drops)\b/i.test(text)) return handleCommand('stuff', '');
  if (/^(\/)?plan(\b|$)/i.test(cleanCmd)) return handleCommand('plan', cleanCmd.replace(/^(\/)?plan\s*/i, ''));
  if (/^(\/)?boost(\b|$)/i.test(cleanCmd)) return handleCommand('boost', cleanCmd.replace(/^(\/)?boost\s*/i, ''));
  if (/^(\/)?goal(\b|$)/i.test(cleanCmd)) return handleCommand('goal', cleanCmd.replace(/^(\/)?goal\s*/i, ''));
  if (/\b(beat|kill|slay|defeat)\b.*\b(dragon|ender\s*dragon)\b/i.test(text)) return planner?.startGoal('defeat_ender_dragon');
  if (/\b(beat|win)\b.*\b(game|minecraft)\b/i.test(text)) return planner?.startGoal('beat_game');
  if (/\b(find|locate|search)\b.*\b(stronghold)\b/i.test(text)) return planner?.startGoal('find_stronghold');
  if (/\b(activate|open|light)\b.*\b(end\s*portal)\b/i.test(text)) return planner?.startGoal('activate_end_portal');
  if (/\b(build|make|light)\b.*\b(nether\s*portal)\b/i.test(text)) return planner?.startGoal('enter_nether');
  if (/\b(mine|gather|dig|find)\b.*\b(diamonds?|heera)\b/i.test(text)) return planner?.startGoal('deep_mine');

  const state = buildState(bot, makeCtx(), { purpose: 'intent', playerMessage: text });
  const res = await decider.decide(state, questions.intent(), { purpose: 'intent' });
  const ans = res.answers?.intent;
  if (!ans) return;

  let { choice, confidence: conf } = ans;
  const { probabilities: probs = {} } = ans;
  // The Decider shrugs at Hinglish and typos ("idhar aao", "gt wod"); the keyword rules know those.
  // Eval: fixes 25 of 44 misses, flips at most 2 true "unclear" lines.
  if (choice === 'unclear' && conf < 0.6) {
    const kw = keywordIntent(text);
    if (kw) { log.info(`[Intent] Decider unsure (${Math.round(conf * 100)}%), keyword rules say ${kw}`); choice = kw; conf = config.decision.confAct; }
  }
  const topProbs = Object.fromEntries(Object.entries(probs).sort(([, a], [, b]) => b - a).slice(0, 3));
  lastDecision = { purpose: 'intent', chosen: choice, confidence: conf, topProbs, backend: res.backend, fallback: res.fallback };

  const top3 = Object.entries(probs).filter(([k]) => k !== 'unclear').sort(([, a], [, b]) => b - a).slice(0, 3).map(([k]) => k.replace(/_/g, ' '));
  // Talk: the Decider picks a reply from a shortlist (knowledge, small talk, live facts, recipes, memories).
  if (choice === 'remember') return talk.remember(text);
  if (choice === 'go_place') return talk.goPlace(text);
  if (['explain', 'chat', 'unclear'].includes(choice) && await talk.answer(text)) return;
  if (choice === 'explain' || choice === 'chat') return say(templates.unclear());
  if (choice === 'status' || choice === 'stop') return handleCommand(choice, '');
  if (choice === 'autopilot') return planner?.startAutopilot();
  if (choice === 'get_food' && /\bgive\b/i.test(text)) return planner?.startGoal('give_items');

  const mcData = bot?.version ? require('minecraft-data')(bot.version) : null;
  const target = parseDirectTarget(text, mcData);
  if (target && !['explain', 'stop', 'status', 'autopilot'].includes(choice)) {
    if (target.startsWith('blueprint:') || target.startsWith('mob:')) return planner?.startGoal(target);
    const hasNum = /\b\d+\b/.test(text) || /\b(stack|few|couple)\b/i.test(text);
    if (!hasNum && choice === 'get_wood') return planner?.startGoal('get_wood');
    if (!hasNum && choice === 'get_food') return planner?.startGoal('get_food');
    if (choice === 'make_tools' && !/_(pickaxe|axe|sword|shovel|hoe)$/.test(target)) return planner?.startGoal('make_tools', { give: true }); // "make me stone tools"
    return planner?.startGoal(`obtain:${target}:${parseAmount(text)}`, { give: /\b(give|me|for\s+me)\b/i.test(text) });
  }

  if (choice === 'unclear' && conf >= 0.5) return say(templates.unclear());
  if (conf >= config.decision.confAct) return planner?.startGoal(choice, { learn: res.answers.wants_to_learn?.p > 0.6, give: /\b(give|me|for\s+me)\b/i.test(text) });
  if (conf >= config.decision.confAsk) { setPending('confirm', { choice, top3 }); return say(templates.didYouMean(choice.replace(/_/g, ' '))); }
  setPending('pick', { options: top3 });
  return say(templates.pickOne(top3));
}

async function warmup() {
  if (config.decision.backend === 'local') {
    try {
      const client = createSystemOneClient({
        baseUrl: config.decision.local.baseUrl,
        model: config.decision.local.model || undefined,
        timeoutMs: 10000,
      });
      await client({ player_message: 'warmup' }, questions.intent());
      log.info('[Decider] Local model warm and ready.');
    } catch (err) {
      log.warn('[Decider] Warmup warning:', err.message);
    }
  }
}

function start() {
  log.info(`Connecting to ${config.mc.host}:${config.mc.port} as ${config.mc.username}...`);
  bot = mineflayer.createBot({ host: config.mc.host, port: config.mc.port, username: config.mc.username, auth: 'offline', version: config.mc.version, respawn: true });
  bot.setMaxListeners(100);
  bot.loadPlugin(pathfinder); bot.loadPlugin(collectBlock);
  say = createSay(bot); planner = createPlanner(bot, decider, config, say); observer = createObserver(bot, config.ownerName, {
    onOwnerDeath: (pos) => say(pos
      ? "Oh no! I marked where you died. Say 'butler get my stuff' and I'll fetch it."
      : "Oh no, you died! I couldn't see where, so I can't fetch your stuff this time."),
  });
  buddy = createBuddy(bot, decider, config, say, planner, observer, { setPending });
  talk = createTalk({ bot, decider, say, setPending, planner, config, makeCtx });

  const router = createRouter({
    botUsername: config.mc.username, ownerName: config.ownerName, prefixes: config.chatPrefixes,
    onCommand: handleCommand, onIntentText: handleIntentText, getPendingQuestion: () => Boolean(pendingQuestion),
  });

  let welcomed = false, autoKit = null;
  const welcomeOwner = () => { if (!welcomed && bot.players[config.ownerName]) { welcomed = true; say(templates.welcome(config.ownerName)); } };

  bot.on('spawn', () => { replenishKit(bot, config); });
  bot.once('spawn', () => {
    log.info(`Spawned at ${bot.entity.position}`);
    const mcData = require('minecraft-data')(bot.version);
    checkNames(mcData); warmup();
    bot.pathfinder.setMovements(safeMovements(bot, mcData));
    bot.on('physicsTick', () => { if (bot.entity?.isInWater) bot.setControlState('jump', true); });
    bot.on('entityMoved', (entity) => {
      if (entity?.username === config.ownerName && entity.position) {
        bot._lastOwnerPos = entity.position.clone ? entity.position.clone() : new Vec3(entity.position.x, entity.position.y, entity.position.z);
        bot._lastOwnerPosTime = Date.now();
      }
    });
    publish('event', { kind: 'spawn', text: `Joined world at ${bot.entity.position.floored()}` });
    welcomeOwner(); buddy.enable(); autoKit = startAutoReplenish(bot, config);
  });

  const sleepSkill = require('./skills/sleep');
  bot.on('entitySleep', (e) => { if (e?.username === config.ownerName) { sleepSkill.setOwnerAsleep(true); planner?.sleepWithOwner(); } });
  bot.on('entityWake', (e) => { if (e?.username === config.ownerName) sleepSkill.setOwnerAsleep(false); });
  bot.on('death', () => { memory.addEvent('I (your butler) died and respawned'); publish('event', { kind: 'death', text: 'Butler died, respawning' }); bot.respawn?.(); });
  bot.on('playerJoined', (p) => { if (p.username === config.ownerName) welcomeOwner(); });
  bot.on('chat', (u, m) => { publish('chat', { username: u, message: m, self: u === bot.username }); router(u, m); });
  bot.on('kicked', (r) => { log.error('Kicked:', r); publish('event', { kind: 'kicked', text: String(r) }); });
  bot.on('error', (e) => log.error('Bot error:', e.message));
  bot.on('end', (r) => { autoKit?.stop?.(); buddy?.disable(); observer?.stopTracking(); log.warn('Disconnected:', r); publish('event', { kind: 'disconnect', text: `Disconnected (${r})` }); setTimeout(start, 10_000); });
}
process.on('unhandledRejection', (e) => log.error('Unhandled rejection:', e)).on('uncaughtException', (e) => log.error('Uncaught exception:', e.message || e));

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
