#!/usr/bin/env node
// Headless network probe: N real browser clients play one private-party match
// on a real server (production by default) with tracing on, so the server and
// every client write timelines under one run id. Read the results with
// `node scripts/dev/net-report.mjs <runId>`.
//
//   node scripts/dev/net-probe.mjs [--base https://brobattles.dev] [--clients 2]
//     [--mode bank-bust] [--variant bank-bust-3v3] [--map 1] [--char ninja | --char sparrow,thorg]
//     [--duration 90] [--script mixed|strafe|dash|idle|attack|melee|special|fight]
//     [--range 380] [--matches 1] [--baseline <runId>] [--no-report] [--coop]
//     [--net fast,4g | --net "rtt=100,jitter=20,spike=0.01:300;fast"]
//     [--headed] [--cpu-throttle 4] [--run <id>] [--token <token>]
//     [--flags "netProjectileLead=0&netRenderDelay=legacy" | --flags "default;netProjectileLead=0"]
//     [--dense]
//
// Attack scripts ("attack", "melee", "special", "fight") hunt an enemy with a
// per-character fighting profile (FIGHT_PROFILES): close to that character's
// range, face it, press J as fast as its ammo allows (J and I aim along the
// facing toward the nearest enemy), fire the special (I) whenever the super is
// charged, and keep strafing and jumping so both sides are moving targets.
// Probe clients on opposite teams hunt each other first, so most hits are
// human against human. "melee" forces close range, "attack" skips specials,
// --range overrides the distance kept.
//
// Teams: clients alternate team1/team2 (versus) unless --coop puts them all on
// team1. --net gives each client a simulated network (see NET_PRESETS):
// one profile for everyone, or a list (comma between preset names, ';' when a
// raw profile has commas) applied per client, cycling.
//
// --matches N plays N matches in a row in the same browser (fresh guests and
// party each); runs are named <run>-m1, <run>-m2, … The report runs at the end
// (brief) and, with --baseline, is compared against that run. The probe writes
// output/net-traces/<run>/probe.json (net profiles, measured RTT, phases and
// attack counters), which the report reads.
//
// --flags sets the client A/B switches (src/client/lib/netFlags.js) on every
// page the probe opens; the game keeps them through the lobby -> game
// navigation. ';' separates per-client sets, cycling like --net; "default" (or
// an empty set) runs the shipped behaviour, so `--flags "default;netProjectileLead=0"`
// compares both modes in one match. Each client's trace records the values in
// effect (`flags` event) and probe.json the sets asked for.
//
// --dense keeps two clients fighting for the whole run: duels 1v1 on Sky Soil
// (spawns ~800 px apart instead of Bank Bust's ~4400) for 6 matches unless
// --mode/--variant/--map/--matches say otherwise. Duels has one life, so each
// match is short; `net-report --pool` (run automatically) pools the victim
// screen truth of the series.
//
// Token: --token, $BB_NET_TRACE_TOKEN, then .env (local and remote runs).
// Runs on this machine (Playwright's headless shell; its full Chromium with
// --headed; installed Google Chrome with --chrome); never run it on the server.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ---- network simulation (pure, tested) --------------------------------------

// rttMs is added round-trip time (half each way), jitterMs the peak-to-peak
// spread of each one-way delay. A spike (spikeP:spikeMs) is a stall of the
// link: with chance spikeP per 100 ms of traffic in one direction, a message
// is held an extra spikeMs, and, the link being ordered, so is everything
// behind it. Chance per message would make busy links (60 messages a second)
// stall almost every second. The real path (~15 ms to brobattles.dev) comes on top.
export const NET_PRESETS = Object.freeze({
  fast: null,
  wifi: Object.freeze({ rttMs: 40, jitterMs: 8, spikeP: 0, spikeMs: 0 }),
  "4g": Object.freeze({ rttMs: 90, jitterMs: 25, spikeP: 0.01, spikeMs: 200 }),
  bad: Object.freeze({ rttMs: 180, jitterMs: 50, spikeP: 0.02, spikeMs: 400 }),
});

// "4g" or "rtt=100,jitter=20,spike=0.01:300" → { name, rttMs, jitterMs, spikeP, spikeMs } or
// null for no simulation ("fast", "none", "").
// Sky Soil: the two duels spawns are ~800 px apart and nearly level
// (Lushy Peaks and Serenity stack them ~420 px vertically).
export const DENSE_DUELS_MAP = "2";

// --flags: one query string for every client, or ';'-separated per client
// (cycling); "default" or "" for none. Only net<Name>=<value> pairs.
export function parseFlagSets(text, clients) {
  if (text == null || text === true) return Array.from({ length: clients }, () => "");
  const sets = String(text).split(";").map(x => x.trim()).map(set => {
    if (!set || set === "default") return "";
    const params = new URLSearchParams(set);
    for (const [k, v] of params) {
      if (!/^net[A-Z][A-Za-z0-9]{0,39}$/.test(k) || !/^[A-Za-z0-9_.-]{1,40}$/.test(v)) throw new Error(`bad --flags entry "${k}=${v}" (want net<Name>=<value>)`);
    }
    return params.toString();
  });
  return Array.from({ length: clients }, (_, i) => sets[i % sets.length]);
}

export function parseNetProfile(spec) {
  const s = String(spec ?? "").trim().toLowerCase();
  if (!s || s === "fast" || s === "none") return null;
  if (Object.prototype.hasOwnProperty.call(NET_PRESETS, s)) return { name: s, ...NET_PRESETS[s] };
  const out = { name: s, rttMs: 0, jitterMs: 0, spikeP: 0, spikeMs: 0 };
  for (const part of s.split(",").map(x => x.trim()).filter(Boolean)) {
    const [k, v = ""] = part.split("=");
    if (k === "rtt") out.rttMs = Number(v);
    else if (k === "jitter") out.jitterMs = Number(v);
    else if (k === "spike") {
      const [p, ms] = v.split(":");
      out.spikeP = Number(p);
      out.spikeMs = Number(ms);
    } else throw new Error(`unknown net profile field "${k}" in "${spec}" (rtt=, jitter=, spike=p:ms)`);
  }
  for (const k of ["rttMs", "jitterMs", "spikeP", "spikeMs"]) {
    if (!Number.isFinite(out[k]) || out[k] < 0) throw new Error(`bad ${k} in net profile "${spec}"`);
  }
  if (out.spikeP > 1) throw new Error(`spike probability must be <= 1 in "${spec}"`);
  return out;
}

