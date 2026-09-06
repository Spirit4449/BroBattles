// Transport/renderer-independent client timeline, also used by latency tests.
const { sample } = require('./huntressProjectile');

class CombatClock {
  constructor() { this.reset(); }
  reset(epoch = null) {
    this.epoch = epoch; this.offset = null; this.simOffset = 0;
    this.samples = []; this.lastPacket = null; this.lastNow = null;
  }
  observe(packet, received) {
    if (packet.epoch !== this.epoch || !Number.isFinite(packet.sentMono) || !Number.isFinite(packet.simMono)) return false;
    if (this.lastPacket && packet.sentMono < this.lastPacket.sentMono) return false;
    this.lastPacket = { ...packet, received };
    this.simOffset = packet.simMono - packet.sentMono;
    if (this.offset === null) this.offset = packet.sentMono - received;
    return true;
  }
  synchronize(packet, sent, received) {
    if (packet.epoch !== this.epoch || received < sent) return;
    this.samples.push({ rtt: received - sent, offset: packet.sentMono - (sent + received) / 2 });
    if (this.samples.length > 12) this.samples.shift();
    this.offset = this.samples.reduce((best, p) => p.rtt < best.rtt ? p : best).offset;
    this.observe(packet, received);
  }
  now(localNow) {
    if (!this.lastPacket) return localNow;
    const estimated = localNow + this.offset + this.simOffset;
    // Bound flight during a transport stall; do not hallucinate seconds of combat.
    const cap = this.lastPacket.received + this.offset + this.simOffset + 250;
    const next = Math.min(estimated, cap);
    this.lastNow = Math.max(this.lastNow ?? next, next);
    return this.lastNow;
  }
}

class HuntressReplica {
  constructor() { this.clock = new CombatClock(); this.reset(); }
  reset(epoch = null) {
    this.clock.reset(epoch); this.active = new Map(); this.terminals = new Map(); this.rejected = new Map();
  }
  launch(p, predicted = false) {
    if (this.terminals.has(p.id) || this.rejected.has(p.requestId)) return false;
    const previous = this.active.get(p.id);
    if (previous && !previous.predicted) return false;
    this.active.set(p.id, { projectile: p, predicted, revision: (previous?.revision || 0) + 1 });
    return true;
  }
  terminate(terminal, localNow) {
    if (this.terminals.has(terminal.id)) return false;
    this.active.delete(terminal.id);
    this.terminals.set(terminal.id, { ...terminal, received: localNow });
    while (this.terminals.size > 512) this.terminals.delete(this.terminals.keys().next().value);
    return true;
  }
  reject(requestId, localNow) {
    this.rejected.set(requestId, localNow);
    while (this.rejected.size > 128) this.rejected.delete(this.rejected.keys().next().value);
    for (const [id, entry] of this.active) if (entry.projectile.requestId === requestId) this.active.delete(id);
  }
  position(id, localNow) {
    const entry = this.active.get(id);
    if (!entry) return null;
    const age = this.clock.now(localNow) - entry.projectile.launchMono;
    return { ...sample(entry.projectile, age), age };
  }
}
module.exports = { CombatClock, HuntressReplica };
