'use strict';
process.env.LOG_DECISIONS = 'false';

const fs = require('fs');
const path = require('path');
const FakeBot = require('../bot/test/fakeBot');
const { buildState } = require('../bot/src/state/buildState');
const questions = require('../bot/src/decision/questions');
const { createDecider } = require('../bot/src/decision');
const baseConfig = require('../bot/src/config');

function parseArgs() {
  const args = process.argv.slice(2);
  let backend = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i].toLowerCase();
    if ((a === '--backend' || a === '-b') && args[i + 1]) {
      backend = args[i + 1].toLowerCase();
      i++;
    } else if (['mock', 'local', 'jev'].includes(a)) {
      backend = a;
    }
  }
  return { backend: backend || baseConfig.decision.backend || 'mock' };
}

function quantile(arr, q) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

async function run() {
  const { backend } = parseArgs();
  const cfg = {
    ...baseConfig,
    decision: { ...baseConfig.decision, backend },
    log: { ...baseConfig.log, decisions: false },
  };
  const decider = createDecider(cfg);

  const fixturePath = path.join(__dirname, '..', 'bot', 'test', 'fixtures', 'chat_intents.jsonl');
  const lines = fs.readFileSync(fixturePath, 'utf8').trim().split('\n').filter(Boolean);
  const items = lines.map((l) => JSON.parse(l));

  const bot = new FakeBot('Butler');
  const ctx = { ownerName: 'Steve', currentGoal: 'none', currentStep: 'none', lastStepResult: 'none', autopilot: false };

  console.log(`\n======================================================`);
  console.log(`Evaluating ${items.length} chat intents using backend: ${backend}`);
  console.log(`======================================================`);

  const results = [];
  const latencies = [];
  const perIntent = {};
  const confusions = [];
  let count = 0;

  for (const item of items) {
    count++;
    if (count % 25 === 0 || count === items.length) {
      process.stdout.write(`  [${count}/${items.length}] evaluating...\n`);
    }
    const state = buildState(bot, ctx, { purpose: 'intent', playerMessage: item.text });
    const q = questions.intent();
    const res = await decider.decide(state, q, { purpose: 'intent' });
    const ans = res.answers?.intent;
    const pred = ans?.choice || 'unclear';
    const conf = ans?.confidence ?? 0;
    latencies.push(res.latencyMs || 1);

    const correct = pred === item.intent;
    results.push({ text: item.text, expected: item.intent, predicted: pred, conf, correct });

    if (!perIntent[item.intent]) perIntent[item.intent] = { total: 0, correct: 0 };
    perIntent[item.intent].total++;
    if (correct) perIntent[item.intent].correct++;
    else confusions.push({ text: item.text, expected: item.intent, predicted: pred, conf: Math.round(conf * 100) });
  }

  const total = results.length;
  const totalCorrect = results.filter((r) => r.correct).length;
  const overallAcc = (totalCorrect / total) * 100;
  const p50 = quantile(latencies, 0.5);
  const p95 = quantile(latencies, 0.95);

  console.log(`\nOverall Accuracy: ${totalCorrect}/${total} (${overallAcc.toFixed(1)}%)`);
  console.log(`Latency: p50 = ${p50.toFixed(0)} ms, p95 = ${p95.toFixed(0)} ms\n`);

  console.log(`Per-Intent Accuracy:`);
  for (const [intent, stat] of Object.entries(perIntent)) {
    const pct = ((stat.correct / stat.total) * 100).toFixed(0);
    console.log(`  - ${intent.padEnd(16)}: ${stat.correct}/${stat.total} (${pct}%)`);
  }

  // Threshold sweep
  console.log(`\nThreshold Sweep Table:`);
  console.log(`Thresh | % Acted | Acc@Act | % Asked (>=0.45 & <T)`);
  console.log(`-------+---------+---------+----------------------`);
  const sweep = [];
  let bestAct = 0.70;
  let bestAsk = 0.45;

  for (let t = 0.30; t <= 0.905; t += 0.05) {
    const thresh = Number(t.toFixed(2));
    const acted = results.filter((r) => r.conf >= thresh);
    const actedCorrect = acted.filter((r) => r.correct).length;
    const pctActed = (acted.length / total) * 100;
    const accAct = acted.length ? (actedCorrect / acted.length) * 100 : 100;
    const asked = results.filter((r) => r.conf >= 0.45 && r.conf < thresh);
    const pctAsked = (asked.length / total) * 100;

    sweep.push({ thresh, pctActed, accAct, pctAsked });
    console.log(` ${thresh.toFixed(2)}  |  ${pctActed.toFixed(1).padStart(5)}% |  ${accAct.toFixed(1).padStart(5)}% |  ${pctAsked.toFixed(1).padStart(5)}%`);
  }

  // Calibration recommendation
  const calAct = sweep.find((s) => s.accAct >= 95.0 && s.thresh >= 0.50);
  if (calAct) bestAct = calAct.thresh;
  const calAsk = sweep.find((s) => s.accAct >= 60.0 && s.thresh >= 0.30);
  if (calAsk) bestAsk = calAsk.thresh;

  console.log(`\nCalibrated Thresholds:`);
  console.log(`  CONF_ACT recommendation (acc@act >= 95%): ${bestAct.toFixed(2)}`);
  console.log(`  CONF_ASK recommendation (acc@ask >= 60%): ${bestAsk.toFixed(2)}`);

  if (confusions.length > 0) {
    console.log(`\nConfusions (${confusions.length}):`);
    confusions.slice(0, 10).forEach((c) => {
      console.log(`  "${c.text}" -> expected: ${c.expected}, got: ${c.predicted} (${c.conf}%)`);
    });
    if (confusions.length > 10) console.log(`  ... and ${confusions.length - 10} more`);
  }

  // Heuristic vs Model check from decisions log
  const logPath = path.join(__dirname, '..', 'bot', 'logs', 'decisions.jsonl');
  let logDiffs = { interrupt: 0, next_goal: 0, totalInterrupt: 0, totalNextGoal: 0 };
  if (fs.existsSync(logPath)) {
    const logLines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
    for (const l of logLines) {
      try {
        const entry = JSON.parse(l);
        if (entry.meta?.purpose === 'interrupt') {
          logDiffs.totalInterrupt++;
          if (entry.meta.heuristicPick && entry.answers?.interrupt?.choice !== entry.meta.heuristicPick) logDiffs.interrupt++;
        } else if (entry.meta?.purpose === 'next_goal') {
          logDiffs.totalNextGoal++;
          if (entry.meta.heuristicPick && entry.answers?.next_goal?.choice !== entry.meta.heuristicPick) logDiffs.next_goal++;
        }
      } catch (_) {}
    }
    console.log(`\nHeuristic vs Model Divergence from logs:`);
    console.log(`  Interrupt diffs: ${logDiffs.interrupt}/${logDiffs.totalInterrupt}`);
    console.log(`  Next Goal diffs: ${logDiffs.next_goal}/${logDiffs.totalNextGoal}`);
  }

  const outDir = path.join(__dirname, '..', 'bot', 'logs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const dateStr = new Date().toISOString().slice(0, 10);
  const outPath = path.join(outDir, `eval-${backend}-${dateStr}.json`);
  const report = {
    backend, date: dateStr, total, accuracy: overallAcc, p50, p95,
    confAct: bestAct, confAsk: bestAsk, perIntent, sweep, confusions,
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nSaved evaluation report to: ${outPath}\n`);
}

run().catch((err) => {
  console.error('Evaluation failed:', err);
  process.exit(1);
});
