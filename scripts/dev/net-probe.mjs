#!/usr/bin/env node
// Headless network probe: N real browser clients play one private-party match
// on a real server (production by default) with tracing on, so the server and
// every client write timelines under one run id. Read the results with
// `node scripts/dev/net-report.mjs <runId>`.
//
//   node scripts/dev/net-probe.mjs [--base https://brobattles.dev] [--clients 2]
//     [--mode bank-bust] [--variant bank-bust-3v3] [--map 1] [--char ninja]
//     [--duration 90] [--script mixed|strafe|dash|idle|attack|melee|special|fight]
//     [--range 380] [--matches 1] [--baseline <runId>] [--no-report]
//     [--headed] [--cpu-throttle 4] [--run <id>] [--token <token>]
//
// Attack scripts steer each client toward the nearest enemy and attack with the
// keyboard (J basic, I special; both auto-aim at the nearest enemy): "attack"
// keeps ranged distance, "melee" closes in, "special" also fires specials,
// "fight" mixes attack with dashes and jumps. --range overrides the distance.
// --matches N plays N matches in a row in the same browser (fresh guests and
// party each); runs are named <run>-m1, <run>-m2, … The report runs at the end (brief) and, with
// --baseline, is compared against that run.
//
// Token: --token, $BB_NET_TRACE_TOKEN, .env.nettrace, then (localhost only) .env.
// Runs on this machine (Playwright headless shell, or Google Chrome with
// --chrome/--headed); never run it on the server.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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

const args = parseArgs(process.argv.slice(2));
const base = String(args.base || "https://brobattles.dev").replace(/\/$/, "");
const isLocal = /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base);
const token = args.token || process.env.BB_NET_TRACE_TOKEN || readEnvFile(".env.nettrace", "BB_NET_TRACE_TOKEN")
  || (isLocal ? readEnvFile(".env", "BB_NET_TRACE_TOKEN") : null);
if (!token) {
  console.error("No trace token. Pass --token, set BB_NET_TRACE_TOKEN, or add it to .env.nettrace.");
  process.exit(2);
}
const clients = Math.max(1, Math.min(6, Number(args.clients) || 2));
const modeId = String(args.mode || "bank-bust");
const variantId = String(args.variant || (modeId === "bank-bust" ? "bank-bust-3v3" : modeId === "duels" ? "duels-2v2" : ""));
const mapId = args.map != null ? String(args.map) : null;
const character = args.char ? String(args.char) : null;
const durationS = Number(args.duration) || 90;
const script = String(args.script || "mixed");
const matches = Math.max(1, Math.min(10, Number(args.matches) || 1));
const MELEE = new Set(["thorg", "draven"]);
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
const baseRunId = String(args.run || `probe-${stamp}`);
let runId = baseRunId;
const tags = Array.from({ length: clients }, (_, i) => `c${i}`);

const log = (...m) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...m);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitFor(page, fn, arg, { timeout = 30000, label = "condition", poll = 250 } = {}) {
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

async function emit(page, event, payload) {
  return page.evaluate(({ event, payload }) => { window.__BB_NET_TRACE_SOCKET__?.emit(event, payload); return true; }, { event, payload });
}

const traceQuery = (tag) => `nettrace=${encodeURIComponent(runId)}&ntk=${encodeURIComponent(token)}&ntag=${tag}`;

async function openClient(browser, tag) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => log(`${tag} pageerror:`, e.message.slice(0, 200)));
  page.on("crash", () => log(`${tag} page crashed`));
  page.on("close", () => log(`${tag} page closed`));
  page.on("console", (m) => { if (m.type() === "error") log(`${tag} console.error:`, m.text().slice(0, 200)); });
  if (args["cpu-throttle"]) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(args["cpu-throttle"]) || 1 });
  }
  await page.goto(`${base}/?${traceQuery(tag)}`, { waitUntil: "domcontentloaded" });
  await waitFor(page, () => !!window.__BB_NET_TRACE_SOCKET__?.connected, null, { label: `${tag} socket` });
  const legal = await api(page, "/api/legal/status");
  if (legal.data && !legal.data.accepted) {
    await api(page, "/api/legal/accept", { accepted: true, termsVersion: legal.data.termsVersion, privacyVersion: legal.data.privacyVersion });
  }
  const me = await api(page, "/api/site/session").catch(() => null);
  return { tag, context, page, me };
}