// Per-client list: ';' always separates clients; ',' does too when no item is
// a raw key=value profile. Cycles over the clients like --char.
export function parseNetProfiles(arg, clients) {
  if (arg == null || arg === true || arg === "") return Array.from({ length: clients }, () => null);
  const text = String(arg);
  let items = text.split(";").map(x => x.trim()).filter(Boolean);
  if (items.length === 1 && !items[0].includes("=")) items = items[0].split(",").map(x => x.trim()).filter(Boolean);
  const profiles = items.map(parseNetProfile);
  return Array.from({ length: clients }, (_, i) => profiles[i % profiles.length]);
}

export const SPIKE_WINDOW_MS = 100;

// A one-direction delay source. `elapsedMs` is the link time since the
// previous message, which scales the spike chance.
export function createDelaySource(profile, rand = Math.random) {
  return (elapsedMs = SPIKE_WINDOW_MS) => {
    if (!profile) return 0;
    const chance = profile.spikeP * Math.min(10, Math.max(0, elapsedMs) / SPIKE_WINDOW_MS);
    const spike = profile.spikeP > 0 && rand() < chance ? profile.spikeMs : 0;
    return Math.max(0, profile.rttMs / 2 + (rand() - 0.5) * profile.jitterMs + spike);
  };
}

// One direction of a TCP-like link: every message gets its own delay, but a
// message is never released before the one sent ahead of it (a delayed
// segment holds back later ones), so release = max(previous release, now + delay).
export function createOrderedLink(deliver, delayFn, { now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const queue = [];
  let lastRelease = -Infinity, timer = null, closed = false, onDrain = null;
  // lateMax: how far behind its release time a message was actually handed
  // on (this process's event loop or the Playwright route, not the profile).
  const stats = { messages: 0, delaySum: 0, maxDelay: 0, heldBack: 0, lateMax: 0, late50: 0 };
  const arm = () => {
    if (timer != null || !queue.length) return;
    timer = setTimer(pump, Math.max(0, queue[0].at - now()));
  };
  function pump() {
    timer = null;
    const t = now();
    while (queue.length && queue[0].at <= t + 0.5) {
      const item = queue.shift();
      const late = t - item.at;
      if (late > stats.lateMax) stats.lateMax = late;
      if (late > 50) stats.late50++;
      try { deliver(item.msg); } catch (_) {}
    }
    if (queue.length) arm();
    else if (onDrain) { const fn = onDrain; onDrain = null; fn(); }
  }
  let lastSend = null;
  return {
    send(msg) {
      if (closed) return;
      const t = now();
      const wanted = t + Math.max(0, Number(delayFn(lastSend == null ? undefined : t - lastSend)) || 0);
      lastSend = t;
      const at = Math.max(lastRelease, wanted);
      if (at > wanted) stats.heldBack++;
      lastRelease = at;
      stats.messages++;
      stats.delaySum += at - t;
      if (at - t > stats.maxDelay) stats.maxDelay = at - t;
      queue.push({ at, msg });
      arm();
    },
    // Runs fn once everything already sent has been delivered.
    afterDrain(fn) { if (!queue.length) fn(); else onDrain = fn; },
    close() { closed = true; queue.length = 0; if (timer != null) clearTimer(timer); timer = null; },
    stats: () => ({ ...stats, meanDelay: stats.messages ? stats.delaySum / stats.messages : 0 }),
    get pending() { return queue.length; },
  };
}

// ---- fighting profiles --------------------------------------------------------
//
// keep: horizontal distance held from the target; reach: farthest distance a
// basic attack is pressed at (quick attacks fly along the facing at the
// character's default range, src/shared/characters/<char>.json); dyTol: height
// difference still worth attacking at; everyMs: press interval (ammo cooldown
// plus a frame, the client refuses a press without ammo); special: distance
// at which a charged special is fired (0: self buff, fire whenever charged).
export const FIGHT_PROFILES = Object.freeze({
  sparrow: { keep: 300, reach: 480, dyTol: 90, everyMs: 430, special: 800 },
  ninja: { keep: 230, reach: 450, dyTol: 70, everyMs: 230, special: 400 },
  thorg: { keep: 40, reach: 110, dyTol: 70, everyMs: 590, special: 0 },
  draven: { keep: 80, reach: 165, dyTol: 80, everyMs: 480, special: 210 },
  ozzy: { keep: 360, reach: 900, dyTol: 70, everyMs: 830, special: 0 },
  gloop: { keep: 260, reach: 340, dyTol: 110, everyMs: 430, special: 700 },
});
const DEFAULT_FIGHT = { keep: 260, reach: 420, dyTol: 80, everyMs: 450, special: 400 };

// ---- probe ----------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

function readEnvFile(file, key) {
  try {
    const line = fs.readFileSync(path.join(root, file), "utf8").split(/\r?\n/).find(l => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : null;
  } catch (_) { return null; }
}

const log = (...m) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...m);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const q = (values, p) => {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.floor((v.length - 1) * p))] : null;
};
const r0 = (x) => (Number.isFinite(x) ? Math.round(x) : null);

async function waitFor(page, fn, arg, { timeout = 30000, label = "condition", poll = 200 } = {}) {
  const started = Date.now();
  for (;;) {
    try { const v = await page.evaluate(fn, arg); if (v) return v; } catch (_) {}
    if (Date.now() - started > timeout) throw new Error(`timeout waiting for ${label}`);
    await sleep(poll);
  }
}

