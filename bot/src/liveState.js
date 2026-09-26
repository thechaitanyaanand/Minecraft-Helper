'use strict';
// What the live view shows. Separate from the (future) Decider state: this one is for humans.

const { HOSTILE_MOBS, timeOfDayLabel } = require('./state/world');
const MAP_RADIUS = 12;   // 25x25 columns around the bot

// Top-down minimap: the highest non-air block of each column near the bot.
// ponytail: scans ~12 blocks per column every 2s; fine at radius 12, use a heightmap if radius grows.
function minimap(bot) {
  const c = bot.entity.position.floored();
  const rows = [];
  for (let dz = -MAP_RADIUS; dz <= MAP_RADIUS; dz++) {
    const row = [];
    for (let dx = -MAP_RADIUS; dx <= MAP_RADIUS; dx++) {
      let name = '';
      for (let y = c.y + 6; y >= c.y - 6; y--) {
        const b = bot.blockAt(c.offset(dx, y - c.y, dz));
        if (b && b.name !== 'air' && b.name !== 'cave_air') { name = b.name; break; }
      }
      row.push(name);
    }
    rows.push(row);
  }
  return rows;
}

function entitiesNear(bot, owner) {
  const me = bot.entity.position;
  const out = [];
  for (const e of Object.values(bot.entities)) {
    if (e === bot.entity || !e.position) continue;
    const dx = e.position.x - me.x, dz = e.position.z - me.z;
    if (Math.abs(dx) > MAP_RADIUS || Math.abs(dz) > MAP_RADIUS) continue;
    const kind = e.type === 'player' ? (e.username === owner ? 'owner' : 'player')
      : HOSTILE_MOBS.has(e.name) ? 'hostile' : e.name === 'item' ? null : 'mob';
    if (kind) out.push({ kind, name: e.username || e.name, dx: Math.round(dx), dz: Math.round(dz) });
  }
  return out;
}

function buildLiveState(bot, { activity, backend, owner, withMap }) {
  if (!bot || !bot.entity) return { online: false, activity, backend };
  const p = bot.entity.position;
  const inv = {};
  for (const it of bot.inventory.items()) inv[it.name] = (inv[it.name] || 0) + it.count;
  const t = bot.time?.timeOfDay ?? 0;
  return {
    online: true,
    username: bot.username,
    owner,
    health: Math.round(bot.health ?? 20),
    food: Math.round(bot.food ?? 20),
    pos: { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) },
    yaw: bot.entity.yaw,
    time: timeOfDayLabel(t),
    timeOfDay: t,
    activity,
    backend,
    held: bot.heldItem?.name || null,
    inventory: Object.entries(inv).map(([name, count]) => ({ name, count })),
    entities: entitiesNear(bot, owner),
    map: withMap ? minimap(bot) : undefined,
  };
}

module.exports = { buildLiveState };
