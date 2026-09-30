'use strict';
const fs = require('fs');
const path = require('path');
const log = require('./log');

// Things worth remembering across restarts: { home, deathSpot, chests: [], notes: [], events: [] }.
// None of this goes into the Decider's state (it's size-capped); talk.js offers matching entries as answer options.
// ponytail: one file for one world; key by server/world if the bot ever hops between them.
const FILE = process.env.MEMORY_FILE || path.join(__dirname, '..', 'memory.json');
let data = null;

function load() {
  if (!data) {
    try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { data = {}; }
    for (const k of ['chests', 'notes', 'events']) data[k] = Array.isArray(data[k]) ? data[k] : [];
  }
  return data;
}

function save() {
  try { fs.writeFileSync(FILE, JSON.stringify(data, null, 2)); } catch (err) { log.warn('[Memory] Save failed:', err.message); }
}

const round = (p) => ({ x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) });
const same = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;
const fmt = (p) => `${p.x} ${p.y} ${p.z}`;

module.exports = {
  get: load,
  set(key, val) {
    if (val && typeof val === 'object' && 'x' in val) {
      load()[key] = round(val);
    } else {
      load()[key] = val ?? null;
    }
    save();
  },
  addChest(pos) {
    const d = load(), p = round(pos);
    if (d.chests.some((c) => same(c, p))) return;
    d.chests = [...d.chests, p].slice(-20);
    save();
  },
  removeChest(pos) {
    const d = load(), p = round(pos), before = d.chests.length;
    d.chests = d.chests.filter((c) => !same(c, p));
    if (d.chests.length !== before) save();
  },
  // Something the player asked us to remember, optionally tied to where they stood.
  addNote(text, pos = null) {
    const d = load();
    d.notes = [...d.notes, { text, ...(pos ? { pos: round(pos) } : {}), t: Date.now() }].slice(-100);
    save();
    return d.notes[d.notes.length - 1];
  },
  removeNote(note) {
    const d = load();
    d.notes = d.notes.filter((n) => n !== note);
    save();
  },
  // Things that happened (deaths, milestones), newest last.
  addEvent(text) {
    const d = load();
    d.events = [...d.events, { text, t: Date.now() }].slice(-50);
    save();
  },
  describe() {
    const d = load(), parts = [];
    parts.push(d.home ? `Home: ${fmt(d.home)}` : 'No home set (say "butler set home")');
    if (d.deathSpot) parts.push(`You last died at ${fmt(d.deathSpot)}`);
    if (d.chests.length) parts.push(`Chests: ${d.chests.slice(-5).map(fmt).join(', ')}`);
    return `${parts.join('. ')}.`;
  },
  _reset() { data = null; },
};