async function api(page, url, body) {
  return page.evaluate(async ({ url, body }) => {
    const res = await fetch(url, { method: body === undefined ? "GET" : "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null; try { data = await res.json(); } catch (_) {}
    return { status: res.status, ok: res.ok, data };
  }, { url, body });
}

async function emitAck(page, event, payload, timeout = 8000) {
  return page.evaluate(({ event, payload, timeout }) => new Promise((resolve) => {
    const s = window.__BB_NET_TRACE_SOCKET__;
    if (!s) return resolve({ error: "no traced socket" });
    s.timeout(timeout).emit(event, payload, (err, reply) => resolve(err ? { error: String(err.message || err) } : reply ?? { ok: true }));
  }), { event, payload, timeout });
}

// Emit and wait briefly for one of the named reply events.
async function emitReply(page, event, payload, replies, timeout = 3000) {
  return page.evaluate(({ event, payload, replies, timeout }) => new Promise((resolve) => {
    const s = window.__BB_NET_TRACE_SOCKET__;
    if (!s) return resolve({ error: "no traced socket" });
    const done = (name) => (data) => { for (const r of replies) s.off(r, handlers[r]); resolve({ event: name, data }); };
    const handlers = Object.fromEntries(replies.map(r => [r, done(r)]));
    for (const r of replies) s.once(r, handlers[r]);
    s.emit(event, payload);
    setTimeout(() => { for (const r of replies) s.off(r, handlers[r]); resolve({ event: "timeout" }); }, timeout);
  }), { event, payload, replies, timeout });
}

// Round trips through the (possibly simulated) socket: an event every handler
// acknowledges at once. In a match, game:clock (also what the client's clock
// sync uses); in the lobby, party:slot:move without a party (an immediate error ack).
async function pingSocket(page, event, count = 5, spacingMs = 120) {
  return page.evaluate(async ({ event, count, spacingMs }) => {
    const s = window.__BB_NET_TRACE_SOCKET__;
    const out = [];
    for (let i = 0; i < count && s?.connected; i++) {
      const t0 = performance.now();
      const ok = await new Promise(res => s.timeout(3000).emit(event, {}, (err) => res(!err)));
      if (ok) out.push(performance.now() - t0);
      await new Promise(r => setTimeout(r, spacingMs));
    }
    return out;
  }, { event, count, spacingMs }).catch(() => []);
}

function createProbe(args) {
  const base = String(args.base || "https://brobattles.dev").replace(/\/$/, "");
  const isLocal = /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base);
  const token = args.token || process.env.BB_NET_TRACE_TOKEN || readEnvFile(".env", "BB_NET_TRACE_TOKEN");
  if (!token) {
    console.error("No trace token. Pass --token, set BB_NET_TRACE_TOKEN, or add it to .env.");
    process.exit(2);
  }
  const dense = !!args.dense;
  const clients = Math.max(1, Math.min(6, Number(args.clients) || 2));
  const modeId = String(args.mode || (dense ? "duels" : "bank-bust"));
  const variantId = String(args.variant || (modeId === "bank-bust" ? "bank-bust-3v3" : modeId === "duels" ? (dense && clients <= 2 ? "duels-1v1" : "duels-2v2") : ""));
  const mapId = args.map != null ? String(args.map) : dense && modeId === "duels" ? DENSE_DUELS_MAP : null;
  let flagSets;
  try { flagSets = parseFlagSets(args.flags, clients); } catch (e) { console.error(e.message); process.exit(2); }
  const characters = args.char ? String(args.char).split(",").map(x => x.trim()).filter(Boolean) : [];
  const characterFor = (i) => characters.length ? characters[i % characters.length] : null;
  const durationS = Number(args.duration) || 90;
  const script = String(args.script || "mixed");
  const matches = Math.max(1, Math.min(10, Number(args.matches) || (dense ? 6 : 1)));
  const versus = !args.coop;
  let netProfiles;
  try { netProfiles = parseNetProfiles(args.net, clients); } catch (e) { console.error(e.message); process.exit(2); }
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const baseRunId = String(args.run || `probe-${stamp}`);
  const tags = Array.from({ length: clients }, (_, i) => `c${i}`);
  return { base, isLocal, token, clients, modeId, variantId, mapId, characters, characterFor, durationS, script, matches,
    versus, netProfiles, baseRunId, tags, runId: baseRunId, flagSets, dense };
}

// Wall-clock per phase, printed at the end and stored in probe.json.
function createPhases() {
  const list = [];
  let current = null;
  return {
    start(name) { const now = Date.now(); if (current) current.ms = now - current.at; current = { name, at: now }; list.push(current); },
    end() { if (current) current.ms = Date.now() - current.at; current = null; },
    list: () => list.map(p => ({ name: p.name, ms: p.ms ?? Date.now() - p.at })),
  };
}

// Route the page's socket.io websocket through Playwright and delay each
// direction per the profile, preserving order.
async function installNetSim(context, profile, tag) {
  const links = [];
  if (!profile) return { links, profile: null };
  await context.routeWebSocket(/\/socket\.io\//, (ws) => {
    const server = ws.connectToServer();
    const up = createOrderedLink((m) => server.send(m), createDelaySource(profile));
    const down = createOrderedLink((m) => ws.send(m), createDelaySource(profile));
    links.push({ up, down });
    ws.onMessage((m) => up.send(m));
    server.onMessage((m) => down.send(m));
    const validCode = (code) => (code === 1000 || (code >= 3000 && code <= 4999) ? { code } : {});
    ws.onClose((code, reason) => up.afterDrain(() => { try { server.close({ ...validCode(code), reason }); } catch (_) {} down.close(); }));
    server.onClose((code, reason) => down.afterDrain(() => { try { ws.close({ ...validCode(code), reason }); } catch (_) {} up.close(); }));
  });
  log(`${tag} net ${profile.name}: +${profile.rttMs}ms rtt, jitter ${profile.jitterMs}ms, spikes ${(profile.spikeP * 100).toFixed(1)}% per ${SPIKE_WINDOW_MS}ms of ${profile.spikeMs}ms`);
  return { links, profile };
}