// Scripted input programs: [key, holdMs] steps, looped until the deadline.
const SCRIPTS = {
  strafe: [["KeyD", 900], ["KeyA", 900], ["KeyD", 300], ["KeyA", 300], ["KeyD", 150], ["KeyA", 150]],
  dash: [["KeyD", 250], ["Space", 60], ["KeyA", 250], ["Space", 60], ["KeyW", 80], ["KeyD", 400], ["Space", 60]],
  idle: [[null, 1500], ["KeyD", 120], [null, 1500], ["KeyA", 120]],
  mixed: [["KeyD", 700], ["KeyW", 90], ["KeyD", 300], ["KeyA", 600], ["Space", 60], ["KeyA", 200], ["KeyW", 90],
    ["KeyW", 90], ["KeyD", 150], ["KeyA", 150], ["KeyD", 150], [null, 900], ["KeyD", 500], ["Space", 60], ["KeyS", 300]],
};

async function playScript(page, steps, deadline, offsetMs) {
  await sleep(offsetMs);
  while (Date.now() < deadline) {
    for (const [key, hold] of steps) {
      if (Date.now() >= deadline || page.isClosed()) {
        if (process.env.PROBE_DEBUG) log(`script exit: left=${deadline - Date.now()}ms closed=${page.isClosed()}`);
        return;
      }
      if (!key) { await sleep(hold); continue; }
      await page.keyboard.down(key).catch(() => {});
      await sleep(hold);
      await page.keyboard.up(key).catch(() => {});
      await sleep(30);
    }
  }
}

let reportRuns = [];

// Steer toward the nearest enemy and attack it. Keys are held/released as in
// a real player's hands; J and I auto-aim at the nearest enemy.
const ATTACK_SCRIPTS = new Set(["attack", "melee", "special", "fight"]);
async function playAttackScript(page, deadline, offsetMs, { range, specials, dashes }) {
  await sleep(offsetMs);
  const held = new Set();
  const hold = async (key, down) => {
    if (down === held.has(key)) return;
    if (down) { held.add(key); await page.keyboard.down(key).catch(() => {}); }
    else { held.delete(key); await page.keyboard.up(key).catch(() => {}); }
  };
  const tap = async (key, ms = 50) => { await page.keyboard.down(key).catch(() => {}); await sleep(ms); await page.keyboard.up(key).catch(() => {}); };
  let nextAttack = 0, nextSpecial = Date.now() + 2500, nextJump = 0, nextDash = Date.now() + 3000;
  while (Date.now() < deadline && !page.isClosed()) {
    const e = await page.evaluate(() => window.__BB_NET_TRACE__?.nearestEnemy?.() || null).catch(() => null);
    const now = Date.now();
    if (!e) { await hold("KeyD", false); await hold("KeyA", false); await sleep(150); continue; }
    const want = Math.abs(e.dx) > range ? Math.sign(e.dx) : Math.abs(e.dx) < range * 0.45 && range > 150 ? -Math.sign(e.dx) : 0;
    await hold("KeyD", want > 0);
    await hold("KeyA", want < 0);
    if (e.dy < -90 && now >= nextJump) { nextJump = now + 900; await tap("KeyW", 90); }
    if (Math.abs(e.dy) < 80 && Math.abs(e.dx) <= range * 1.15 && now >= nextAttack) {
      nextAttack = now + 260 + Math.random() * 120;
      await tap("KeyJ", 40);
    }
    if (specials && now >= nextSpecial && Math.abs(e.dx) <= range * 1.2) { nextSpecial = now + 2000; await tap("KeyI", 40); }
    if (dashes && now >= nextDash) { nextDash = now + 2500 + Math.random() * 1500; await tap("Space", 50); }
    await sleep(90);
  }
  for (const key of [...held]) await hold(key, false);
}

