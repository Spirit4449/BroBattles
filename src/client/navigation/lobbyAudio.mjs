import { LOBBY_MUSIC_TIMING as timing } from './lobbyMusicTiming.mjs';

// Navigation owns both streams: party changes cannot restart their transport.
export function createLobbyAudio({ getAudioContext, readSettings, createAudio = src => new Audio(src),
  later = setTimeout, cancel = clearTimeout } = {}) {
  const level = 0.264;
  const channels = new Map(), cues = new Map();
  const cueFiles = { ready: '/assets/ui-sound/ready.mp3', cancel2: '/assets/ui-sound/cancel2.wav',
    playerJoin: '/assets/player-join.wav' };
  let playerKeys;
  let phase = 'game', active = 'lobby', context;
  let unlocked = false, hidden = false, ready = false;
  let stopTimer, switchTimer, syncTimer, volumeTimer, pending, preparing;
  const settings = () => readSettings?.() || { music: 1, sfx: 1 };
  const desired = () => phase === 'lobby' ? 'lobby' : 'matchmaking';
  const available = key => {
    const channel = channels.get(key);
    return channel && !channel.failed && channel.playing && !channel.audio.paused && !channel.audio.seeking;
  };
  const wrap = (time, duration) => ((time % duration) + duration) % duration;
  function cancelSwitch() { cancel(switchTimer); switchTimer = undefined; pending = undefined; }
  function ensureTracks() {
    if (channels.size) return;
    for (const [key, info] of Object.entries(timing.tracks)) {
      const audio = createAudio(info.src);
      audio.loop = true; audio.preload = 'auto'; audio.volume = 0; audio.playbackRate = 1;
      const channel = { key, info, audio, playing: false, failed: false };
      channels.set(key, channel);
      audio.addEventListener?.('error', () => {
        channel.failed = true; channel.playing = false;
        cancelSwitch(); planSwitch();
      });
      audio.addEventListener?.('playing', () => {
        channel.playing = true;
        if (hidden || phase === 'game') { audio.pause(); return; }
        planSwitch();
      });
      audio.addEventListener?.('seeked', planSwitch);
    }
  }
  function connect() {
    context ||= getAudioContext?.();
    if (!context?.createMediaElementSource) return;
    for (const channel of channels.values()) {
      if (channel.gain || channel.direct) continue;
      try {
        channel.source ||= context.createMediaElementSource(channel.audio);
        channel.gain = context.createGain(); channel.gain.gain.value = 0;
        channel.source.connect(channel.gain).connect(context.destination);
        channel.audio.volume = 1;
      } catch (_) {
        // A media element already routed into Web Audio needs a destination,
        // even when gain creation fails and volume falls back to HTML audio.
        if (channel.source) {
          channel.source.connect(context.destination);
          channel.direct = true;
        }
      }
    }
  }
  function ramp(param, target, seconds) {
    const now = context.currentTime;
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
    else { param.cancelScheduledValues(now); param.setValueAtTime(param.value, now); }
    param.setTargetAtTime(target, now, Math.max(0.015, seconds / 4));
  }
  function applyVolume(seconds = timing.beatSeconds) {
    cancel(volumeTimer);
    const volume = hidden || phase === 'game' ? 0 : level * settings().music;
    const fallback = [];
    for (const channel of channels.values()) {
      const target = channel.key === active ? volume : 0;
      if (channel.gain) ramp(channel.gain.gain, target, seconds);
      else fallback.push({ audio: channel.audio, from: channel.audio.volume, target });
    }
    // Keep fades when Web Audio is unavailable, without changing playback speed.
    let elapsed = 0;
    const tick = () => {
      elapsed += 25;
      const t = Math.min(1, elapsed / Math.max(25, seconds * 1000));
      for (const { audio, from, target } of fallback) audio.volume = from + (target-from)*t;
      if (t < 1) volumeTimer = later(tick, 25);
    };
    if (fallback.length) tick();
  }
  function syncIncoming(incoming, reference) {
    if (!incoming || !reference || !available(incoming.key) || !available(reference.key)) return;
    // Never seek a stream that is still audible during a reversed crossfade.
    const volume = incoming.gain ? incoming.gain.gain.value : incoming.audio.volume;
    if (volume > 0.001) return;
    const bar = timing.beatSeconds * 4;
    const delta = wrap(incoming.audio.currentTime - reference.audio.currentTime + bar/2, bar) - bar/2;
    if (Math.abs(delta) < 0.025) return;
    const duration = Number.isFinite(incoming.audio.duration) && incoming.audio.duration > 0
      ? incoming.audio.duration : incoming.info.durationSeconds;
    try { incoming.audio.currentTime = wrap(incoming.audio.currentTime - delta, duration); }
    catch (_) { /* Metadata may still be arriving; retry on the next sync. */ }
  }
  function planSwitch() {
    if (hidden || phase === 'game' || !unlocked) return;
    let next = desired();
    if (!available(next)) next = available(active) ? active : [...channels.keys()].find(available);
    if (!next) return;
    if (pending === next) return;
    cancelSwitch();
    if (next === active) { applyVolume(); return; }
    const reference = channels.get(active);
    // Seek the silent standby before the boundary, allowing its decoder to settle.
    // A seek takes time while the reference keeps advancing. Re-seeking on
    // every seeked event can wait forever, especially after battle resume.
    if (preparing !== next) {
      preparing = next;
      syncIncoming(channels.get(next), reference);
    }
    if (!available(next)) { applyVolume(); return; }
    const delay = available(active)
      ? wrap(-reference.audio.currentTime, timing.beatSeconds) * 1000 : 0;
    pending = next;
    switchTimer = later(() => {
      pending = undefined; switchTimer = undefined;
      if (hidden || phase === 'game') return;
      if (!available(next)) { planSwitch(); return; }
      active = next; preparing = undefined; applyVolume();
    }, delay);
  }
  function scheduleSync() {
    cancel(syncTimer);
    if (!unlocked || hidden || phase === 'game') return;
    syncTimer = later(() => {
      const standby = [...channels.values()].find(channel => channel.key !== active);
      // Do not disturb a prepared stream while its switch waits for a beat.
      if (standby?.key !== preparing) syncIncoming(standby, channels.get(active));
      scheduleSync();
    }, 2000);
  }
  function start() {
    if (!unlocked || hidden || phase === 'game') return;
    ensureTracks();
    try { connect(); } catch (_) { /* HTML audio fallback */ }
    // Phaser can queue a suspend while the context still reports running.
    context?.resume()?.catch(() => {});
    for (const channel of channels.values()) {
      if (channel.failed || channel.starting || (!channel.audio.paused && channel.playing)) continue;
      channel.playing = false;
      channel.starting = true;
      let promise;
      try { promise = channel.audio.play(); }
      catch (_) { channel.starting = false; continue; }
      Promise.resolve(promise).then(() => {
        channel.starting = false; channel.playing = true;
        if (hidden || phase === 'game') { channel.audio.pause(); return; }
        planSwitch();
      }, () => { channel.starting = false; channel.playing = false; });
    }
    planSwitch(); scheduleSync();
  }
  // Battle loading silences the lobby so the match opens on its own pregame cue.
  const LOADING_FADE_SECONDS = 1.2;
  function change(next, seconds = timing.beatSeconds) {
    if (phase === next) return;
    const previousVersion = desired();
    phase = next; cancel(stopTimer); cancelSwitch();
    if (phase === 'game' || previousVersion !== desired()) preparing = undefined;
    if (phase === 'game') {
      cancel(syncTimer); applyVolume(seconds);
      stopTimer = later(() => {
        if (phase === 'game') for (const { audio } of channels.values()) audio.pause();
      }, seconds * 1000 + 200);
    } else { ensureTracks(); start(); applyVolume(seconds); }
  }
  function cue(name, volume) {
    if (!unlocked || hidden || settings().sfx === 0) return;
    let voice = cues.get(name);
    if (!voice) { voice = createAudio(cueFiles[name]); cues.set(name, voice); }
    voice._baseVolume = volume; voice.volume = volume * settings().sfx; voice.currentTime = 0;
    voice.play()?.catch(() => {});
  }
  return {
    enterLobby() {
      if (phase === 'game') { ready = false; playerKeys = undefined; change('lobby', 1.8); }
    },
    setReady(value) {
      if (['found', 'game'].includes(phase) || ready === value) return;
      ready = value; cue(value ? 'ready' : 'cancel2', value ? 0.38 : 0.22);
      if (value && phase === 'searching') return;
      change(value ? 'ready' : 'lobby');
    },
    searching() { if (!['found', 'game'].includes(phase)) change('searching'); },
    updatePlayers(keys, selfKey) {
      const next = new Set(keys.filter(Boolean));
      if (playerKeys && [...next].some(key => key !== selfKey && !playerKeys.has(key))) cue('playerJoin', 0.35);
      playerKeys = next;
    },
    found() {
      if (['found', 'game'].includes(phase)) return;
      change('found');
    },
    cancelSearch() {
      playerKeys = undefined;
      if (phase === 'game') return;
      if (ready || ['searching', 'found'].includes(phase)) cue('cancel2', 0.22);
      ready = false; change('lobby');
    },
    loading() { change('game', LOADING_FADE_SECONDS); },
    handoff() { change('game', 1.1); },
    unlock() { unlocked = true; start(); },
    refresh() {
      applyVolume(0.15);
      for (const voice of cues.values()) voice.volume = voice._baseVolume * settings().sfx;
    },
    setHidden(value) {
      hidden = value;
      if (hidden) {
        preparing = undefined;
        cancelSwitch(); cancel(syncTimer);
        for (const { audio } of channels.values()) audio.pause();
        for (const voice of cues.values()) voice.pause();
        applyVolume(0.05);
      } else { start(); applyVolume(0.5); }
    },
  };
}