function linkStats(sim) {
  const blank = () => ({ messages: 0, heldBack: 0, maxDelay: 0, delaySum: 0, lateMax: 0, late50: 0 });
  const sum = { up: blank(), down: blank() };
  for (const l of sim.links) for (const dir of ["up", "down"]) {
    const s = l[dir].stats();
    sum[dir].messages += s.messages; sum[dir].heldBack += s.heldBack; sum[dir].delaySum += s.delaySum; sum[dir].late50 += s.late50;
    sum[dir].maxDelay = Math.max(sum[dir].maxDelay, s.maxDelay);
    sum[dir].lateMax = Math.max(sum[dir].lateMax, s.lateMax);
  }
  for (const dir of ["up", "down"]) {
    sum[dir].meanDelay = sum[dir].messages ? Math.round(sum[dir].delaySum / sum[dir].messages) : null;
    sum[dir].maxDelay = Math.round(sum[dir].maxDelay);
    sum[dir].lateMax = Math.round(sum[dir].lateMax);
    delete sum[dir].delaySum;
  }
  return sum;
}

async function openClient(P, args, browser, tag, i) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const sim = await installNetSim(context, P.netProfiles[i], tag);
  const page = await context.newPage();
  page.on("pageerror", (e) => log(`${tag} pageerror:`, e.message.slice(0, 200)));
  page.on("crash", () => log(`${tag} page crashed`));
  page.on("console", (m) => { if (m.type() === "error") log(`${tag} console.error:`, m.text().slice(0, 200)); });
  if (args["cpu-throttle"]) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(args["cpu-throttle"]) || 1 });
  }
  await page.goto(`${P.base}/?${traceQuery(P, tag)}`, { waitUntil: "domcontentloaded" });
  await waitFor(page, () => !!window.__BB_NET_TRACE_SOCKET__?.connected, null, { label: `${tag} socket` });
  const legal = await api(page, "/api/legal/status");
  if (legal.data && !legal.data.accepted) {
    await api(page, "/api/legal/accept", { accepted: true, termsVersion: legal.data.termsVersion, privacyVersion: legal.data.privacyVersion });
  }
  return { tag, index: i, context, page, sim, name: null, rtt: { lobby: [], game: [] } };
}

// A client without flags clears any stored ones (netflags=off).
const traceQuery = (P, tag) => `nettrace=${encodeURIComponent(P.runId)}&ntk=${encodeURIComponent(P.token)}&ntag=${tag}` +
  `&${P.flagSets?.[P.tags.indexOf(tag)] || "netflags=off"}`;

async function partyMembers(page, partyId) {
  const res = await api(page, "/party-members", { partyId });
  return (res.data?.members || []).map(m => ({ name: m.name || m.username, team: m.team }));
}

async function setupParty(P, all) {
  const [owner, ...guests] = all;
  const selection = { modeId: P.modeId, ...(P.variantId ? { modeVariantId: P.variantId } : {}), ...(P.mapId ? { mapId: P.mapId } : {}) };
  const created = await api(owner.page, "/create-party", { selection });
  if (!created.ok) throw new Error(`create-party failed: ${created.status} ${JSON.stringify(created.data)}`);
  owner.partyId = created.data.partyId;
  const known = new Set();
  for (const m of await partyMembers(owner.page, owner.partyId)) { known.add(m.name); owner.name = m.name; }
  log(`party ${owner.partyId} created by ${owner.tag}=${owner.name}`);
  for (const g of guests) {
    const req = await api(g.page, "/party/join-request", { partyId: owner.partyId });
    if (!req.ok) throw new Error(`${g.tag} join-request failed: ${req.status} ${JSON.stringify(req.data)}`);
    const list = await api(owner.page, "/party/join-requests", { partyId: owner.partyId });
    const pending = (list.data?.requests || []).filter(r => String(r.status || "pending") === "pending");
    const request = pending[pending.length - 1];
    if (!request) throw new Error(`no pending join request for ${g.tag}: ${JSON.stringify(list.data)}`);
    const res = await api(owner.page, "/party/join-request/respond", { partyId: owner.partyId, requestId: request.requestId, response: "accept" });
    if (!res.ok) throw new Error(`accept failed: ${res.status} ${JSON.stringify(res.data)}`);
    g.name = request.requesterName || null;
    log(`${g.tag}=${g.name || "?"} joined party ${owner.partyId}`);
  }
  return owner;
}

// Fallback when a join request carried no name: members are listed by join
// time, and guests joined in client order.
async function resolveNames(all, owner) {
  if (all.every(c => c.name)) return;
  for (let attempt = 0; attempt < 10; attempt++) {
    const members = await partyMembers(owner.page, owner.partyId);
    const guests = members.map(m => m.name).filter(n => n && n !== owner.name);
    if (guests.length >= all.length - 1) {
      all.slice(1).forEach((c, i) => { c.name ||= guests[i]; });
      return;
    }
    await sleep(300);
  }
  log("could not resolve every guest name; versus targeting falls back to the nearest enemy");
}

// Versus: c0, c2, c4 on team1 and c1, c3, c5 on team2; coop: everyone on team1
// (as far as the team size allows). The party owner moves seats before anyone
// is ready (party:slot:move).
async function arrangeTeams(P, all, owner) {
  const want = all.map((c, i) => P.versus ? { team: i % 2 ? "team2" : "team1", index: Math.floor(i / 2) } : { team: "team1", index: i });
  let members = await partyMembers(owner.page, owner.partyId);
  const teamOf = () => Object.fromEntries(members.map(m => [m.name, m.team]));
  for (const [i, c] of all.entries()) {
    if (!c.name || teamOf()[c.name] === want[i].team) continue;
    const reply = await emitAck(owner.page, "party:slot:move", { partyId: owner.partyId, name: c.name, ...want[i] });
    if (!reply?.ok) log(`${c.tag} seat move to ${want[i].team} refused: ${JSON.stringify(reply).slice(0, 160)}`);
    members = await partyMembers(owner.page, owner.partyId);
  }
  const teams = teamOf();
  for (const c of all) c.team = teams[c.name] || null;
  log(`teams: ${all.map(c => `${c.tag}=${c.team || "?"}`).join(" ")}${P.versus ? " (versus)" : " (coop)"}`);
}

