#!/usr/bin/env node
// Headless network probe: N real browser clients play one private-party match
// on a real server (production by default) with tracing on, so the server and
// every client write timelines under one run id. Read the results with
// `node scripts/dev/net-report.mjs <runId>`.
//
//   node scripts/dev/net-probe.mjs [--base https://brobattles.dev] [--clients 2]
//     [--mode bank-bust] [--variant bank-bust-3v3] [--map 1] [--char ninja]
//     [--duration 90] [--script mixed|strafe|dash|idle] [--headed] [--cpu-throttle 4]
//     [--run <id>] [--token <token>]
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
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
const runId = String(args.run || `probe-${stamp}`);
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

async function main() {
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
  let exitCode = 0;
  try {
    for (const tag of tags) all.push(await openClient(browser, tag));
    const [owner, ...guests] = all;
    log("clients:", all.map(c => `${c.tag}=${c.me?.data?.username || "guest"}`).join(" "));

    const selection = { modeId, ...(variantId ? { modeVariantId: variantId } : {}), ...(mapId ? { mapId } : {}) };
    const created = await api(owner.page, "/create-party", { selection });
    if (!created.ok) throw new Error(`create-party failed: ${created.status} ${JSON.stringify(created.data)}`);
    const partyId = created.data.partyId;
    log(`party ${partyId} created by ${owner.tag}`);

    for (const g of guests) {
      const req = await api(g.page, "/party/join-request", { partyId });
      if (!req.ok) throw new Error(`${g.tag} join-request failed: ${req.status} ${JSON.stringify(req.data)}`);
      const list = await api(owner.page, "/party/join-requests", { partyId });
      const pending = (list.data?.requests || []).filter(r => String(r.status || "pending") === "pending");
      const request = pending[pending.length - 1];
      if (!request) throw new Error(`no pending join request for ${g.tag}: ${JSON.stringify(list.data)}`);
      const res = await api(owner.page, "/party/join-request/respond", { partyId, requestId: request.requestId, response: "accept" });
      if (!res.ok) throw new Error(`accept failed: ${res.status} ${JSON.stringify(res.data)}`);
      log(`${g.tag} joined party ${partyId}`);
    }

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
    await emit(owner.page, "queue:fill-bots", {});
    log("requested bot fill; waiting for /game/ …");
    await Promise.all(all.map(c => c.page.waitForURL(/\/game\/\d+/, { timeout: 45000 })));
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
    const players = all.map((c, i) => playScript(c.page, steps, deadline, i * 370));
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
    log(`done. Report: node scripts/dev/net-report.mjs ${runId}${isLocal ? " --local" : ""}`);
  } catch (e) {
    exitCode = 1;
    log("probe failed:", e.message);
    for (const c of all) log(`${c.tag} at ${c.page.url().replace(/ntk=[^&]+/, "ntk=…")}`);
  } finally {
    await browser.close().catch(() => {});
  }
  process.exit(exitCode);
}

main();
