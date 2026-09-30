'use strict';
const log = require('../log');
const questions = require('../decision/questions');
const { buildState } = require('../state/buildState');
const { ownerEntity, HOSTILE_MOBS, timeOfDayLabel, hasShield } = require('../state/world');
const { dropOf } = require('../planner/obtain');
const { FOOD_PRIORITY } = require('../skills/eat');

// Things the owner visibly needs, handed over unasked. `when` sees the owner state and our inventory.
const GIFTS = Object.freeze([
  { item: 'arrow', count: 16, keep: 16, when: (o) => /bow$/.test(o?.held || ''), say: 'Here, have some arrows for that bow!' },
  { item: 'torch', count: 8, keep: 8, when: (o, night) => night || /_pickaxe$/.test(o?.held || ''), say: 'Take some torches to light things up!' },
]);

function createBuddy(bot, decider, config, say, planner, observer, opts = {}) {
  let enabled = false, runningAction = null, actionStartTime = 0, lastChatter = 0, loopTimer = null, inFlight = false;
  const setPending = opts.setPending || (() => {}), suppressedOffers = new Map();

  function canChat(isDanger = false) {
    const now = Date.now();
    if (isDanger) return true;
    if (now - lastChatter >= 60_000) { lastChatter = now; return true; }
    return false;
  }

  function suppress(action, durationMs = 300_000) {
    suppressedOffers.set(action, Date.now() + durationMs);
  }
  const suppressed = (action) => (suppressedOffers.get(action) || 0) > Date.now();

  // Hands over just these items (give_items would dump the whole inventory, tools included).
  function handOver(match, count, msg) {
    if (canChat(true)) say(msg);
    return planner?.runSkillByName?.('give_to_owner', { match, count });
  }

  function giftFor(ownerState, inv, night) {
    return GIFTS.find((g) => !suppressed(`gift_${g.item}`) && (inv[g.item] || 0) >= g.count + g.keep && g.when(ownerState, night));
  }

  // The mob that hit the owner if we saw it, else the hostile closest to them. Creepers only with a shield up.
  function pickTarget(owner) {
    const attacker = observer.getLastAttacker?.();
    if (attacker && (attacker.name !== 'creeper' || hasShield(bot))) return attacker;
    let best = null, bestD = 16;
    for (const e of Object.values(bot.entities || {})) {
      if (!e?.position || !HOSTILE_MOBS.has(e.name) || (e.name === 'creeper' && !hasShield(bot))) continue;
      const d = owner.position?.distanceTo?.(e.position) ?? 999;
      if (d <= bestD) { best = e; bestD = d; }
    }
    return best;
  }

  function getLegalActions(ownerState, butlerHealth, inv, timeOfDay, currentGoal) {
    const now = Date.now(), legal = ['stay_close'];
    const hasHostiles = (ownerState?.hostiles_near_owner?.length || 0) > 0;
    if (hasHostiles && (butlerHealth > 10 || (ownerState?.health && ownerState.health <= 8))) legal.push('protect_owner');

    const broke = Object.keys(ownerState?.recent?.broke || {});
    if (broke.find(b => /(log|wood|stem|stone|cobblestone|deepslate|_ore)$/.test(b)) && (!suppressedOffers.has('gather_same') || now >= suppressedOffers.get('gather_same'))) {
      legal.push('gather_same');
    }

    const placed = Object.keys(ownerState?.recent?.placed || {});
    if (placed.find(p => (inv[p] || 0) > 0) && (!suppressedOffers.has('bring_materials') || now >= suppressedOffers.get('bring_materials'))) {
      legal.push('bring_materials');
    }

    const hasFood = Object.keys(inv).some(k => /(cooked_|bread|apple|carrot|potato|beef|porkchop|mutton|chicken)/.test(k));
    if (hasFood && (ownerState?.recent?.hurt > 0 || (ownerState?.health && ownerState.health < 15))) legal.push('give_food');

    if ((timeOfDay === 'dusk' || timeOfDay === 'night') && (!suppressedOffers.has('build_shelter_near_owner') || now >= suppressedOffers.get('build_shelter_near_owner'))) {
      legal.push('build_shelter_near_owner');
    }
    if ((ownerState?.recent?.moved || 0) > 40 && (!suppressedOffers.has('scout_ahead') || now >= suppressedOffers.get('scout_ahead'))) {
      legal.push('scout_ahead');
    }
    if (currentGoal && currentGoal !== 'none' && currentGoal !== 'idle') legal.push('continue_own_task');
    return legal;
  }

  function heuristicPick(ownerActivity, legal, ownerState) {
    if (legal.includes('protect_owner') && (ownerState?.hostiles_near_owner?.length > 0)) return 'protect_owner';
    if ((ownerActivity === 'mining' || ownerActivity === 'chopping_wood') && legal.includes('gather_same')) return 'gather_same';
    if (ownerActivity === 'building' && legal.includes('bring_materials')) return 'bring_materials';
    if (ownerActivity === 'exploring' && legal.includes('scout_ahead')) return 'scout_ahead';
    return legal.includes('stay_close') ? 'stay_close' : legal[0];
  }

  async function executeAction(action, ownerState, needsHelp) {
    const owner = ownerEntity(bot, config.ownerName);
    if (!owner) return;

    if (action === 'stay_close') {
      const pl = planner?.getState?.();
      if (pl && pl.mode !== 'idle') return;
      const pos = bot.entity?.position;
      if (pos && owner.position && pos.distanceTo(owner.position) > 6) planner?.startGoal?.('come_here');
    } else if (action === 'protect_owner') {
      const targetEntity = pickTarget(owner);
      if (!targetEntity) return;
      if (canChat(true)) say(`Watch out ${config.ownerName}! Defending you against ${targetEntity.name.replace(/_/g, ' ')}!`);
      if (planner?.runSkillByName) planner.runSkillByName('fight', { targetEntity });
    } else if (action === 'gather_same') {
      const broke = dropOf(Object.keys(ownerState?.recent?.broke || {})[0] || 'oak_log'); // stone -> cobblestone, iron_ore -> raw_iron
      if (needsHelp < 0.5) {
        if (canChat()) { setPending('buddy_offer', { action: 'gather_same', item: broke }); say(`You're gathering ${broke} — want me to get some nearby? (yes/no)`); }
      } else {
        if (canChat()) say(`I'll collect some ${broke} nearby.`);
        planner?.startGoal?.(`obtain:${broke}:4`);
      }
    } else if (action === 'bring_materials') {
      const placed = Object.keys(ownerState?.recent?.placed || {})[0] || 'stone';
      if (needsHelp < 0.5) {
        if (canChat()) { setPending('buddy_offer', { action: 'bring_materials', item: placed }); say(`You're building with ${placed} — want more? (yes/no)`); }
      } else {
        await handOver((n) => n === placed, 64, `Bringing you more ${placed}!`);
      }
    } else if (action === 'give_food') {
      await handOver((n) => FOOD_PRIORITY.includes(n), 8, 'Here is some food for you!');
    } else if (action === 'build_shelter_near_owner') {
      if (canChat()) { setPending('buddy_offer', { action: 'build_shelter_near_owner' }); say('Night is approaching! Want me to dig us a shelter? (yes/no)'); }
    } else if (action === 'scout_ahead') {
      if (canChat()) say('Scouting ahead for resources and hostiles...');
      planner?.startGoal?.('explore');
    }
  }

  async function tick(dangerTrigger = false) {
    if (!enabled || inFlight) return;
    const plState = planner?.getState?.() || { mode: 'idle' };
    if (plState.mode === 'goal') return;
    if (plState.mode !== 'idle' && plState.mode !== 'buddy' && !dangerTrigger) return;

    const ownerState = observer.getOwnerState(), butlerHealth = Math.round(bot.health || 20);
    // Owner just got hit by something we can see: go after it right away, no model call.
    const hitBySomething = dangerTrigger && butlerHealth > 10 && observer.getLastAttacker?.();
    if (hitBySomething || (ownerState?.hostiles_near_owner?.length > 0 && ownerState?.health <= 8)) {
      runningAction = 'protect_owner'; actionStartTime = Date.now();
      return executeAction('protect_owner', ownerState, 1.0);
    }

    const now = Date.now();
    if (runningAction && runningAction !== 'stay_close' && now - actionStartTime < 20_000 && !dangerTrigger) return;

    const inv = {};
    if (bot.inventory?.items) for (const it of bot.inventory.items()) if (it?.name) inv[it.name] = (inv[it.name] || 0) + it.count;
    const timeOfDay = timeOfDayLabel(bot.time?.timeOfDay ?? 6000);
    const gift = giftFor(ownerState, inv, timeOfDay === 'dusk' || timeOfDay === 'night');
    if (gift) {
      suppress(`gift_${gift.item}`, 5 * 60_000);
      runningAction = 'gift'; actionStartTime = now;
      return handOver((n) => n === gift.item, gift.count, gift.say);
    }
    const legal = getLegalActions(ownerState, butlerHealth, inv, timeOfDay, plState.currentGoal);

    if (legal.length === 1 && legal[0] === 'stay_close') {
      runningAction = 'stay_close'; actionStartTime = now;
      return executeAction('stay_close', ownerState, 0.1);
    }

    inFlight = true;
    try {
      const q = questions.buddy(legal);
      const ctx = { ownerName: config.ownerName, currentGoal: plState.currentGoal, currentStep: 'buddy', owner: ownerState };
      const state = buildState(bot, ctx, { purpose: 'buddy' });

      let chosenAction = 'stay_close', needsHelpP = 0.2;
      try {
        const res = await decider.decide(state, q, { purpose: 'buddy', timeoutMs: 1500 });
        const act = res.answers?.owner_activity?.choice || 'unknown';
        chosenAction = res.answers?.buddy_action?.choice || heuristicPick(act, legal, ownerState);
        needsHelpP = res.answers?.needs_help?.p ?? 0.2;
      } catch (err) {
        log.warn('[Buddy] Decision error, using heuristic:', err.message);
        chosenAction = heuristicPick('unknown', legal, ownerState);
      }

      runningAction = chosenAction; actionStartTime = Date.now();
      await executeAction(chosenAction, ownerState, needsHelpP);
    } finally {
      inFlight = false;
    }
  }

  // Jump into the owner's fight right away, in any planner mode (following, gathering...): the planner pauses the
  // current step and resumes it afterwards. No model call: someone hitting the owner is not a judgement call.
  let lastDefendSay = 0;
  function defend(target) {
    if (!enabled || !target?.isValid || !target.position) return false;
    if (Math.round(bot.health ?? 20) <= 10) return false;
    if (target.name === 'creeper' && !hasShield(bot)) return false;
    if ((bot.entity?.position?.distanceTo?.(target.position) ?? 999) > 24) return false;
    const started = planner?.defendOwner?.(target);
    if (started && Date.now() - lastDefendSay > 30_000) {
      lastDefendSay = Date.now();
      say(`I've got your back! Fighting the ${target.name.replace(/_/g, ' ')}.`);
    }
    return Boolean(started);
  }

  // Registered after the observer's own entityHurt listener, so getLastAttacker() already reflects this hit.
  function onEntityHurt(entity) {
    if (entity?.username !== config.ownerName) return;
    if (!defend(observer.getLastAttacker?.())) tick(true);
  }

  // The owner swinging with a hostile mob right next to them means they're fighting it, even before taking a hit.
  function onSwingArm(entity) {
    if (entity?.username !== config.ownerName || !entity.position) return;
    let mob = null, best = 4;
    for (const e of Object.values(bot.entities || {})) {
      if (!e?.position || !HOSTILE_MOBS.has(e.name)) continue;
      const d = entity.position.distanceTo(e.position);
      if (d <= best) { mob = e; best = d; }
    }
    if (mob) defend(mob);
  }

  function start() {
    stop();
    loopTimer = setInterval(() => tick(false), 8000);
    bot?.on?.('entityHurt', onEntityHurt);
    bot?.on?.('entitySwingArm', onSwingArm);
  }

  function stop() {
    if (loopTimer) clearInterval(loopTimer);
    loopTimer = null; runningAction = null;
    bot?.removeListener?.('entityHurt', onEntityHurt);
    bot?.removeListener?.('entitySwingArm', onSwingArm);
  }

  return {
    enable: () => { enabled = true; start(); },
    disable: () => { enabled = false; stop(); },
    toggle: () => { enabled = !enabled; if (enabled) start(); else stop(); return enabled; },
    isEnabled: () => enabled,
    tick, suppress, getLegalActions, heuristicPick, cleanup: stop, executeAction, giftFor, defend,
  };
}

module.exports = { createBuddy };