// Live state for the attack scripts, read in one round trip: the hunted enemy
// (the rival probe client if it is on the other team and alive, else the
// nearest enemy), own super charge (from super-update), and RTT samples.
function readFightState({ rival, me }) {
  const T = window.__BB_NET_TRACE__;
  const S = (window.__BB_PROBE__ ||= { charge: 0, max: 0, rtts: [], lastPing: 0 });
  const sock = window.__BB_NET_TRACE_SOCKET__;
  if (sock && S.sock !== sock) {
    S.sock = sock;
    sock.on("super-update", (d) => { if (d?.username === me) { S.charge = Number(d.charge) || 0; S.max = Number(d.maxCharge) || 0; } });
    sock.on("health-update", (d) => { if (d?.username === me) S.health = d.health; });
  }
  const now = performance.now();
  if (sock?.connected && now - S.lastPing > 1500) {
    S.lastPing = now;
    sock.timeout(3000).emit("game:clock", {}, (err) => { if (!err) S.rtts.push(Math.round((performance.now() - now) * 10) / 10); });
  }
  const n = T?.nearestEnemy?.();
  if (!n) return { enemy: null, charge: S.charge, max: S.max, health: S.health };
  let enemy = { name: n.name, dx: n.dx, dy: n.dy };
  if (rival && rival !== n.name) {
    const all = window.__BB_REMOTE_PLAYERS__?.() || [];
    const near = all.find(p => p.name === n.name), r = all.find(p => p.name === rival);
    if (near && r && r.active && r.visible !== false && Number.isFinite(r.x)) {
      const lx = near.x - n.dx, ly = near.y - n.dy;
      const dx = r.x - lx, dy = r.y - ly;
      // Hunt the rival unless it is far away and a bot is right here.
      if (Math.hypot(dx, dy) < 1400 || Math.hypot(n.dx, n.dy) > 500) enemy = { name: r.name, dx, dy, rival: true };
    }
  }
  return { enemy, charge: S.charge, max: S.max, health: S.health };
}

async function playAttackScript(page, deadline, offsetMs, { profile, specials, dashes, rival, me, counters, ctl }) {
  await sleep(offsetMs);
  const held = new Set();
  const hold = (key, down) => {
    if (down === held.has(key)) return;
    if (down) { held.add(key); page.keyboard.down(key).catch(() => {}); }
    else { held.delete(key); page.keyboard.up(key).catch(() => {}); }
  };
  // Taps do not block the loop: Phaser polls JustDown once per frame, so the
  // key stays down ~2 frames.
  const tap = (key, ms = 40) => {
    if (held.has(key)) return;
    held.add(key);
    page.keyboard.down(key).catch(() => {});
    setTimeout(() => { held.delete(key); page.keyboard.up(key).catch(() => {}); }, ms);
  };
  let nextAttack = 0, nextSpecial = 0, nextJump = 0, nextDash = Date.now() + 2500, nextJuke = Date.now() + 700;
  let jukeUntil = 0, jukeDir = 0, outOfLineSince = 0, lastPress = Date.now();
  while (Date.now() < deadline && !page.isClosed() && !ctl.stop) {
    const s = await page.evaluate(readFightState, { rival, me }).catch(() => null);
    const now = Date.now();
    counters.ticks++;
    if (!s?.enemy) { hold("KeyD", false); hold("KeyA", false); await sleep(120); continue; }
    const { dx, dy } = s.enemy;
    const adx = Math.abs(dx), dir = Math.sign(dx) || 1;
    // Move to the kept distance; a short juke away and back keeps the
    // attacker a moving target without leaving range.
    // Back off only when crowded, so a melee rival can still close in.
    let want = adx > profile.keep * 1.25 + 20 ? dir : adx < Math.min(profile.keep * 0.35, 70) ? -dir : 0;
    if (now >= nextJuke) {
      nextJuke = now + 700 + Math.random() * 900;
      jukeUntil = now + 160 + Math.random() * 200;
      jukeDir = Math.random() < 0.5 ? -dir : dir;
    }
    if (now < jukeUntil && adx <= profile.reach) want = jukeDir;
    // Face the target before attacking (the quick attack also turns toward the
    // nearest enemy, which may be someone else when hunting the rival).
    const inLine = Math.abs(dy) <= profile.dyTol;
    // Melee swings a little early: the target walks into the swing.
    const inReach = adx <= profile.reach + (profile.keep < 120 ? 35 : 0);
    // Ammo left unused for long is pressed at a near miss rather than wasted.
    const idleFire = now - lastPress > 2500 && adx <= profile.reach * 2 && Math.abs(dy) <= profile.dyTol * 2;
    const attackNow = now >= nextAttack && ((inReach && (inLine || (outOfLineSince && now - outOfLineSince > 1500))) || idleFire);
    if (attackNow && want === -dir) want = 0;
    hold("KeyD", want > 0 || (attackNow && want === 0 && dir > 0 && adx > 20));
    hold("KeyA", want < 0 || (attackNow && want === 0 && dir < 0 && adx > 20));
    if (inReach && !inLine) outOfLineSince ||= now; else outOfLineSince = 0;
    if (inReach && Math.abs(dy) <= profile.dyTol * 1.5) counters.engagedMs += now - (counters.lastTick || now);
    counters.lastTick = now;
    // Climb toward a target above; random hops keep both sides moving.
    if (now >= nextJump && (dy < -profile.dyTol * 0.7 || Math.random() < 0.06)) {
      nextJump = now + 450 + Math.random() * 400;
      tap("KeyW", 90);
      // A double jump for a target a floor or more above.
      if (dy < -150) setTimeout(() => tap("KeyW", 90), 260);
      counters.jumps++;
    }
    if (attackNow) {
      nextAttack = now + profile.everyMs + Math.random() * 40;
      lastPress = now;
      tap("KeyJ", 40);
      counters.attackPresses++;
    }
    const charged = s.max > 0 && s.charge >= s.max;
    if (specials && charged && now >= nextSpecial && (profile.special === 0 || (Math.hypot(dx, dy) <= profile.special))) {
      nextSpecial = now + 900;
      tap("KeyI", 40);
      counters.specialPresses++;
    }
    if (dashes && now >= nextDash) { nextDash = now + 2500 + Math.random() * 2000; tap("Space", 50); counters.dashes++; }
    await sleep(35);
  }
  for (const key of [...held]) hold(key, false);
}