async function setupParty(all) {
  const [owner, ...guests] = all;
  log("clients:", all.map(c => `${c.tag}=${c.me?.data?.username || "guest"}`).join(" "));
  const selection = { modeId, ...(variantId ? { modeVariantId: variantId } : {}), ...(mapId ? { mapId } : {}) };
  const created = await api(owner.page, "/create-party", { selection });
  if (!created.ok) throw new Error(`create-party failed: ${created.status} ${JSON.stringify(created.data)}`);
  owner.partyId = created.data.partyId;
  log(`party ${owner.partyId} created by ${owner.tag}`);
  for (const g of guests) {
    const req = await api(g.page, "/party/join-request", { partyId: owner.partyId });
    if (!req.ok) throw new Error(`${g.tag} join-request failed: ${req.status} ${JSON.stringify(req.data)}`);
    const list = await api(owner.page, "/party/join-requests", { partyId: owner.partyId });
    const pending = (list.data?.requests || []).filter(r => String(r.status || "pending") === "pending");
    const request = pending[pending.length - 1];
    if (!request) throw new Error(`no pending join request for ${g.tag}: ${JSON.stringify(list.data)}`);
    const res = await api(owner.page, "/party/join-request/respond", { partyId: owner.partyId, requestId: request.requestId, response: "accept" });
    if (!res.ok) throw new Error(`accept failed: ${res.status} ${JSON.stringify(res.data)}`);
    log(`${g.tag} joined party ${owner.partyId}`);
  }
  return owner;
}

async function playMatch(all, owner, partyId) {
  for (const c of all) {
    await c.page.goto(`${base}/party/${partyId}?${traceQuery(c.tag)}`, { waitUntil: "domcontentloaded" });
    await waitFor(c.page, () => !!window.__BB_NET_TRACE_SOCKET__?.connected, null, { label: `${c.tag} party socket` });
  }
  await sleep(1500);
  if (character) {
    for (const c of all) log(`${c.tag} char-change`, JSON.stringify(await emitAck(c.page, "char-change", { partyId, character })));
  }
  for (const c of all) {
    const reply = await emitAck(c.page, "ready:status", { partyId, ready: true });
    log(`${c.tag} ready`, JSON.stringify(reply).slice(0, 160));
  }
  await sleep(1500);
  // The previous match's room lingers until it is abandoned; fill again until
  // the party is placed in a new match.
  const fill = () => emitReply(owner.page, "queue:fill-bots", {}, ["queue:fill-bots:ok", "queue:fill-bots:error"])
    .then(r => { if (r.event !== "queue:fill-bots:ok") log("bot fill:", JSON.stringify(r).slice(0, 200)); }).catch(() => {});
  await fill();
  log("requested bot fill; waiting for /game/ …");
  const refill = setInterval(fill, 5000);
  try {
    await Promise.all(all.map(c => c.page.waitForURL(/\/game\/\d+/, { timeout: 75000 })));
  } finally { clearInterval(refill); }
  const matchId = owner.page.url().match(/\/game\/(\d+)/)?.[1];
  log(`match ${matchId} loading`);

  // Snapshots only flow after FIGHT.
  await Promise.all(all.map(c => waitFor(c.page, () => (window.__BB_NET_TRACE__?.stats().snaps || 0) > 5, null,
    { timeout: 60000, label: `${c.tag} first snapshots` })));
  log("FIGHT — playing");
  for (const c of all) await c.page.mouse.click(640, 360).catch(() => {});

  const deadline = Date.now() + durationS * 1000;
  if (process.env.PROBE_DEBUG) log(`deadline in ${deadline - Date.now()}ms`);
  const steps = SCRIPTS[script] || SCRIPTS.mixed;
  const players = all.map((c, i) => {
    if (!ATTACK_SCRIPTS.has(script)) return playScript(c.page, steps, deadline, i * 370);
    const range = Number(args.range) || (script === "melee" || MELEE.has(character) ? 70 : 380);
    return playAttackScript(c.page, deadline, i * 370, { range, specials: script === "special" || script === "fight", dashes: script === "fight" });
  });
  const status = setInterval(async () => {
    const lines = await Promise.all(all.map(async c => {
      try {
        const s = await c.page.evaluate(() => {
          const t = window.__BB_NET_TRACE__?.stats(); const n = window.__BB_NETWORK_DIAGNOSTICS__?.();
          return { t, delay: n?.interpDelayMs, under: n?.underrunFrames, rtt: n?.clock?.bestRttMs, corr: n?.corrections?.total ?? n?.corrections?.count };
        });
        return `${c.tag} snaps=${s.t?.snaps} maxGap=${s.t?.maxArrivalGapMs}ms corr=${s.t?.corrections} rtt=${Math.round(s.rtt ?? -1)} delay=${Math.round(s.delay ?? -1)} underruns=${s.under} up=${s.t?.uploads}/${s.t?.rejected}`;
      } catch (e) { return `${c.tag} (${e.message.slice(0, 40)})`; }
    }));
    log(lines.join(" | "));
  }, 5000);
  const playStarted = Date.now();
  await Promise.all(players);
  clearInterval(status);
  log(`played ${Math.round((Date.now() - playStarted) / 1000)}s`);
  for (const c of all) await c.page.evaluate(() => window.__BB_NET_TRACE__?.flush()).catch(() => {});
  await sleep(2500);
}

