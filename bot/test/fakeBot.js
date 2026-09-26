'use strict';
const EventEmitter = require('events');
const { Vec3 } = require('vec3');

class FakeBot extends EventEmitter {
  constructor(username = 'Helper') {
    super();
    this.username = username;
    this.version = '1.20.4';
    this.entity = {
      position: new Vec3(0, 64, 0),
      isInWater: false,
    };
    this.health = 20;
    this.food = 20;
    this.time = { timeOfDay: 6000 };
    this.chatLog = [];
    this.pathfinder = {
      isMoving: () => false,
      stop: () => { this.pathfinderStopped = true; },
      setGoal: (goal) => { this.currentGoal = goal; },
      goto: async () => {},
      setMovements: () => {},
    };
    this.pathfinderStopped = false;
    this.controlStatesCleared = false;
    this.inventory = {
      items: () => this._items || [],
    };
    this.entities = {};
    this.players = {};
    this._items = [];
    this._foundBlocks = [];
    this._foundBlock = null;
  }

  findBlocks(opts) {
    return typeof this._foundBlocks === 'function' ? this._foundBlocks(opts) : this._foundBlocks;
  }

  findBlock(opts) {
    return typeof this._foundBlock === 'function' ? this._foundBlock(opts) : this._foundBlock;
  }

  blockAt(pos) {
    return this._blockAtFn ? this._blockAtFn(pos) : { name: 'air' };
  }

  chat(msg) {
    this.chatLog.push(msg);
    this.emit('chatSent', msg);
  }

  clearControlStates() {
    this.controlStatesCleared = true;
  }
}

module.exports = FakeBot;
