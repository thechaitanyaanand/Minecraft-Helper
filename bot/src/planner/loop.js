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

function createPlanner(bot, decider, config, say) {
  let mode = 'idle'; // 'idle' | 'goal' | 'autopilot'
  let currentGoalId = 'none';
  let currentStepName = 'none';
  let currentToken = new CancelToken();
  let lastInterruptCheck = 0;

  const makeCtx = () => ({
    ownerName: config.ownerName,
    currentGoal: currentGoalId,
    currentStep: currentStepName,
    lastStepResult: 'none',
    autopilot: mode === 'autopilot',
  });

  const stop = (reason = 'user requested stop') => {
    currentToken.cancel(reason);
    currentToken = new CancelToken();
    try { bot?.pathfinder?.stop?.(); bot?.pathfinder?.setGoal?.(null); bot?.collectBlock?.cancelTask?.(); bot?.stopDigging?.(); bot?.clearControlStates?.(); } catch (_) {}
    mode = 'idle'; currentGoalId = 'none'; currentStepName = 'none';
  };

  async function checkInterrupts(token) {
    const now = Date.now();
    if (now - lastInterruptCheck < 2000) return null;
    lastInterruptCheck = now;

    const state = buildState(bot, makeCtx(), { purpose: 'interrupt' });
    const safety = safetyOverride(state);
    let chosenAction = safety;

    if (!chosenAction) {
      const legal = getLegalInterrupts(state);
      if (legal.length <= 1) return null;
      const q = questions.interrupt(legal);
      if (!q) return null;
      const res = await decider.decide(state, q, {
        purpose: 'interrupt', heuristicPick: heuristicInterrupt(state, legal),
      });
      chosenAction = res.answers?.interrupt?.choice;
    }
    if (!chosenAction || chosenAction === 'continue_task') return null;

    log.warn(`[Planner] Interrupting with action: ${chosenAction}`);
    const actionSkillMap = { eat_food: 'eat', flee: 'flee', fight: 'fight', dig_in: 'dig_in', get_food: 'hunt_food' };
    const skillName = actionSkillMap[chosenAction] || chosenAction;
    const skill = getSkill(skillName);
    if (!skill) return null;
    say(templates.stepStart(skillName, {}));
    return await runSkill(skill, bot, makeCtx(), token || currentToken);
  }

  async function pickNextGoal() {
    const candidateGoals = ['get_wood', 'make_tools', 'get_food', 'survive_night'];
    const available = candidateGoals.filter((id) => {
      const g = GOALS[id];
      if (!g || g.done(bot, makeCtx())) return false;
      if (id === 'survive_night') {
        const time = bot?.time?.timeOfDay ?? 6000;
        return time >= 12000 && time < 23000;
      }
      return true;
    });

    if (available.length === 0) {
      say('Autopilot: All basic survival goals complete!');
      mode = 'idle';
      return null;
    }
    const state = buildState(bot, makeCtx(), { purpose: 'next_goal' });
    if (available.length === 1) return available[0];
    const q = questions.next_goal(available);
    const res = await decider.decide(state, q, {
      purpose: 'next_goal',
      heuristicPick: heuristicNextGoal(state, available),
    });
    return res.answers?.next_goal?.choice || available[0];
  }

  async function runGoalLoop(goalId, opts = {}, goalToken = currentToken) {
    const goal = GOALS[goalId];
    if (!goal) return say(`Unknown goal: ${goalId}`);
    currentGoalId = goalId;
    let stepCount = 0, retries = 0, lastFailedStep = null;

    while (!goalToken.cancelled) {
      if (goal.done(bot, makeCtx())) {
        say(templates.stepDone(goalId, `Completed goal: ${goal.describe}`));
        if (mode === 'autopilot') {
          const next = await pickNextGoal();
          if (next && !goalToken.cancelled) return runGoalLoop(next, { autopilot: true }, goalToken);
        } else if (goalId === 'get_food') {
          say('Delivering food to you now...');
          await runSkill(getSkill('give_to_owner'), bot, makeCtx(), goalToken);
        }
        mode = 'idle';
        currentGoalId = 'none';
        currentStepName = 'none';
        return;
      }

      const step = getFirstNeededStep(goal, bot, makeCtx());
      if (!step) { mode = 'idle'; return; }
      if (++stepCount > 25) {
        say(templates.stepFailed(goalId, 'too_many_steps'));
        stop('too_many_steps');
        return;
      }

      await checkInterrupts(goalToken);
      if (goalToken.cancelled) return;

      currentStepName = step.skill;
      const skill = getSkill(step.skill);
      if (!skill) {
        say(`Missing skill for step: ${step.skill}`);
        return stop('missing_skill');
      }

      say(templates.stepStart(step.skill, step.args || {}, opts.learn));
      const res = await runSkill(skill, bot, makeCtx(), goalToken, step.args || {});
      if (goalToken.cancelled) return;

      if (res.ok) {
        say(templates.stepDone(step.skill, res.message));
        retries = 0;
        lastFailedStep = null;
      } else {
        if (res.reason === 'cancelled') return;
        if (res.reason === 'owner_not_found') {
          say("I can't see you — please come closer (within ~60 blocks) or teleport me to you.");
          return stop('owner_not_found');
        }
        if (lastFailedStep === step.skill) retries++;
        else { lastFailedStep = step.skill; retries = 1; }

        if (retries === 2 && res.reason === 'no_target') {
          say('Cannot find target nearby — exploring around first...');
          await runSkill(getSkill('explore'), bot, makeCtx(), goalToken, { distance: 30 });
        } else if (retries > 2) {
          say(templates.stepFailed(step.skill, res.reason || res.message));
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
    say(templates.announceGoal(goalId, opts.learn));
    const token = currentToken;
    runGoalLoop(goalId, opts, token).catch((err) => log.error('[Planner] Loop error:', err));
  }

  function startAutopilot() {
    stop('starting autopilot');
    mode = 'autopilot';
    say(templates.announceGoal('autopilot'));
    pickNextGoal().then((g) => {
      if (g) startGoal(g, { autopilot: true });
    }).catch((err) => log.error('[Planner] Autopilot error:', err));
  }

  return {
    startGoal,
    startAutopilot,
    stop,
    checkInterrupts,
    getLegalInterrupts,
    getState: () => ({ mode, currentGoal: currentGoalId, currentStep: currentStepName }),
  };
}

module.exports = {
  createPlanner,
  getLegalInterrupts,
};
