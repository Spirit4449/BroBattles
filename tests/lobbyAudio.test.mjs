import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createLobbyAudio } from '../src/client/navigation/lobbyAudio.mjs';
import { LOBBY_MUSIC_TIMING as timing } from '../src/client/navigation/lobbyMusicTiming.mjs';

const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
function setup({ webAudio = true, delayMatchmaking = false, delayResumeMatchmaking = false, seekDelay = 0 } = {}) {
  const voices = [], timers = new Map(), params = [];
  let id = 0, clock = 0, release;
  const settings = { music: 1, sfx: 1 };
  const param = value => {
    const p = { value, target: value, tau: .1, cancelAndHoldAtTime() {},
      setTargetAtTime(target, time, tau) { this.target = target; this.tau = tau; } };
    params.push(p); return p;
  };
  const context = { currentTime: 0, state: 'running', destination: {}, resumes: 0,
    async resume() { this.resumes++; this.state = 'running'; },
    createMediaElementSource: () => ({ connect(node) { return node; } }),
    createGain: () => ({ gain: param(0), connect() { return this; } }),
  };
  const api = createLobbyAudio({
    getAudioContext: () => webAudio ? context : undefined, readSettings: () => settings,
    createAudio(src) {
      assert.ok(existsSync(new URL(`../public${src}`, import.meta.url)), `missing audio: ${src}`);
      const listeners = new Map();
      const key = Object.keys(timing.tracks).find(key => timing.tracks[key].src === src);
      const voice = { src, _time: 0, seeks: 0, paused: true, plays: 0, volume: 0,
        duration: key ? timing.tracks[key].durationSeconds : 10, rateWrites: 0, rate: 1,
        get currentTime() { return this._time; }, set currentTime(time) {
          this.seeks++; this._time = time;
          if (seekDelay) {
            this.seeking = true;
            timers.set(++id, { at: clock + seekDelay, fn: () => { this.seeking = false; this.emit('seeked'); } });
          }
        },
        get playbackRate() { return this.rate; },
        set playbackRate(value) { this.rateWrites++; this.rate = value; },
        addEventListener(event, fn) { listeners.set(event, fn); },
        removeEventListener(event, fn) { if (listeners.get(event) === fn) listeners.delete(event); },
        emit(event) { listeners.get(event)?.(); },
        play() {
          this.paused = false; this.plays++;
          if (key === 'matchmaking' && (delayMatchmaking || (delayResumeMatchmaking && this.plays > 1))) {
            return new Promise(resolve => { release = resolve; });
          }
          return Promise.resolve();
        },
        pause() { this.paused = true; } };
      voices.push(voice); return voice;
    },
    later(fn, delay = 0) { timers.set(++id, { fn, at: clock + delay }); return id; },
    cancel(id) { timers.delete(id); },
  });
  function tick(ms) {
    clock += ms; context.currentTime = clock / 1000;
    for (const voice of voices) if (!voice.paused && !voice.seeking) {
      voice._time += ms / 1000;
      if (voice.loop) voice._time %= voice.duration;
    }
    for (const p of params) p.value += (p.target-p.value)*(1-Math.exp(-ms/1000/p.tau));
  }
  return { api, voices, params, settings, context, release: () => release(),
    advance(ms) {
      const until = clock + ms;
      for (;;) {
        const due = [...timers].sort((a,b) => a[1].at-b[1].at)[0];
        if (!due || due[1].at > until) break;
        timers.delete(due[0]); tick(due[1].at-clock); due[1].fn();
      }
      tick(until-clock);
    } };
}

test('both music assets loop in whole bars with a shared beat grid', () => {
  for (const track of Object.values(timing.tracks)) {
    assert.equal(track.beats % 4, 0);
    assert.ok(Math.abs(track.durationSeconds - track.beats * timing.beatSeconds) < 1/48000);
    assert.ok(existsSync(new URL(`../public${track.src}`, import.meta.url)));
  }
});

