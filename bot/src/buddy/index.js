'use strict';
const log = require('../log');
const questions = require('../decision/questions');
const { buildState } = require('../state/buildState');
const { ownerEntity, HOSTILE_MOBS } = require('../state/world');

function createBuddy(bot, decider, config, say, planner, observer) {
  let enabled = false;
  let runningAction = null;
  let actionStartTime = 0;
  let lastChatter = 0;
  let loopTimer = null;
  const suppressedOffers = new Map();

  function canChat(isDanger = false) {
    const now = Date.now();
    if (isDanger) return true;
    if (now - lastChatter >= 60_000) { lastChatter = now; return true; }
    return false;
  }

  function suppress(action, durationMs = 300_000) {
    suppressedOffers.set(action, Date.now() + durationMs);
  }

  function getLegalActions(ownerState, helperHealth, inv, timeOfDay, currentGoal) {
    const now = Date.now();
    const legal = ['stay_close'];
    const hasHostiles = (ownerState?.hostiles_near_owner?.length || 0) > 0;
    if (hasHostiles && (helperHealth > 10 || (ownerState?.health && ownerState.health <= 8))) legal.push('protect_owner');

    const broke = Object.keys(ownerState?.recent?.broke || {});
    const brokeHarvestable = broke.find(b => /(log|wood|stem|stone|cobblestone|deepslate|_ore)$/.test(b));
    if (brokeHarvestable && (!suppressedOffers.has('gather_same') || now >= suppressedOffers.get('gather_same'))) {
      legal.push('gather_same');
    }

    const placed = Object.keys(ownerState?.recent?.placed || {});
    const hasPlacedInInv = placed.find(p => (inv[p] || 0) > 0);
    if (hasPlacedInInv && (!suppressedOffers.has('bring_materials') || now >= suppressedOffers.get('bring_materials'))) {
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
    if (ownerActivity === 'mining' && legal.includes('gather_same')) return 'gather_same';
    if (ownerActivity === 'building' && legal.includes('bring_materials')) return 'bring_materials';
    if (ownerActivity === 'exploring' && legal.includes('scout_ahead')) return 'scout_ahead';
    if (ownerActivity === 'chopping_wood' && legal.includes('gather_same')) return 'gather_same';
    return legal.includes('stay_close') ? 'stay_close' : legal[0];
  }

  async function executeAction(action, ownerState, needsHelp) {
    const owner = ownerEntity(bot, config.ownerName);
    if (!owner) return;

    if (action === 'stay_close') {
      const pos = bot.entity?.position;
      if (pos && owner.position && pos.distanceTo(owner.position) > 6) {
        if (planner?.startGoal) planner.startGoal('come_here');
      }
    } else if (action === 'protect_owner') {
      const nearest = ownerState?.hostiles_near_owner?.[0];
      if (canChat(true)) say(`Watch out ${config.ownerName}! Defending you against ${nearest?.type || 'monster'}!`);
      const targetEntity = Object.values(bot.entities || {}).find(e => HOSTILE_MOBS.has(e.name) && owner.position.distanceTo(e.position) <= 14);
      if (targetEntity && planner?.runSkillByName) planner.runSkillByName('fight', { targetEntity });
    } else if (action === 'gather_same') {
      const broke = Object.keys(ownerState?.recent?.broke || {})[0] || 'oak_log';
      if (needsHelp < 0.5) {
        if (canChat()) say(`You're gathering ${broke} — want me to get some nearby? (yes/no)`);
      } else {
        if (canChat()) say(`I'll collect some ${broke} nearby.`);
        planner?.startGoal(`obtain:${broke}:4`);
      }
    } else if (action === 'bring_materials') {
      const placed = Object.keys(ownerState?.recent?.placed || {})[0] || 'stone';
      if (needsHelp < 0.5) {
        if (canChat()) say(`You're building with ${placed} — want more? (yes/no)`);
      } else {
        if (canChat()) say(`Bringing you more ${placed}!`);
        planner?.startGoal('give_items');
      }
    } else if (action === 'give_food') {
      if (canChat()) say('Here is some food for you!');
      planner?.startGoal('give_items');
    } else if (action === 'build_shelter_near_owner') {
      if (canChat()) say('Night is approaching! Want me to dig us a shelter? (yes/no)');
    } else if (action === 'scout_ahead') {
      if (canChat()) say('Scouting ahead for resources and hostiles...');
      planner?.startGoal('explore');
    }
  }

  async function tick(dangerTrigger = false) {
    if (!enabled) return;
    const plState = planner?.getState?.() || { mode: 'idle' };
    if (plState.mode !== 'idle' && plState.mode !== 'buddy' && !dangerTrigger) return;

    const ownerState = observer.getOwnerState();
    const helperHealth = Math.round(bot.health || 20);

    // Hard override on low owner health with hostiles
    if (ownerState?.hostiles_near_owner?.length > 0 && ownerState?.health <= 8) {
      runningAction = 'protect_owner';
      actionStartTime = Date.now();
      return executeAction('protect_owner', ownerState, 1.0);
    }

    // Commitment rule: action runs for up to 20 s unless interrupted
    const now = Date.now();
    if (runningAction && runningAction !== 'stay_close' && now - actionStartTime < 20_000 && !dangerTrigger) {
      return;
    }

    const inv = {};
    if (bot.inventory?.items) {
      for (const it of bot.inventory.items()) if (it?.name) inv[it.name] = (inv[it.name] || 0) + it.count;
    }
    const timeOfDay = require('../state/world').timeOfDayLabel(bot.time?.timeOfDay ?? 6000);
    const legal = getLegalActions(ownerState, helperHealth, inv, timeOfDay, plState.currentGoal);
    const q = questions.buddy(legal);
    const ctx = { ownerName: config.ownerName, currentGoal: plState.currentGoal, currentStep: 'buddy', owner: ownerState };
    const state = buildState(bot, ctx, { purpose: 'buddy' });

    let chosenAction = 'stay_close';
    let needsHelpP = 0.2;
    try {
      const res = await decider.decide(state, q, { purpose: 'buddy' });
      const act = res.answers?.owner_activity?.choice || 'unknown';
      chosenAction = res.answers?.buddy_action?.choice || heuristicPick(act, legal, ownerState);
      needsHelpP = res.answers?.needs_help?.p ?? 0.2;
    } catch (err) {
      log.warn('[Buddy] Decision error, using heuristic:', err.message);
      chosenAction = heuristicPick('unknown', legal, ownerState);
    }

    runningAction = chosenAction;
    actionStartTime = Date.now();
    await executeAction(chosenAction, ownerState, needsHelpP);
  }

  function start() {
    if (loopTimer) clearInterval(loopTimer);
    loopTimer = setInterval(() => tick(false), 5000);
    bot?.on?.('entityHurt', (entity) => {
      if (entity?.username === config.ownerName) tick(true);
    });
  }

  function stop() {
    if (loopTimer) clearInterval(loopTimer);
    loopTimer = null;
    runningAction = null;
  }

  return {
    enable: () => { enabled = true; start(); },
    disable: () => { enabled = false; stop(); },
    toggle: () => { enabled = !enabled; if (enabled) start(); else stop(); return enabled; },
    isEnabled: () => enabled,
    tick,
    suppress,
    getLegalActions,
    heuristicPick,
    cleanup: stop,
  };
}

module.exports = { createBuddy };
