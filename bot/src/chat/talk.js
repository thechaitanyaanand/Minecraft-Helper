'use strict';
const mcData = require('minecraft-data')('1.20.4');
const { KNOWLEDGE, SMALLTALK } = require('./knowledge');
const templates = require('./templates');
const memory = require('../memory');
const questions = require('../decision/questions');
const { buildState } = require('../state/buildState');
const { parseDirectTarget, trigramSimilarity } = require('../planner/shortlist');
const { plan, parseRecipe, getCheapestHarvestTool, MOB_DROPS, BLOCK_DROPS } = require('../planner/obtain');
const { SMELTING } = require('../planner/smelting');
const { nextGoal } = require('../planner/heuristics');
const { ownerEntity, timeOfDayLabel } = require('../state/world');

// The Decider picks a reply from options code has built (§1.2). Only the best-matching few are offered,
// so it stays one ~100 ms pass, and memories reach the model only when they match what the player said.
const MAX_OPTIONS = 12;
const DEATH_WORDS = /\b(died|slain|killed|shot|blew up|drowned|burned|fell|starved)\b/i;
const STOP = new Set('the a an and or but to of in on at is are was were be it this that i me my you your we our do did does can could would should will what where when why how who which with for from have has had just please butler there here its im'.split(' '));

const norm = (s) => ` ${String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;
const pretty = (n) => String(n).replace(/_/g, ' ');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmt = (p) => `${p.x} ${p.y} ${p.z}`;
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const an = (n) => (/^[aeiou]/.test(n) ? `an ${n}` : `a ${n}`);
const plural = (c, n) => (c > 1 && !n.endsWith('s') ? `${c} ${n}s` : `${c} ${n}`);
const words = (text) => norm(text).trim().split(' ').filter((w) => w.length >= 3 && !STOP.has(w));

function ago(t) {
  const min = Math.round((Date.now() - t) / 60_000);
  if (min < 2) return 'Just now';
  if (min < 90) return `${min} minutes ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} hours ago`;
  return `${Math.round(min / 1440)} days ago`;
}

// Whole-phrase hits count 1 per word; the closest word-to-keyword trigram match (0..1) rescues typos ("diamons").
function score(message, keys) {
  const m = norm(message), msgWords = words(message);
  let hits = 0, fuzzy = 0;
  for (const k of keys) {
    const nk = norm(k);
    if (!nk.trim()) continue;
    if (m.includes(nk) || m.includes(`${nk.slice(0, -1)}s `)) hits += nk.trim().split(' ').length;
    if (!k.includes(' ')) for (const w of msgWords) fuzzy = Math.max(fuzzy, trigramSimilarity(w, k));
  }
  return hits + (fuzzy >= 0.5 ? fuzzy : 0);
}

// How to get an item, straight from game data so it's never made up.
function howToGet(item) {
  const name = pretty(item);
  if (SMELTING[item]) return `Smelt ${pretty(SMELTING[item].input)} in a furnace to get ${name}.`;
  if (MOB_DROPS[item]) return `${cap(name)} drops from ${MOB_DROPS[item].map(pretty).join(' or ')}.`;
  const ore = BLOCK_DROPS[item]?.find((b) => b !== item); // stone -> cobblestone, diamond_ore -> diamond
  const withTool = (b) => { const t = getCheapestHarvestTool(b); return t ? ` with ${an(pretty(t))} or better` : ''; };
  if (ore) return `Mine ${pretty(ore)}${withTool(ore)} to get ${name}.`;
  const recipe = mcData.recipes[mcData.itemsByName[item]?.id]?.[0];
  if (recipe) {
    const { ingredients, needsTable, resultCount } = parseRecipe(recipe);
    const list = Object.entries(ingredients).map(([n, c]) => plural(c, pretty(n))).join(' + ');
    return `${cap(name)}: ${list}${needsTable ? ' at a crafting table' : ' (fits your 2x2 grid)'}${resultCount > 1 ? `, makes ${resultCount}` : ''}.`;
  }
  if (BLOCK_DROPS[item]) return `Find ${name} in the world and mine it${withTool(item)}.`;
  return null;
}

function createTalk({ bot, decider, say, setPending, planner, config, makeCtx = () => ({}) }) {
  const health = () => Math.round(bot?.health ?? 20);
  const ownerPos = () => ownerEntity(bot, config.ownerName)?.position || bot?.entity?.position || null;

  // Something fun and useful to do next, offered as a yes/no.
  function suggest() {
    const state = buildState(bot, makeCtx(), { purpose: 'talk' });
    const goal = nextGoal(state, ['survive_night', 'get_food', 'make_tools', 'get_wood', 'progress']);
    const lines = {
      survive_night: 'Night is coming. Want to hide out in a shelter together?',
      get_food: 'We\'re low on food. Hunting trip?',
      make_tools: 'We need better tools. Want me to make stone ones?',
      get_wood: 'Let\'s stock up on wood. Want me to chop some?',
      progress: 'Let\'s upgrade our gear! Want me to start on the next piece?',
      deep_mine: 'Ready for diamonds? Deep mining expedition at Y=-58?',
      enter_nether: 'Want to build a Nether portal and venture to the Nether?',
      defeat_ender_dragon: 'Ready to enter the End and slay the Ender Dragon?',
    };
    if (goal === 'progress' && Math.random() < 0.4) return { text: 'Want to build a hut together? (yes/no)', offer: 'blueprint:hut_5x5' };
    return { text: `${lines[goal] || lines.progress} (yes/no)`, offer: goal };
  }

  function facts() {
    const d = memory.get();
    const inv = (bot?.inventory?.items?.() || []).map((it) => `${it.count} ${pretty(it.name)}`);
    const t = bot?.time?.timeOfDay ?? 6000, label = timeOfDayLabel(t);
    const mins = (ticks) => Math.max(1, Math.round(ticks / 1200));
    const pl = planner?.getState?.() || { mode: 'idle' };
    const p = bot?.entity?.position, o = ownerEntity(bot, config.ownerName)?.position;
    return [
      { id: 'fact_inventory', about: 'what items the butler is carrying', keys: ['inventory', 'carrying', 'what do you have', 'your items', 'tumhare paas'],
        reply: () => (inv.length ? `I'm carrying: ${inv.slice(0, 12).join(', ')}.` : 'My pockets are empty!') },
      { id: 'fact_time', about: 'what time it is and how long until night or morning', keys: ['time', 'what time', 'when is night', 'how long', 'baje'],
        reply: () => (label === 'day' ? `It's day. Night starts in about ${mins(12000 - t)} minutes.` : `It's ${label}. Morning comes in about ${mins((24000 - t) % 24000)} minutes.`) },
      { id: 'fact_where', about: 'where the butler is', keys: ['where are you', 'kahan ho', 'your location', 'your coords'],
        reply: () => (p ? `I'm at ${fmt(p.floored())}${o ? `, ${Math.round(p.distanceTo(o))} blocks from you` : ''}.` : 'Not sure, I just spawned!') },
      { id: 'fact_doing', about: 'what the butler is doing right now', keys: ['what are you doing', 'doing', 'busy', 'kya kar rahe'],
        reply: () => (pl.mode === 'idle' ? 'Just hanging out with you. Got a job for me?' : `Working on ${templates.goalLabel(pl.currentGoal)}.`) },
      { id: 'fact_places', about: 'remembered places: home, chests and where the player died', keys: ['where is home', 'where is my', 'my chests', 'where did i die', 'my base'],
        reply: () => memory.describe() },
      d.stronghold && { id: 'fact_stronghold', about: 'where the stronghold is', keys: ['stronghold', 'end portal', 'where is the stronghold', 'portal room'],
        reply: () => ({ text: `The stronghold is at ${fmt(d.stronghold)}. Want to head there? (yes/no)`, offer: 'find_stronghold' }) },
      ...d.notes.map((n, i) => ({
        id: `note_${i}`, about: `the player told me: ${n.text}`, keys: words(n.text),
        reply: () => ({ text: `You told me: "${n.text}"${n.pos ? ` (at ${fmt(n.pos)}). Want me to take you there? (yes/no)` : '.'}`, offer: n.pos ? `goto:${fmt(n.pos).replace(/ /g, ',')}` : null }),
      })),
      ...d.events.map((e, i) => ({
        id: `event_${i}`, about: `something that happened: ${e.text}`,
        keys: [...words(e.text), 'last time', 'happened', ...(DEATH_WORDS.test(e.text) ? ['die', 'died', 'death', 'killed'] : [])],
        reply: () => `${ago(e.t)}: ${e.text}.`,
      })),
    ].filter(Boolean);
  }

  function candidates(text) {
    const ctx = { health: health(), food: Math.round(bot?.food ?? 20), botName: bot?.username || 'Butler', suggest };
    const pool = [
      ...KNOWLEDGE.map((k) => ({ id: k.id, about: k.about, keys: k.keys, reply: () => k.text })),
      ...SMALLTALK.map((s) => ({ id: `st_${s.id}`, about: s.about, keys: s.keys, reply: () => (typeof s.say === 'function' ? s.say(ctx) : pick(s.say)) })),
      ...facts(),
    ].map((c) => ({ ...c, score: score(text, c.keys) }))
      .filter((c) => c.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_OPTIONS);

    const item = parseDirectTarget(text, mcData);
    const how = item && !item.includes(':') && howToGet(item);
    if (how) {
      const canGet = !plan(item, 1, {}).fail;
      // Outranks a knowledge entry only when they're asking how to make or get it.
      const asksHow = /\b(make|craft|get|obtain|recipe|banao|banaye|banate)\b/i.test(text);
      pool.push({ id: `how_${item}`, about: `how to get or make ${pretty(item)}`, score: asksHow ? 2.5 : 1.5,
        reply: () => ({ text: canGet ? `${how} Want me to get one? (yes/no)` : how, offer: canGet ? `obtain:${item}:1` : null }) });
      pool.sort((a, b) => b.score - a.score);
    }
    return pool;
  }

  // Asks the Decider to choose among options (skipped when there's only one); null = none fit.
  async function choose(text, options, instructions) {
    if (!options.length) return null;
    if (options.length === 1) return options[0].score >= 1 ? options[0] : null;
    const state = buildState(bot, makeCtx(), { purpose: 'talk', playerMessage: text });
    const res = await decider.decide(state, questions.answer(options, instructions), { purpose: 'talk' });
    return options.find((o) => o.id === res.answers?.answer?.choice) || null;
  }

  function deliver(reply) {
    const r = typeof reply === 'string' ? { text: reply } : reply;
    say(r.text);
    if (r.offer) setPending('offer', { goal: r.offer });
  }

  return {
    // Returns true when something was said.
    async answer(text) {
      const chosen = await choose(text, candidates(text), 'The player said player_message to their Minecraft buddy. Which reply fits best?');
      if (!chosen) return false;
      deliver(chosen.reply());
      return true;
    },

    remember(text) {
      const forget = text.match(/^\s*forget\s+(?:about\s+)?(.+)$/i);
      if (forget) {
        const best = memory.get().notes.map((n) => ({ n, s: score(forget[1], words(n.text)) })).sort((a, b) => b.s - a.s)[0];
        if (!best || best.s < 1) return say("I don't remember anything like that.");
        memory.removeNote(best.n);
        return say(`Okay, forgot: "${best.n.text}".`);
      }
      const content = text.replace(/^\s*(please\s+)?(remember|yaad\s+rakh(na|o)?|note)\b\s*(that\s+)?/i, '').trim();
      if (!content) return say('Remember what?');
      const here = /\b(here|this place|this spot|yahan|yaha|this is)\b/i.test(content);
      const note = memory.addNote(content, here ? ownerPos() : null);
      return say(`Got it, I'll remember: "${content}"${note.pos ? ' and where it is' : ''}.`);
    },

    async goPlace(text) {
      const d = memory.get(), o = ownerPos();
      const nearestChests = [...d.chests].sort((a, b) => (o ? o.distanceTo(a) - o.distanceTo(b) : 0)).slice(0, 3);
      const places = [
        d.home && { id: 'home', about: 'home, our base', keys: ['home', 'base', 'ghar', 'house'], pos: d.home },
        d.deathSpot && { id: 'death', about: 'where the player last died', keys: ['died', 'death', 'my stuff', 'where i died'], pos: d.deathSpot },
        ...nearestChests.map((p, i) => ({ id: `chest_${i}`, about: `a chest at ${fmt(p)}`, keys: ['chest', 'chests', 'storage', 'sandook'], pos: p })),
        ...d.notes.filter((n) => n.pos).map((n, i) => ({ id: `place_${i}`, about: n.text, keys: words(n.text), pos: n.pos })),
      ].filter(Boolean).map((p) => ({ ...p, score: score(text, p.keys) }))
        .filter((p) => p.score >= 0.5).sort((a, b) => b.score - a.score).slice(0, MAX_OPTIONS);
      const chosen = await choose(text, places, 'The player wants to go somewhere. Which remembered place do they mean?');
      if (!chosen) return say('I don\'t know that place yet. Stand there and say "butler remember this is my <name>".');
      // "my iron farm is here" -> "your iron farm"
      const label = chosen.about.replace(/\b(is here|this is|this place is|here|yahan hai|yaha)\b/gi, '').replace(/\bmy\b/gi, 'your').replace(/\s+/g, ' ').trim();
      say(`Heading to ${label}!`);
      return planner?.startGoal(`goto:${chosen.pos.x},${chosen.pos.y},${chosen.pos.z}`);
    },
  };
}

module.exports = { createTalk, howToGet, score };
