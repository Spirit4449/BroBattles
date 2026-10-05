const test = require('node:test');
const assert = require('node:assert/strict');
const { createSnapshotEncoder, createSnapshotDecoder, KEYFRAME_EVERY_SNAPSHOTS } = require('../src/shared/snapshotDelta');
const { makeRoom } = require('./helpers/botRoom');

function packet(encoder, seq, players, epoch = 'e1') {
  return { snapshotSeq: seq, snapshotEpoch: epoch, ...encoder.encode(seq, players) };
}

function randomStates(steps, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const states = [];
  let names = ['a', 'b', 'c'];
  for (let i = 0; i < steps; i++) {
    if (i === 40) names = ['a', 'b', 'c', 'late'];
    if (i === 80) names = ['a', 'c', 'late'];
    const players = {};
    for (const name of names) {
      const sliding = rnd() < 0.3;
      players[name] = {
        x: Math.round(rnd() * 4) / 2, y: 10, grounded: rnd() < 0.5,
        animation: rnd() < 0.2 ? null : 'running', health: rnd() < 0.1 ? 0 : 100,
        wallSliding: sliding, ...(sliding ? { wallSide: rnd() < 0.5 ? 'left' : 'right' } : {}),
      };
    }
    states.push(players);
  }
  return states;
}

test('decoded snapshots equal the full states through changes, deletions and roster changes', () => {
  const encoder = createSnapshotEncoder();
  const decoder = createSnapshotDecoder();
  let keyframes = 0;
  randomStates(120).forEach((players, i) => {
    const sent = packet(encoder, i + 1, structuredClone(players));
    if (sent.keyframe) keyframes++;
    assert.deepEqual(decoder.decode(sent).players, players, `step ${i}`);
  });
  assert.equal(keyframes, Math.ceil(120 / KEYFRAME_EVERY_SNAPSHOTS));
});

test('unchanged players are omitted and only changed fields are sent', () => {
  const encoder = createSnapshotEncoder();
  packet(encoder, 1, { a: { x: 1, y: 2, flip: false }, b: { x: 5, y: 5, flip: true } });
  const delta = packet(encoder, 2, { a: { x: 1.5, y: 2, flip: false }, b: { x: 5, y: 5, flip: true } });
  assert.equal(delta.keyframe, undefined);
  assert.equal(delta.baseSeq, 1);
  assert.deepEqual(delta.players, { a: { x: 1.5 } });
});

test('a client that missed a snapshot waits for the next keyframe', () => {
  const encoder = createSnapshotEncoder();
  const decoder = createSnapshotDecoder();
  const states = randomStates(10);
  assert.ok(decoder.decode(packet(encoder, 1, states[0])));
  packet(encoder, 2, states[1]); // lost
  assert.equal(decoder.decode(packet(encoder, 3, states[2])), null);
  encoder.requestKeyframe(); // e.g. the client re-joined
  const recovered = decoder.decode(packet(encoder, 4, states[3]));
  assert.deepEqual(recovered.players, states[3]);
  assert.deepEqual(decoder.decode(packet(encoder, 5, states[4])).players, states[4]);
});

test('a new room epoch never applies deltas to the old room state', () => {
  const decoder = createSnapshotDecoder();
  const oldRoom = createSnapshotEncoder();
  decoder.decode(packet(oldRoom, 1, { a: { x: 1 } }, 'old'));
  const newRoom = createSnapshotEncoder();
  newRoom.encode(1, { a: { x: 9 } }); // keyframe the client did not receive
  assert.equal(decoder.decode(packet(newRoom, 2, { a: { x: 10 } }, 'new')), null);
});

test('callers may mutate decoded players without corrupting later snapshots', () => {
  const encoder = createSnapshotEncoder();
  const decoder = createSnapshotDecoder();
  decoder.decode(packet(encoder, 1, { a: { x: 1, y: 1 } })).players.a.y = 999;
  assert.deepEqual(decoder.decode(packet(encoder, 2, { a: { x: 2, y: 1 } })).players.a, { x: 2, y: 1 });
});

test('a live bot room publishes deltas that rebuild every full snapshot', (t) => {
  const h = makeRoom({ characters: ['ninja', 'thorg', 'draven', 'wizard', 'huntress', 'gloop'], map: 1, seed: 17 });
  t.after(() => h.room.cleanup());
  delete h.room.broadcastSnapshot; // the helper stubs it out; use the real one
  const full = [], sent = [];
  h.room.io.to = () => ({ emit: (type, payload) => { if (type === 'game:snapshot') sent.push(payload); }, compress() { return this; } });
  // Capture the full states the encoder was given, before delta encoding.
  h.room.broadcastSnapshot();
  const encode = h.room._snapshotEncoder.encode;
  h.room._snapshotEncoder.encode = (seq, players) => { full.push(structuredClone(players)); return encode(seq, players); };
  sent.length = 0;
  let now = Date.now();
  for (let i = 0; i < 600; i++) {
    now += 1000 / 60;
    h.tick(now);
    if (i % 2 === 0) h.room.broadcastSnapshot({ tMono: now });
  }
  const decoder = createSnapshotDecoder();
  decoder.decode({ ...sent[0], keyframe: true, players: full[0] });
  const fullBytes = full.reduce((sum, players) => sum + JSON.stringify(players).length, 0);
  const sentBytes = sent.reduce((sum, payload) => sum + JSON.stringify(payload.players).length, 0);
  for (let i = 1; i < sent.length; i++) assert.deepEqual(decoder.decode(sent[i]).players, full[i], `snapshot ${i}`);
  assert.ok(sentBytes < fullBytes / 2, `deltas ${sentBytes}B vs full ${fullBytes}B`);
});

test('a field that becomes undefined is deleted on the client, as JSON would drop it', () => {
  const encoder = createSnapshotEncoder();
  const decoder = createSnapshotDecoder();
  const wire = (p) => JSON.parse(JSON.stringify(p));
  decoder.decode(wire(packet(encoder, 1, { a: { x: 1, health: 5 } })));
  const decoded = decoder.decode(wire(packet(encoder, 2, { a: { x: 1, health: undefined } })));
  assert.deepEqual(decoded.players.a, { x: 1 });
  assert.deepEqual(decoder.decode(wire(packet(encoder, 3, { a: { x: 2, health: undefined } }))).players.a, { x: 2 });
});