test('gesture starts two persistent streams; readiness switches on a beat without restarting', async () => {
  const env = setup(), { api, voices, params } = env;
  api.enterLobby();
  assert.equal(voices.length, 2); assert.ok(voices.every(v => v.plays === 0));
  api.unlock(); await settle(); env.advance(1800);
  assert.equal(params[0].target, .264); assert.equal(params[1].target, 0);
  voices[0]._time = voices[1]._time = 42;
  const delay = timing.beatSeconds - 42 % timing.beatSeconds;
  api.setReady(true); api.setReady(true); api.searching();
  env.advance(delay * 1000 - 1);
  assert.equal(params[0].target, .264, 'lobby remains until the beat boundary');
  env.advance(2);
  assert.equal(params[0].target, 0); assert.equal(params[1].target, .264);
  assert.equal(voices.filter(v => v.src.endsWith('/ready.mp3')).length, 1);
  api.found(); api.found(); api.searching(); api.setReady(false);
  assert.equal(params[1].target, .264, 'match found does not lower music level');
  api.loading();
  assert.ok(params.every(p => p.target === 0), 'the battle loading screen fades the lobby out');
  env.advance(100);
  assert.equal(voices.some(v => v.src.endsWith('/match-ready.wav')), false);
  for (const voice of voices.slice(0,2)) {
    assert.equal(voice.playbackRate, 1); assert.equal(voice.rateWrites, 1);
    assert.equal(voice.plays, 1); assert.equal(voice.seeks, 0);
  }
});

test('player arrivals ignore the initial roster, duplicate updates, reorderings, and departures', async () => {
  const env = setup(); env.api.enterLobby(); env.api.unlock(); await settle();
  env.api.searching();
  env.api.updatePlayers(['self', 'party-member']);
  assert.equal(env.voices.some(v => v.src.endsWith('/player-join.wav')), false);
  env.api.updatePlayers(['self', 'party-member', 'opponent']);
  const join = env.voices.find(v => v.src.endsWith('/player-join.wav'));
  assert.equal(join.plays, 1);
  env.api.updatePlayers(['opponent', 'self', 'party-member']);
  env.api.updatePlayers(['self', 'party-member']);
  assert.equal(join.plays, 1);
  env.api.updatePlayers(['self', 'party-member', 'opponent']);
  assert.equal(join.plays, 2);
  env.settings.sfx = .25; env.api.refresh(); assert.equal(join.volume, .0875);
  env.api.cancelSearch(); env.api.searching(); env.api.updatePlayers(['self', 'new-party']);
  assert.equal(join.plays, 2, 'a new queue starts with a fresh baseline');
  env.api.updatePlayers(['self', 'new-party', 'final-opponent']); env.api.found(); env.api.found();
  assert.equal(join.plays, 3);
  join.emit('ended'); env.advance(100);
  assert.equal(env.voices.some(v => v.src.endsWith('/match-ready.wav')), false);
});

test('match-found and loading add no sound, including after the final join clip ends', async () => {
  for (const withJoin of [false, true]) {
    const env = setup(); env.api.enterLobby(); env.api.unlock(); await settle();
    env.api.searching(); env.api.updatePlayers(['self'], 'self');
    if (withJoin) env.api.updatePlayers(['self', 'opponent'], 'self');
    const voicesBefore = env.voices.length;
    const playsBefore = env.voices.map(v => v.plays);
    env.api.found(); env.api.found(); env.advance(1050);
    const join = env.voices.find(v => v.src.endsWith('/player-join.wav'));
    join?.emit('ended'); env.api.loading(); env.advance(2000);
    assert.equal(env.voices.length, voicesBefore);
    assert.deepEqual(env.voices.map(v => v.plays), playsBefore);
    if (join) { assert.equal(join.plays, 1); assert.equal(join.volume, .35); }
  }
});

