// One deterministic simulation for every shot, run by the server (targets at
// lag-compensated positions) and by the shooter's browser (targets as drawn).
//
// Not yet used by the game: this is the proposed single plumbing for shots
// (docs/development/networking.md). Characters supply *behaviors*, ordinary
// code that owns its shot's state; the kernel supplies fixed stepping, sampling
// between steps, contact queries, child shots and lifecycle events.
//
//   behavior.launch(pose, aim) -> state | state[]   one shot or a volley; a
//                                                   state may set delayMs
//   behavior.step(shot, ctx)                        advance one STEP_MS
//
// ctx, for the step ending at simulation time ctx.t:
//   dt                      step length in seconds
//   terrain()               colliders at ctx.t
//   wall(a, b)              earliest terrain contact on a->b with its normal
//   hit(a, b, radius, opt)  earliest target contact; opt.who is 'enemies'
//                           (default), 'allies' or 'all'; opt.once skips
//                           targets this shot already struck; opt.skip is any
//                           other set of names; opt.inset uses Huntress insets
//   targets(who)            [{ name, team, x, y, bounds }]
//   owner()                 the shooter's position
//   input(key)              latest steering input for this shot
//   emit(event)             'hit' records the target as struck; 'end' finishes
//                           the shot; anything else is for other systems
//   spawn(kind, state)      a child shot (split, chain) starting at ctx.t
//
// The world is what differs between the two sides:
//   world.terrain(t), world.targets(t, shot), world.owner(shot), world.input(shot, key)
const { FIXED_DT_MS: STEP_MS } = require('../gameConstants');
const { firstTargetContact } = require('./shotContact');

const RELATIONS = {
  enemies: (shot, target) => target.team !== shot.team,
  allies: (shot, target) => target.team === shot.team && target.name !== shot.owner,
  all: (shot, target) => target.name !== shot.owner,
};

// Segment against axis-aligned colliders: entry time and entry face normal.
function wallContact(a, b, rects) {
  let best = null;
  for (const rect of rects) {
    let lo = 0, hi = 1, normal = { x: 0, y: 0 }, miss = false;
    for (const [origin, delta, min, max, axis] of [[a.x, b.x - a.x, rect.left, rect.right, 'x'], [a.y, b.y - a.y, rect.top, rect.bottom, 'y']]) {
      if (Math.abs(delta) < 1e-12) { if (origin < min || origin > max) miss = true; continue; }
      const u = (min - origin) / delta, v = (max - origin) / delta;
      if (Math.min(u, v) > lo) {
        lo = Math.min(u, v);
        normal = axis === 'x' ? { x: delta > 0 ? -1 : 1, y: 0 } : { x: 0, y: delta > 0 ? -1 : 1 };
      }
      hi = Math.min(hi, Math.max(u, v));
    }
    if (!miss && lo <= hi && (!best || lo < best.t)) best = { t: lo, normal, collider: rect.id ?? null };
  }
  return best && { ...best, x: a.x + (b.x - a.x) * best.t, y: a.y + (b.y - a.y) * best.t };
}

function createProjectileKernel(behaviors) {
  function behaviorOf(kind) {
    const behavior = behaviors[kind];
    if (!behavior) throw new Error(`Unknown shot kind ${kind}`);
    return behavior;
  }

  // Shots for one request. Ids are stable on every side: `${id}:${index}`.
  function launch(kind, pose, aim, { id, owner, team, at }) {
    const states = [].concat(behaviorOf(kind).launch(pose, aim));
    return states.map((state, index) => ({ ...state, id: `${id}:${index}`, kind, owner, team,
      at: at + (state.delayMs || 0), done: false, struck: [] }));
  }

  function context(shot, world, events) {
    let children = 0;
    const t = shot.at;
    const targets = who => world.targets(t, shot).filter(target => RELATIONS[who](shot, target));
    return {
      dt: STEP_MS / 1000, t,
      terrain: () => world.terrain(t),
      wall: (a, b) => wallContact(a, b, world.terrain(t)),
      targets,
      hit(a, b, radius, { who = 'enemies', once = false, skip = null, inset = false } = {}) {
        const excluded = new Set([...(once ? shot.struck : []), ...(skip || [])]);
        return firstTargetContact(a, b, radius, targets(who), { inset, skip: excluded });
      },
      owner: () => world.owner(shot),
      input: key => world.input?.(shot, key),
      emit(event) {
        if (event.type === 'hit' && !shot.struck.includes(event.target)) shot.struck.push(event.target);
        if (event.type === 'end') shot.done = true;
        events.push({ ...event, shot: shot.id, t });
      },
      spawn(kind, state) {
        const child = { ...state, id: `${shot.id}/${children++}`, kind, owner: shot.owner, team: shot.team,
          parent: shot.id, at: t, done: false, struck: [] };
        events.push({ type: 'spawn', shot: shot.id, child, t });
        return child;
      },
    };
  }

  // Advances one shot to `until`, committing state; returns its events.
  function advance(shot, world, until) {
    const events = [];
    while (!shot.done && shot.at + STEP_MS <= until + 1e-9) {
      shot.at += STEP_MS;
      behaviorOf(shot.kind).step(shot, context(shot, world, events));
    }
    return events;
  }

  // Advances every shot, including children spawned on the way.
  function run(shots, world, until) {
    const events = [];
    for (let i = 0; i < shots.length; i++) {
      for (const event of advance(shots[i], world, until)) {
        events.push(event);
        if (event.type === 'spawn') shots.push(event.child);
      }
    }
    return events;
  }

  // Where to draw a shot at `time`, between fixed steps. Commits nothing.
  function sample(shot, world, time) {
    const base = structuredClone(shot);
    advance(base, world, time);
    if (base.done) return base;
    const next = structuredClone(base);
    advance(next, world, base.at + STEP_MS);
    const f = Math.max(0, Math.min(1, (time - base.at) / STEP_MS));
    return { ...base, x: base.x + (next.x - base.x) * f, y: base.y + (next.y - base.y) * f };
  }

  return { launch, advance, run, sample };
}

module.exports = { STEP_MS, createProjectileKernel, wallContact };