// Scripted input programs: [key, holdMs] steps, looped until the deadline.
const SCRIPTS = {
  strafe: [["KeyD", 900], ["KeyA", 900], ["KeyD", 300], ["KeyA", 300], ["KeyD", 150], ["KeyA", 150]],
  dash: [["KeyD", 250], ["Space", 60], ["KeyA", 250], ["Space", 60], ["KeyW", 80], ["KeyD", 400], ["Space", 60]],
  idle: [[null, 1500], ["KeyD", 120], [null, 1500], ["KeyA", 120]],
  mixed: [["KeyD", 700], ["KeyW", 90], ["KeyD", 300], ["KeyA", 600], ["Space", 60], ["KeyA", 200], ["KeyW", 90],
    ["KeyW", 90], ["KeyD", 150], ["KeyA", 150], ["KeyD", 150], [null, 900], ["KeyD", 500], ["Space", 60], ["KeyS", 300]],
};
const ATTACK_SCRIPTS = new Set(["attack", "melee", "special", "fight"]);

async function playScript(page, steps, deadline, offsetMs, ctl) {
  await sleep(offsetMs);
  while (Date.now() < deadline && !ctl.stop) {
    for (const [key, hold] of steps) {
      if (Date.now() >= deadline || page.isClosed() || ctl.stop) return;
      if (!key) { await sleep(hold); continue; }
      await page.keyboard.down(key).catch(() => {});
      await sleep(hold);
      await page.keyboard.up(key).catch(() => {});
      await sleep(30);
    }
  }
}

function fightProfileFor(P, args, i) {
  const character = P.characterFor(i);
  const profile = { ...(FIGHT_PROFILES[character] || DEFAULT_FIGHT) };
  if (P.script === "melee") { profile.keep = Math.min(profile.keep, 50); profile.reach = Math.max(profile.reach, 110); }
  if (Number(args.range) > 0) { profile.keep = Number(args.range); profile.reach = Math.max(profile.reach, profile.keep * 1.2); }
  return profile;
}

// The live status line: trace totals plus snapshot-buffer and clock
// diagnostics (`__BB_NETWORK_DIAGNOSTICS__` spreads the buffer's fields at the
// top level and nests `clock`; older shapes nested `snapshot`).
function readStatus() {
  const t = window.__BB_NET_TRACE__?.stats?.() || null;
  const n = window.__BB_NETWORK_DIAGNOSTICS__?.() || null;
  const buf = n?.snapshot || n || {};
  const P = window.__BB_PROBE__;
  const rtts = (P?.rtts || []).slice(-5).sort((a, b) => a - b);
  return { snaps: t?.snaps ?? null, maxGap: t?.maxArrivalGapMs ?? null, corr: t?.corrections ?? n?.corrections?.received ?? null,
    uploads: t?.uploads ?? null, rejected: t?.rejected ?? null, bestRtt: n?.clock?.bestRttMs ?? null,
    pingRtt: rtts.length ? rtts[Math.floor(rtts.length / 2)] : null,
    delay: buf.interpDelayMs ?? null, under: buf.underrunFrames ?? null, traced: !!t };
}

