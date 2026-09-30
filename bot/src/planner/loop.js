'use strict';
const { CancelToken } = require('../cancel');
const { GOALS, getFirstNeededStep, isEnclosed, nextUpgrade } = require('./goals');
const { getSkill } = require('../skills');
const { runSkill } = require('../skills/runSkill');
const { safetyOverride, interrupt: heuristicInterrupt, nextGoal: heuristicNextGoal, getLegalInterrupts } = require('./heuristics');
const questions = require('../decision/questions');
const { buildState } = require('../state/buildState');
const { timeOfDayLabel, hostilesNear, hasShield, hasBow } = require('../state/world');
const templates = require('../chat/templates');
const log = require('../log');
const { plan, getHave } = require('./obtain');

// Runaway guard only; real stall detection is MAX_IDLE_STEPS (steps in a row that changed nothing).
const MAX_STEPS = 300, MAX_IDLE_STEPS = 8, MAX_EXPLORES = 4, MAX_RETRIES = 3, AUTOPILOT_MAX_FAILS = 5;
const ALIASED_GOALS = {
  get_wood: 'obtain:group:logs:8',
  make_tools: 'obtain:stone_pickaxe:1',
  get_food: 'obtain:group:food:4',
  diamonds: 'deep_mine',
  gather_diamonds: 'deep_mine',
  nether: 'enter_nether',
  nether_portal: 'enter_nether',
  portal: 'enter_nether',
  blaze_rods: 'get_blaze_rods',
  blaze: 'get_blaze_rods',
  fortress: 'get_blaze_rods',
  ender_pearls: 'gather_ender_pearls',
  pearls: 'gather_ender_pearls',
  eyes: 'craft_eyes_of_ender',
  stronghold: 'find_stronghold',
  end_portal: 'activate_end_portal',
  dragon: 'defeat_ender_dragon',
  ender_dragon: 'defeat_ender_dragon',
};
const TRIP_SKILLS = new Set(['come_to_owner', 'give_to_owner', 'go_to', 'recover_items']);
const WEAR_SLOT =[[/_helmet$/, 'head'], [/_chestplate$/, 'torso'], [/_leggings$/, 'legs'], [/_boots$/, 'feet'], [/^shield$/, 'off-hand']];

function invMap(bot) {
  const inv = {};
  for (const it of bot?.inventory?.items?.() || []) inv[it.name] = (inv[it.name] || 0) + it.count;
  return inv;
}

