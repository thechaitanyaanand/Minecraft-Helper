'use strict';
const { CancelToken } = require('../cancel');
const { GOALS, getFirstNeededStep } = require('./goals');
const { getSkill } = require('../skills');
const { runSkill } = require('../skills/runSkill');
const { safetyOverride, interrupt: heuristicInterrupt, nextGoal: heuristicNextGoal, getLegalInterrupts } = require('./heuristics');
const questions = require('../decision/questions');
const { buildState } = require('../state/buildState');
const templates = require('../chat/templates');
const log = require('../log');
const { plan, getHave } = require('./obtain');

function createPlanner(bot, decider, config, say) {
  let mode = 'idle', currentGoalId = 'none', currentStepName = 'none', currentToken = new CancelToken();
  let lastInterruptCheck = 0, lastSaidTime = Date.now();

  const speak = (msg, opts) => { lastSaidTime = Date.now(); say(msg, opts); };
  const progressTimer = setInterval(() => {
    if (mode !== 'idle' && Date.now() - lastSaidTime >= 18000) speak(`Still working on ${(currentStepName !== 'none' ? currentStepName : currentGoalId).replace(/_/g, ' ')}...`);
  }, 3000);
  if (progressTimer.unref) progressTimer.unref();

  const makeCtx = () => ({ ownerName: config.ownerName, currentGoal: currentGoalId, currentStep: currentStepName, lastStepResult: 'none', autopilot: mode === 'autopilot' });
  const stop = (reason = 'user requested stop') => {
    currentToken.cancel(reason);
    currentToken = new CancelToken();
    try { bot?.pathfinder?.stop?.(); bot?.pathfinder?.setGoal?.(null); bot?.collectBlock?.cancelTask?.(); bot?.stopDigging?.(); bot?.clearControlStates?.(); } catch (_) {}
    mode = 'idle'; currentGoalId = 'none'; currentStepName = 'none'; lastSaidTime = Date.now();
  };


  async function checkInterrupts(token) {
    const now = Date.now();
    if (now - lastInterruptCheck < 2000) return null;
    lastInterruptCheck = now;
    const state = buildState(bot, makeCtx(), { purpose: 'interrupt' });
    let chosenAction = safetyOverride(state);
    if (!chosenAction) {
      const legal = getLegalInterrupts(state);
      if (legal.length <= 1) return null;
      const q = questions.interrupt(legal);
      if (!q) return null;
      const res = await decider.decide(state, q, { purpose: 'interrupt', heuristicPick: heuristicInterrupt(state, legal) });
      chosenAction = res.answers?.interrupt?.choice;
    }
    if (!chosenAction || chosenAction === 'continue_task') return null;
    log.warn(`[Planner] Interrupting with action: ${chosenAction}`);
    const map = { eat_food: 'eat', flee: 'flee', fight: 'fight', dig_in: 'dig_in', get_food: 'hunt_food' };
    const skill = getSkill(map[chosenAction] || chosenAction);
    if (!skill) return null;
    speak(templates.stepStart(skill.name, {}));
    return await runSkill(skill, bot, makeCtx(), token || currentToken);
  }

  async function pickNextGoal() {
    const available = ['get_wood', 'make_tools', 'get_food', 'survive_night'].filter((id) => {
      const g = GOALS[id];
      if (!g || g.done(bot, makeCtx())) return false;
      const time = bot?.time?.timeOfDay ?? 6000;
      return id !== 'survive_night' || (time >= 12000 && time < 23000);
    });
    if (!available.length) { speak('Autopilot: All basic survival goals complete!'); mode = 'idle'; return null; }
    const state = buildState(bot, makeCtx(), { purpose: 'next_goal' });
    if (available.length === 1) return available[0];
    const q = questions.next_goal(available);
    const res = await decider.decide(state, q, { purpose: 'next_goal', heuristicPick: heuristicNextGoal(state, available) });
    return res.answers?.next_goal?.choice || available[0];
  }

  async function runGoalLoop(goalId, opts = {}, goalToken = currentToken) {
    let rId = goalId;
    if (goalId === 'get_wood') rId = 'obtain:group:logs:8';
    else if (goalId === 'make_tools') rId = 'obtain:stone_pickaxe:1';
    else if (goalId === 'get_food') rId = 'obtain:group:food:4';

    const isObtain = rId.startsWith('obtain:'), isBp = rId.startsWith('blueprint:'), isMob = rId.startsWith('mob:');
    let tgt = '', count = 1;
    if (isObtain) {
      const rest = rId.slice('obtain:'.length), idx = rest.lastIndexOf(':');
      tgt = idx !== -1 ? rest.slice(0, idx) : rest;
      count = parseInt(idx !== -1 ? rest.slice(idx + 1) : '1', 10) || 1;
    }
    const goal = (isObtain || isBp || isMob) ? null : GOALS[rId];
    if (!goal && !isObtain && !isBp && !isMob) return speak(`Unknown goal: ${goalId}`);
    currentGoalId = goalId;
    let stepCount = 0, retries = 0, lastFailedStep = null;

    while (!goalToken.cancelled) {
      let step = null;
      const inv = {};
      if (bot?.inventory?.items) for (const it of bot.inventory.items()) inv[it.name] = (inv[it.name] || 0) + it.count;

      if (isObtain) {
        const steps = plan(tgt, count, inv);
        if (steps.fail) { speak(templates.stepFailed(tgt, steps.fail)); return stop(steps.fail); }
        if (!steps.length) {
          speak(templates.stepDone(tgt, `Obtained ${count} ${tgt}`));
          if (opts.give || goalId === 'get_food') await runSkill(getSkill('give_to_owner'), bot, makeCtx(), goalToken);
          if (mode === 'autopilot') { const n = await pickNextGoal(); if (n && !goalToken.cancelled) return runGoalLoop(n, { autopilot: true }, goalToken); }
          mode = 'idle'; currentGoalId = 'none'; currentStepName = 'none'; return;
        }
        step = steps[0];
      } else if (isBp) {
        const bpId = rId.replace('blueprint:', '');
        const { loadBlueprint, calculateMaterials } = require('./blueprint');
        const mats = calculateMaterials(loadBlueprint(bpId));
        const missing = Object.entries(mats).find(([k, v]) => getHave(inv, k) < v);
        if (missing) {
          const needed = missing[1] - getHave(inv, missing[0]);
          const steps = plan(missing[0], needed, inv);
          if (steps.fail) { speak(templates.stepFailed(missing[0], steps.fail)); return stop(steps.fail); }
          step = steps[0];
        } else {
          step = { skill: 'build_blueprint', args: { id: bpId } };
        }
      } else if (isMob) {
        step = { skill: 'fight', args: { mobNames: [rId.replace('mob:', '')], count: 1 } };
      } else {
        if (goal.done(bot, makeCtx())) {
          speak(templates.stepDone(goalId, `Completed goal: ${goal.describe}`));
          if (mode === 'autopilot') {
            const next = await pickNextGoal();
            if (next && !goalToken.cancelled) return runGoalLoop(next, { autopilot: true }, goalToken);
          }
          mode = 'idle'; currentGoalId = 'none'; currentStepName = 'none'; return;
        }
        step = getFirstNeededStep(goal, bot, makeCtx());
        if (!step) { mode = 'idle'; return; }
      }
      if (++stepCount > 25) { speak(templates.stepFailed(goalId, 'too_many_steps')); return stop('too_many_steps'); }

      await checkInterrupts(goalToken);
      if (goalToken.cancelled) return;

      currentStepName = step.skill;
      const skill = getSkill(step.skill);
      if (!skill) { speak(`Missing skill: ${step.skill}`); return stop('missing_skill'); }

      speak(templates.stepStart(step.skill, step.args || {}, opts.learn));
      const res = await runSkill(skill, bot, makeCtx(), goalToken, step.args || {});
      if (goalToken.cancelled) return;

      if (res.ok) {
        speak(templates.stepDone(step.skill, res.message));
        retries = 0; lastFailedStep = null;
        if (isBp && step.skill === 'build_blueprint') { mode = 'idle'; currentGoalId = 'none'; currentStepName = 'none'; return; }
        if (isMob && step.skill === 'fight') { mode = 'idle'; currentGoalId = 'none'; currentStepName = 'none'; return; }
      } else {
        if (res.reason === 'cancelled') return;
        if (res.reason === 'owner_not_found') { speak("I can't see you — please come closer."); return stop('owner_not_found'); }
        if (lastFailedStep === step.skill) retries++; else { lastFailedStep = step.skill; retries = 1; }
        if (retries === 2 && res.reason === 'no_target') {
          speak('Cannot find target nearby — exploring around first...');
          await runSkill(getSkill('explore'), bot, makeCtx(), goalToken, { distance: 30 });
        } else if (retries > 2) {
          speak(templates.stepFailed(step.skill, res.reason || res.message));
          return stop('step_failed_max_retries');
        }
      }
    }
  }

  function startGoal(goalId, opts = {}) {
    if (goalId === 'autopilot') return startAutopilot();
    if (goalId === 'stop') return stop('user requested stop');
    stop('starting new goal');
    mode = opts.autopilot ? 'autopilot' : 'goal';
    currentGoalId = goalId;
    speak(templates.announceGoal(goalId, opts.learn));
    runGoalLoop(goalId, opts, currentToken).catch((err) => log.error('[Planner] Loop error:', err));
  }

  function startAutopilot() {
    stop('starting autopilot');
    mode = 'autopilot';
    speak(templates.announceGoal('autopilot'));
    pickNextGoal().then((g) => { if (g) startGoal(g, { autopilot: true }); }).catch((err) => log.error('[Planner] Autopilot error:', err));
  }

  async function runSkillByName(skillName, args = {}) {
    const skill = getSkill(skillName);
    if (!skill) return { ok: false, reason: 'skill_not_found' };
    return await runSkill(skill, bot, makeCtx(), currentToken, args);
  }

  return {
    startGoal, startAutopilot, stop, runSkillByName, checkInterrupts, getLegalInterrupts,
    getState: () => ({ mode, currentGoal: currentGoalId, currentStep: currentStepName }),
  };
}

module.exports = { createPlanner, getLegalInterrupts };