async function playMatch(P, args, all, owner, phases) {
  const partyId = owner.partyId;
  phases.start("party pages");
  await Promise.all(all.map(async c => {
    await c.page.goto(`${P.base}/party/${partyId}?${traceQuery(P, c.tag)}`, { waitUntil: "domcontentloaded" });
    await waitFor(c.page, () => !!window.__BB_NET_TRACE_SOCKET__?.connected, null, { label: `${c.tag} party socket` });
  }));
  // Lobby round trips: confirms each client's simulated network before playing.
  await Promise.all(all.map(async c => { c.rtt.lobby = await pingSocket(c.page, "party:slot:move", 6, 80); }));
  log(`lobby rtt p50/max: ${all.map(c => `${c.tag} ${r0(q(c.rtt.lobby, 0.5))}/${r0(Math.max(...c.rtt.lobby, -1))}ms`).join(" ")}`);
  phases.start("teams, characters, ready");
  await resolveNames(all, owner);
  await arrangeTeams(P, all, owner);
  if (P.characters.length) {
    const replies = await Promise.all(all.map((c, i) => emitAck(c.page, "char-change", { partyId, character: P.characterFor(i) })));
    log(`char-change: ${all.map((c, i) => `${c.tag}=${P.characterFor(i)} ${replies[i]?.ok === false || replies[i]?.error ? JSON.stringify(replies[i]).slice(0, 80) : "ok"}`).join(" ")}`);
  }
  const ready = await Promise.all(all.map(c => emitAck(c.page, "ready:status", { partyId, ready: true })));
  for (const [i, c] of all.entries()) if (ready[i]?.ok === false || ready[i]?.error) log(`${c.tag} ready`, JSON.stringify(ready[i]).slice(0, 160));
  await sleep(400);
  phases.start("queue → /game/");
  // The previous match's room lingers until it is abandoned; fill again until
  // the party is placed in a new match.
  const fill = () => emitReply(owner.page, "queue:fill-bots", {}, ["queue:fill-bots:ok", "queue:fill-bots:error"])
    .then(r => { if (r.event !== "queue:fill-bots:ok") log("bot fill:", JSON.stringify(r).slice(0, 200)); }).catch(() => {});
  await fill();
  const refill = setInterval(fill, 5000);
  try {
    await Promise.all(all.map(c => c.page.waitForURL(/\/game\/\d+/, { timeout: 75000 })));
  } finally { clearInterval(refill); }
  const matchId = owner.page.url().match(/\/game\/(\d+)/)?.[1];
  log(`match ${matchId} loading`);

  // Snapshots only flow after FIGHT (loading, intro and countdown are the server's).
  phases.start("load + countdown");
  await Promise.all(all.map(c => waitFor(c.page, () => (window.__BB_NET_TRACE__?.stats().snaps || 0) > 5, null,
    { timeout: 60000, label: `${c.tag} first snapshots`, poll: 100 })));
  log("FIGHT — playing");
  // The switches the game page actually runs with (also in each trace's `flags` event).
  for (const c of all) {
    c.flagsInEffect = await c.page.evaluate(() => {
      const n = window.__BB_NETWORK_DIAGNOSTICS__?.();
      return n ? { ...(n.experiments || {}), projectileLead: n.clock?.projectileLead ?? null } : null;
    }).catch(() => null);
  }
  if (P.flagSets.some(Boolean)) log(`flags in effect: ${all.map(c => `${c.tag} ${JSON.stringify(c.flagsInEffect)}`).join(" | ")}`);
  phases.start("play");
  await Promise.all(all.map(c => c.page.mouse.click(640, 360).catch(() => {})));

  const deadline = Date.now() + P.durationS * 1000;
  const steps = SCRIPTS[P.script] || SCRIPTS.mixed;
  const attack = ATTACK_SCRIPTS.has(P.script);
  // engagedMs: time the hunted enemy was within reach and roughly level.
  for (const c of all) c.counters = { ticks: 0, attackPresses: 0, specialPresses: 0, jumps: 0, dashes: 0, engagedMs: 0 };
  const ctl = { stop: false };
  const players = all.map((c, i) => {
    if (!attack) return playScript(c.page, steps, deadline, i * 370, ctl);
    const rival = P.versus ? all.find(o => o !== c && o.team && o.team !== c.team)?.name || null : null;
    return playAttackScript(c.page, deadline, i * 150, { profile: fightProfileFor(P, args, i),
      specials: P.script !== "attack", dashes: P.script === "fight", rival, me: c.name, counters: c.counters, ctl });
  });
  let lastSnaps = all.map(() => 0);
  const status = setInterval(async () => {
    const lines = await Promise.all(all.map(async (c, i) => {
      try {
        const s = await c.page.evaluate(readStatus);
        if (!s.traced) return `${c.tag} (no trace on this page)`;
        const rate = s.snaps != null ? Math.round((s.snaps - lastSnaps[i]) / 5) : null;
        lastSnaps[i] = s.snaps ?? 0;
        return `${c.tag} snaps=${s.snaps} (${rate}/s) maxGap=${r0(s.maxGap)}ms corr=${s.corr} rtt=${r0(s.pingRtt) ?? "-"}ms (best ${r0(s.bestRtt) ?? "-"}) delay=${r0(s.delay) ?? "-"}ms underruns=${s.under ?? "-"} up=${s.uploads}/${s.rejected} J=${c.counters?.attackPresses ?? 0} I=${c.counters?.specialPresses ?? 0} engaged=${Math.round((c.counters?.engagedMs || 0) / 1000)}s`;
      } catch (e) { return `${c.tag} (${e.message.slice(0, 40)})`; }
    }));
    log(lines.join(" | "));
  }, 5000);
  const playStarted = Date.now();
  // A duels match ends at the first team wipe; stop playing once every page
  // has seen the results instead of idling to the deadline.
  const over = Promise.all(all.map(c => c.page.waitForURL(u => !/\/game\/\d+/.test(String(u)), { timeout: P.durationS * 1000 + 5000 }).catch(() => {})));
  const ended = await Promise.race([Promise.all(players), over.then(() => "over")]);
  ctl.stop = true;
  await Promise.all(players);
  clearInterval(status);
  if (ended === "over") log("match ended before the deadline");
  phases.start("flush");
  log(`played ${Math.round((Date.now() - playStarted) / 1000)}s`);
  for (const c of all) {
    c.rtt.game = await c.page.evaluate(() => window.__BB_PROBE__?.rtts || []).catch(() => c.rtt.game);
    c.clock = await c.page.evaluate(() => window.__BB_NETWORK_DIAGNOSTICS__?.()?.clock || null).catch(() => null);
  }
  await Promise.all(all.map(c => c.page.evaluate(() => window.__BB_NET_TRACE__?.flush()).catch(() => {})));
  await sleep(1200);
  return { matchId };
}

function writeProbeMeta(P, all, phases, match) {
  const dir = path.join(root, "output", "net-traces", P.runId);
  fs.mkdirSync(dir, { recursive: true });
  const meta = {
    runId: P.runId, base: P.base, mode: P.modeId, variant: P.variantId, script: P.script, durationS: P.durationS,
    versus: P.versus, matchId: match?.matchId ?? null,
    clients: Object.fromEntries(all.map((c, i) => [c.tag, {
      name: c.name, team: c.team || null, character: P.characterFor(i), net: c.sim.profile, flags: P.flagSets[i] || null,
      flagsInEffect: c.flagsInEffect ?? null,
      rtt: {
        lobby: { n: c.rtt.lobby.length, p50: r0(q(c.rtt.lobby, 0.5)), min: r0(Math.min(...c.rtt.lobby)) },
        game: { n: c.rtt.game.length, p50: r0(q(c.rtt.game, 0.5)), p95: r0(q(c.rtt.game, 0.95)), min: r0(Math.min(...c.rtt.game)), max: r0(Math.max(...c.rtt.game)) },
        clockBest: r0(c.clock?.bestRttMs),
      },
      link: c.sim.profile ? linkStats(c.sim) : null,
      counters: c.counters ? { ...c.counters, lastTick: undefined, engagedMs: Math.round(c.counters.engagedMs) } : null,
    }])),
    phases: phases.list(),
  };
  for (const c of Object.values(meta.clients)) for (const k of ["lobby", "game"]) for (const [f, v] of Object.entries(c.rtt[k])) if (!Number.isFinite(v)) c.rtt[k][f] = null;
  fs.writeFileSync(path.join(dir, "probe.json"), JSON.stringify(meta, null, 1));
  return meta;
}