function createPlanner(bot, decider, config, say) {
  let mode = 'idle', currentGoalId = 'none', currentStepName = 'none', currentToken = new CancelToken();
  let defending = null; // promise of an owner-defense fight in progress; the goal loop waits for it
  let stepToken = null, reflexBusy = false, lastInterruptCheck = 0, interruptCooldownUntil = 0, lastSaidTime = Date.now();
  const failedUntil = new Map(); // autopilot: goal id / upgrade item -> retry-after timestamp

  const speak = (msg, opts) => { if (!msg) return; lastSaidTime = Date.now(); say(msg, opts); };
  const skipped = () => new Set([...failedUntil].filter(([, t]) => t > Date.now()).map(([k]) => k));

  const progressTimer = setInterval(() => {
    if (mode !== 'idle' && !['follow_me', 'come_here'].includes(currentGoalId) && !['wait_for_day', 'come_to_owner', 'follow_owner'].includes(currentStepName) && Date.now() - lastSaidTime >= 60_000) speak(`Still working on ${templates.goalLabel(currentGoalId)}...`);
  }, 5000);
  if (progressTimer.unref) progressTimer.unref();

  const makeCtx = () => ({ ownerName: config.ownerName, currentGoal: currentGoalId, currentStep: currentStepName, lastStepResult: 'none', autopilot: mode === 'autopilot' });

  const stop = (reason = 'user requested stop') => {
    currentToken.cancel(reason);
    currentToken = new CancelToken();
    try { bot?.pathfinder?.stop?.(); bot?.pathfinder?.setGoal?.(null); bot?.collectBlock?.cancelTask?.(); bot?.stopDigging?.(); bot?.clearControlStates?.(); } catch (_) {}
    mode = 'idle'; currentGoalId = 'none'; currentStepName = 'none'; stepToken = null; lastSaidTime = Date.now();
  };

  // Cheap state for the 1s reflex watcher (buildState scans for trees, too slow to run every second).
  const quickState = () => ({
    health: Math.round(bot?.health ?? 20), food: Math.round(bot?.food ?? 20),
    time_of_day: timeOfDayLabel(bot?.time?.timeOfDay ?? 6000),
    nearby: { hostile_mobs: hostilesNear(bot, 16).slice(0, 3) }, inventory: invMap(bot),
    tools: { shield: hasShield(bot), bow: hasBow(bot) },
  });

  // Sealed in a shelter: monsters can't reach us, so only hunger matters.
  const legalNow = (state) => {
    const legal = getLegalInterrupts(state);
    return isEnclosed(bot) ? legal.filter((o) => o === 'continue_task' || o === 'eat_food') : legal;
  };

  async function checkInterrupts(token, force = false) {
    const now = Date.now();
    if (!force && now - lastInterruptCheck < 2000) return null;
    lastInterruptCheck = now;
    const state = buildState(bot, makeCtx(), { purpose: 'interrupt' });
    let chosenAction = isEnclosed(bot) ? null : safetyOverride(state);
    if (!chosenAction) {
      const legal = legalNow(state);
      if (legal.length <= 1) return null;
      const pick = heuristicInterrupt(state, legal);
      if (pick === 'continue_task') {
        interruptCooldownUntil = Date.now() + 5000;
        return null;
      }
      const q = questions.interrupt(legal);
      if (!q) return null;
      const res = await decider.decide(state, q, { purpose: 'interrupt', heuristicPick: pick, timeoutMs: 1500 });
      chosenAction = res.answers?.interrupt?.choice || pick;
    }
    if (!chosenAction || chosenAction === 'continue_task') { interruptCooldownUntil = Date.now() + 10_000; return null; }
    log.warn(`[Planner] Interrupting with action: ${chosenAction}`);
    const map = { eat_food: 'eat', flee: 'flee', fight: 'fight', dig_in: 'dig_in', get_food: 'hunt_food' };
    const skill = getSkill(map[chosenAction] || chosenAction);
    if (!skill) return null;
    if (skill.name !== 'eat') speak(templates.stepStart(skill.name, {}));
    const res = await runSkill(skill, bot, makeCtx(), token || currentToken);
    // Let the main task breathe after a reflex; back off longer if the reflex itself failed (no thrashing).
    interruptCooldownUntil = Date.now() + (res.ok ? 3000 : 15_000);
    return res;
  }

  // Reflexes: every second, break out of a long step (chopping, mining) when danger or hunger shows up,
  // and defend/feed ourselves while idle. Previously interrupts were only checked between steps.
  const reflexTimer = setInterval(async () => {
    if (!bot?.entity || reflexBusy || Date.now() < interruptCooldownUntil) return;
    const state = quickState();
    const legal = legalNow(state);
    const urgent = legal.length > 1 && heuristicInterrupt(state, legal) !== 'continue_task';
    if (stepToken) {
      const alreadyHandling = ['fight', 'flee', 'sleep_with_owner'].includes(currentStepName);
      if (!alreadyHandling && (urgent || (!isEnclosed(bot) && safetyOverride(state)))) stepToken.cancel('interrupt');
      return;
    }
    if (mode !== 'idle' || !urgent) return;
    reflexBusy = true;
    try { await checkInterrupts(currentToken, true); } catch (err) { log.warn('[Planner] Reflex error:', err.message); } finally { reflexBusy = false; }
  }, 1000);
  if (reflexTimer.unref) reflexTimer.unref();
  bot?.once?.('end', () => { clearInterval(reflexTimer); clearInterval(progressTimer); }); // index.js builds a new planner per connection

  async function pickNextGoal() {
    const skip = skipped();
    const available = ['get_wood', 'make_tools', 'get_food', 'survive_night', 'progress'].filter((id) => {
      const g = GOALS[id];
      if (!g || skip.has(id)) return false;
      if (id === 'progress' ? !nextUpgrade(bot, skip) : g.done(bot, makeCtx())) return false;
      const time = bot?.time?.timeOfDay ?? 6000;
      return id !== 'survive_night' || (time >= 12000 && time < 23000);
    });
    if (!available.length) return null;
    if (available.length === 1) return available[0];
    const state = buildState(bot, makeCtx(), { purpose: 'next_goal' });
    const q = questions.next_goal(available);
    const res = await decider.decide(state, q, { purpose: 'next_goal', heuristicPick: heuristicNextGoal(state, available) });
    return res.answers?.next_goal?.choice || available[0];
  }

  const findStation = (name) => {
    const id = bot?.registry?.blocksByName?.[name]?.id ?? require('minecraft-data')(bot?.version || '1.20.4').blocksByName[name]?.id;
    return typeof id === 'number' && bot?.findBlock ? bot.findBlock({ matching: id, maxDistance: 32 }) : null;
  };

  async function equipIfWearable(name) {
    const slot = WEAR_SLOT.find(([re]) => re.test(name))?.[1];
    const item = slot && bot.inventory?.items?.().find((it) => it.name === name);
    if (item && bot.equip) { try { await bot.equip(item, slot); } catch (_) {} }
  }

  // Runs one goal to completion. Returns { status: 'done' | 'failed' | 'cancelled', key }.
  async function runGoalLoop(goalId, opts, goalToken) {
    let rId = ALIASED_GOALS[goalId] || goalId, key = goalId;
    if (goalId === 'progress') {
      const item = nextUpgrade(bot, skipped());
      if (!item) return { status: 'done', key };
      rId = `obtain:${item}:1`; key = item;
    }
    const isObtain = rId.startsWith('obtain:'), isBp = rId.startsWith('blueprint:'), isMob = rId.startsWith('mob:'), isGoto = rId.startsWith('goto:'), isExplore = rId === 'explore';
    let tgt = '', count = 1;
    if (isObtain) {
      const rest = rId.slice('obtain:'.length), idx = rest.lastIndexOf(':');
      tgt = idx !== -1 ? rest.slice(0, idx) : rest;
      count = parseInt(idx !== -1 ? rest.slice(idx + 1) : '1', 10) || 1;
    }
    const goal = (isObtain || isBp || isMob || isGoto || isExplore) ? null : GOALS[rId];
    if (!goal && !isObtain && !isBp && !isMob && !isGoto && !isExplore) { speak(`Unknown goal: ${goalId}`); return { status: 'failed', key }; }

    const fail = (what, reason) => { speak(templates.stepFailed(what, reason)); return { status: 'failed', key }; };
    const finish = async () => {
      let gave = false;
      if (opts.give || goalId === 'get_food') {
        const match = isObtain ? (n) => getHave({ [n]: 1 }, tgt) > 0 : undefined;
        gave = (await runSkill(getSkill('give_to_owner'), bot, makeCtx(), goalToken, { match, count })).ok;
      }
      if (isObtain) { await equipIfWearable(tgt); speak(templates.obtained(tgt, count, gave)); } else speak(templates.goalDone(goalId));
      return { status: 'done', key };
    };

    let stepCount = 0, idleSteps = 0, retries = 0, explores = 0, lastFailedStep = null, announced = false, useWorldStations = true;
    let lastSig = JSON.stringify(invMap(bot));

    while (!goalToken.cancelled) {
      let step = null;
      const inv = invMap(bot);
      // The planner only sees inventory; tell it about tables/furnaces already in the world so it doesn't craft new ones.
      if (useWorldStations) {
        if (findStation('crafting_table')) inv.placed_crafting_table = 1;
        if (findStation('furnace')) inv.placed_furnace = 1;
      }

      if (isObtain) {
        const steps = plan(tgt, count, inv);
        if (steps.fail) return fail(tgt, steps.fail);
        if (!announced) { announced = true; speak(templates.planSummary(tgt, count, steps)); }
        if (!steps.length) return finish();
        step = steps[0];
      } else if (isBp) {
        const bpId = rId.replace('blueprint:', '');
        const { loadBlueprint, calculateMaterials } = require('./blueprint');
        const mats = calculateMaterials(loadBlueprint(bpId));
        const missing = Object.entries(mats).find(([k, v]) => getHave(inv, k) < v);
        if (missing) {
          const steps = plan(missing[0], missing[1] - getHave(inv, missing[0]), inv);
          if (steps.fail) return fail(missing[0], steps.fail);
          step = steps[0];
        } else {
          step = { skill: 'build_blueprint', args: { id: bpId } };
        }
      } else if (isMob) {
        const mob = rId.replace('mob:', '');
        if (mob === 'ender_dragon' || mob === 'dragon') {
          step = { skill: 'fight_dragon' };
        } else if (mob === 'blaze') {
          step = { skill: 'hunt_blaze', args: { count: 1 } };
        } else if (mob === 'enderman') {
          step = { skill: 'hunt_enderman', args: { count: 1 } };
        } else {
          step = { skill: 'fight', args: { mobNames: [mob], count: 1 } };
        }
      } else if (isGoto) {
        const [x, y, z] = rId.slice('goto:'.length).split(',').map(Number);
        step = { skill: 'go_to', args: { pos: { x, y, z } } };
      } else if (isExplore) {
        step = { skill: 'explore', args: { distance: 35 } };
      } else {
        if (goal.done(bot, makeCtx())) return finish();
        step = getFirstNeededStep(goal, bot, makeCtx());
        if (!step) return { status: 'done', key };
      }
      if (++stepCount > MAX_STEPS) return fail(goalId, 'too_many_steps');
      if (idleSteps >= MAX_IDLE_STEPS) return fail(templates.goalLabel(goalId), 'no_progress');

      await checkInterrupts(goalToken);
      if (goalToken.cancelled) return { status: 'cancelled', key };

      currentStepName = step.skill;
      const skill = getSkill(step.skill);
      if (!skill) return fail(step.skill, 'missing_skill');
      if (typeof bot.pathfinder?.setMovements === 'function' && bot.version) {
        const { safeMovements } = require('../safety/movements');
        bot.pathfinder.setMovements(safeMovements(bot, require('minecraft-data')(bot.version)));
      }

      if (opts.learn) speak(templates.stepStart(step.skill, step.args || {}, true));
      const st = new CancelToken();
      goalToken.onCancel((r) => st.cancel(r));
      stepToken = st;
      const res = await runSkill(skill, bot, makeCtx(), st, step.args || {});
      if (stepToken === st) stepToken = null;
      if (goalToken.cancelled) return { status: 'cancelled', key };

      if (res.reason === 'interrupt') {
        if (defending) await defending; else await checkInterrupts(goalToken, true);
        continue;
      }

      // Progress = inventory changed or skill completed successfully.
      const sig = JSON.stringify(invMap(bot));
      const progressed = sig !== lastSig;
      lastSig = sig;
      idleSteps = (progressed || res.ok) ? 0 : idleSteps + 1;

      if (res.ok || progressed) {
        if (opts.learn) speak(templates.stepDone(step.skill, res.message));
        retries = 0; lastFailedStep = null;
        if (isBp && step.skill === 'build_blueprint' && res.ok) return finish();
        if (isMob && ['fight', 'fight_dragon', 'hunt_blaze', 'hunt_enderman'].includes(step.skill) && res.ok) return finish();
        if (isGoto && res.ok) return finish();
        if (isExplore && res.ok) return finish();
        continue;
      }

      if (res.reason === 'owner_not_found') { speak("I can't see you — please come closer."); return { status: 'failed', key }; }
      if (['craft', 'smelt'].includes(step.skill) && ['no_table', 'no_furnace', 'error'].includes(res.reason)) useWorldStations = false;
      // Exploring helps find trees or animals, not reach a fixed spot: it would walk away from the owner.
      const isTrip = TRIP_SKILLS.has(step.skill);
      if (!isTrip && ['no_target', 'no_path', 'stuck'].includes(res.reason) && explores < MAX_EXPLORES) {
        const isDeepOreTask = step.skill === 'collect_block' && (step.args?.dropName === 'diamond' || step.args?.blockNames?.some((n) => n && n.includes('diamond')));
        if (isDeepOreTask) {
          if (explores++ === 0) speak('Diamonds are deep underground! Starting a deep mining expedition to Y=-58.');
          await runSkill(getSkill('deep_mine'), bot, makeCtx(), goalToken, { count: step.args?.count || 1 });
          continue;
        }
        if (explores++ === 0) speak(`Nothing reachable for ${templates.goalLabel(goalId)} nearby — exploring.`);
        await runSkill(getSkill('explore'), bot, makeCtx(), goalToken, { distance: 30 + explores * 15 });
        continue;
      }
      if (lastFailedStep === step.skill) retries++; else { lastFailedStep = step.skill; retries = 1; }
      if (retries >= MAX_RETRIES) return fail(step.skill, res.reason || res.message);
    }
    return { status: 'cancelled', key };
  }

  // Runs a goal; in autopilot keeps choosing the next one, skipping goals that recently failed.
  async function drive(goalId, opts, token) {
    let fails = 0;
    while (goalId && !token.cancelled) {
      currentGoalId = goalId;
      const r = await runGoalLoop(goalId, opts, token);
      // A goal that paused another one (sleeping with the owner) hands back to it.
      if (!token.cancelled && opts.resume) {
        ({ goalId, opts } = opts.resume);
        mode = opts.autopilot ? 'autopilot' : 'goal';
        continue;
      }
      if (token.cancelled || mode !== 'autopilot') break;
      if (r.status === 'failed') {
        failedUntil.set(r.key, Date.now() + 5 * 60_000);
        if (++fails >= AUTOPILOT_MAX_FAILS) { speak('Autopilot: too many things failing here, stopping. Tell me what to do!'); break; }
        await runSkill(getSkill('explore'), bot, makeCtx(), token, { distance: 40 });
      } else fails = 0;
      if (token.cancelled) break;
      goalId = await pickNextGoal();
      opts = { autopilot: true };
      if (!goalId) speak('Autopilot: nothing left to do right now — I have good gear and supplies!');
    }
    if (token === currentToken) { mode = 'idle'; currentGoalId = 'none'; currentStepName = 'none'; }
  }

  function startGoal(goalId, opts = {}) {
    if (goalId === 'autopilot') return startAutopilot();
    if (goalId === 'stop') return stop('user requested stop');
    stop('starting new goal');
    mode = opts.autopilot ? 'autopilot' : 'goal';
    currentGoalId = goalId;
    if (!goalId.startsWith('obtain:')) speak(templates.announceGoal(goalId, opts.learn)); // obtain announces its plan
    drive(goalId, opts, currentToken).catch((err) => log.error('[Planner] Loop error:', err));
  }

  function startAutopilot() {
    stop('starting autopilot');
    mode = 'autopilot';
    const token = currentToken;
    speak(templates.announceGoal('autopilot'));
    pickNextGoal().then((g) => {
      if (token.cancelled) return;
      if (!g) { mode = 'idle'; return speak('Autopilot: nothing left to do right now — I have good gear and supplies!'); }
      startGoal(g, { autopilot: true });
    }).catch((err) => log.error('[Planner] Autopilot error:', err));
  }

  async function runSkillByName(skillName, args = {}) {
    const skill = getSkill(skillName);
    if (!skill) return { ok: false, reason: 'skill_not_found' };
    reflexBusy = true;
    try { return await runSkill(skill, bot, makeCtx(), currentToken, args); } finally { reflexBusy = false; }
  }

  // Someone is attacking the owner: pause whatever step is running (following, chopping...), fight, then resume.
  // Returns false when already busy fighting, fleeing or sleeping.
  function defendOwner(targetEntity) {
    if (defending || reflexBusy || ['fight', 'flee', 'sleep_with_owner'].includes(currentStepName)) return false;
    reflexBusy = true;
    stepToken?.cancel('interrupt');
    const prevStep = currentStepName;
    currentStepName = 'fight';
    defending = runSkill(getSkill('fight'), bot, makeCtx(), currentToken, { targetEntity })
      .catch((err) => log.warn('[Planner] Defend error:', err.message))
      .finally(() => {
        defending = null; reflexBusy = false;
        if (currentStepName === 'fight') currentStepName = prevStep;
        interruptCooldownUntil = Date.now() + 3000;
      });
    return true;
  }

  // Owner got into bed: drop everything, sleep too, then go back to what we were doing.
  function sleepWithOwner() {
    if (currentGoalId === 'sleep_with_owner') return;
    const resume = mode !== 'idle' ? { goalId: currentGoalId, opts: { autopilot: mode === 'autopilot' } } : null;
    startGoal('sleep_with_owner', { resume });
  }

  return {
    startGoal, startAutopilot, stop, runSkillByName, checkInterrupts, getLegalInterrupts, sleepWithOwner, defendOwner,
    getState: () => ({ mode, currentGoal: currentGoalId, currentStep: currentStepName }),
  };
}

module.exports = { createPlanner, getLegalInterrupts };