test('joining the matchmaking roster yourself is silent, including delayed arrival and rejoining', async () => {
  const env = setup(); env.api.enterLobby(); env.api.unlock(); await settle();
  env.api.searching();
  env.api.updatePlayers([], 'self');
  env.api.updatePlayers(['self'], 'self');
  env.api.updatePlayers([], 'self');
  env.api.updatePlayers(['self'], 'self');
  assert.equal(env.voices.some(v => v.src.endsWith('/player-join.wav')), false);
  env.api.updatePlayers(['self', 'opponent'], 'self');
  const join = env.voices.find(v => v.src.endsWith('/player-join.wav'));
  assert.equal(join.plays, 1);
  env.api.updatePlayers(['opponent'], 'self');
  env.api.updatePlayers(['opponent', 'self'], 'self');
  assert.equal(join.plays, 1);
});

test('cancelling before a queued switch prevents a late matchmaking fade', async () => {
  const env = setup(); env.api.enterLobby(); env.api.unlock(); await settle();
  env.voices[0]._time = env.voices[1]._time = 42;
  env.api.searching(); env.api.cancelSearch(); env.advance(1000);
  assert.equal(env.params[0].target, .264); assert.equal(env.params[1].target, 0);
  env.api.searching(); env.advance(1000);
  env.api.cancelSearch(); env.advance(1000);
  assert.equal(env.params[0].target, .264); assert.equal(env.params[1].target, 0);
});

test('silent standby drift is corrected while audible playback and position are preserved', async () => {
  const env = setup(); env.api.enterLobby(); env.api.unlock(); await settle(); env.advance(1800);
  env.voices[0]._time = 42; env.voices[1]._time = 42.12;
  env.api.searching();
  assert.equal(env.voices[0].seeks, 0);
  assert.equal(env.voices[1].seeks, 1);
  assert.ok(Math.abs(env.voices[1].currentTime-env.voices[0].currentTime) < .000001);
  env.advance(600); env.api.cancelSearch(); env.advance(600);
  assert.equal(env.voices[0].seeks, 0, 'do not seek the outgoing audio while it is fading');
});

test('different loop lengths preserve beat phase after their endings', async () => {
  const env = setup(); env.api.enterLobby(); env.api.unlock(); await settle();
  env.voices[0]._time = timing.tracks.lobby.durationSeconds - .1;
  env.voices[1]._time = timing.tracks.matchmaking.durationSeconds - .1;
  env.advance(600); env.api.searching(); env.advance(600);
  assert.equal(env.params[1].target, .264);
  assert.ok(Math.abs(env.voices[0].currentTime-env.voices[1].currentTime) < .0001);
  assert.ok(env.voices.slice(0,2).every(v => v.playbackRate === 1));
});

test('a decoder seek must settle before crossfading the incoming stream', async () => {
  const env = setup(); env.api.enterLobby(); env.api.unlock(); await settle(); env.advance(1800);
  const incoming = env.voices[1]; env.voices[0]._time = 42; incoming._time = 42.12;
  Object.defineProperty(incoming, 'currentTime', {
    get() { return this._time; }, set(time) { this._time = time; this.seeking = true; },
  });
  env.api.searching(); env.advance(600);
  assert.equal(env.params[0].target, .264); assert.equal(env.params[1].target, 0);
  incoming.seeking = false; incoming.emit('seeked'); env.advance(600);
  assert.equal(env.params[1].target, .264);
});

test('lobby keeps playing while the matchmaking stream is not ready; errors fall back', async () => {
  const env = setup({ delayMatchmaking: true });
  env.api.enterLobby(); env.api.unlock(); await settle(); env.api.searching(); env.advance(1000);
  assert.equal(env.params[0].target, .264); assert.equal(env.params[1].target, 0);
  env.release(); await settle(); env.advance(1000);
  assert.equal(env.params[1].target, .264);
  env.voices[1].emit('error'); env.advance(1);
  assert.equal(env.params[0].target, .264); assert.equal(env.params[1].target, 0);
});