// Trace files append, so a reused run id would mix two matches in one report.
async function assertFreshRun(P, ids) {
  const { execFileSync } = await import("node:child_process");
  for (const id of ids) {
    if (fs.existsSync(path.join(root, "output", "net-traces", id))) throw new Error(`run ${id} already exists in output/net-traces; pick another --run`);
  }
  if (P.isLocal) return;
  const remote = process.env.BB_NET_TRACE_REMOTE || "nisch@100.94.147.111";
  const dir = process.env.BB_NET_TRACE_REMOTE_DIR || "~/Desktop/Game/data/net-traces";
  const found = execFileSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20", remote,
    ids.map(id => `test -e ${dir}/${id} && echo ${id}`).join("; ") + "; true"], { encoding: "utf8" }).trim();
  if (found) throw new Error(`run ${found.split("\n").join(", ")} already exists on the server; pick another --run`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const P = createProbe(args);
  const phases = createPhases();
  const started = Date.now();
  phases.start("check run id");
  const ids = P.matches > 1 ? Array.from({ length: P.matches }, (_, i) => `${P.baseRunId}-m${i + 1}`) : [P.baseRunId];
  try { await assertFreshRun(P, ids); } catch (e) { log(e.message); process.exit(2); }
  log(`run ${P.runId} → ${P.base} (${P.clients} clients, ${P.modeId}:${P.variantId || "default"}${P.mapId ? ` map ${P.mapId}` : ""}, ${P.durationS}s, script=${P.script}, ${P.versus ? "versus" : "coop"}, net ${P.netProfiles.map(p => p?.name || "fast").join("/")}${P.flagSets.some(Boolean) ? `, flags ${P.flagSets.map(f => f || "default").join(" / ")}` : ""})`);
  if (P.modeId === "duels" && ATTACK_SCRIPTS.has(P.script) && P.matches < 3) log("note: duels has one life per fighter, so a dense fight ends the match in ~20–40 s; use --dense (several 1v1 matches, pooled) for attack samples.");
  phases.start("launch browser");
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    // Playwright's headless shell by default (`npx playwright-core install
    // chromium-headless-shell`); Playwright's Chromium for --headed
    // (`npx playwright-core install chromium`); installed Google Chrome only
    // with --chrome (on the dev Mac it is killed ~30 s after launch).
    ...(args.chrome ? { channel: "chrome" } : {}),
    headless: !args.headed,
    // Real GPU (Metal) instead of SwiftShader, so client frame pacing is realistic.
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows", "--autoplay-policy=no-user-gesture-required", "--mute-audio"],
  });
  browser.on("disconnected", () => log("browser disconnected"));
  let all = [];
  const runIds = [];
  let reportRuns = [];
  let exitCode = 0;
  try {
    for (let m = 1; m <= P.matches; m++) {
      P.runId = P.matches > 1 ? `${P.baseRunId}-m${m}` : P.baseRunId;
      runIds.push(P.runId);
      log(`match ${m}/${P.matches}: run ${P.runId}`);
      // Fresh guests and party per match in the same browser: re-queueing a
      // party that just left a live match is not reliable.
      await Promise.all(all.splice(0).map(c => c.context.close().catch(() => {})));
      phases.start(m > 1 ? `open clients (m${m})` : "open clients");
      all = await Promise.all(P.tags.map((tag, i) => openClient(P, args, browser, tag, i)));
      phases.start("party setup");
      const owner = await setupParty(P, all);
      const match = await playMatch(P, args, all, owner, phases);
      phases.end();
      writeProbeMeta(P, all, phases, match);
      reportRuns = runIds.slice();
    }
    log(`done. Report: node scripts/dev/net-report.mjs ${runIds.join(" ")}${P.isLocal ? " --local" : ""}`);
  } catch (e) {
    exitCode = 1;
    log("probe failed:", e.message);
    for (const c of all) log(`${c.tag} at ${c.page.url().replace(/ntk=[^&]+/, "ntk=…")}`);
  } finally {
    await browser.close().catch(() => {});
  }
  // Brief report (verdict and key lines) per match, then a comparison.
  if (!args["no-report"]) {
    phases.start("report");
    const { execFileSync } = await import("node:child_process");
    for (const id of reportRuns) {
      try {
        const out = execFileSync(process.execPath, [path.join(root, "scripts/dev/net-report.mjs"), id, "--brief", ...(P.isLocal ? ["--local"] : []),
          ...(args.baseline ? ["--baseline", String(args.baseline)] : [])], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
        console.log(out);
      } catch (e) { log(`report ${id} failed: ${e.message.slice(0, 200)}`); }
    }
    if (reportRuns.length > 1) {
      try {
        console.log(execFileSync(process.execPath, [path.join(root, "scripts/dev/net-report.mjs"), "--pool", ...reportRuns],
          { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }));
      } catch (e) { log(`pooled report failed: ${e.message.slice(0, 200)}`); }
    }
  }
  phases.end();
  log(`wall clock ${Math.round((Date.now() - started) / 1000)}s: ${phases.list().map(p => `${p.name} ${(p.ms / 1000).toFixed(1)}s`).join(", ")}`);
  process.exit(exitCode);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