// Trace files append, so a reused run id would mix two matches in one report.
async function assertFreshRun(ids) {
  const { execFileSync } = await import("node:child_process");
  for (const id of ids) {
    if (fs.existsSync(path.join(root, "output", "net-traces", id))) throw new Error(`run ${id} already exists in output/net-traces; pick another --run`);
  }
  if (isLocal) return;
  const remote = process.env.BB_NET_TRACE_REMOTE || "nisch@100.94.147.111";
  const dir = process.env.BB_NET_TRACE_REMOTE_DIR || "~/Desktop/Game/data/net-traces";
  const found = execFileSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20", remote,
    ids.map(id => `test -e ${dir}/${id} && echo ${id}`).join("; ") + "; true"], { encoding: "utf8" }).trim();
  if (found) throw new Error(`run ${found.split("\n").join(", ")} already exists on the server; pick another --run`);
}

async function main() {
  try {
    await assertFreshRun(matches > 1 ? Array.from({ length: matches }, (_, i) => `${baseRunId}-m${i + 1}`) : [baseRunId]);
  } catch (e) { log(e.message); process.exit(2); }
  log(`run ${runId} → ${base} (${clients} clients, ${modeId}:${variantId || "default"}${mapId ? ` map ${mapId}` : ""}, ${durationS}s, script=${script})`);
  const browser = await chromium.launch({
    // Playwright's headless shell by default (`npx playwright-core install
    // chromium-headless-shell`); installed Google Chrome for --headed or --chrome.
    ...(args.headed || args.chrome ? { channel: "chrome" } : {}),
    headless: !args.headed,
    // Real GPU (Metal) instead of SwiftShader, so client frame pacing is realistic.
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows", "--autoplay-policy=no-user-gesture-required", "--mute-audio"],
  });
  browser.on("disconnected", () => log("browser disconnected"));
  const all = [];
  const runIds = [];
  reportRuns = [];
  let exitCode = 0;
  try {
    for (let m = 1; m <= matches; m++) {
      runId = matches > 1 ? `${baseRunId}-m${m}` : baseRunId;
      runIds.push(runId);
      log(`match ${m}/${matches}: run ${runId}`);
      // Fresh guests and party per match in the same browser: re-queueing a
      // party that just left a live match is not reliable.
      for (const c of all.splice(0)) await c.context.close().catch(() => {});
      for (const tag of tags) all.push(await openClient(browser, tag));
      const owner = await setupParty(all);
      await playMatch(all, owner, owner.partyId);
      reportRuns = runIds.slice();
    }
    log(`done. Report: node scripts/dev/net-report.mjs ${runIds.join(" ")}${isLocal ? " --local" : ""}`);
    reportRuns = runIds.slice();
  } catch (e) {
    exitCode = 1;
    log("probe failed:", e.message);
    for (const c of all) log(`${c.tag} at ${c.page.url().replace(/ntk=[^&]+/, "ntk=…")}`);
  } finally {
    await browser.close().catch(() => {});
  }
  // Brief report (verdict and key lines) per match, then a comparison.
  if (!args["no-report"]) {
    const { execFileSync } = await import("node:child_process");
    for (const id of reportRuns) {
      try {
        const out = execFileSync(process.execPath, [path.join(root, "scripts/dev/net-report.mjs"), id, "--brief", ...(isLocal ? ["--local"] : []),
          ...(args.baseline ? ["--baseline", String(args.baseline)] : [])], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
        console.log(out);
      } catch (e) { log(`report ${id} failed: ${e.message.slice(0, 200)}`); }
    }
  }
  process.exit(exitCode);
}

main();