test('handoff fades and pauses both; lobby return resumes a Phaser-suspended context', async () => {
  const env = setup(); env.api.enterLobby(); env.api.unlock(); await settle();
  env.api.searching(); env.advance(600);
  assert.equal(env.params[1].target, .264);
  env.api.loading(); env.api.handoff(); assert.ok(env.params.every(p => p.target === 0)); env.advance(1400);
  assert.ok(env.voices.slice(0,2).every(v => v.paused));
  env.api.unlock(); assert.ok(env.voices.slice(0,2).every(v => v.paused));
  const positions = env.voices.slice(0,2).map(v => v.currentTime);
  env.context.state = 'suspended'; const before = env.context.resumes;
  env.api.enterLobby(); await settle();
  assert.equal(env.context.state, 'running'); assert.equal(env.context.resumes, before + 1);
  assert.deepEqual(env.voices.slice(0,2).map(v => v.currentTime), positions);
  env.advance(600); assert.equal(env.params[0].target, .264);
  env.api.handoff(); env.api.enterLobby(); env.advance(1400);
  assert.ok(env.voices.slice(0,2).every(v => !v.paused), 'lobby return cancels a pending pause');
});

test('Ready after battle return completes even when the standby decoder seeks slowly', async () => {
  const env = setup({ seekDelay: 100 });
  env.api.enterLobby(); env.api.unlock(); await settle();
  env.api.setReady(true); env.api.searching(); env.advance(1000);
  env.api.loading(); env.api.handoff(); env.advance(1400);
  env.context.state = 'suspended';
  env.api.enterLobby(); await settle(); env.advance(2500);
  assert.equal(env.params[0].target, .264);
  // Resumed media decoders can advance at different times after being paused.
  env.voices[1]._time += .12;
  const before = env.voices[1].seeks;
  env.api.setReady(true); env.api.searching(); env.advance(2000);
  assert.equal(env.params[1].target, .264, 'ready must reach the relaxed music');
  assert.equal(env.params[0].target, 0);
  assert.equal(env.voices[1].seeks-before, 1, 'a seeked event must not trigger another alignment seek');
});

test('Ready after battle waits for resumed matchmaking playback rather than stale playing state', async () => {
  const env = setup({ delayResumeMatchmaking: true });
  env.api.enterLobby(); env.api.unlock(); await settle();
  env.api.setReady(true); env.advance(1000);
  env.api.handoff(); env.advance(1400);
  env.api.enterLobby(); await settle(); env.advance(1000);
  env.api.setReady(true); env.advance(1000);
  assert.equal(env.params[0].target, .264); assert.equal(env.params[1].target, 0);
  env.release(); await settle(); env.advance(1000);
  assert.equal(env.params[0].target, 0); assert.equal(env.params[1].target, .264);
});

test('hidden tabs cancel pending switches and respect independent music/SFX settings', async () => {
  const env = setup(); env.api.unlock(); env.api.enterLobby(); await settle();
  env.settings.music = 0; env.api.refresh(); assert.ok(env.params.every(p => p.target === 0));
  env.api.setReady(true); assert.equal(env.voices[2].volume, .38);
  env.settings.sfx = 0; env.api.refresh(); assert.equal(env.voices[2].volume, 0);
  env.api.setHidden(true); env.api.found(); env.advance(1000);
  assert.ok(env.voices.every(v => v.paused)); assert.ok(env.params.every(p => p.target === 0));
  env.settings.music = .5; env.api.setHidden(false); await settle(); env.advance(1000);
  assert.equal(env.params[1].target, .132); assert.equal(env.params[0].target, 0);
  assert.ok(env.voices.slice(0,2).every(v => !v.paused));
});

test('HTML audio fallback crossfades the pair at unchanged speed', async () => {
  const env = setup({ webAudio: false });
  env.api.enterLobby(); env.api.unlock(); await settle(); env.advance(2000);
  assert.equal(env.voices[0].volume, .264); assert.equal(env.voices[1].volume, 0);
  env.api.searching(); env.advance(1200);
  assert.equal(env.voices[0].volume, 0); assert.equal(env.voices[1].volume, .264);
  env.api.cancelSearch(); env.advance(1200);
  assert.equal(env.voices[0].volume, .264);
  assert.ok(env.voices.slice(0,2).every(v => v.playbackRate === 1));
});
